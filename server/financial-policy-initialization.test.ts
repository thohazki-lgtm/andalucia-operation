import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import type { AuthPrincipal, IncentiveRule } from '../src/domain.js'
import { AuthorizationService } from './authorization-service.js'
import { FinancialPolicyInitializationService, FINANCIAL_POLICY_EFFECTIVE_DATE } from './financial-policy-initialization-service.js'
import { IncentivesCalculationService } from './incentives-calculation-service.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { runMigrations } from './migration-store.js'

const db = new PGlite()
await db.exec(await readFile('database/schema.sql', 'utf8'))
await runMigrations(db)

const ownerId = randomUUID()
await db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status) values($1,'isolated-owner','isolated-owner','Isolated Owner','not-used','active')", [ownerId])
await db.query("insert into authorization_user_roles(id,user_id,role_id,active) select $1,$2,id,true from authorization_roles where role_key='owner'", [randomUUID(), ownerId])
const authorization = new AuthorizationService(db)
const summary = await authorization.authorizationForUser(ownerId)
const principal: AuthPrincipal = { userId: ownerId, sessionId: randomUUID(), loginIdentifier: 'isolated-owner', displayName: 'Isolated Owner', staffId: null, ...summary }
await authorization.requireOutletPermission(principal, 'manage_financial_rules', ANDALUCIA_SCOPE_ID)

const duties = [
  ['on', 'Duty', 'ON', 'working', true],
  ['off', 'Off', 'OFF', 'off', false],
  ['annual_leave', 'Annual Leave', 'AL', 'annualLeave', false],
  ['public_holiday', 'Public Holiday', 'PH', 'publicHoliday', false],
  ['sick_leave', 'Sick Leave', 'SK', 'sickLeave', false],
  ['training', 'Training', 'TRN', 'working', true],
  ['custom_setup', 'Setup Andalucía', 'SET', 'working', true],
] as const
for (const [index, duty] of duties.entries()) await db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes',$2,$3,$4,$5,true,$6)", [randomUUID(), duty[0], duty[1], '#123456', JSON.stringify({ displayCode: duty[2], dutyClassification: duty[3], countsAsWorking: duty[4], unrelatedSemantic: `preserved-${index}` }), index])

const packages = [
  ['lobster_paella', 'Lobster Paella'], ['birthday_basic', 'Birthday Basic'], ['birthday_premium', 'Birthday Premium'],
  ['anniversary_basic', 'Anniversary Basic'], ['anniversary_premium', 'Anniversary Premium'],
]
for (const [index, item] of packages.entries()) await db.query("insert into configuration_options(id,group_key,value,label,metadata,active,sort_order) values($1,'chargeable_items',$2,$3,$4,true,$5)", [randomUUID(), item[0], item[1], JSON.stringify({ category: 'Food', price: index ? 75 : 85 }), index])

const staffId = randomUUID()
await db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'ISO-001','Isolated Staff','Waiter','active','2026-01-01')", [staffId])
const baselineId = randomUUID()
await db.query("insert into staff_membership_baseline_reviews(id,outlet_scope_id,baseline_month,status,revision_number,review_type,is_current_revision,is_authoritative,approved_at,approved_by,approved_by_user_id) values($1,$2,'2026-09','approved',1,'initial',true,true,now(),'Isolated Owner',$3)", [baselineId, ANDALUCIA_SCOPE_ID, ownerId])
for (let index = 0; index < 12; index++) {
  const memberId = index ? randomUUID() : staffId
  if (index) await db.query('insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,$2,$3,$4,\'active\',\'2026-01-01\')', [memberId, `ISO-${String(index + 1).padStart(3, '0')}`, `Isolated Staff ${index + 1}`, 'Waiter'])
  await db.query("insert into staff_membership_history(id,staff_id,outlet_scope_id,membership_dimension,effective_from,effective_to,source,review_status,reviewed_at,reviewed_by,baseline_revision_id,is_current_baseline) values($1,$2,$3,'regular_outlet','2026-09-01','2026-09-30','baseline_manager_review','approved',now(),'Isolated Owner',$4,true)", [randomUUID(), memberId, ANDALUCIA_SCOPE_ID, baselineId])
}
await db.query("insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,'2026-09-01','on')", [randomUUID(), staffId])
await db.query("insert into chargeable_item_records(id,outlet_scope_id,item_value,item_label,item_category,charge_date,guest_name,room_number,check_invoice_number,amount,quantity,unit_price,total_amount,status,waiter_id) values($1,$2,'lobster_paella','Lobster Paella','Food','2026-09-01','Isolated Guest','700','POLICY-CHECK-001',85,1,85,85,'charged',$3)", [randomUUID(), ANDALUCIA_SCOPE_ID, staffId])

const beforeDuty = (await db.query<any>("select id,value,label,color,active,sort_order,metadata-'billTipEligible'-'billTipWorkedDayUnits' metadata from configuration_options where group_key='duty_codes' order by sort_order")).rows
const service = new FinancialPolicyInitializationService(db)
const first = await service.initialize(ANDALUCIA_SCOPE_ID, principal)
assert.equal(first.dutyCodesUpdated, duties.length)
assert.equal(first.rateCreated, true)
assert.equal(first.rulesCreated, 6)
assert.equal(first.tiersCreated, 9)
assert.equal(first.readiness, true)

const eligibility = (await db.query<any>("select metadata->>'displayCode' code,(metadata->>'billTipEligible')::boolean eligible from configuration_options where group_key='duty_codes' order by sort_order")).rows
assert.deepEqual(Object.fromEntries(eligibility.map(row => [row.code, row.eligible])), { ON: true, OFF: true, AL: false, PH: true, SK: true, TRN: true, SET: true })
const workedUnits = (await db.query<any>("select metadata->>'displayCode' code,(metadata->>'billTipWorkedDayUnits')::int units from configuration_options where group_key='duty_codes' order by sort_order")).rows
assert.deepEqual(Object.fromEntries(workedUnits.map(row => [row.code, row.units])), { ON: 1, OFF: 0, AL: 0, PH: 1, SK: 1, TRN: 1, SET: 1 })
const afterDuty = (await db.query<any>("select id,value,label,color,active,sort_order,metadata-'billTipEligible'-'billTipWorkedDayUnits' metadata from configuration_options where group_key='duty_codes' order by sort_order")).rows
assert.deepEqual(afterDuty, beforeDuty)

const rules = (await db.query<any>('select id,rule_key,configuration_option_id,source_key,rule_family,version,effective_from::text,effective_to::text,rate_percent::text,active from incentive_rules where outlet_scope_id=$1 order by rule_key', [ANDALUCIA_SCOPE_ID])).rows
assert.equal(rules.length, 6)
const foodRow = rules.find(row => row.rule_key === 'chargeable:lobster_paella')
const food: IncentiveRule = { id: foodRow.id, ruleKey: foodRow.rule_key, configurationOptionId: foodRow.configuration_option_id, sourceKey: foodRow.source_key, ruleFamily: foodRow.rule_family, version: foodRow.version, effectiveFrom: foodRow.effective_from, effectiveTo: foodRow.effective_to, ratePercent: foodRow.rate_percent, active: foodRow.active, tiers: [] }
const calculation = new IncentivesCalculationService(db).calculateIncentive(food, '85.00', 1, '10.0000', '17.0000')
assert.deepEqual({ gross: calculation.grossTotal, net: calculation.eligibleNetTotal, incentive: calculation.finalAmount }, { gross: '85.00', net: '66.05', incentive: '1.65' })
for (const key of ['birthday_basic', 'birthday_premium', 'anniversary_basic', 'anniversary_premium']) assert.equal(rules.find(row => row.source_key === key)?.rule_family, 'no_incentive')

const wineRow = rules.find(row => row.rule_key === 'wine-spirits:standard')
const tiers = (await db.query<any>('select id,minimum_amount::text,maximum_amount::text,reward_mode,reward_value::text from incentive_rule_tiers where rule_id=$1 order by sort_order', [wineRow.id])).rows
const wine: IncentiveRule = { id: wineRow.id, ruleKey: wineRow.rule_key, configurationOptionId: null, sourceKey: wineRow.source_key, ruleFamily: wineRow.rule_family, version: wineRow.version, effectiveFrom: wineRow.effective_from, effectiveTo: null, ratePercent: null, active: true, tiers: tiers.map(row => ({ id: row.id, minimumAmount: row.minimum_amount, maximumAmount: row.maximum_amount, rewardMode: row.reward_mode, rewardValue: row.reward_value })) }
const calculator = new IncentivesCalculationService(db)
for (const [amount, expected] of [['39.99', '0.00'], ['40.00', '2.00'], ['70.00', '3.00'], ['100.00', '4.00'], ['130.00', '5.00'], ['200.00', '6.00'], ['250.00', '7.00'], ['350.00', '8.00'], ['500.00', '12.50']]) assert.equal(calculator.calculateIncentive(wine, amount, 1, '0.0000', '0.0000').finalAmount, expected)

const countsBeforeRetry = {
  rates: Number((await db.query<any>('select count(*)::int count from financial_rate_versions')).rows[0].count),
  rules: Number((await db.query<any>('select count(*)::int count from incentive_rules')).rows[0].count),
  tiers: Number((await db.query<any>('select count(*)::int count from incentive_rule_tiers')).rows[0].count),
  audits: Number((await db.query<any>("select count(*)::int count from audit_logs where action in ('bill_tip_eligibility_initialized','initial_policy_version_created')")).rows[0].count),
}
const second = await service.initialize(ANDALUCIA_SCOPE_ID, principal)
assert.deepEqual({ dutyCodesUpdated: second.dutyCodesUpdated, rateCreated: second.rateCreated, rulesCreated: second.rulesCreated, tiersCreated: second.tiersCreated }, { dutyCodesUpdated: 0, rateCreated: false, rulesCreated: 0, tiersCreated: 0 })
const countsAfterRetry = {
  rates: Number((await db.query<any>('select count(*)::int count from financial_rate_versions')).rows[0].count),
  rules: Number((await db.query<any>('select count(*)::int count from incentive_rules')).rows[0].count),
  tiers: Number((await db.query<any>('select count(*)::int count from incentive_rule_tiers')).rows[0].count),
  audits: Number((await db.query<any>("select count(*)::int count from audit_logs where action in ('bill_tip_eligibility_initialized','initial_policy_version_created')")).rows[0].count),
}
assert.deepEqual(countsAfterRetry, countsBeforeRetry)
for (const table of ['bill_tip_distributions', 'bill_tip_staff_allocations', 'bill_tip_manual_allocations', 'chargeable_incentive_earnings']) assert.equal(Number((await db.query<any>(`select count(*)::int count from ${table}`)).rows[0].count), 0)
const audits = (await db.query<any>("select actor,after_data from audit_logs where action in ('bill_tip_eligibility_initialized','initial_policy_version_created')")).rows
assert(audits.length >= 14)
assert(audits.every(row => row.actor.includes(ownerId) && row.actor.includes('Isolated Owner')))
assert(audits.every(row => parsed(row.after_data).actorUserId === ownerId && parsed(row.after_data).outletScopeId === ANDALUCIA_SCOPE_ID))

await db.query("insert into configuration_options(id,group_key,value,label,metadata,active,sort_order) values($1,'duty_codes','ambiguous','Ambiguous Duty',$2,true,99)", [randomUUID(), JSON.stringify({ displayCode: 'AMB', dutyClassification: 'other', countsAsWorking: false })])
await assert.rejects(() => service.initialize(ANDALUCIA_SCOPE_ID, principal), /BILL_TIP_ELIGIBILITY_MANAGER_DECISION_REQUIRED:AMB/)

console.log(JSON.stringify({ effectiveDate: FINANCIAL_POLICY_EFFECTIVE_DATE, ownerAuthorization: true, eligibility: Object.fromEntries(eligibility.map(row => [row.code, row.eligible])), ambiguousCustomCodeBlocked: true, semanticPreservation: true, rate: '10.0000/17.0000', rules: rules.length, wineTiers: tiers.length, calculation, idempotent: true, financialTransactionsCreated: false, readiness: first.readiness }, null, 2))
await db.close()

function parsed(value: unknown) { return typeof value === 'string' ? JSON.parse(value) : value as Record<string, unknown> }
