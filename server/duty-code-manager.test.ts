import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { PGlite } from '@electric-sql/pglite'
import { StaffRepository } from './staff-repository.js'
import { moveDutyCode } from '../src/duty-code-order.js'

const dataDirectory = await mkdtemp(join(tmpdir(), 'andalucia-duty-code-manager-'))
const snapshotPath = join(tmpdir(), `andalucia-duty-code-manager-${randomUUID()}.tgz`)
const execFileAsync = promisify(execFile)
try {
  const repository = new StaffRepository(dataDirectory, new PGlite(dataDirectory))
  await repository.initialize()
  const createDuty = (displayCode: string, label: string, classification: 'working' | 'off' | 'annualLeave' | 'other', countsAsWorking: boolean) => repository.saveConfiguration('duty-codes', { id: randomUUID(), value: '', label, color: '#345678', active: true, metadata: { displayCode, dutyClassification: classification, countsAsWorking, billTipEligible: classification === 'annualLeave' ? false : true, billTipWorkedDayUnits: classification === 'working' ? 1 : 0 } })

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

  const beforeOptions = (await repository.configuration()).dutyCodes.filter(option => option.active)
  const beforeOrder = beforeOptions.map(option => option.id)
  await repository.reorderDutyCode(off.id, 'up')
  const directionalOrder = (await repository.configuration()).dutyCodes.filter(option => option.active).map(option => option.id)
  assert.notDeepEqual(directionalOrder, beforeOrder)
  let currentOptions = (await repository.configuration()).dutyCodes.filter(option => option.active)
  const persistMove = async (sourceIndex: number, targetIndex: number, placement: 'before' | 'after') => {
    const expected = moveDutyCode(currentOptions, currentOptions[sourceIndex].id, currentOptions[targetIndex].id, placement)
    await repository.reorderDutyCodes(expected.map(option => option.id))
    currentOptions = (await repository.configuration()).dutyCodes.filter(option => option.active)
    assert.deepEqual(currentOptions.map(option => option.id), expected.map(option => option.id))
  }
  await persistMove(0, Math.floor(currentOptions.length / 2), 'after')
  await persistMove(Math.floor(currentOptions.length / 2), 0, 'before')
  await persistMove(currentOptions.length - 1, 0, 'before')
  await persistMove(1, 2, 'after')
  await persistMove(2, 1, 'before')
  const afterOrder = currentOptions.map(option => option.id)
  await assert.rejects(() => repository.reorderDutyCodes(afterOrder.slice(1)), /no longer matches the active configuration/)
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

  const configurationAudit = await repository.getDatabase().query<{ action: string }>("select action from audit_logs where entity_type='configuration_option'")
  for (const action of ['configuration_created', 'configuration_updated', 'duty_codes_reordered', 'duty_code_deleted', 'duty_code_retired']) assert.ok(configurationAudit.rows.some(row => row.action === action), `${action} must be audited`)

  const snapshot = await repository.getDatabase().dumpDataDir('gzip')
  await writeFile(snapshotPath, new Uint8Array(await snapshot.arrayBuffer()))
  await repository.getDatabase().close()
  const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const verifier = join(process.cwd(), 'server', 'duty-code-manager-reopen-verifier.ts')
  const expectedActiveOrder = afterOrder.filter(id => id !== unused.id && id !== referenced.id)
  const { stdout } = await execFileAsync(process.execPath, [tsxCli, verifier, snapshotPath, edited.id, referenced.id, attendanceReferenced.id, JSON.stringify(expectedActiveOrder)], { cwd: process.cwd(), maxBuffer: 1024 * 1024 })
  assert.deepEqual(JSON.parse(stdout), { displayCode: 'TST2', color: '#abcdef', rosterReferencedActive: false, attendanceReferencedActive: false, activeOrder: expectedActiveOrder })
  console.log(JSON.stringify({ internalValueImmutable: true, displayCodePersisted: true, classificationsProtected: true, duplicateDisplayCodeRejected: true, firstToMiddlePersisted: true, middleToFirstPersisted: true, lastToTopPersisted: true, downOnePersisted: true, upOnePersisted: true, databaseReopenPersistence: true, invalidOrderRejected: true, rosterOrderRefreshed: true, unusedDeleted: true, rosterReferencedRetired: true, attendanceReferencedRetired: true, historyPreserved: true, configurationAudit: true }, null, 2))
} finally {
  await rm(snapshotPath, { force: true })
  await rm(dataDirectory, { recursive: true, force: true })
}
