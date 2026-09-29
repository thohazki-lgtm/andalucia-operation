import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { AuthPrincipal } from '../src/domain.js'
import { AuthorizationService } from './authorization-service.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { MonthlyReportInputRepository, monthlyFinanceComplete, normalizeMonthlyFinancePayload } from './monthly-report-input-repository.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const fixture = await createDisposableDevelopmentStore('monthly-finance')
const db = fixture.db

const ownerRow = (await db.query<{id:string;login_identifier:string;display_name:string}>("select id,login_identifier,display_name from user_accounts where status='active' order by created_at limit 1")).rows[0]
assert.ok(ownerRow, 'An isolated authenticated account fixture is required.')
const authorization = new AuthorizationService(db)
const sessionId = randomUUID()
await db.query("insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval '1 hour')", [sessionId, `isolated-monthly-${randomUUID()}`, ownerRow.id])
const principal:AuthPrincipal = {
  userId: ownerRow.id, sessionId, loginIdentifier: ownerRow.login_identifier,
  displayName: ownerRow.display_name, staffId: null, ...await authorization.authorizationForUser(ownerRow.id)
}
assert.equal(principal.permissionKeys.includes('manage_reports'), true)
const repository = new MonthlyReportInputRepository(db)

const assertRejectsCode = async (operation:()=>Promise<unknown>, code:string) => {
  await assert.rejects(operation, error => String((error as Error).message).includes(code))
}
const requiredPayload = {
  netFoodCost:'25', foodSales:'100', mtdFoodCostPercent:'25', budgetFoodCostPercent:'30', foodCostPerCover:'5',
  netBeverageCost:'10', beverageSales:'100', mtdBeverageCostPercent:'10', budgetBeverageCostPercent:'20', beverageCostPerCover:'2'
}

try {
  await assertRejectsCode(() => repository.save({ outletScopeId:ANDALUCIA_SCOPE_ID, monthStart:'2026-09-02', expectedRevision:null, financePayload:{} }, principal), 'MONTHLY_REPORT_MONTH_START_INVALID')
  await assertRejectsCode(() => repository.save({ outletScopeId:ANDALUCIA_SCOPE_ID, monthStart:'2026-09-01', expectedRevision:null, financePayload:{} }, null), 'AUTHENTICATION_REQUIRED')
  await assertRejectsCode(() => repository.save({ outletScopeId:ANDALUCIA_SCOPE_ID, monthStart:'2026-09-01', expectedRevision:null, financePayload:{} }, { ...principal, globalScope:false, permissionKeys:[], allowedOutletScopeIds:[], isOwner:false }), 'manage_reports')

  const otherOutlet = randomUUID()
  await db.query("insert into outlet_scopes(id,scope_key,display_name,active,created_by,updated_by) values($1,'isolated_other','Isolated Other',true,'test','test')", [otherOutlet])
  await assertRejectsCode(() => repository.save({ outletScopeId:otherOutlet, monthStart:'2026-09-01', expectedRevision:null, financePayload:{} }, principal), 'MONTHLY_REPORT_OUTLET_SCOPE_REJECTED')

  let record = await repository.save({ outletScopeId:ANDALUCIA_SCOPE_ID, monthStart:'2026-09-01', expectedRevision:null, financePayload:{}, managerCommentary:'Monthly management commentary', followUpsChanges:'Follow up next month' }, principal)
  assert.equal(record.financeStatus, 'not_entered')
  assert.equal(monthlyFinanceComplete(record.financePayload), false)
  assert.equal(record.managerCommentary, 'Monthly management commentary')
  assert.equal(record.followUpsChanges, 'Follow up next month')
  assert.equal(Object.values(record.financePayload).every(value => value === null), true, 'No Finance values may be fabricated.')

  record = await repository.save({ outletScopeId:ANDALUCIA_SCOPE_ID, monthStart:'2026-09-01', expectedRevision:record.revisionNumber, financePayload:{ netFoodCost:'0' }, managerCommentary:'Updated monthly context', followUpsChanges:'Updated follow-up' }, principal)
  assert.equal(record.financePayload.netFoodCost, '0', 'An explicit zero must not become null.')
  assert.equal(record.financePayload.foodSales, null)
  assert.equal(record.financeStatus, 'entered')
  await assertRejectsCode(() => repository.save({ outletScopeId:ANDALUCIA_SCOPE_ID, monthStart:'2026-09-01', expectedRevision:1, financePayload:{} }, principal), 'MONTHLY_REPORT_CONCURRENCY_CONFLICT')
  await assertRejectsCode(() => repository.save({ outletScopeId:ANDALUCIA_SCOPE_ID, monthStart:'2026-09-01', expectedRevision:null, financePayload:{} }, principal), 'MONTHLY_REPORT_CONCURRENCY_CONFLICT')

  record = await repository.save({ outletScopeId:ANDALUCIA_SCOPE_ID, monthStart:'2026-09-01', expectedRevision:record.revisionNumber, financePayload:requiredPayload }, principal)
  assert.equal(record.financePayload.calculatedFoodCostPercent, '25.0000')
  assert.equal(record.financePayload.calculatedBeverageCostPercent, '10.0000')
  assert.equal(record.financePayload.foodCostPercentDifference, '0.0000')
  assert.equal(record.financePayload.beverageCostPercentDifference, '0.0000')
  assert.equal(record.financePayload.foodCostVariancePercent, '-5.0000')
  assert.equal(record.financePayload.beverageCostVariancePercent, '-10.0000')
  record = await repository.verify(ANDALUCIA_SCOPE_ID, '2026-09-01', record.revisionNumber, principal)
  assert.equal(record.financeStatus, 'verified')
  assert.equal(record.verifiedByUserId, principal.userId)
  assert.equal(record.verifiedByName, principal.displayName)
  assert.ok(record.verifiedAt)

  await assert.rejects(db.query("update monthly_report_inputs set revision_number=revision_number+1,finance_payload=jsonb_set(finance_payload,'{netFoodCost}','\"30\"'::jsonb) where id=$1", [record.id]), /Editing verified Finance inputs must clear verification/)
  record = await repository.save({ outletScopeId:ANDALUCIA_SCOPE_ID, monthStart:'2026-09-01', expectedRevision:record.revisionNumber, financePayload:{ ...requiredPayload, netFoodCost:'30' } }, principal)
  assert.equal(record.financeStatus, 'entered')
  assert.equal(record.verifiedByUserId, null)
  assert.equal(record.verifiedByName, null)
  assert.equal(record.verifiedAt, null)

  let variance = await repository.save({ outletScopeId:ANDALUCIA_SCOPE_ID, monthStart:'2026-10-01', expectedRevision:null, financePayload:{ ...requiredPayload, mtdFoodCostPercent:'24' } }, principal)
  variance = await repository.verify(ANDALUCIA_SCOPE_ID, '2026-10-01', variance.revisionNumber, principal)
  assert.equal(variance.financeStatus, 'verified_with_variance')
  assert.equal(variance.financePayload.enteredFoodCostPercent, '24')
  assert.equal(variance.financePayload.calculatedFoodCostPercent, '25.0000')
  assert.equal(variance.financePayload.foodCostPercentDifference, '-1.0000')

  let zeroSales = await repository.save({ outletScopeId:ANDALUCIA_SCOPE_ID, monthStart:'2026-11-01', expectedRevision:null, financePayload:{ ...requiredPayload, foodSales:'0' } }, principal)
  assert.equal(zeroSales.financePayload.calculatedFoodCostPercent, null)
  zeroSales = await repository.verify(ANDALUCIA_SCOPE_ID, '2026-11-01', zeroSales.revisionNumber, principal)
  assert.equal(zeroSales.financeStatus, 'verified_with_variance')

  const zeroCost = normalizeMonthlyFinancePayload({ ...requiredPayload, netFoodCost:'0', mtdFoodCostPercent:'0' })
  assert.equal(zeroCost.calculatedFoodCostPercent, '0.0000')
  assert.equal(zeroCost.foodCostPercentDifference, '0.0000')

  const rows = Number((await db.query<{count:number}>('select count(*)::int count from monthly_report_inputs')).rows[0].count)
  assert.equal(rows, 3, 'One current row per tested outlet/month is expected.')
  const duplicateGroups = Number((await db.query<{count:number}>('select count(*)::int count from (select outlet_scope_id,month_start from monthly_report_inputs group by outlet_scope_id,month_start having count(*)>1) duplicate')).rows[0].count)
  assert.equal(duplicateGroups, 0)
  const audits = await db.query<{action:string;actor:string}>("select action,actor from audit_logs where entity_type='monthly_report_input'")
  assert.equal(audits.rows.some(row => row.action === 'created'), true)
  assert.equal(audits.rows.some(row => row.action === 'updated'), true)
  assert.equal(audits.rows.some(row => row.action === 'finance_verified'), true)
  assert.equal(audits.rows.some(row => row.action === 'finance_verification_reset'), true)
  assert.equal(audits.rows.some(row => row.action === 'monthly_commentary_updated'), true)
  assert.equal(audits.rows.some(row => row.action === 'monthly_follow_ups_updated'), true)
  assert.equal(audits.rows.every(row => row.actor.includes(principal.userId)), true)

  console.log(JSON.stringify({ status:'PASS', explicitZero:true, nullNotEntered:true, calculations:true, verified:true, verifiedWithVariance:true, verificationReset:true, concurrency:true, authorization:true, outletScope:true, audit:true, rows }, null, 2))
} finally {
  await fixture.cleanup()
}
