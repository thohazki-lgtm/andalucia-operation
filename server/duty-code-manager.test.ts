import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { StaffRepository } from './staff-repository.js'

const dataDirectory = await mkdtemp(join(tmpdir(), 'andalucia-duty-code-manager-'))
try {
  const repository = new StaffRepository(dataDirectory, new PGlite(dataDirectory))
  await repository.initialize()
  const createDuty = (displayCode: string, label: string, classification: 'working' | 'off' | 'annualLeave' | 'other', countsAsWorking: boolean) => repository.saveConfiguration('duty-codes', { id: randomUUID(), value: '', label, color: '#345678', active: true, metadata: { displayCode, dutyClassification: classification, countsAsWorking } })

  const working = await createDuty('TST', 'Test Working', 'working', false)
  assert.ok(working.value.startsWith('DUTY_'))
  assert.equal(working.metadata?.countsAsWorking, true)
  const internalValue = working.value
  const edited = await repository.saveConfiguration('duty-codes', { ...working, value: 'MUTATION_NOT_ALLOWED', label: 'Renamed Working', color: '#abcdef', metadata: { ...working.metadata, displayCode: 'TST2' } })
  assert.equal(edited.value, internalValue)
  assert.equal(edited.metadata?.displayCode, 'TST2')

  const off = await createDuty('TOFF', 'Test Off', 'off', true)
  const leave = await createDuty('TAL', 'Test Leave', 'annualLeave', true)
  assert.equal(off.metadata?.countsAsWorking, false)
  assert.equal(leave.metadata?.countsAsWorking, false)
  await assert.rejects(() => createDuty('TST2', 'Duplicate Code', 'other', false), /already in use/)

  const beforeOrder = (await repository.configuration()).dutyCodes.filter(option => option.active).map(option => option.id)
  await repository.reorderDutyCode(off.id, 'up')
  const afterOrder = (await repository.configuration()).dutyCodes.filter(option => option.active).map(option => option.id)
  assert.notDeepEqual(afterOrder, beforeOrder)

  const unused = await createDuty('DEL', 'Delete Me', 'other', false)
  assert.equal((await repository.removeDutyCode(unused.id)).mode, 'deleted')
  assert.equal((await repository.configuration()).dutyCodes.some(option => option.id === unused.id), false)

  const referenced = await createDuty('HIST', 'Historical Duty', 'other', true)
  const staffId = '00000000-0000-4000-8000-000000000001'
  await repository.getDatabase().query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), staffId, '2026-09-01', referenced.value])
  const retirement = await repository.removeDutyCode(referenced.id)
  assert.equal(retirement.mode, 'retired')
  assert.equal(retirement.option?.active, false)
  const historicalRoster = await repository.getDatabase().query<{ duty_code_value: string }>('select duty_code_value from duty_roster_entries where staff_id=$1 and duty_date=$2', [staffId, '2026-09-01'])
  assert.equal(historicalRoster.rows[0].duty_code_value, referenced.value)
  const attendanceReferenced = await createDuty('AHIST', 'Attendance History Duty', 'other', true)
  await repository.getDatabase().query('insert into attendance_records(id,staff_id,attendance_date,actual_status,actual_duty_code) values($1,$2,$3,$4,$5)', [randomUUID(), staffId, '2026-09-02', 'worked_as_scheduled', attendanceReferenced.value])
  assert.equal((await repository.removeDutyCode(attendanceReferenced.id)).mode, 'retired')

  await repository.getDatabase().close()
  const reopened = new StaffRepository(dataDirectory, new PGlite(dataDirectory))
  await reopened.initialize()
  const persisted = await reopened.configuration()
  assert.equal(persisted.dutyCodes.find(option => option.id === edited.id)?.metadata?.displayCode, 'TST2')
  assert.equal(persisted.dutyCodes.find(option => option.id === edited.id)?.color, '#abcdef')
  assert.equal(persisted.dutyCodes.find(option => option.id === referenced.id)?.active, false)
  assert.equal(persisted.dutyCodes.find(option => option.id === attendanceReferenced.id)?.active, false)
  assert.deepEqual(persisted.dutyCodes.filter(option => option.active).map(option => option.id), afterOrder.filter(id => id !== unused.id && id !== referenced.id))
  await reopened.getDatabase().close()
  console.log(JSON.stringify({ internalValueImmutable: true, displayCodePersisted: true, classificationsProtected: true, duplicateDisplayCodeRejected: true, orderPersisted: true, unusedDeleted: true, rosterReferencedRetired: true, attendanceReferencedRetired: true, historyPreserved: true }, null, 2))
} finally {
  await rm(dataDirectory, { recursive: true, force: true })
}
