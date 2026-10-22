import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { request as httpRequest } from 'node:http'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { auditActorLabel } from './authorization-service.js'
import { canonicalStoreDirectory, readStoreIdentity } from './database-protection.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const fixture = await createDisposableDevelopmentStore('annual-leave-r2-authorization')
const normalized = (value: string) => resolve(value).replaceAll('\\', '/').toLowerCase()
assert.notEqual(normalized(fixture.store), normalized(canonicalStoreDirectory))
assert.equal((await readStoreIdentity(fixture.store, 'development')).role, 'development')

const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex')
const tokens = {
  manager: `leave-manager-${randomUUID()}`,
  viewer: `leave-viewer-${randomUUID()}`,
  wrongOutlet: `leave-wrong-outlet-${randomUUID()}`
}
const users = {
  manager: { id: randomUUID(), name: 'Annual Leave Manager' },
  viewer: { id: randomUUID(), name: 'Annual Leave Viewer' },
  wrongOutlet: { id: randomUUID(), name: 'Other Outlet Manager' }
}
const otherOutletId = randomUUID()
const db = fixture.db
await db.query("insert into outlet_scopes(id,scope_key,display_name,active,outlet_type) values($1,'annual_leave_other','Other Outlet',true,'restaurant')", [otherOutletId])
for (const key of Object.keys(users) as Array<keyof typeof users>) {
  const user = users[key]
  await db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status,created_by,updated_by) values($1,$2,$2,$3,'isolated-test-no-login','active','Annual Leave R2 test','Annual Leave R2 test')", [user.id, `leave-${key}-${user.id}`, user.name])
  await db.query("insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval '1 hour')", [randomUUID(), tokenHash(tokens[key]), user.id])
}
await db.query("insert into authorization_user_roles(id,user_id,role_id,active,created_by,updated_by) select $1,$2,id,true,'Annual Leave R2 test','Annual Leave R2 test' from authorization_roles where role_key='outlet_manager'", [randomUUID(), users.manager.id])
await db.query("insert into authorization_user_roles(id,user_id,role_id,active,created_by,updated_by) select $1,$2,id,true,'Annual Leave R2 test','Annual Leave R2 test' from authorization_roles where role_key='viewer'", [randomUUID(), users.viewer.id])
await db.query("insert into authorization_user_roles(id,user_id,role_id,active,created_by,updated_by) select $1,$2,id,true,'Annual Leave R2 test','Annual Leave R2 test' from authorization_roles where role_key='outlet_manager'", [randomUUID(), users.wrongOutlet.id])
await db.query("insert into authorization_user_outlet_scopes(id,user_id,outlet_scope_id,active,created_by,updated_by) values($1,$2,$3,true,'Annual Leave R2 test','Annual Leave R2 test')", [randomUUID(), users.manager.id, ANDALUCIA_SCOPE_ID])
await db.query("insert into authorization_user_outlet_scopes(id,user_id,outlet_scope_id,active,created_by,updated_by) values($1,$2,$3,true,'Annual Leave R2 test','Annual Leave R2 test')", [randomUUID(), users.viewer.id, ANDALUCIA_SCOPE_ID])
await db.query("insert into authorization_user_outlet_scopes(id,user_id,outlet_scope_id,active,created_by,updated_by) values($1,$2,$3,true,'Annual Leave R2 test','Annual Leave R2 test')", [randomUUID(), users.wrongOutlet.id, otherOutletId])

const staff = { id: randomUUID() }
const annualLeaveCode = { value: 'AL_R2_AUTH_TEST' }
await db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'employment_statuses','active','Active','#1b6288',$2,true,1) on conflict(group_key,value) do nothing", [randomUUID(), JSON.stringify({ eligibleForAssignments: true })])
await db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes',$2,'Annual Leave','#b38b3a',$3,true,1)", [randomUUID(), annualLeaveCode.value, JSON.stringify({ displayCode: 'AL', dutyClassification: 'annualLeave', countsAsWorking: false, countsAsLeave: true })])
await db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date,nationality,division,department,outlet,identity_document_number) values($1,'AL-R2-AUTH','Annual Leave Security Fixture','Waiter','active','2099-01-01','','Food & Beverage','F&B Service','Andalucía','')", [staff.id])
await db.query("insert into staff_membership_history(id,staff_id,outlet_scope_id,membership_dimension,effective_from,effective_to,source,reason,review_status,reviewed_at,reviewed_by,is_current_baseline) values($1,$2,$3,'regular_outlet','2099-01-01',null,'baseline_manager_review','Authorization fixture','approved',now(),'Annual Leave R2 test',true)", [randomUUID(), staff.id, ANDALUCIA_SCOPE_ID])
const before = {
  entitlements: Number((await db.query<{ count: number }>('select count(*)::int count from staff_entitlements')).rows[0].count),
  leaveEntitlementOverrides: Number((await db.query<{ count: number }>('select count(*)::int count from staff_leave_entitlement_overrides')).rows[0].count),
  holidays: Number((await db.query<{ count: number }>('select count(*)::int count from public_holidays')).rows[0].count),
  roster: Number((await db.query<{ count: number }>("select count(*)::int count from duty_roster_entries where staff_id=$1 and duty_date='2099-06-15'", [staff.id])).rows[0].count),
  planned: Number((await db.query<{ count: number }>('select count(*)::int count from planned_leave_periods')).rows[0].count)
}
await db.close()

const port = await new Promise<number>((resolvePort, rejectPort) => {
  const reservation = createServer()
  reservation.once('error', rejectPort)
  reservation.listen(0, '127.0.0.1', () => {
    const address = reservation.address()
    if (!address || typeof address === 'string') return reservation.close(() => rejectPort(new Error('ISOLATED_API_PORT_RESERVATION_FAILED')))
    const selected = address.port
    reservation.close(error => error ? rejectPort(error) : resolvePort(selected))
  })
})
const base = `http://127.0.0.1:${port}`
const trustedOrigin = 'https://annual-leave-r2-security.test'
const loopbackRequest = (url: string, init: { method?: string; headers?: Headers; body?: string; timeout?: number } = {}) => new Promise<Response>((resolveResponse, rejectResponse) => {
  const request = httpRequest(url, { method: init.method || 'GET', headers: init.headers ? Object.fromEntries(init.headers.entries()) : undefined }, response => {
    const chunks: Buffer[] = []
    response.on('data', chunk => chunks.push(Buffer.from(chunk)))
    response.on('end', () => {
      const status = response.statusCode || 500
      resolveResponse(new Response(status === 204 || status === 304 ? null : Buffer.concat(chunks), { status, headers: response.headers as HeadersInit }))
    })
  })
  request.once('error', rejectResponse)
  request.setTimeout(init.timeout || 5_000, () => request.destroy(new Error('ISOLATED_API_REQUEST_TIMEOUT')))
  if (init.body !== undefined) request.write(init.body)
  request.end()
})
const request = (path: string, method = 'GET', token?: string, origin = trustedOrigin, payload?: unknown) => {
  const headers = new Headers()
  if (method !== 'GET') { headers.set('Origin', origin); headers.set('Content-Type', 'application/json') }
  if (token) headers.set('Cookie', `andalucia_session=${encodeURIComponent(token)}`)
  return loopbackRequest(`${base}${path}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) })
}
const entitlementBody = { annualLeavePerYear: 31, weeklyOffEntitlement: 1, publicHolidayPerYear: 11, leaveOverrides: { sickLeave: 0, emergencyLeave: 5 }, updatedBy: 'Spoofed Client Actor' }
const holidayId = randomUUID()
const holidayBody = { id: holidayId, name: 'Isolated Authorization Holiday', date: '2099-06-14', days: 1, active: true, updatedBy: 'Spoofed Client Actor' }
const rosterBody = { dutyCode: annualLeaveCode.value, actor: 'Spoofed Client Actor' }
const plannedBody = { staffId: staff.id, startDate: '2099-06-20', endDate: '2099-06-22', leaveType: 'annual_leave', managerNote: 'Authorization fixture', createdBy: 'Spoofed Client Actor' }
const activationBody = { code: 'EL' }
const carryForwardPreviewBody = { carryForward: 10.5 }
const carryForwardSaveBody = { ...carryForwardPreviewBody, confirmation: 'CONFIRM_ANNUAL_LEAVE_CARRY_FORWARD' }
const accumulatedOffOpeningBody = { staffId: staff.id, days: 1, effectiveDate: '2026-09-05', justification: 'Verified historical authorization evidence', evidenceReference: 'AUTH-026' }
const mutationCases = [
  { path: `/api/workforce/staff-entitlements/${staff.id}`, method: 'PUT', body: entitlementBody },
  { path: '/api/workforce/public-holidays', method: 'POST', body: holidayBody },
  { path: `/api/roster/${staff.id}/2099-06-15`, method: 'PUT', body: rosterBody }
  ,{ path: '/api/workforce/planned-leave', method: 'POST', body: plannedBody }
  ,{ path: '/api/config/staff/duty-codes/activate', method: 'POST', body: activationBody }
  ,{ path: `/api/workforce/staff-entitlements/${staff.id}/annual-leave-carry-forward/preview`, method: 'POST', body: carryForwardPreviewBody }
  ,{ path: `/api/workforce/staff-entitlements/${staff.id}/annual-leave-carry-forward`, method: 'PUT', body: carryForwardSaveBody }
  ,{ path: '/api/workforce/accumulated-off/opening-balance', method: 'POST', body: accumulatedOffOpeningBody }
  ,{ path: '/api/workforce/accumulated-off/initialize-history', method: 'POST', body: {} }
] as const

let api: ChildProcess | undefined
let stdout = ''
let stderr = ''
const stop = async () => {
  if (!api || api.exitCode !== null) return
  api.kill('SIGTERM')
  await Promise.race([new Promise<void>(done => api!.once('exit', () => done())), new Promise<void>(done => setTimeout(done, 5_000))])
  if (api.exitCode === null) api.kill('SIGKILL')
}
const waitForHealth = async () => {
  const deadline = Date.now() + 20_000
  let lastFailure = 'no response'
  while (Date.now() < deadline) {
    if (api?.exitCode !== null && api?.exitCode !== undefined) throw new Error(`Isolated Annual Leave API exited before health readiness with code ${api.exitCode}. stdout=${stdout} stderr=${stderr}`)
    try {
      const response = await loopbackRequest(`${base}/api/health`, { timeout: 1_000 })
      if (response.ok) return
      lastFailure = `HTTP ${response.status}: ${await response.text()}`
    } catch (error) { lastFailure = error instanceof Error ? error.message : String(error) }
    await new Promise(done => setTimeout(done, 150))
  }
  throw new Error(`Isolated Annual Leave API did not become healthy. lastFailure=${lastFailure} stdout=${stdout} stderr=${stderr}`)
}

try {
  api = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
    cwd: resolve('.'),
    env: { ...process.env, ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', NODE_ENV: 'test', APP_ORIGIN: trustedOrigin, API_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  api.stdout?.on('data', chunk => { stdout += String(chunk) })
  api.stderr?.on('data', chunk => { stderr += String(chunk) })
  await waitForHealth()

  for (const item of mutationCases) {
    assert.equal((await request(item.path, item.method, undefined, trustedOrigin, item.body)).status, 401, `${item.method} ${item.path} must reject anonymous callers.`)
    assert.equal((await request(item.path, item.method, tokens.viewer, trustedOrigin, item.body)).status, 403, `${item.method} ${item.path} must reject insufficient permission.`)
    assert.equal((await request(item.path, item.method, tokens.wrongOutlet, trustedOrigin, item.body)).status, 403, `${item.method} ${item.path} must reject the wrong OutletScope.`)
    assert.equal((await request(item.path, item.method, tokens.manager, 'https://untrusted.example', item.body)).status, 401, `${item.method} ${item.path} must reject an untrusted origin.`)
  }

  const accumulatedOffInitialization = await request('/api/workforce/accumulated-off/initialize-history', 'POST', tokens.manager, trustedOrigin, {})
  assert.equal(accumulatedOffInitialization.status, 200)
  const accumulatedOffInitializationResult = await accumulatedOffInitialization.json() as { outletScopeId: string; eligibleStaff: number }
  assert.equal(accumulatedOffInitializationResult.outletScopeId, ANDALUCIA_SCOPE_ID)
  assert.equal(accumulatedOffInitializationResult.eligibleStaff, 0, 'The future-dated authorization fixture must not create historical accumulated-OFF evaluations.')

  assert.equal((await request('/api/workforce/public-holidays?year=2099')).status, 401)
  assert.equal((await request('/api/workforce/public-holidays?year=2099', 'GET', tokens.viewer)).status, 403)
  assert.equal((await request('/api/workforce/public-holidays?year=2099', 'GET', tokens.wrongOutlet)).status, 403)
  assert.equal((await request('/api/workforce/public-holidays?year=2099', 'GET', tokens.manager)).status, 200)
  assert.equal((await request(`/api/workforce/public-holidays/${holidayId}`, 'PUT', undefined, trustedOrigin, holidayBody)).status, 401)
  assert.equal((await request(`/api/workforce/public-holidays/${holidayId}`, 'DELETE', undefined, trustedOrigin)).status, 401)

  const activationResponse = await request('/api/config/staff/duty-codes/activate', 'POST', tokens.manager, trustedOrigin, activationBody)
  assert.equal(activationResponse.status, 200)
  const activated = await activationResponse.json() as { label: string; active: boolean; metadata?: { displayCode?: string; dutyClassification?: string } }
  assert.equal(activated.metadata?.displayCode, 'EL')
  assert.equal(activated.metadata?.dutyClassification, 'emergencyLeave')
  assert.equal(activated.label, 'Emergency Leave')
  assert.equal(activated.active, true)
  const refreshedConfiguration = await request('/api/config/staff', 'GET', tokens.manager)
  assert.equal(refreshedConfiguration.status, 200)
  const refreshedDutyCodes = (await refreshedConfiguration.json() as { dutyCodes: Array<{ active: boolean; metadata?: { displayCode?: string } }> }).dutyCodes
  assert.equal(refreshedDutyCodes.filter(option => option.active && option.metadata?.displayCode === 'EL').length, 1, 'authenticated activation must persist exactly once')
  const duplicateActivation = await request('/api/config/staff/duty-codes/activate', 'POST', tokens.manager, trustedOrigin, activationBody)
  assert.equal(duplicateActivation.status, 409)
  assert.match((await duplicateActivation.json() as { message: string }).message, /already configured and active/)

  const entitlementResponse = await request(mutationCases[0].path, 'PUT', tokens.manager, trustedOrigin, entitlementBody)
  assert.equal(entitlementResponse.status, 200)
  const savedEntitlement = await entitlementResponse.json() as { updatedBy?: string }
  assert.equal(savedEntitlement.updatedBy, auditActorLabel({ userId: users.manager.id, displayName: users.manager.name }))
  assert.notEqual(savedEntitlement.updatedBy, entitlementBody.updatedBy)

  const holidayResponse = await request('/api/workforce/public-holidays', 'POST', tokens.manager, trustedOrigin, holidayBody)
  assert.equal(holidayResponse.status, 201)
  const savedHoliday = await holidayResponse.json() as { updatedBy?: string }
  assert.equal(savedHoliday.updatedBy, auditActorLabel({ userId: users.manager.id, displayName: users.manager.name }))
  assert.notEqual(savedHoliday.updatedBy, holidayBody.updatedBy)
  assert.equal((await request(`/api/workforce/public-holidays/${holidayId}`, 'PUT', tokens.manager, trustedOrigin, { ...holidayBody, name: 'Updated Isolated Authorization Holiday' })).status, 200)

  assert.equal((await request(mutationCases[2].path, 'PUT', tokens.manager, trustedOrigin, rosterBody)).status, 204)
  const plannedResponse = await request('/api/workforce/planned-leave', 'POST', tokens.manager, trustedOrigin, plannedBody)
  assert.equal(plannedResponse.status, 201)
  const savedPlanned = await plannedResponse.json() as { id: string; revision: number; createdByUserId: string }
  assert.equal(savedPlanned.createdByUserId, users.manager.id)
  assert.equal((await request(`/api/workforce/planned-leave/${savedPlanned.id}/cancel`, 'POST', tokens.manager, trustedOrigin, { revision: savedPlanned.revision, reason: 'Authorization test cleanup' })).status, 200)
  assert.equal((await request(`/api/workforce/public-holidays/${holidayId}`, 'DELETE', tokens.manager, trustedOrigin)).status, 204)
} finally {
  await stop()
}

const verified = new PGlite(fixture.store)
try {
  const actor = auditActorLabel({ userId: users.manager.id, displayName: users.manager.name })
  const after = {
    entitlements: Number((await verified.query<{ count: number }>('select count(*)::int count from staff_entitlements')).rows[0].count),
    leaveEntitlementOverrides: Number((await verified.query<{ count: number }>('select count(*)::int count from staff_leave_entitlement_overrides')).rows[0].count),
    holidays: Number((await verified.query<{ count: number }>('select count(*)::int count from public_holidays')).rows[0].count),
    roster: Number((await verified.query<{ count: number }>("select count(*)::int count from duty_roster_entries where staff_id=$1 and duty_date='2099-06-15'", [staff.id])).rows[0].count),
    planned: Number((await verified.query<{ count: number }>('select count(*)::int count from planned_leave_periods')).rows[0].count)
  }
  assert.equal(after.entitlements, before.entitlements + (before.entitlements === 0 ? 1 : 0))
  assert.equal(after.leaveEntitlementOverrides, before.leaveEntitlementOverrides + 2)
  assert.equal(after.holidays, before.holidays, 'The authorized create/update/delete holiday sequence must leave no fixture holiday behind.')
  assert.equal(after.roster, before.roster + 1)
  assert.equal(after.planned, before.planned + 1)
  const audits = await verified.query<{ entity_type: string; actor: string }>("select entity_type,actor from audit_logs where entity_type in ('staff_entitlement','staff_leave_entitlement_override','public_holiday','duty_roster_entry','configuration_option') and actor=$1", [actor])
  assert(audits.rows.some(row => row.entity_type === 'staff_entitlement'))
  assert.equal(audits.rows.filter(row => row.entity_type === 'staff_leave_entitlement_override').length, 2)
  assert(audits.rows.filter(row => row.entity_type === 'public_holiday').length >= 3)
  assert(audits.rows.some(row => row.entity_type === 'duty_roster_entry'))
  assert(audits.rows.some(row => row.entity_type === 'configuration_option'))
  assert(audits.rows.every(row => row.actor === actor))
  assert.equal(audits.rows.some(row => row.actor === 'Spoofed Client Actor'), false)
  console.log(JSON.stringify({
    isolatedDevelopmentStore: true,
    anonymousRejected: true,
    insufficientPermissionRejected: true,
    wrongOutletRejected: true,
    untrustedOriginRejected: true,
    authorizedAndaluciaManagerAccepted: true,
    accumulatedOffInitializationProtected: true,
    publicHolidayReadProtected: true,
    publicHolidayCreateUpdateDeleteProtected: true,
    entitlementMutationProtected: true,
    rosterMutationProtected: true,
    plannedLeaveCreateCancelProtected: true,
    protectedDutyCodeActivationAuthenticated: true,
    protectedDutyCodeActivationPersisted: true,
    protectedDutyCodeDuplicateRejected: true,
    annualLeaveCarryForwardPreviewProtected: true,
    annualLeaveCarryForwardSaveProtected: true,
    serverDerivedAuditIdentity: true,
    clientAuditSpoofRejected: true,
    canonicalOperationalMutations: 0
  }, null, 2))
} finally {
  await verified.close()
  await fixture.cleanup()
}
