import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import type { AuthPrincipal, MaintenanceRecord } from '../src/domain.js'
import { serviceDate } from '../src/service-date.js'
import { MaintenanceRepository } from './maintenance-repository.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'

const db = new PGlite()
await db.exec(await readFile('database/schema.sql', 'utf8'))
await db.query("insert into outlet_scopes(id,scope_key,display_name,active,outlet_type) values($1,'andalucia','Andalucía',true,'restaurant')", [ANDALUCIA_SCOPE_ID])
const actorId = randomUUID(); const staffId = randomUUID()
await db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status) values($1,'maintenance.manager','maintenance.manager','Maintenance Manager','not-used','active')", [actorId])
await db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'M001','Reporter One','waiter','active','2026-01-01')", [staffId])
const actor: AuthPrincipal = { userId: actorId, sessionId: randomUUID(), loginIdentifier: 'maintenance.manager', displayName: 'Maintenance Manager', staffId: null, roleKeys: ['outlet_manager'], permissionKeys: ['manage_maintenance'], globalScope: false, allowedOutletScopeIds: [ANDALUCIA_SCOPE_ID], isOwner: false }
const context = { outletScopeId: ANDALUCIA_SCOPE_ID, actor }
const repository = new MaintenanceRepository(db); await repository.initialize()
const configuration = await repository.configuration(); const area = configuration.areas[0]
const input: MaintenanceRecord = { id: randomUUID(), issue: 'Ice machine not working!', dateReported: '2026-09-22', area: area.value, priority: 'urgent', status: 'open', referenceFollowUp: 'Engineering informed', notes: 'Service impact', reportedByStaffId: staffId, reportedBy: null, revision: 1 }
const created = await repository.save(input, context)
assert.equal(created.revision, 1); assert.equal(created.reporterNameSnapshot, 'Reporter One'); assert.equal(created.reporterNumberSnapshot, 'M001'); assert.equal(created.outletScopeId, ANDALUCIA_SCOPE_ID)
const warnings = await repository.duplicateWarnings({ ...input, issue: ' ICE—MACHINE, not working ' }, ANDALUCIA_SCOPE_ID)
assert.equal(warnings.length, 1); assert.equal(warnings[0].id, created.id)
const inProgress = await repository.save({ ...created, status: 'in_progress' }, context); assert.equal(inProgress.revision, 2)
await assert.rejects(repository.save({ ...created, notes: 'stale overwrite' }, context), /MAINTENANCE_CONCURRENCY_CONFLICT/)
const completed = await repository.save({ ...inProgress, status: 'completed' }, context)
assert.equal(completed.revision, 3); assert.ok(completed.completedAt); assert.equal(completed.completedByUserId, actorId); assert.equal(completed.completedByNameSnapshot, 'Maintenance Manager (maintenance.manager)')
await assert.rejects(repository.save({ ...completed, status: 'open' }, context), /terminal/)
const summary = await repository.summary(serviceDate(new Date(completed.completedAt!)), ANDALUCIA_SCOPE_ID); assert.equal(summary.completedToday, 1); assert.equal(summary.urgentUnresolved, 0)

const areaCreated = await repository.saveConfiguration('areas', { id: randomUUID(), value: '', label: 'Cold Store', active: true }, actor)
assert.match(areaCreated.value, /^maintenance_area_/)
const areaEdited = await repository.saveConfiguration('areas', { ...areaCreated, label: 'Cold Storage' }, actor); assert.equal(areaEdited.value, areaCreated.value)
const areaArchived = await repository.saveConfiguration('areas', { ...areaEdited, active: false }, actor); assert.equal(areaArchived.active, false)
const areaRestored = await repository.saveConfiguration('areas', { ...areaArchived, active: true }, actor); assert.equal(areaRestored.active, true)
await assert.rejects(repository.saveConfiguration('areas', { id: randomUUID(), value: '', label: ' cold  storage ', active: true }, actor), /already uses/)
const open = configuration.statuses.find(option => option.value === 'open')!
const recolored = await repository.saveConfiguration('statuses', { ...open, color: '#123456' }, actor); assert.equal(recolored.color, '#123456')
await assert.rejects(repository.saveConfiguration('statuses', { ...open, label: 'Started' }, actor), /Only the display color/)

await db.query("insert into maintenance_issues(id,issue,priority,reported_at,status,issue_date,area_value,notes,outlet_scope_id,revision) values($1,'Historical issue','Operational','2026-09-01','open','2026-09-01',$2,'',$3,1)", [randomUUID(), area.value, ANDALUCIA_SCOPE_ID])
const records = await repository.list(ANDALUCIA_SCOPE_ID); const historical = records.find(item => item.issue === 'Historical issue')!
assert.equal(historical.priority, 'Operational'); assert.equal(historical.reporterNameSnapshot, null); assert.equal(historical.completedAt, null)
assert.equal((await repository.list(randomUUID())).length, 0)
assert.ok(Number((await db.query<{ count: number }>("select count(*)::int count from audit_logs where entity_type in ('maintenance_issue','maintenance_configuration')")).rows[0].count) >= 8)
console.log(JSON.stringify({ creation: true, snapshots: true, duplicateWarning: true, concurrency: true, completion: true, protectedWorkflow: true, areaArchiveRestore: true, outletScope: true, audit: true, legacyPriorityPreserved: true }))
await db.close()
