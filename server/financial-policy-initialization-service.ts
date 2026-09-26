import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { AuditActor } from '../src/domain.js'
import { auditActorLabel } from './authorization-service.js'

export const FINANCIAL_POLICY_EFFECTIVE_DATE = '2026-09-01'

const dutyPolicy = new Map([
  ['AL', false],
  ['OFF', true],
  ['PH', true],
  ['SK', true],
  ['TRN', true],
  ['ON', true],
])
const dutyWorkedDayUnits = new Map([
  ['AL', 0],
  ['OFF', 0],
  ['PH', 1],
  ['SK', 1],
  ['TRN', 1],
  ['ON', 1],
])

const packageRules = [
  { value: 'lobster_paella', family: 'food_percentage', rate: '2.5000' },
  { value: 'birthday_basic', family: 'no_incentive', rate: null },
  { value: 'birthday_premium', family: 'no_incentive', rate: null },
  { value: 'anniversary_basic', family: 'no_incentive', rate: null },
  { value: 'anniversary_premium', family: 'no_incentive', rate: null },
] as const

const wineTiers = [
  ['0.00', '39.99', 'none', '0.0000'],
  ['40.00', '69.99', 'fixed', '2.0000'],
  ['70.00', '99.99', 'fixed', '3.0000'],
  ['100.00', '129.99', 'fixed', '4.0000'],
  ['130.00', '199.99', 'fixed', '5.0000'],
  ['200.00', '249.99', 'fixed', '6.0000'],
  ['250.00', '349.99', 'fixed', '7.0000'],
  ['350.00', '499.99', 'fixed', '8.0000'],
  ['500.00', null, 'percentage', '2.5000'],
] as const

type PolicyTier = readonly [string, string | null, string, string]
type ExpectedRule = { ruleKey: string; configurationOptionId: string | null; sourceKey: string; family: string; rate: string | null; tiers: ReadonlyArray<PolicyTier> }

const parsedMetadata = (value: unknown): Record<string, unknown> => {
  if (!value) return {}
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>
  return value as Record<string, unknown>
}

const stableJson = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.keys(item).sort().reduce<Record<string, unknown>>((result, key) => { result[key] = item[key]; return result }, {})
  : item)

const actorContext = (actor: AuditActor, outletScopeId: string) => ({ actorUserId: actor.userId, actorDisplayName: actor.displayName, outletScopeId })

export class FinancialPolicyInitializationService {
  constructor(private readonly db: PGlite) {}

  async initialize(outletScopeId: string, actor: AuditActor) {
    return this.db.transaction(async transaction => {
      const outlet = (await transaction.query<any>("select id,scope_key,display_name,active from outlet_scopes where id=$1 and scope_key='andalucia' and active=true for update", [outletScopeId])).rows[0]
      if (!outlet) throw new Error('FINANCIAL_POLICY_INITIALIZATION_BLOCKED:ANDALUCIA_OUTLET_SCOPE_NOT_FOUND')

      const transactionTables = ['bill_tip_distributions', 'bill_tip_staff_allocations', 'bill_tip_manual_allocations', 'chargeable_incentive_earnings']
      const financialCountsBefore: Record<string, number> = {}
      for (const table of transactionTables) financialCountsBefore[table] = Number((await transaction.query<any>(`select count(*)::int count from ${table}`)).rows[0].count)
      if (Object.values(financialCountsBefore).some(Boolean)) throw new Error('FINANCIAL_POLICY_INITIALIZATION_BLOCKED:FINANCIAL_TRANSACTIONS_ALREADY_EXIST')

      const protectedBefore = await this.protectedSnapshot(transaction, outletScopeId)
      const dutyRows = (await transaction.query<any>("select id,value,label,color,active,sort_order,metadata from configuration_options where group_key='duty_codes' order by sort_order,id for update")).rows
      if (!dutyRows.length) throw new Error('FINANCIAL_POLICY_INITIALIZATION_BLOCKED:DUTY_CODE_INVENTORY_EMPTY')
      const unresolved: string[] = []
      const dutyInventory = dutyRows.map((row: any) => {
        const metadata = parsedMetadata(row.metadata)
        const displayCode = String(metadata.displayCode || row.value).trim().toUpperCase()
        const current = typeof metadata.billTipEligible === 'boolean' ? metadata.billTipEligible : null
        const known = dutyPolicy.get(displayCode)
        const proposed = known ?? (current !== null ? current : metadata.dutyClassification === 'working' ? true : null)
        const currentWorkedDayUnits = typeof metadata.billTipWorkedDayUnits === 'number' ? metadata.billTipWorkedDayUnits : null
        const proposedWorkedDayUnits = dutyWorkedDayUnits.get(displayCode) ?? (metadata.countsAsWorking === true ? 1 : proposed === false ? 0 : null)
        if (proposed === null) unresolved.push(displayCode)
        if (proposed === true && proposedWorkedDayUnits === null) unresolved.push(`${displayCode}:WORKED_DAY_UNITS`)
        return { id: row.id, value: row.value, code: displayCode, name: row.label, current, proposed, currentWorkedDayUnits, proposedWorkedDayUnits, reason: known !== undefined ? 'approved_named_policy' : current !== null ? 'existing_explicit_manager_metadata' : 'approved_normal_working_duty_policy', metadata }
      })
      if (unresolved.length) throw new Error(`BILL_TIP_ELIGIBILITY_MANAGER_DECISION_REQUIRED:${unresolved.join(',')}`)

      let dutyCodesUpdated = 0
      for (const item of dutyInventory) {
        if (item.current === item.proposed && item.currentWorkedDayUnits === item.proposedWorkedDayUnits) continue
        const beforeMetadata = item.metadata
        const afterMetadata = { ...beforeMetadata, billTipEligible: item.proposed, billTipWorkedDayUnits: item.proposedWorkedDayUnits }
        await transaction.query('update configuration_options set metadata=$2,updated_at=now() where id=$1', [item.id, JSON.stringify(afterMetadata)])
        await this.audit(transaction, 'configuration_option', item.id, 'bill_tip_eligibility_initialized', { metadata: beforeMetadata }, { metadata: afterMetadata, ...actorContext(actor, outletScopeId) }, actor)
        dutyCodesUpdated++
      }

      const rateRows = (await transaction.query<any>('select id,version,effective_from::text,effective_to::text,service_charge_rate::text,gst_rate::text,active from financial_rate_versions where outlet_scope_id=$1 order by version for update', [outletScopeId])).rows
      const matchingRate = rateRows.find((row: any) => Number(row.version) === 1 && row.effective_from === FINANCIAL_POLICY_EFFECTIVE_DATE && row.effective_to == null && Number(row.service_charge_rate) === 10 && Number(row.gst_rate) === 17 && row.active)
      if (rateRows.length && (rateRows.length !== 1 || !matchingRate)) throw new Error('FINANCIAL_POLICY_INITIALIZATION_BLOCKED:FINANCIAL_RATE_CONFLICT')
      let rateCreated = false
      let rateId = matchingRate?.id
      if (!rateId) {
        rateId = randomUUID()
        await transaction.query('insert into financial_rate_versions(id,outlet_scope_id,version,effective_from,effective_to,service_charge_rate,gst_rate,active,created_by,updated_by) values($1,$2,1,$3,null,10.0000,17.0000,true,$4,$4)', [rateId, outletScopeId, FINANCIAL_POLICY_EFFECTIVE_DATE, auditActorLabel(actor)])
        await this.audit(transaction, 'financial_rate_version', rateId, 'initial_policy_version_created', null, { version: 1, effectiveFrom: FINANCIAL_POLICY_EFFECTIVE_DATE, serviceChargeRate: '10.0000', gstRate: '17.0000', active: true, ...actorContext(actor, outletScopeId) }, actor)
        rateCreated = true
      }

      const configuredPackages = (await transaction.query<any>("select id,value,label,active from configuration_options where group_key='chargeable_items' and value=any($1::text[]) order by value", [packageRules.map(rule => rule.value)])).rows
      const packageByValue = new Map(configuredPackages.map((row: any) => [row.value, row]))
      const missingPackages = packageRules.filter(rule => !packageByValue.get(rule.value)?.active).map(rule => rule.value)
      if (missingPackages.length) throw new Error(`FINANCIAL_POLICY_INITIALIZATION_BLOCKED:CHARGEABLE_PACKAGE_IDENTITY_MISSING:${missingPackages.join(',')}`)

      const expectedRules: ExpectedRule[] = [...packageRules.map((rule): ExpectedRule => ({
        ruleKey: `chargeable:${rule.value}`,
        configurationOptionId: packageByValue.get(rule.value).id as string,
        sourceKey: rule.value,
        family: rule.family,
        rate: rule.rate,
        tiers: [],
      })), {
        ruleKey: 'wine-spirits:standard', configurationOptionId: null, sourceKey: 'wine_spirits', family: 'wine_spirits_tier', rate: null, tiers: wineTiers,
      }]

      let rulesCreated = 0
      let tiersCreated = 0
      for (const expected of expectedRules) {
        const existing = (await transaction.query<any>('select id,rule_key,configuration_option_id,source_key,rule_family,version,effective_from::text,effective_to::text,rate_percent::text,active from incentive_rules where outlet_scope_id=$1 and rule_key=$2 order by version for update', [outletScopeId, expected.ruleKey])).rows
        if (existing.length) {
          if (existing.length !== 1 || !this.ruleMatches(existing[0], expected)) throw new Error(`FINANCIAL_POLICY_INITIALIZATION_BLOCKED:INCENTIVE_RULE_CONFLICT:${expected.ruleKey}`)
          const existingTiers = (await transaction.query<any>('select minimum_amount::text,maximum_amount::text,reward_mode,reward_value::text from incentive_rule_tiers where rule_id=$1 order by sort_order', [existing[0].id])).rows
          if (!this.tiersMatch(existingTiers, expected.tiers)) throw new Error(`FINANCIAL_POLICY_INITIALIZATION_BLOCKED:INCENTIVE_TIER_CONFLICT:${expected.ruleKey}`)
          continue
        }
        const id = randomUUID()
        await transaction.query('insert into incentive_rules(id,outlet_scope_id,rule_key,configuration_option_id,source_key,rule_family,version,effective_from,effective_to,rate_percent,active,created_by,updated_by) values($1,$2,$3,$4,$5,$6,1,$7,null,$8,true,$9,$9)', [id, outletScopeId, expected.ruleKey, expected.configurationOptionId, expected.sourceKey, expected.family, FINANCIAL_POLICY_EFFECTIVE_DATE, expected.rate, auditActorLabel(actor)])
        for (const [index, tier] of expected.tiers.entries()) {
          await transaction.query('insert into incentive_rule_tiers(id,rule_id,minimum_amount,maximum_amount,reward_mode,reward_value,sort_order) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), id, tier[0], tier[1], tier[2], tier[3], index])
          tiersCreated++
        }
        await this.audit(transaction, 'incentive_rule', id, 'initial_policy_version_created', null, { ruleKey: expected.ruleKey, configurationOptionId: expected.configurationOptionId, sourceKey: expected.sourceKey, ruleFamily: expected.family, version: 1, effectiveFrom: FINANCIAL_POLICY_EFFECTIVE_DATE, ratePercent: expected.rate, tiers: expected.tiers, active: true, ...actorContext(actor, outletScopeId) }, actor)
        rulesCreated++
      }

      const protectedAfter = await this.protectedSnapshot(transaction, outletScopeId)
      if (stableJson(protectedBefore) !== stableJson(protectedAfter)) throw new Error('FINANCIAL_POLICY_INITIALIZATION_BLOCKED:PROTECTED_OPERATIONAL_DATA_CHANGED')
      for (const table of transactionTables) {
        const after = Number((await transaction.query<any>(`select count(*)::int count from ${table}`)).rows[0].count)
        if (after !== financialCountsBefore[table]) throw new Error(`FINANCIAL_POLICY_INITIALIZATION_BLOCKED:FINANCIAL_TRANSACTION_CREATED:${table}`)
      }

      const baseline = (await transaction.query<any>("select id,revision_number,(select count(*)::int from staff_membership_history h where h.baseline_revision_id=r.id and h.review_status='approved' and h.is_current_baseline=true) member_count from staff_membership_baseline_reviews r where r.outlet_scope_id=$1 and r.baseline_month='2026-09' and r.status='approved' and r.is_authoritative=true order by revision_number desc limit 1", [outletScopeId])).rows[0]
      const readiness = Boolean(baseline && Number(baseline.revision_number) === 1 && Number(baseline.member_count) === 12 && protectedAfter.rosterCount > 0 && protectedAfter.chargeableCount > 0)
      return { outlet, dutyInventory: dutyInventory.map(({ metadata: _metadata, ...item }) => item), dutyCodesUpdated, rateCreated, rateId, rulesCreated, tiersCreated, effectiveDate: FINANCIAL_POLICY_EFFECTIVE_DATE, baseline: baseline ? { revisionNumber: Number(baseline.revision_number), memberCount: Number(baseline.member_count) } : null, protected: protectedAfter, readiness, wineSpiritsLiveSource: 'ACTIVE' }
    })
  }

  private ruleMatches(row: any, expected: { configurationOptionId: string | null; sourceKey: string; family: string; rate: string | null }) {
    return Number(row.version) === 1 && row.effective_from === FINANCIAL_POLICY_EFFECTIVE_DATE && row.effective_to == null && row.configuration_option_id === expected.configurationOptionId && row.source_key === expected.sourceKey && row.rule_family === expected.family && (expected.rate == null ? row.rate_percent == null : Number(row.rate_percent) === Number(expected.rate)) && row.active
  }

  private tiersMatch(rows: any[], expected: ReadonlyArray<readonly [string, string | null, string, string]>) {
    return rows.length === expected.length && rows.every((row, index) => Number(row.minimum_amount) === Number(expected[index][0]) && (row.maximum_amount == null ? expected[index][1] == null : Number(row.maximum_amount) === Number(expected[index][1])) && row.reward_mode === expected[index][2] && Number(row.reward_value) === Number(expected[index][3]))
  }

  private async protectedSnapshot(transaction: any, outletScopeId: string) {
    const roster = await transaction.query('select id,staff_id,duty_date::text,duty_code_value from duty_roster_entries order by id')
    const chargeables = await transaction.query('select id,booking_id,charge_date::text,guest_name,item_value,quantity,unit_price::text,total_amount::text,status,waiter_id from chargeable_item_records where outlet_scope_id=$1 order by id', [outletScopeId])
    const membership = await transaction.query("select id,staff_id,effective_from::text,effective_to::text,review_status,baseline_revision_id,is_current_baseline from staff_membership_history where outlet_scope_id=$1 order by id", [outletScopeId])
    return { rosterCount: roster.rows.length, roster: roster.rows, chargeableCount: chargeables.rows.length, chargeables: chargeables.rows, membershipCount: membership.rows.length, membership: membership.rows }
  }

  private async audit(transaction: any, entityType: string, entityId: string, action: string, before: unknown, after: unknown, actor: AuditActor) {
    await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), entityType, entityId, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), auditActorLabel(actor)])
  }
}
