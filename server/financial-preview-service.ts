import type { PGlite } from '@electric-sql/pglite'
import type { FinancialManagerPreview, FinancialPreviewExternalAllocation, IncentiveRule } from '../src/domain.js'
import { serviceDate } from '../src/service-date.js'
import { billTipShares, formatFixed, parseFixed } from './financial-decimal.js'
import { IncentivesCalculationService } from './incentives-calculation-service.js'

const monthPattern = /^(\d{4})-(0[1-9]|1[0-2])$/
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()
const monthDates = (month: string) => {
  const match = monthPattern.exec(month)
  if (!match) throw new Error('Preview month must use YYYY-MM.')
  return Array.from({ length: daysInMonth(Number(match[1]), Number(match[2])) }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
}
const metadata = (value: unknown): Record<string, unknown> => typeof value === 'string' ? JSON.parse(value) : value as Record<string, unknown> || {}
const approvedHelperAmounts = new Set([500n, 1000n, 1500n, 2000n])
const approvedNamedDayUnits = new Map([['AL', 0], ['OFF', 0], ['PH', 1], ['SK', 1], ['TRN', 1], ['ON', 1]])
const workedDayUnits = (duty: { value: string; metadata: Record<string, unknown> }): number | null => {
  const explicit = duty.metadata.billTipWorkedDayUnits
  if (typeof explicit === 'number' && Number.isInteger(explicit) && explicit >= 0) return explicit
  const code = String(duty.metadata.displayCode || duty.value).trim().toUpperCase()
  const approved = approvedNamedDayUnits.get(code)
  if (approved !== undefined) return approved
  if (duty.metadata.countsAsWorking === true) return 1
  return null
}
const tierLabel = (minimum: string, maximum: string | null, rewardMode: string, rewardValue: string) => {
  const range = maximum == null ? `$${Number(minimum).toFixed(0)}+` : `$${Number(minimum).toFixed(0)}–$${Math.floor(Number(maximum))}`
  const reward = rewardMode === 'percentage' ? `${Number(rewardValue).toFixed(1)}%` : `$${Number(rewardValue).toFixed(2)}`
  return `${range} · ${reward}`
}

export class FinancialPreviewService {
  private readonly calculator: IncentivesCalculationService
  constructor(private readonly db: PGlite) { this.calculator = new IncentivesCalculationService(db) }

  async preview(input: { month: string; outletScopeId: string; totalPool: string; externalAllocations: FinancialPreviewExternalAllocation[]; asOfDate?: string }): Promise<FinancialManagerPreview> {
    const dates = monthDates(input.month)
    const start = dates[0]; const end = dates[dates.length - 1]
    const asOfDate = input.asOfDate || serviceDate()
    const poolCents = parseFixed(input.totalPool || '0', 2, 'Total Bill Tip Pool')
    const external = input.externalAllocations.filter(item => item.name.trim() || Number(item.fixedAmount || 0) > 0).map(item => ({ ...item, name: item.name.trim(), fixedAmount: formatFixed(parseFixed(item.fixedAmount || '0', 2, 'External allocation'), 2) }))
    if (external.some(item => !item.name)) throw new Error('External/support staff name is required when an allocation is entered.')
    if (external.some(item => !approvedHelperAmounts.has(parseFixed(item.fixedAmount, 2)))) throw new Error('External/support allocation must be exactly $5, $10, $15 or $20.')
    const externalCents = external.reduce((sum, item) => sum + parseFixed(item.fixedAmount, 2), 0n)
    if (externalCents > poolCents) throw new Error('External/support allocations cannot exceed the total Bill Tip pool.')

    const outlet = (await this.db.query<any>("select id,scope_key,display_name from outlet_scopes where id=$1 and active=true", [input.outletScopeId])).rows[0]
    if (!outlet) throw new Error('Financial preview outlet was not found.')
    const revision = (await this.db.query<any>("select id,revision_number,status,is_authoritative,approved_at::text,approved_by from staff_membership_baseline_reviews where outlet_scope_id=$1 and baseline_month=$2 and status='approved' and is_authoritative=true order by revision_number desc limit 1", [input.outletScopeId, input.month])).rows[0]
    if (!revision) throw new Error('Approved Team Membership revision could not be resolved for this month.')
    const members = (await this.db.query<any>("select h.staff_id,h.effective_from::text,h.effective_to::text,s.full_name,s.staff_number,s.position_key from staff_membership_history h join staff s on s.id=h.staff_id where h.baseline_revision_id=$1 and h.outlet_scope_id=$2 and h.review_status='approved' and h.is_current_baseline=true order by s.full_name", [revision.id, input.outletScopeId])).rows
    if (!members.length) throw new Error('Approved Team Membership revision has no regular Staff members.')

    const rosterRows = (await this.db.query<any>('select staff_id,duty_date::text,duty_code_value from duty_roster_entries where duty_date between $1 and $2 and staff_id=any($3::uuid[])', [start, end, members.map((row: any) => row.staff_id)])).rows
    const dutyRows = (await this.db.query<any>("select value,label,metadata from configuration_options where group_key='duty_codes'")).rows
    const duties = new Map(dutyRows.map((row: any) => [row.value, { ...row, metadata: metadata(row.metadata) }]))
    const unresolvedDuties = dutyRows.filter((row: any) => { const parsed = metadata(row.metadata); return typeof parsed.billTipEligible !== 'boolean' || (parsed.billTipEligible === true && workedDayUnits({ value: row.value, metadata: parsed }) === null) }).map((row: any) => row.value)
    if (unresolvedDuties.length) throw new Error(`Bill Tip eligibility or worked-day credit is not configured for: ${unresolvedDuties.join(', ')}`)
    const roster = new Map(rosterRows.map((row: any) => [`${row.staff_id}|${row.duty_date}`, row.duty_code_value]))
    const staff = members.map((member: any) => {
      const membershipDates = dates.filter(date => date >= member.effective_from && (!member.effective_to || date <= member.effective_to))
      const closedDates = membershipDates.filter(date => date < asOfDate)
      const futureDates = membershipDates.filter(date => date >= asOfDate)
      let eligibleRecordedDays = 0; let alDaysExcluded = 0; let otherExcludedDays = 0; let historicalMissingRosterDays = 0
      for (const date of closedDates) {
        const dutyValue = roster.get(`${member.staff_id}|${date}`)
        if (!dutyValue) { historicalMissingRosterDays++; continue }
        const duty: any = duties.get(dutyValue)
        if (!duty || typeof duty.metadata.billTipEligible !== 'boolean') { historicalMissingRosterDays++; continue }
        const creditedUnits = workedDayUnits(duty)
        if (duty.metadata.billTipEligible && creditedUnits !== null) eligibleRecordedDays += creditedUnits
        else if (duty.metadata.dutyClassification === 'annualLeave' || String(duty.metadata.displayCode || dutyValue).toUpperCase() === 'AL') alDaysExcluded++
        else otherExcludedDays++
      }
      return { staffId: member.staff_id, staffName: member.full_name, staffNumber: member.staff_number, designation: member.position_key, membershipFrom: member.effective_from, membershipTo: member.effective_to, eligibleRecordedDays, alDaysExcluded, otherExcludedDays, historicalMissingRosterDays, futureUnclosedDays: futureDates.length, calculatedBillTip: '0.00', reviewStatus: historicalMissingRosterDays ? 'REVIEW_REQUIRED' as const : 'READY' as const }
    })
    const remainingCents = poolCents - externalCents
    const eligibleDays = staff.map(item => item.eligibleRecordedDays)
    const shares = eligibleDays.some(Boolean) ? billTipShares(remainingCents, eligibleDays) : { totalEligibleDays: 0, valuePerDayMicro: 0n, finalCents: eligibleDays.map(() => 0n), remainderCents: remainingCents }
    staff.forEach((item, index) => { item.calculatedBillTip = formatFixed(shares.finalCents[index], 2) })
    const distributedCents = shares.finalCents.reduce((sum, value) => sum + value, 0n)

    const statusRows = (await this.db.query<any>("select value,metadata from configuration_options where group_key='chargeable_statuses'")).rows
    const realizedStatuses = statusRows.filter((row: any) => metadata(row.metadata).countsAsRealizedRevenue === true).map((row: any) => row.value)
    const pendingStatuses = statusRows.filter((row: any) => metadata(row.metadata).countsAsPendingValue === true).map((row: any) => row.value)
    const chargeables = (await this.db.query<any>('select c.id,c.charge_date::text,c.item_value,c.item_label,c.quantity,c.unit_price::text,c.total_amount::text,c.status,c.waiter_id,s.full_name,s.staff_number,s.position_key from chargeable_item_records c left join staff s on s.id=c.waiter_id where c.outlet_scope_id=$1 and c.charge_date between $2 and $3 and c.active=true order by c.charge_date,c.created_at,c.id', [input.outletScopeId, start, end])).rows
    const pendingRows = chargeables.filter((row: any) => pendingStatuses.includes(row.status))
    const realizedRows = chargeables.filter((row: any) => realizedStatuses.includes(row.status))
    const wineRows = (await this.db.query<any>(`select w.id,w.service_date::text,w.check_invoice_number,w.room_number,w.item_name,w.quantity,w.gross_unit_price::text,w.gross_total::text,w.incentive_eligible_net_unit_price::text,w.incentive_eligible_net_total::text,w.incentive_tier_minimum::text,w.incentive_tier_maximum::text,w.incentive_reward_mode,w.incentive_reward_value::text,w.incentive_per_bottle::text,w.total_beverage_incentive::text,w.status,w.waiter_id,w.financial_rate_version_id,w.incentive_rule_version,fr.version financial_rate_version,s.full_name,s.staff_number
      from wine_spirit_sales w
      join financial_rate_versions fr on fr.id=w.financial_rate_version_id
      left join staff s on s.id=w.waiter_id
      where w.outlet_scope_id=$1 and w.service_date between $2 and $3 and w.archived_at is null
      order by w.service_date,w.created_at,w.id`, [input.outletScopeId, start, end])).rows
    const realizedWineRows = wineRows.filter((row: any) => row.status === 'charged')
    const pendingWineRows = wineRows.filter((row: any) => row.status === 'pending')
    const incentives: FinancialManagerPreview['incentives']['records'] = []
    for (const row of realizedRows) {
      const rateRow = (await this.db.query<any>('select id,version,service_charge_rate::text,gst_rate::text from financial_rate_versions where outlet_scope_id=$1 and active=true and effective_from<=$2 and (effective_to is null or effective_to>=$2) order by effective_from desc,version desc limit 1', [input.outletScopeId, row.charge_date])).rows[0]
      if (!rateRow) throw new Error(`No scoped financial rate resolves for ${row.charge_date}.`)
      const ruleRow = (await this.db.query<any>('select id,rule_key,configuration_option_id,source_key,rule_family,version,effective_from::text,effective_to::text,rate_percent::text,active from incentive_rules where outlet_scope_id=$1 and source_key=$2 and active=true and effective_from<=$3 and (effective_to is null or effective_to>=$3) order by effective_from desc,version desc limit 1', [input.outletScopeId, row.item_value, row.charge_date])).rows[0]
      if (!ruleRow) throw new Error(`No scoped incentive rule resolves for ${row.item_value} on ${row.charge_date}.`)
      const tierRows = (await this.db.query<any>('select id,minimum_amount::text,maximum_amount::text,reward_mode,reward_value::text from incentive_rule_tiers where rule_id=$1 order by sort_order', [ruleRow.id])).rows
      const rule: IncentiveRule = { id: ruleRow.id, ruleKey: ruleRow.rule_key, configurationOptionId: ruleRow.configuration_option_id, sourceKey: ruleRow.source_key, ruleFamily: ruleRow.rule_family, version: Number(ruleRow.version), effectiveFrom: ruleRow.effective_from, effectiveTo: ruleRow.effective_to, ratePercent: ruleRow.rate_percent, active: ruleRow.active, tiers: tierRows.map((tier: any) => ({ id: tier.id, minimumAmount: tier.minimum_amount, maximumAmount: tier.maximum_amount, rewardMode: tier.reward_mode, rewardValue: tier.reward_value })) }
      const calculated = this.calculator.calculateIncentive(rule, row.unit_price, Number(row.quantity), rateRow.service_charge_rate, rateRow.gst_rate)
      incentives.push({ sourceType: 'FOOD', sourceId: row.id, chargeableId: row.id, serviceDate: row.charge_date, itemValue: row.item_value, itemLabel: row.item_label, quantity: Number(row.quantity), grossAmount: calculated.grossTotal, grossUnitPrice: row.unit_price, eligibleNetAmount: calculated.eligibleNetTotal, appliedRule: rule.ruleFamily === 'food_percentage' ? `${rule.ratePercent}% Food` : rule.ruleFamily === 'no_incentive' ? 'No incentive' : 'Wine/Spirits tier', incentive: calculated.finalAmount, soldByStaffId: row.waiter_id || null, soldByName: row.full_name || null, soldByNumber: row.staff_number || null, status: 'PROVISIONAL' as const, reviewStatus: row.waiter_id && row.full_name ? 'READY' : 'REVIEW_REQUIRED', financialRateVersion: Number(rateRow.version), incentiveRuleVersion: rule.version })
    }
    for (const row of realizedWineRows) {
      incentives.push({
        sourceType: 'WINE_SPIRITS', sourceId: row.id, serviceDate: row.service_date,
        checkInvoiceNumber: row.check_invoice_number, roomNumber: row.room_number,
        itemValue: 'wine_spirits', itemLabel: row.item_name, quantity: Number(row.quantity),
        grossAmount: row.gross_total, grossUnitPrice: row.gross_unit_price,
        eligibleNetAmount: row.incentive_eligible_net_total, eligibleNetUnitPrice: row.incentive_eligible_net_unit_price,
        appliedRule: 'Wine / Spirits tier',
        appliedTier: tierLabel(row.incentive_tier_minimum, row.incentive_tier_maximum, row.incentive_reward_mode, row.incentive_reward_value),
        incentive: row.total_beverage_incentive, soldByStaffId: row.waiter_id || null,
        soldByName: row.full_name || null, soldByNumber: row.staff_number || null,
        status: 'PROVISIONAL', reviewStatus: row.waiter_id && row.full_name ? 'READY' : 'REVIEW_REQUIRED',
        financialRateVersion: Number(row.financial_rate_version), incentiveRuleVersion: Number(row.incentive_rule_version),
      })
    }
    const staffIncentives = new Map<string, { staffId: string; staffName: string; staffNumber: string; foodIncentiveCents: bigint; wineSpiritsIncentiveCents: bigint }>()
    for (const item of incentives) {
      if (!item.soldByStaffId || !item.soldByName || !item.soldByNumber) continue
      const current = staffIncentives.get(item.soldByStaffId) || { staffId: item.soldByStaffId, staffName: item.soldByName, staffNumber: item.soldByNumber, foodIncentiveCents: 0n, wineSpiritsIncentiveCents: 0n }
      const amount = parseFixed(item.incentive, 2)
      if (item.sourceType === 'WINE_SPIRITS') current.wineSpiritsIncentiveCents += amount
      else current.foodIncentiveCents += amount
      staffIncentives.set(item.soldByStaffId, current)
    }
    const incentiveSummary = [...staffIncentives.values()].map(item => ({ staffId: item.staffId, staffName: item.staffName, staffNumber: item.staffNumber, foodIncentive: formatFixed(item.foodIncentiveCents, 2), wineSpiritsIncentive: formatFixed(item.wineSpiritsIncentiveCents, 2), totalIncentive: formatFixed(item.foodIncentiveCents + item.wineSpiritsIncentiveCents, 2), wineSpiritsStatus: 'ACTIVE' as const }))
    const incentivesByStaff = new Map(incentiveSummary.map(item => [item.staffId, item]))
    const earnings = staff.map(item => { const incentive = incentivesByStaff.get(item.staffId); const bill = parseFixed(item.calculatedBillTip, 2); const food = parseFixed(incentive?.foodIncentive || '0.00', 2); const wine = parseFixed(incentive?.wineSpiritsIncentive || '0.00', 2); return { staffId: item.staffId, staffName: item.staffName, staffNumber: item.staffNumber, billTips: item.calculatedBillTip, foodIncentives: formatFixed(food, 2), wineSpiritsIncentives: formatFixed(wine, 2), totalExtraEarnings: formatFixed(bill + food + wine, 2), status: item.reviewStatus } })
    return {
      generatedAt: new Date().toISOString(), month: input.month, outlet: { id: outlet.id, key: outlet.scope_key, name: outlet.display_name }, periodStatus: asOfDate <= end ? 'IN_PROGRESS' : 'CLOSED', previewStatus: 'PROVISIONAL', asOfDate,
      membership: { revisionId: revision.id, revisionNumber: Number(revision.revision_number), status: 'APPROVED', approvedAt: revision.approved_at, approvedBy: revision.approved_by, memberCount: members.length },
      billTips: { totalPool: formatFixed(poolCents, 2), externalAllocations: external, externalAllocationTotal: formatFixed(externalCents, 2), remainingRegularTeamPool: formatFixed(remainingCents, 2), totalEligibleRecordedDays: shares.totalEligibleDays, valuePerEligibleDay: formatFixed(shares.valuePerDayMicro, 6), regularStaffDistributed: formatFixed(distributedCents, 2), roundingRemainder: formatFixed(shares.remainderCents, 2), reviewStatus: staff.some(item => item.reviewStatus === 'REVIEW_REQUIRED') ? 'REVIEW_REQUIRED' : 'READY', staff },
      incentives: { realizedRecordCount: realizedRows.length + realizedWineRows.length, realizedGrossAmount: formatFixed(realizedRows.reduce((sum: bigint, row: any) => sum + parseFixed(row.total_amount, 2), realizedWineRows.reduce((sum: bigint, row: any) => sum + parseFixed(row.gross_total, 2), 0n)), 2), pendingExcludedCount: pendingRows.length + pendingWineRows.length, pendingExcludedAmount: formatFixed(pendingRows.reduce((sum: bigint, row: any) => sum + parseFixed(row.total_amount, 2), pendingWineRows.reduce((sum: bigint, row: any) => sum + parseFixed(row.gross_total, 2), 0n)), 2), unattributedRealizedCount: incentives.filter(item => item.reviewStatus === 'REVIEW_REQUIRED').length, unattributedIncentiveAmount: formatFixed(incentives.filter(item => item.reviewStatus === 'REVIEW_REQUIRED').reduce((sum, item) => sum + parseFixed(item.incentive, 2), 0n), 2), reviewStatus: incentives.some(item => item.reviewStatus === 'REVIEW_REQUIRED') ? 'REVIEW_REQUIRED' : 'READY', records: incentives, staffSummary: incentiveSummary, wineSpiritsLiveSource: 'ACTIVE' },
      earnings,
    }
  }
}
