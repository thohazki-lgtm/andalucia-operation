import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { StaffRepository } from './staff-repository.js'

const dataDirectory = await mkdtemp(join(tmpdir(), 'andalucia-staff-order-'))
const database = new PGlite(dataDirectory)
try {
  const repository = new StaffRepository(dataDirectory, database)
  await repository.initialize()
  const original = await repository.list()
  assert.ok(original.length >= 3)
  const staffBefore = (await database.query<Record<string, unknown>>('select * from staff order by id')).rows
  const rosterStaff = original[0]
  const dutyCode = (await repository.configuration()).dutyCodes.find(option => option.active)!
  await database.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), rosterStaff.id, '2026-12-31', dutyCode.value])
  const rosterBefore = (await database.query<Record<string, unknown>>('select * from duty_roster_entries order by id')).rows

  const reorderedIds = [...original.map(person => person.id)].reverse()
  const reordered = await repository.reorderStaff(reorderedIds, 'Test Manager')
  assert.deepEqual(reordered.map(person => person.id), reorderedIds)
  assert.deepEqual((await repository.list()).map(person => person.id), reorderedIds)

  const refreshedRepository = new StaffRepository(dataDirectory, database)
  await refreshedRepository.initialize()
  assert.deepEqual((await refreshedRepository.list()).map(person => person.id), reorderedIds)
  const cancelledDraft = [...reorderedIds]
  cancelledDraft.splice(1, 0, cancelledDraft.shift()!)
  assert.notDeepEqual(cancelledDraft, reorderedIds)
  assert.deepEqual((await repository.list()).map(person => person.id), reorderedIds, 'Cancelling a local draft must not persist a new order.')
  await assert.rejects(() => repository.reorderStaff(reorderedIds.slice(1), 'Test Manager'), /every current staff member exactly once/)
  await assert.rejects(() => repository.reorderStaff([...reorderedIds.slice(0, -1), reorderedIds[0]], 'Test Manager'), /every current staff member exactly once/)

  assert.deepEqual((await database.query<Record<string, unknown>>('select * from staff order by id')).rows, staffBefore)
  assert.deepEqual((await database.query<Record<string, unknown>>('select * from duty_roster_entries order by id')).rows, rosterBefore)
  const saved = (await database.query<any>("select metadata from configuration_options where group_key='staff_display_order' and value='shared'")).rows[0]
  assert.deepEqual(saved.metadata.orderedIds, reorderedIds)
  const audit = (await database.query<any>("select action,actor,after_data from audit_logs where entity_type='staff_display_order' order by created_at desc limit 1")).rows[0]
  assert.equal(audit.action, 'reordered')
  assert.equal(audit.actor, 'Test Manager')
  assert.deepEqual(audit.after_data.orderedIds, reorderedIds)

  console.log(JSON.stringify({ completeOrderValidated: true, sharedOrderPersisted: true, refreshSynchronization: true, cancelDoesNotPersist: true, invalidOrdersRejected: true, staffRecordsUnchanged: true, rosterAssignmentsUnchanged: true, auditPreserved: true }, null, 2))
} finally {
  await database.close()
  await rm(dataDirectory, { recursive: true, force: true })
}
