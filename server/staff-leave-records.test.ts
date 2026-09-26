import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OperationsRepository } from './operations-repository.js'
import { StaffRepository } from './staff-repository.js'

const dataDirectory = await mkdtemp(join(tmpdir(), 'andalucia-staff-leave-'))
try {
  const repository = new StaffRepository(dataDirectory)
  await repository.initialize()
  const operations = new OperationsRepository(repository.getDatabase())
  await operations.initialize()
  const staff = (await repository.list()).find(person => person.employmentStatus === 'active')!
  const dutyCodes = (await repository.configuration()).dutyCodes
  const annualLeave = dutyCodes.find(option => option.metadata?.dutyClassification === 'annualLeave')!
  const off = dutyCodes.find(option => option.metadata?.dutyClassification === 'off')!
  const publicHoliday = await repository.saveConfiguration('duty-codes', { id: randomUUID(), value: '', label: 'Public Holiday', color: '#587f98', active: true, metadata: { displayCode: 'PH', dutyClassification: 'publicHoliday', countsAsWorking: false } })
  const sickLeave = await repository.saveConfiguration('duty-codes', { id: randomUUID(), value: '', label: 'Sick Leave', color: '#a45b57', active: true, metadata: { displayCode: 'SK', dutyClassification: 'sickLeave', countsAsWorking: false } })
  assert.deepEqual([annualLeave.metadata?.countsAsLeave, off.metadata?.countsAsOffDay, publicHoliday.metadata?.countsAsPublicHoliday, sickLeave.metadata?.countsAsSickLeave], [true, true, true, true])

  const assignments = [
    ['2026-09-10', annualLeave.value], ['2026-09-11', annualLeave.value], ['2026-09-12', off.value],
    ['2026-09-13', annualLeave.value], ['2026-09-14', publicHoliday.value], ['2026-09-15', annualLeave.value],
    ['2026-09-20', sickLeave.value], ['2026-09-21', sickLeave.value], ['2026-09-25', off.value], ['2026-09-27', publicHoliday.value]
  ] as const
  for (const [date, dutyCode] of assignments) await operations.updateRoster(staff.id, date, dutyCode)

  const september = await repository.leaveRecords('2026-09-01', '2026-09-30', staff.id)
  const annualPeriods = september.filter(record => record.leaveType === 'annualLeave')
  assert.deepEqual(annualPeriods.map(record => ({ from: record.fromDate, to: record.toDate, leave: record.leaveDays, total: record.totalDays })), [
    { from: '2026-09-10', to: '2026-09-11', leave: 2, total: 2 },
    { from: '2026-09-13', to: '2026-09-13', leave: 1, total: 1 },
    { from: '2026-09-15', to: '2026-09-15', leave: 1, total: 1 }
  ])
  assert.equal(september.some(record => record.leaveType === 'off' && record.fromDate === '2026-09-12'), true)
  assert.equal(september.some(record => record.leaveType === 'publicHoliday' && record.fromDate === '2026-09-14'), true)
  const sickPeriod = september.find(record => record.leaveType === 'sickLeave')!
  assert.deepEqual({ leave: sickPeriod.leaveDays, total: sickPeriod.totalDays }, { leave: 2, total: 2 })
  assert.equal(september.some(record => record.leaveType === 'off' && record.fromDate === '2026-09-25'), true)
  assert.equal(september.some(record => record.leaveType === 'publicHoliday' && record.fromDate === '2026-09-27'), true)
  assert.equal((await repository.leaveRecords('2026-09-10', '2026-09-15', staff.id)).flatMap(record => record.entries).length, 6)
  assert.equal((await repository.leaveRecords('2026-01-01', '2026-12-31', staff.id)).flatMap(record => record.entries).length, 10)

  await operations.updateRoster(staff.id, '2026-09-13', 'ON')
  const recalculated = await repository.leaveRecords('2026-09-01', '2026-09-30', staff.id)
  assert.equal(recalculated.flatMap(record => record.entries).filter(day => day.classification === 'annualLeave').length, 3)
  assert.equal((await repository.find(staff.id))?.employmentStatus, 'active')
  const rosterRows = await repository.getDatabase().query<{ count: number }>('select count(*)::int count from duty_roster_entries where staff_id=$1', [staff.id])
  assert.equal(rosterRows.rows[0].count, assignments.length)

  await repository.getDatabase().close()
  const reopened = new StaffRepository(dataDirectory)
  await reopened.initialize()
  const persisted = await reopened.leaveRecords('2026-09-01', '2026-09-30', staff.id)
  assert.equal(persisted.flatMap(record => record.entries).filter(day => day.classification === 'sickLeave').length, 2)
  await reopened.getDatabase().close()
  console.log(JSON.stringify({ annualLeaveDetection: true, offDetection: true, publicHolidayDetection: true, sickLeaveDetection: true, conservativeContiguousGrouping: true, annualLeaveSeparatedByOffAndPublicHoliday: true, monthYearCustomRanges: true, rosterEditRecalculation: true, noDuplicatedLeaveRows: true, employmentStatusIndependent: true, reopenPersistence: true }, null, 2))
} finally {
  await rm(dataDirectory, { recursive: true, force: true })
}
