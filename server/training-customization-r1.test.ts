import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { TrainingRepository } from './training-repository.js'

const db = new PGlite()
await db.exec(await readFile('database/schema.sql', 'utf8'))
await db.query("insert into outlet_scopes(id,scope_key,display_name,active,outlet_type) values('00000000-0000-4000-8000-00000000a001','andalucia','Andalucía',true,'restaurant')")
await db.exec(await readFile('database/migrations/016_training_r2_foundation.sql', 'utf8'))
const repository = new TrainingRepository(db)
await repository.initialize()

const original = (await repository.configuration()).categories[0]
const renamed = await repository.saveCategory({ ...original, label: 'Service Excellence', color: '#234f68' }, 'R1 Test')
assert.equal(renamed.value, original.value)
assert.equal(renamed.id, original.id)
await repository.saveCategory({ ...renamed, active: false }, 'R1 Test')
assert.equal((await repository.configuration()).categories.find(item => item.id === original.id)?.active, false)

const added = await repository.saveCategory({ id: randomUUID(), value: 'client-value-must-not-win', label: 'Coffee Knowledge', color: '#765b32', active: true }, 'R1 Test')
assert.match(added.value, /^TRAINING_CATEGORY_[A-F0-9]{32}$/)
await assert.rejects(repository.saveCategory({ id: randomUUID(), value: '', label: 'coffee knowledge', active: true }, 'R1 Test'), /already exists/)
const beforeOrder = (await repository.configuration()).categories.map(item => item.id)
const requestedOrder = [added.id, ...beforeOrder.filter(id => id !== added.id)]
await repository.reorderCategories(requestedOrder, 'R1 Test')
const afterOrder = (await repository.configuration()).categories.map(item => item.id)
assert.deepEqual(afterOrder, requestedOrder)
await assert.rejects(repository.reorderCategories(requestedOrder.slice(1), 'R1 Test'), /every category exactly once/)

const activeStaffId = randomUUID()
await db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'TR-CFG-1','Training Manager','Venue Manager','active','2026-09-01')", [activeStaffId])
const defaults = await repository.saveDefaults({ durationMinutes: 30, trainerMode: 'staff', trainerStaffId: activeStaffId, location: 'Andalucía', categoryValue: added.value, participantSelection: 'eligible_staff' }, 'R1 Test')
assert.deepEqual(await repository.defaults(), defaults)

const ownerId = randomUUID()
await db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status) values($1,'training.owner','training.owner','Training Owner','test-only','active')", [ownerId])
const oldTarget = await repository.target()
const target = await repository.createTargetVersion({ effectiveMonth: '2026-10-01', monthlyTargetHours: 62, perHeadTargetHours: 3.8 }, { userId: ownerId, displayName: 'Training Owner' })
assert.equal(target.versionNumber, oldTarget.versionNumber + 1)
assert.equal(target.participantCreditCapMinutes, 30)
assert.equal((await db.query<{ count: number }>('select count(*)::int count from training_target_versions where id=$1 and monthly_target_credited_minutes=$2', [oldTarget.id, oldTarget.monthlyTargetMinutes])).rows[0].count, 1)
await assert.rejects(db.query('update training_target_versions set monthly_target_credited_minutes=1 where id=$1', [oldTarget.id]), /immutable/i)

const workflowBefore = await repository.workflow()
const savedWorkflow = await repository.saveWorkflowColor('completed', '#246b58', 'R1 Test')
assert.equal(savedWorkflow.color, '#246b58')
assert.equal((await repository.workflow()).find(item => item.state === 'completed')?.label, 'Completed')
assert.deepEqual(workflowBefore.map(item => item.state), (await repository.workflow()).map(item => item.state))
assert.ok((await db.query<{ count: number }>("select count(*)::int count from audit_logs where entity_type in ('training_configuration','training_target_version')")).rows[0].count >= 6)

console.log(JSON.stringify({ categoryIdentityLocked: true, categoryArchiveHistoricalSafe: true, duplicateActiveNameRejected: true, categoryOrderPersisted: true, defaultsPersisted: true, targetVersionInserted: true, historicalTargetImmutable: true, participantCapProtected: true, workflowColorOnly: true, auditEvidence: true }, null, 2))
await db.close()
