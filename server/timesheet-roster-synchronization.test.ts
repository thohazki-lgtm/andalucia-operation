import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { timesheetConfirmationPresentation, timesheetIsReadOnlyNonWorkingDay, timesheetShiftPresentation } from '../src/timesheet-presentation.js'
import { TimesheetService } from './timesheet-service.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const fixture = await createDisposableStoreThrough('timesheet-roster-synchronization', '027')

try {
  const staffId = randomUUID()
  await fixture.db.query(
    "insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'SW2268','DODON','Waiter','active','2024-01-01')",
    [staffId],
  )

  const codes = [
    ['SYNC_WORK', 'DIN', 'Dinner Service', 'working', true, '#173D56'],
    ['SYNC_OFF', 'OFF', 'Day Off', 'off', false, '#DEC58F'],
    ['SYNC_AL', 'AL', 'Annual Leave', 'annualLeave', false, '#B68A3A'],
    ['SYNC_PH', 'PH', 'Public Holiday', 'publicHoliday', false, '#587F98'],
    ['SYNC_SL', 'SL', 'Sick Leave', 'sickLeave', false, '#A45B57'],
    ['SYNC_TR', 'TR', 'Training', 'training', true, '#2F8063'],
    ['SYNC_CUSTOM_NW', 'CL', 'Compassionate Leave', 'other', false, '#856C96'],
  ] as const
  for (let index = 0; index < codes.length; index += 1) {
    const [value, displayCode, label, dutyClassification, countsAsWorking, color] = codes[index]
    await fixture.db.query(
      "insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes',$2,$3,$4,$5,true,$6)",
      [randomUUID(), value, label, color, JSON.stringify({ displayCode, dutyClassification, countsAsWorking }), index + 1],
    )
  }

  const roster = [
    ['2026-10-01', 'SYNC_OFF'],
    ['2026-10-02', 'SYNC_AL'],
    ['2026-10-03', 'SYNC_PH'],
    ['2026-10-04', 'SYNC_SL'],
    ['2026-10-05', 'SYNC_WORK'],
    ['2026-10-06', 'SYNC_TR'],
    ['2026-10-07', 'SYNC_WORK'],
    ['2026-10-08', 'SYNC_CUSTOM_NW'],
  ] as const
  for (const [date, code] of roster) {
    await fixture.db.query(
      'insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)',
      [randomUUID(), staffId, date, code],
    )
  }

  const service = new TimesheetService(fixture.db, () => new Date('2026-10-15T10:00:00.000Z'))
  for (const date of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-08']) {
    await service.confirmDay(staffId, date, { firstShift: { timeIn: null, timeOut: null }, secondShift: { timeIn: null, timeOut: null } }, fixture.ownerId)
  }
  await service.confirmDay(staffId, '2026-10-05', {
    firstShift: { timeIn: '07:00', timeOut: '12:00' },
    secondShift: { timeIn: '17:30', timeOut: '23:00' },
  }, fixture.ownerId)
  await service.confirmDay(staffId, '2026-10-06', {
    firstShift: { timeIn: '09:00', timeOut: '17:00' },
    secondShift: { timeIn: null, timeOut: null },
  }, fixture.ownerId)
  await service.confirmDay(staffId, '2026-10-07', {
    firstShift: { timeIn: '08:00', timeOut: '17:00' },
    secondShift: { timeIn: null, timeOut: null },
  }, fixture.ownerId)

  const storedBeforeCorrection = (await fixture.db.query<any>(
    "select d.first_time_in,d.first_time_out,d.second_time_in,d.second_time_out,d.total_minutes,d.state,d.revision from employee_timesheet_days d join employee_timesheets t on t.id=d.timesheet_id where t.staff_id=$1 and d.work_date='2026-10-05'",
    [staffId],
  )).rows[0]

  // Simulate an authoritative roster correction after the employee confirmed the day.
  await fixture.db.query(
    "update duty_roster_entries set duty_code_value='SYNC_OFF' where staff_id=$1 and duty_date='2026-10-05'",
    [staffId],
  )

  const employee = await service.month(staffId, '2026-10')
  const manager = await service.managerMonth(staffId, '2026-10')
  const employeeByDate = new Map(employee.days.map(day => [day.date, day]))
  const managerByDate = new Map(manager.days.map(day => [day.date, day]))

  for (const date of roster.map(([day]) => day)) {
    const employeeDay = employeeByDate.get(date)!
    const managerDay = managerByDate.get(date)!
    assert.deepEqual(managerDay, employeeDay, `Employee and manager projections diverged for ${date}`)
  }

  for (const [date, expectedCode] of [['2026-10-01', 'OFF'], ['2026-10-02', 'AL'], ['2026-10-03', 'PH'], ['2026-10-04', 'SL'], ['2026-10-08', 'CL']] as const) {
    const day = employeeByDate.get(date)!
    assert.equal(day.scheduledDuty?.code, expectedCode)
    assert.equal(day.totalMinutes, 0)
    assert.equal(day.rosterConflict, false)
    assert.equal(timesheetIsReadOnlyNonWorkingDay(day), true)
    assert.deepEqual(timesheetShiftPresentation(day, 'firstShift'), { text: expectedCode, rostered: true })
    assert.deepEqual(timesheetShiftPresentation(day, 'secondShift'), { text: expectedCode, rostered: true })
    assert.deepEqual(timesheetConfirmationPresentation(day), { label: 'Confirmed', state: 'confirmed' })
  }

  const dodonOctober5 = employeeByDate.get('2026-10-05')!
  assert.equal(dodonOctober5.scheduledDuty?.code, 'OFF')
  assert.equal(dodonOctober5.state, 'confirmed')
  assert.equal(dodonOctober5.totalMinutes, 630)
  assert.equal(dodonOctober5.rosterConflict, true)
  assert.equal(timesheetIsReadOnlyNonWorkingDay(dodonOctober5), false)
  assert.deepEqual(timesheetShiftPresentation(dodonOctober5, 'firstShift'), { text: '07:00–12:00', rostered: false })
  assert.deepEqual(timesheetShiftPresentation(dodonOctober5, 'secondShift'), { text: '17:30–23:00', rostered: false })
  assert.deepEqual(timesheetConfirmationPresentation(dodonOctober5), { label: 'Confirmed', state: 'confirmed' })
  assert(manager.exceptions.some(item => item.date === '2026-10-05' && item.code === 'WORK_RECORDED_ON_NON_WORKING_DUTY'))

  const training = employeeByDate.get('2026-10-06')!
  assert.equal(training.scheduledDuty?.code, 'TR')
  assert.equal(training.scheduledDuty?.countsAsWorking, true)
  assert.equal(training.totalMinutes, 480)
  assert.equal(training.rosterConflict, false)

  const normal = employeeByDate.get('2026-10-07')!
  assert.equal(normal.scheduledDuty?.code, 'DIN')
  assert.equal(normal.totalMinutes, 540)
  assert.equal(normal.rosterConflict, false)

  const storedAfterCorrection = (await fixture.db.query<any>(
    "select d.first_time_in,d.first_time_out,d.second_time_in,d.second_time_out,d.total_minutes,d.state,d.revision from employee_timesheet_days d join employee_timesheets t on t.id=d.timesheet_id where t.staff_id=$1 and d.work_date='2026-10-05'",
    [staffId],
  )).rows[0]
  assert.deepEqual(storedAfterCorrection, storedBeforeCorrection)

  console.log(JSON.stringify({
    schema: '027',
    employeeManagerProjectionParity: true,
    offWithoutWork: true,
    annualLeaveWithoutWork: true,
    publicHolidayWithoutWork: true,
    sickLeaveWithoutWork: true,
    configuredNonWorkingDutyWithoutWork: true,
    trainingDuty: true,
    normalWorkingDay: true,
    confirmedThenRosterCorrected: true,
    dodonOctober5: { duty: 'OFF', firstShift: '07:00–12:00', secondShift: '17:30–23:00', total: '10h 30m', confirmation: 'Confirmed', managerReviewFlag: true },
    storedTimesheetUnchangedByRosterCorrection: true,
    canonicalDatabaseUsed: false,
  }, null, 2))
} finally {
  await fixture.cleanup()
}
