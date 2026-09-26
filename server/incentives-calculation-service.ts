import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { BillTipDraftCalculation, BillTipRosterDiagnostic, ChargeableIncentiveEarning, IncentiveCalculation, IncentiveRule } from '../src/domain.js'
import { billTipShares, eligibleNetFromGrossUnit, formatFixed, parseFixed, percentageMicroDollars, roundMicroDollarsToCents } from './financial-decimal.js'
import { IncentivesRepository } from './incentives-repository.js'
import { assertRecoveryInactive } from './database-recovery.js'

const monthPattern = /^([0-9]{4})-(0[1-9]|1[0-2])$/
const leapYear = (year: number) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
const daysInMonth = (year: number, month: number) => [31, leapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
const monthDates = (monthKey: string) => {
  const match = monthPattern.exec(monthKey)
  if (!match) throw new Error('Distribution month must use YYYY-MM.')
  const year = Number(match[1]); const month = Number(match[2]); const prefix = `${match[1]}-${match[2]}`
  return Array.from({ length: daysInMonth(year, month) }, (_, index) => `${prefix}-${String(index + 1).padStart(2, '0')}`)
}
const json = (value: unknown) => JSON.stringify(value)

export class IncentivesCalculationService {
  private readonly repository: IncentivesRepository

  constructor(private readonly db: PGlite, private readonly recoveryGuard = assertRecoveryInactive) { this.repository = new IncentivesRepository(db) }

  async calculateBillTipDraft(distributionId: string, staffIds: string[], actor = 'Venue Manager'): Promise<BillTipDraftCalculation> {
    const uniqueStaffIds = [...new Set(staffIds)]
    if (!uniqueStaffIds.length) throw new Error('Select at least one regular staff member for the distribution.')
    const distribution = await this.repository.distribution(distributionId)
    if (!distribution) throw new Error('Bill Tip distribution not found.')
    if (distribution.status !== 'draft') throw new Error('Only a draft Bill Tip distribution can be calculated.')
    const dates = monthDates(distribution.distributionMonth)
    const start = dates[0]; const end = dates[dates.length - 1]
    const staffRows: any[] = []
    for (const staffId of uniqueStaffIds) {
      const result = await this.db.query<any>('select id,full_name,staff_number,position_key,join_date::text,resignation_date::text from staff where id=$1', [staffId])
      if (!result.rows[0]) throw new Error(`Regular staff member ${staffId} was not found.`)
      staffRows.push(result.rows[0])
    }
    const rosterRows = await this.db.query<any>('select staff_id,duty_date::text,duty_code_value from duty_roster_entries where duty_date between $1 and $2', [start, end])
    const dutyRows = await this.db.query<any>("select value,label,metadata from configuration_options where group_key='duty_codes'")
    const duties = new Map(dutyRows.rows.map((row: any) => [row.value, { ...row, metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {} }]))
    const roster = new Map(rosterRows.rows.map((row: any) => [`${row.staff_id}|${row.duty_date}`, row.duty_code_value]))
    const diagnostics: BillTipRosterDiagnostic[] = staffRows.map(staff => {
      const expectedDates = dates.filter(date => date >= staff.join_date && (!staff.resignation_date || date <= staff.resignation_date))
      let rosterDaysFound = 0; let eligibleDays = 0; let excludedAlDays = 0; let unresolvedDays = 0
      for (const date of expectedDates) {
        const value = roster.get(`${staff.id}|${date}`)
        if (!value) { unresolvedDays++; continue }
        rosterDaysFound++
        const duty: any = duties.get(value)
        if (!duty || typeof duty.metadata.billTipEligible !== 'boolean') { unresolvedDays++; continue }
        if (duty.metadata.billTipEligible) eligibleDays++
        else if (duty.metadata.dutyClassification === 'annualLeave' || String(duty.metadata.displayCode || value).toUpperCase() === 'AL') excludedAlDays++
      }
      return { staffId: staff.id, staffName: staff.full_name, staffNumber: staff.staff_number, designation: staff.position_key, expectedDays: expectedDates.length, rosterDaysFound, eligibleDays, excludedAlDays, missingRosterDays: unresolvedDays, reviewRequired: unresolvedDays > 0 }
    })
    const manual = await this.db.query<{ total: string }>('select coalesce(sum(fixed_amount),0)::text total from bill_tip_manual_allocations where distribution_id=$1', [distributionId])
    const poolCents = parseFixed(distribution.poolAmount, 2, 'Pool amount')
    const manualCents = parseFixed(manual.rows[0].total, 2, 'External allocation total')
    if (manualCents > poolCents) throw new Error('External/support allocations cannot exceed the monthly Bill Tip pool.')
    const remainingCents = poolCents - manualCents
    const shares = billTipShares(remainingCents, diagnostics.map(item => item.eligibleDays))
    const policyMetadata = { eligibilitySource: 'duty_codes.metadata.billTipEligible', dutyEligibility: Object.fromEntries([...duties.entries()].map(([value, duty]: [string, any]) => [value, duty.metadata.billTipEligible])), expectedCoverage: 'explicit staff scope intersected with join/resignation dates', allocationRounding: 'per-day value truncated to 6 decimals; staff payouts rounded half-up to cents; remainder retained', dateSemantics: 'Maldives date-only', staffIds: uniqueStaffIds }
    await this.db.transaction(async transaction => {
      await transaction.query('delete from bill_tip_staff_allocations where distribution_id=$1', [distributionId])
      for (let index = 0; index < diagnostics.length; index++) {
        const item = diagnostics[index]
        await transaction.query('insert into bill_tip_staff_allocations(id,distribution_id,staff_id,staff_name_snapshot,staff_number_snapshot,designation_snapshot,eligible_days,excluded_al_days,missing_roster_days,requires_roster_review,value_per_eligible_day,calculated_amount,final_amount,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)', [randomUUID(), distributionId, item.staffId, item.staffName, item.staffNumber, item.designation, item.eligibleDays, item.excludedAlDays, item.missingRosterDays, item.reviewRequired, formatFixed(shares.valuePerDayMicro, 6), formatFixed(shares.calculatedMicro[index], 6), formatFixed(shares.finalCents[index], 2), actor])
      }
      await transaction.query("update bill_tip_distributions set external_allocation_total=$2,remaining_team_pool=$3,total_eligible_days=$4,eligible_staff_count=$5,value_per_eligible_day=$6,undistributed_remainder=$7,policy_version='bill-tip-v1',policy_metadata=$8,calculated_at=now(),calculated_by=$9,updated_at=now(),updated_by=$9 where id=$1 and status='draft'", [distributionId, formatFixed(manualCents, 2), formatFixed(remainingCents, 2), shares.totalEligibleDays, diagnostics.filter(item => item.eligibleDays > 0).length, formatFixed(shares.valuePerDayMicro, 6), formatFixed(shares.remainderCents, 2), json(policyMetadata), actor])
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'bill_tip_distribution', distributionId, 'draft_calculated', json(distribution), json({ diagnostics, policyMetadata }), actor])
    })
    return { distribution: (await this.repository.distribution(distributionId))!, staff: diagnostics, blockers: diagnostics.filter(item => item.reviewRequired).map(item => `${item.staffName}: ROSTER ASSIGNMENT MISSING — MANAGER REVIEW REQUIRED`) }
  }

  async finalizeBillTip(distributionId: string, actor = 'Venue Manager') {
    this.recoveryGuard()
    const existing = await this.repository.distribution(distributionId)
    if (!existing) throw new Error('Bill Tip distribution not found.')
    if (existing.status === 'finalized') return existing
    if (!existing.calculatedAt) throw new Error('Calculate the draft distribution before finalizing it.')
    const allocations = await this.db.query<any>('select staff_id,requires_roster_review,final_amount::text from bill_tip_staff_allocations where distribution_id=$1', [distributionId])
    if (allocations.rows.some((row: any) => row.requires_roster_review)) throw new Error('ROSTER ASSIGNMENT MISSING — MANAGER REVIEW REQUIRED')
    if (new Set(allocations.rows.map((row: any) => row.staff_id)).size !== allocations.rows.length) throw new Error('Duplicate staff allocations prevent finalization.')
    const manual = await this.db.query<{ total: string }>('select coalesce(sum(fixed_amount),0)::text total from bill_tip_manual_allocations where distribution_id=$1', [distributionId])
    const staffCents = allocations.rows.reduce((sum: bigint, row: any) => sum + parseFixed(row.final_amount, 2), 0n)
    const reconciled = parseFixed(manual.rows[0].total, 2) + staffCents + parseFixed(existing.undistributedRemainder, 2)
    if (reconciled !== parseFixed(existing.poolAmount, 2)) throw new Error('Bill Tip distribution does not reconcile to the monthly pool.')
    await this.db.transaction(async transaction => {
      const result = await transaction.query<any>("update bill_tip_distributions set status='finalized',finalized_at=now(),finalized_by=$2,updated_at=now(),updated_by=$2 where id=$1 and status='draft' returning id", [distributionId, actor])
      if (!result.rows[0]) throw new Error('Bill Tip distribution changed before finalization.')
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'bill_tip_distribution', distributionId, 'finalized', json(existing), json({ allocationCount: allocations.rows.length, reconciledPool: existing.poolAmount }), actor])
    })
    return (await this.repository.distribution(distributionId))!
  }

  calculateIncentive(rule: IncentiveRule, grossUnitPrice: string, quantity: number, serviceChargeRate: string, gstRate: string): IncentiveCalculation {
    const grossUnitCents = parseFixed(grossUnitPrice, 2, 'Gross unit price')
    const net = eligibleNetFromGrossUnit(grossUnitCents, quantity, serviceChargeRate, gstRate)
    let calculatedMicro = 0n; let rate: string | null = null; let fixed: string | null = null; let minimum: string | null = null; let maximum: string | null = null
    if (rule.ruleFamily === 'food_percentage') {
      if (!rule.ratePercent) throw new Error('Food percentage rule is missing its percentage rate.')
      rate = rule.ratePercent; calculatedMicro = percentageMicroDollars(net.eligibleNetTotalCents, rate)
    } else if (rule.ruleFamily === 'wine_spirits_tier') {
      // Symphony Wine/Spirits prices include Service Charge and GST. Select
      // the tier from one bottle's calculated net value, then multiply the
      // per-bottle reward by quantity.
      const netUnit = eligibleNetFromGrossUnit(grossUnitCents, 1, serviceChargeRate, gstRate)
      const tier = rule.tiers.find(item => netUnit.eligibleNetTotalCents >= parseFixed(item.minimumAmount, 2) && (item.maximumAmount == null || netUnit.eligibleNetTotalCents <= parseFixed(item.maximumAmount, 2)))
      if (!tier) throw new Error('No Wine/Spirits incentive tier matches the net unit price.')
      minimum = tier.minimumAmount; maximum = tier.maximumAmount
      if (tier.rewardMode === 'fixed') { fixed = tier.rewardValue; calculatedMicro = parseFixed(tier.rewardValue, 4) * 100n * BigInt(quantity) }
      if (tier.rewardMode === 'percentage') { rate = tier.rewardValue; calculatedMicro = percentageMicroDollars(netUnit.eligibleNetTotalCents, rate) * BigInt(quantity) }
    }
    return { grossTotal: formatFixed(net.grossTotalCents, 2), eligibleNetTotal: formatFixed(net.eligibleNetTotalCents, 2), appliedRatePercent: rate, appliedFixedAmount: fixed, appliedTierMinimum: minimum, appliedTierMaximum: maximum, calculatedAmount: formatFixed(calculatedMicro, 6), finalAmount: formatFixed(roundMicroDollarsToCents(calculatedMicro), 2) }
  }

  async generateDraftEarning(sourceChargeableItemId: string, actor = 'Venue Manager'): Promise<ChargeableIncentiveEarning> {
    const sourceResult = await this.db.query<any>("select c.id,c.charge_date::text,c.item_value,c.quantity,c.unit_price::text,c.total_amount::text,c.waiter_id,c.status,coalesce((o.metadata->>'countsAsRealizedRevenue')::boolean,false) realized,s.full_name,s.staff_number,s.position_key from chargeable_item_records c left join configuration_options o on o.group_key='chargeable_statuses' and o.value=c.status left join staff s on s.id=c.waiter_id where c.id=$1", [sourceChargeableItemId])
    const source = sourceResult.rows[0]
    if (!source) throw new Error('Source Chargeable Item not found.')
    if (!source.realized) throw new Error('Only realized Chargeable Items can generate incentive earnings.')
    if (!source.waiter_id || !source.full_name) throw new Error('The Chargeable Item must have an authoritative seller assignment.')
    const current = await this.db.query<any>("select id,status from chargeable_incentive_earnings where source_chargeable_item_id=$1 and status in ('draft','finalized') limit 1", [sourceChargeableItemId])
    if (current.rows[0]?.status === 'finalized') return (await this.repository.earning(current.rows[0].id))!
    const rule = await this.repository.ruleForSourceDate(source.item_value, source.charge_date)
    if (!rule) throw new Error('No effective incentive rule exists for this package and service date.')
    const financialRate = await this.repository.financialRateForDate(source.charge_date)
    if (!financialRate) throw new Error('No effective GST/Service Charge rate exists for this service date.')
    const calculation = this.calculateIncentive(rule, source.unit_price, Number(source.quantity), financialRate.serviceChargeRate, financialRate.gstRate)
    const id = current.rows[0]?.id || randomUUID()
    const cycles = await this.db.query<{ count: number }>('select count(*)::int count from chargeable_incentive_earnings where source_chargeable_item_id=$1', [sourceChargeableItemId])
    const generationKey = current.rows[0] ? undefined : `chargeable:${sourceChargeableItemId}:cycle:${cycles.rows[0].count + 1}`
    const before = current.rows[0] ? await this.repository.earning(id) : null
    if (current.rows[0]) {
      await this.db.query("update chargeable_incentive_earnings set seller_id=$2,seller_name_snapshot=$3,seller_number_snapshot=$4,designation_snapshot=$5,service_date=$6,package_identity=$7,quantity=$8,guest_amount=$9,eligible_net_amount=$10,financial_rate_version_id=$11,financial_rate_version=$12,service_charge_rate=$13,gst_rate=$14,incentive_rule_id=$15,incentive_rule_version=$16,rule_family_snapshot=$17,applied_rate_percent=$18,applied_fixed_amount=$19,applied_tier_minimum=$20,applied_tier_maximum=$21,calculated_amount=$22,final_amount=$23,updated_at=now(),updated_by=$24 where id=$1 and status='draft'", [id, source.waiter_id, source.full_name, source.staff_number, source.position_key, source.charge_date, source.item_value, source.quantity, calculation.grossTotal, calculation.eligibleNetTotal, financialRate.id, financialRate.version, financialRate.serviceChargeRate, financialRate.gstRate, rule.id, rule.version, rule.ruleFamily, calculation.appliedRatePercent, calculation.appliedFixedAmount, calculation.appliedTierMinimum, calculation.appliedTierMaximum, calculation.calculatedAmount, calculation.finalAmount, actor])
    } else {
      await this.db.query("insert into chargeable_incentive_earnings(id,source_chargeable_item_id,seller_id,seller_name_snapshot,seller_number_snapshot,designation_snapshot,service_date,package_identity,quantity,guest_amount,eligible_net_amount,financial_rate_version_id,financial_rate_version,service_charge_rate,gst_rate,incentive_rule_id,incentive_rule_version,rule_family_snapshot,applied_rate_percent,applied_fixed_amount,applied_tier_minimum,applied_tier_maximum,calculated_amount,final_amount,status,generation_key,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'draft',$25,$26,$26)", [id, sourceChargeableItemId, source.waiter_id, source.full_name, source.staff_number, source.position_key, source.charge_date, source.item_value, source.quantity, calculation.grossTotal, calculation.eligibleNetTotal, financialRate.id, financialRate.version, financialRate.serviceChargeRate, financialRate.gstRate, rule.id, rule.version, rule.ruleFamily, calculation.appliedRatePercent, calculation.appliedFixedAmount, calculation.appliedTierMinimum, calculation.appliedTierMaximum, calculation.calculatedAmount, calculation.finalAmount, generationKey, actor])
    }
    const saved = (await this.repository.earning(id))!
    await this.db.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'chargeable_incentive_earning', id, before ? 'draft_recalculated' : 'draft_generated', before ? json(before) : null, json(saved), actor])
    return saved
  }

  async finalizeEarning(id: string, actor = 'Venue Manager') {
    this.recoveryGuard()
    const earning = await this.repository.earning(id)
    if (!earning) throw new Error('Incentive earning not found.')
    if (earning.status === 'finalized') return earning
    if (earning.status !== 'draft') throw new Error('Only a draft incentive earning can be finalized.')
    const source = await this.db.query<any>("select c.waiter_id,c.item_value,c.quantity,c.total_amount::text,coalesce((o.metadata->>'countsAsRealizedRevenue')::boolean,false) realized from chargeable_item_records c left join configuration_options o on o.group_key='chargeable_statuses' and o.value=c.status where c.id=$1", [earning.sourceChargeableItemId])
    const sale = source.rows[0]
    if (!sale?.realized) throw new Error('Only realized Chargeable Items can have finalized incentives.')
    if (sale.waiter_id !== earning.sellerId || sale.item_value !== earning.packageIdentity || Number(sale.quantity) !== earning.quantity || sale.total_amount !== earning.guestAmount) throw new Error('The source sale changed; regenerate the draft earning before finalization.')
    await this.db.transaction(async transaction => {
      const result = await transaction.query<any>("update chargeable_incentive_earnings set status='finalized',finalized_at=now(),finalized_by=$2,updated_at=now(),updated_by=$2 where id=$1 and status='draft' returning id", [id, actor])
      if (!result.rows[0]) throw new Error('Incentive earning changed before finalization.')
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'chargeable_incentive_earning', id, 'finalized', json(earning), json({ finalAmount: earning.finalAmount }), actor])
    })
    return (await this.repository.earning(id))!
  }

  async reverseEarning(id: string, reason: string, actor = 'Venue Manager') {
    if (!reason.trim()) throw new Error('A reversal reason is required.')
    const existing = await this.db.query<{ id: string }>('select id from chargeable_incentive_earnings where reversal_of_id=$1', [id])
    if (existing.rows[0]) return (await this.repository.earning(existing.rows[0].id))!
    const earning = await this.repository.earning(id)
    if (!earning || earning.status !== 'finalized') throw new Error('Only a finalized incentive earning can be reversed.')
    const reversalId = randomUUID()
    await this.db.transaction(async transaction => {
      await transaction.query("update chargeable_incentive_earnings set status='reversed',updated_at=now(),updated_by=$2 where id=$1 and status='finalized'", [id, actor])
      await transaction.query("insert into chargeable_incentive_earnings(id,source_chargeable_item_id,seller_id,seller_name_snapshot,seller_number_snapshot,designation_snapshot,service_date,package_identity,quantity,guest_amount,eligible_net_amount,financial_rate_version_id,financial_rate_version,service_charge_rate,gst_rate,incentive_rule_id,incentive_rule_version,rule_family_snapshot,applied_rate_percent,applied_fixed_amount,applied_tier_minimum,applied_tier_maximum,calculated_amount,final_amount,status,generation_key,reversal_of_id,finalized_at,finalized_by,created_by,updated_by) select $2,source_chargeable_item_id,seller_id,seller_name_snapshot,seller_number_snapshot,designation_snapshot,service_date,package_identity,quantity,guest_amount,eligible_net_amount,financial_rate_version_id,financial_rate_version,service_charge_rate,gst_rate,incentive_rule_id,incentive_rule_version,rule_family_snapshot,applied_rate_percent,applied_fixed_amount,applied_tier_minimum,applied_tier_maximum,calculated_amount,final_amount,'reversed',generation_key||':reversal',$1,now(),$3,$3,$3 from chargeable_incentive_earnings where id=$1", [id, reversalId, actor])
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'chargeable_incentive_earning', id, 'reversed', json(earning), json({ reversalId, reason: reason.trim() }), actor])
    })
    return (await this.repository.earning(reversalId))!
  }

  async earningsSummary() {
    const result = await this.db.query<any>(`select staff_id,sum(bill_tip)::text bill_tip_total,sum(food)::text food_incentive_total,sum(wine)::text wine_spirits_incentive_total,sum(bill_tip+food+wine)::text total_extra_earnings from (select a.staff_id,a.final_amount bill_tip,0::numeric food,0::numeric wine from bill_tip_staff_allocations a join bill_tip_distributions d on d.id=a.distribution_id and d.status='finalized' union all select e.seller_id,0::numeric,case when e.rule_family_snapshot='food_percentage' then e.final_amount else 0 end,case when e.rule_family_snapshot='wine_spirits_tier' then e.final_amount else 0 end from chargeable_incentive_earnings e where e.status='finalized') totals group by staff_id order by staff_id`)
    return result.rows.map((row: any) => ({ staffId: row.staff_id, billTipTotal: row.bill_tip_total, foodIncentiveTotal: row.food_incentive_total, wineSpiritsIncentiveTotal: row.wine_spirits_incentive_total, totalExtraEarnings: row.total_extra_earnings }))
  }
}
