import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { BillTipDistribution, BillTipDistributionStatus, BillTipManualAllocation, BillTipStaffAllocation, ChargeableIncentiveEarning, FinancialRateVersion, IncentiveRule, IncentiveRuleTier } from '../src/domain.js'

const validMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
const validDate = (value: string) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)
const decimal = (value: string, scale: number, label: string) => {
  if (!new RegExp(`^\\d{1,12}(?:\\.\\d{1,${scale}})?$`).test(value)) throw new Error(`${label} must be a non-negative decimal with no more than ${scale} decimal places.`)
  return value
}
const text = (value: unknown) => value == null ? null : String(value)

export class IncentivesRepository {
  constructor(private readonly db: PGlite) {}

  async initialize() { await this.db.query('select 1 from bill_tip_distributions limit 1') }

  private async audit(entityType: string, entityId: string, action: string, before: unknown, after: unknown, actor: string) {
    await this.db.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), entityType, entityId, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), actor])
  }

  private mapDistribution(row: any): BillTipDistribution {
    return { id: row.id, distributionMonth: row.distribution_month, poolAmount: row.pool_amount, status: row.status, externalAllocationTotal: row.external_allocation_total, remainingTeamPool: row.remaining_team_pool, totalEligibleDays: row.total_eligible_days, eligibleStaffCount: row.eligible_staff_count, valuePerEligibleDay: row.value_per_eligible_day, undistributedRemainder: row.undistributed_remainder, policyVersion: row.policy_version, policyMetadata: typeof row.policy_metadata === 'string' ? JSON.parse(row.policy_metadata) : row.policy_metadata || {}, calculatedAt: row.calculated_at, calculatedBy: row.calculated_by, finalizedAt: row.finalized_at, finalizedBy: row.finalized_by, reopenedAt: row.reopened_at, reopenedBy: row.reopened_by, reopenReason: row.reopen_reason, createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by, updatedBy: row.updated_by }
  }

  async distribution(id: string): Promise<BillTipDistribution | null> {
    const result = await this.db.query<any>('select id,distribution_month,pool_amount::text,status,external_allocation_total::text,remaining_team_pool::text,total_eligible_days,eligible_staff_count,value_per_eligible_day::text,undistributed_remainder::text,policy_version,policy_metadata,calculated_at::text,calculated_by,finalized_at::text,finalized_by,reopened_at::text,reopened_by,reopen_reason,created_at::text,updated_at::text,created_by,updated_by from bill_tip_distributions where id=$1', [id])
    return result.rows[0] ? this.mapDistribution(result.rows[0]) : null
  }

  private async requireDraftDistribution(id: string) {
    const distribution = await this.distribution(id)
    if (!distribution) throw new Error('Bill Tip distribution not found.')
    if (distribution.status !== 'draft') throw new Error('Finalized Bill Tip distributions must be reopened before allocations can change.')
    return distribution
  }

  async createDistribution(input: Pick<BillTipDistribution, 'id' | 'distributionMonth' | 'poolAmount'> & Partial<Pick<BillTipDistribution, 'undistributedRemainder'>>, actor = 'Venue Manager') {
    if (!validMonth(input.distributionMonth)) throw new Error('Distribution month must use YYYY-MM.')
    const poolAmount = decimal(input.poolAmount, 2, 'Pool amount')
    const remainder = decimal(input.undistributedRemainder || '0.00', 2, 'Undistributed remainder')
    const duplicate = await this.db.query('select id from bill_tip_distributions where distribution_month=$1', [input.distributionMonth])
    if (duplicate.rows[0]) throw new Error('A Bill Tip distribution already exists for this month.')
    await this.db.query("insert into bill_tip_distributions(id,distribution_month,pool_amount,status,undistributed_remainder,created_by,updated_by) values($1,$2,$3,'draft',$4,$5,$5)", [input.id, input.distributionMonth, poolAmount, remainder, actor])
    const saved = await this.distribution(input.id)
    await this.audit('bill_tip_distribution', input.id, 'created', null, saved, actor)
    return saved!
  }

  async setDistributionStatus(id: string, status: BillTipDistributionStatus, actor = 'Venue Manager') {
    const previous = await this.distribution(id)
    if (!previous) throw new Error('Bill Tip distribution not found.')
    if (previous.status === 'finalized' && status === 'draft') throw new Error('Use the audited reopen action to reopen a finalized Bill Tip distribution.')
    await this.db.query("update bill_tip_distributions set status=$2,finalized_at=case when $2='finalized' then coalesce(finalized_at,now()) else finalized_at end,finalized_by=case when $2='finalized' then coalesce(finalized_by,$3) else finalized_by end,updated_by=$3,updated_at=now() where id=$1", [id, status, actor])
    const saved = await this.distribution(id)
    await this.audit('bill_tip_distribution', id, `status_${status}`, previous, saved, actor)
    return saved!
  }

  async reopenDistribution(id: string, reason: string, actor = 'Venue Manager') {
    const previous = await this.distribution(id)
    if (!previous || previous.status !== 'finalized') throw new Error('Only a finalized Bill Tip distribution can be reopened.')
    if (!reason.trim()) throw new Error('A reopen reason is required.')
    await this.db.query("update bill_tip_distributions set status='draft',reopened_at=now(),reopened_by=$2,reopen_reason=$3,updated_by=$2,updated_at=now() where id=$1", [id, actor, reason.trim()])
    const saved = await this.distribution(id)
    await this.audit('bill_tip_distribution', id, 'reopened', previous, saved, actor)
    return saved!
  }

  async createStaffAllocation(input: Omit<BillTipStaffAllocation, 'staffNameSnapshot' | 'staffNumberSnapshot' | 'designationSnapshot'>, actor = 'Venue Manager') {
    await this.requireDraftDistribution(input.distributionId)
    const staff = await this.db.query<any>('select full_name,staff_number,position_key from staff where id=$1', [input.staffId])
    if (!staff.rows[0]) throw new Error('Staff member not found.')
    decimal(input.valuePerEligibleDay, 6, 'Value per eligible day'); decimal(input.calculatedAmount, 6, 'Calculated amount'); decimal(input.finalAmount, 2, 'Final amount')
    if (![input.eligibleDays, input.excludedAlDays, input.missingRosterDays].every(value => Number.isInteger(value) && value >= 0)) throw new Error('Roster-day snapshots must be non-negative whole numbers.')
    const row = staff.rows[0]
    await this.db.query('insert into bill_tip_staff_allocations(id,distribution_id,staff_id,staff_name_snapshot,staff_number_snapshot,designation_snapshot,eligible_days,excluded_al_days,missing_roster_days,requires_roster_review,value_per_eligible_day,calculated_amount,final_amount,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)', [input.id, input.distributionId, input.staffId, row.full_name, row.staff_number, row.position_key, input.eligibleDays, input.excludedAlDays, input.missingRosterDays, input.requiresRosterReview, input.valuePerEligibleDay, input.calculatedAmount, input.finalAmount, actor])
    const result = await this.db.query<any>('select id,distribution_id,staff_id,staff_name_snapshot,staff_number_snapshot,designation_snapshot,eligible_days,excluded_al_days,missing_roster_days,requires_roster_review,value_per_eligible_day::text,calculated_amount::text,final_amount::text,created_at::text,updated_at::text,created_by,updated_by from bill_tip_staff_allocations where id=$1', [input.id])
    const saved = this.mapStaffAllocation(result.rows[0]); await this.audit('bill_tip_staff_allocation', input.id, 'created', null, saved, actor); return saved
  }

  private mapStaffAllocation(row: any): BillTipStaffAllocation { return { id: row.id, distributionId: row.distribution_id, staffId: row.staff_id, staffNameSnapshot: row.staff_name_snapshot, staffNumberSnapshot: row.staff_number_snapshot, designationSnapshot: row.designation_snapshot, eligibleDays: row.eligible_days, excludedAlDays: row.excluded_al_days, missingRosterDays: row.missing_roster_days, requiresRosterReview: row.requires_roster_review, valuePerEligibleDay: row.value_per_eligible_day, calculatedAmount: row.calculated_amount, finalAmount: row.final_amount, createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by, updatedBy: row.updated_by } }

  async createManualAllocation(input: BillTipManualAllocation, actor = 'Venue Manager') {
    await this.requireDraftDistribution(input.distributionId)
    decimal(input.fixedAmount, 2, 'Fixed amount')
    if (!input.helperName.trim() || !input.reason.trim()) throw new Error('Helper name and reason are required.')
    if (input.linkedStaffId) { const staff = await this.db.query('select id from staff where id=$1', [input.linkedStaffId]); if (!staff.rows[0]) throw new Error('Linked staff member not found.') }
    await this.db.query('insert into bill_tip_manual_allocations(id,distribution_id,linked_staff_id,helper_name,staff_reference,department,outlet,fixed_amount,reason,notes,idempotency_key,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)', [input.id, input.distributionId, input.linkedStaffId, input.helperName.trim(), input.staffReference || null, input.department || null, input.outlet || null, input.fixedAmount, input.reason.trim(), input.notes || '', input.idempotencyKey || null, actor])
    const result = await this.db.query<any>('select id,distribution_id,linked_staff_id,helper_name,staff_reference,department,outlet,fixed_amount::text,reason,notes,idempotency_key,created_at::text,updated_at::text,created_by,updated_by from bill_tip_manual_allocations where id=$1', [input.id])
    const row = result.rows[0]; const saved: BillTipManualAllocation = { id: row.id, distributionId: row.distribution_id, linkedStaffId: row.linked_staff_id, helperName: row.helper_name, staffReference: row.staff_reference, department: row.department, outlet: row.outlet, fixedAmount: row.fixed_amount, reason: row.reason, notes: row.notes, idempotencyKey: row.idempotency_key, createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by, updatedBy: row.updated_by }
    await this.audit('bill_tip_manual_allocation', input.id, 'created', null, saved, actor); return saved
  }

  private validateRule(rule: IncentiveRule) {
    if (!rule.ruleKey.trim() || !rule.sourceKey.trim() || !Number.isInteger(rule.version) || rule.version < 1 || !validDate(rule.effectiveFrom) || (rule.effectiveTo && !validDate(rule.effectiveTo))) throw new Error('Rule key, source key, version and effective dates are required.')
    if (rule.ruleFamily === 'food_percentage') { if (!rule.ratePercent) throw new Error('Food percentage rules require a rate.'); decimal(rule.ratePercent, 4, 'Percentage rate'); if (rule.tiers.length) throw new Error('Food percentage rules cannot contain tiers.') }
    if (rule.ruleFamily === 'no_incentive' && (rule.ratePercent || rule.tiers.length)) throw new Error('No-incentive rules cannot contain rates or tiers.')
    if (rule.ruleFamily === 'wine_spirits_tier') {
      if (!rule.tiers.length || rule.ratePercent) throw new Error('Wine/Spirits rules require tiers and no general rate.')
      const ordered = [...rule.tiers].sort((a, b) => Number(a.minimumAmount) - Number(b.minimumAmount))
      for (const [index, tier] of ordered.entries()) { decimal(tier.minimumAmount, 2, 'Tier minimum'); if (tier.maximumAmount) decimal(tier.maximumAmount, 2, 'Tier maximum'); decimal(tier.rewardValue, 4, 'Tier reward'); if (index && Number(tier.minimumAmount) <= Number(ordered[index - 1].maximumAmount ?? Infinity)) throw new Error('Incentive tiers must not overlap.'); if (!tier.maximumAmount && index !== ordered.length - 1) throw new Error('Only the final incentive tier may be open-ended.') }
    }
  }

  async createRule(rule: IncentiveRule, actor = 'Venue Manager') {
    this.validateRule(rule)
    if (rule.configurationOptionId) { const option = await this.db.query("select id from configuration_options where id=$1 and group_key='chargeable_items'", [rule.configurationOptionId]); if (!option.rows[0]) throw new Error('Chargeable package configuration not found.') }
    await this.db.transaction(async transaction => {
      if (rule.active) await transaction.query('update incentive_rules set active=false,updated_by=$2,updated_at=now() where rule_key=$1 and active=true', [rule.ruleKey, actor])
      await transaction.query('insert into incentive_rules(id,rule_key,configuration_option_id,source_key,rule_family,version,effective_from,effective_to,rate_percent,active,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)', [rule.id, rule.ruleKey, rule.configurationOptionId || null, rule.sourceKey, rule.ruleFamily, rule.version, rule.effectiveFrom, rule.effectiveTo || null, rule.ratePercent || null, rule.active, actor])
      for (const [index, tier] of rule.tiers.entries()) await transaction.query('insert into incentive_rule_tiers(id,rule_id,minimum_amount,maximum_amount,reward_mode,reward_value,sort_order) values($1,$2,$3,$4,$5,$6,$7)', [tier.id || randomUUID(), rule.id, tier.minimumAmount, tier.maximumAmount, tier.rewardMode, tier.rewardValue, index])
    })
    const saved = await this.rule(rule.id); await this.audit('incentive_rule', rule.id, 'created', null, saved, actor); return saved!
  }

  async rule(id: string): Promise<IncentiveRule | null> {
    const result = await this.db.query<any>('select id,rule_key,configuration_option_id,source_key,rule_family,version,effective_from::text,effective_to::text,rate_percent::text,active,created_at::text,updated_at::text,created_by,updated_by from incentive_rules where id=$1', [id])
    if (!result.rows[0]) return null
    const tiers = await this.db.query<any>('select id,minimum_amount::text,maximum_amount::text,reward_mode,reward_value::text from incentive_rule_tiers where rule_id=$1 order by sort_order', [id])
    const row = result.rows[0]
    return { id: row.id, ruleKey: row.rule_key, configurationOptionId: row.configuration_option_id, sourceKey: row.source_key, ruleFamily: row.rule_family, version: row.version, effectiveFrom: row.effective_from, effectiveTo: row.effective_to, ratePercent: row.rate_percent, active: row.active, tiers: tiers.rows.map((tier: any): IncentiveRuleTier => ({ id: tier.id, minimumAmount: tier.minimum_amount, maximumAmount: tier.maximum_amount, rewardMode: tier.reward_mode, rewardValue: tier.reward_value })), createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by, updatedBy: row.updated_by }
  }

  async ruleForSourceDate(sourceKey: string, serviceDate: string): Promise<IncentiveRule | null> {
    if (!validDate(serviceDate)) throw new Error('Service date must use YYYY-MM-DD.')
    const result = await this.db.query<{ id: string }>('select id from incentive_rules where source_key=$1 and effective_from<=$2 and (effective_to is null or effective_to>=$2) order by effective_from desc,version desc limit 1', [sourceKey, serviceDate])
    return result.rows[0] ? this.rule(result.rows[0].id) : null
  }

  async createFinancialRate(rate: FinancialRateVersion, actor = 'Venue Manager') {
    if (!Number.isInteger(rate.version) || rate.version < 1 || !validDate(rate.effectiveFrom) || (rate.effectiveTo && !validDate(rate.effectiveTo))) throw new Error('Financial rate version and effective dates are required.')
    decimal(rate.serviceChargeRate, 4, 'Service Charge rate'); decimal(rate.gstRate, 4, 'GST rate')
    await this.db.transaction(async transaction => {
      if (rate.active) await transaction.query('update financial_rate_versions set active=false,updated_by=$1,updated_at=now() where active=true', [actor])
      await transaction.query('insert into financial_rate_versions(id,version,effective_from,effective_to,service_charge_rate,gst_rate,active,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$8)', [rate.id, rate.version, rate.effectiveFrom, rate.effectiveTo || null, rate.serviceChargeRate, rate.gstRate, rate.active, actor])
    })
    const saved = await this.financialRate(rate.id)
    await this.audit('financial_rate_version', rate.id, 'created', null, saved, actor)
    return saved!
  }

  async financialRate(id: string): Promise<FinancialRateVersion | null> {
    const result = await this.db.query<any>('select id,version,effective_from::text,effective_to::text,service_charge_rate::text,gst_rate::text,active,created_at::text,updated_at::text,created_by,updated_by from financial_rate_versions where id=$1', [id])
    const row = result.rows[0]
    return row ? { id: row.id, version: row.version, effectiveFrom: row.effective_from, effectiveTo: row.effective_to, serviceChargeRate: row.service_charge_rate, gstRate: row.gst_rate, active: row.active, createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by, updatedBy: row.updated_by } : null
  }

  async financialRateForDate(serviceDate: string): Promise<FinancialRateVersion | null> {
    if (!validDate(serviceDate)) throw new Error('Service date must use YYYY-MM-DD.')
    const result = await this.db.query<{ id: string }>('select id from financial_rate_versions where effective_from<=$1 and (effective_to is null or effective_to>=$1) order by effective_from desc,version desc limit 1', [serviceDate])
    return result.rows[0] ? this.financialRate(result.rows[0].id) : null
  }

  async createEarning(input: ChargeableIncentiveEarning, actor = 'Venue Manager') {
    decimal(input.eligibleNetAmount, 2, 'Eligible net amount'); decimal(input.calculatedAmount, 6, 'Calculated amount'); decimal(input.finalAmount, 2, 'Final amount')
    const source = await this.db.query<any>('select c.item_value,c.quantity,c.total_amount::text,c.waiter_id,c.charge_date::text,c.status,coalesce((s.metadata->>\'countsAsRealizedRevenue\')::boolean,false) realized from chargeable_item_records c left join configuration_options s on s.group_key=\'chargeable_statuses\' and s.value=c.status where c.id=$1', [input.sourceChargeableItemId])
    if (!source.rows[0]) throw new Error('Source Chargeable Item not found.')
    const sale = source.rows[0]
    if (!sale.waiter_id || sale.waiter_id !== input.sellerId) throw new Error('The earning seller must match the source Chargeable Item waiter.')
    if (input.status === 'finalized' && !sale.realized) throw new Error('Only realized Chargeable Items can have finalized incentives.')
    const staff = await this.db.query<any>('select full_name,staff_number,position_key from staff where id=$1', [input.sellerId]); if (!staff.rows[0]) throw new Error('Earning seller not found.')
    const rule = await this.rule(input.incentiveRuleId); if (!rule || rule.version !== input.incentiveRuleVersion) throw new Error('Incentive rule version not found.')
    const duplicate = await this.db.query("select id from chargeable_incentive_earnings where source_chargeable_item_id=$1 and status in ('draft','finalized')", [input.sourceChargeableItemId]); if (duplicate.rows[0]) throw new Error('This Chargeable Item already has a current incentive earning.')
    const seller = staff.rows[0]
    await this.db.query('insert into chargeable_incentive_earnings(id,source_chargeable_item_id,seller_id,seller_name_snapshot,seller_number_snapshot,designation_snapshot,service_date,package_identity,quantity,guest_amount,eligible_net_amount,financial_rate_version_id,financial_rate_version,service_charge_rate,gst_rate,incentive_rule_id,incentive_rule_version,rule_family_snapshot,applied_rate_percent,applied_fixed_amount,applied_tier_minimum,applied_tier_maximum,calculated_amount,final_amount,status,generation_key,reversal_of_id,finalized_at,finalized_by,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,case when $25=\'finalized\' then now() else null end,case when $25=\'finalized\' then $28 else null end,$28,$28)', [input.id, input.sourceChargeableItemId, input.sellerId, seller.full_name, seller.staff_number, seller.position_key, sale.charge_date, sale.item_value, sale.quantity, sale.total_amount, input.eligibleNetAmount, input.financialRateVersionId || null, input.financialRateVersion || null, input.serviceChargeRate || null, input.gstRate || null, rule.id, rule.version, rule.ruleFamily, input.appliedRatePercent || rule.ratePercent || null, input.appliedFixedAmount || null, input.appliedTierMinimum || null, input.appliedTierMaximum || null, input.calculatedAmount, input.finalAmount, input.status, input.generationKey, input.reversalOfId || null, actor])
    const saved = await this.earning(input.id); await this.audit('chargeable_incentive_earning', input.id, 'created', null, saved, actor); return saved!
  }

  async earning(id: string): Promise<ChargeableIncentiveEarning | null> {
    const result = await this.db.query<any>('select id,source_chargeable_item_id,seller_id,seller_name_snapshot,seller_number_snapshot,designation_snapshot,service_date::text,package_identity,quantity,guest_amount::text,eligible_net_amount::text,financial_rate_version_id,financial_rate_version,service_charge_rate::text,gst_rate::text,incentive_rule_id,incentive_rule_version,rule_family_snapshot,applied_rate_percent::text,applied_fixed_amount::text,applied_tier_minimum::text,applied_tier_maximum::text,calculated_amount::text,final_amount::text,status,generation_key,reversal_of_id,finalized_at::text,finalized_by,created_at::text,updated_at::text,created_by,updated_by from chargeable_incentive_earnings where id=$1', [id])
    const row = result.rows[0]; if (!row) return null
    return { id: row.id, sourceChargeableItemId: row.source_chargeable_item_id, sellerId: row.seller_id, sellerNameSnapshot: row.seller_name_snapshot, sellerNumberSnapshot: row.seller_number_snapshot, designationSnapshot: row.designation_snapshot, serviceDate: row.service_date, packageIdentity: row.package_identity, quantity: row.quantity, guestAmount: row.guest_amount, eligibleNetAmount: row.eligible_net_amount, financialRateVersionId: row.financial_rate_version_id, financialRateVersion: row.financial_rate_version, serviceChargeRate: text(row.service_charge_rate), gstRate: text(row.gst_rate), incentiveRuleId: row.incentive_rule_id, incentiveRuleVersion: row.incentive_rule_version, ruleFamilySnapshot: row.rule_family_snapshot, appliedRatePercent: text(row.applied_rate_percent), appliedFixedAmount: text(row.applied_fixed_amount), appliedTierMinimum: text(row.applied_tier_minimum), appliedTierMaximum: text(row.applied_tier_maximum), calculatedAmount: row.calculated_amount, finalAmount: row.final_amount, status: row.status, generationKey: row.generation_key, reversalOfId: row.reversal_of_id, finalizedAt: row.finalized_at, finalizedBy: row.finalized_by, createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by, updatedBy: row.updated_by }
  }
}
