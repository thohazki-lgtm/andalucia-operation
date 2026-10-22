import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { AuthService } from './auth-service.js'
import { AuthorizationError, AuthorizationService } from './authorization-service.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { TimesheetError, TimesheetService } from './timesheet-service.js'
import { requireOwnWorkforcePermission } from './workforce-authorization.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const fixture = await createDisposableStoreThrough('timesheet-service', '027')
try {
  const staffOne = randomUUID(); const staffTwo = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'TS-001','Timesheet Employee One','Waiter','active','2025-01-01'),($2,'TS-002','Timesheet Employee Two','Waiter','active','2025-02-01')", [staffOne, staffTwo])
  const working = randomUUID(); const off = randomUUID(); const annual = randomUUID(); const training = randomUUID()
  await fixture.db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes','TS_ON','Morning Service','#1b6288',$2,true,1),($3,'duty_codes','TS_OFF','Day Off','#a7b0ba',$4,true,2),($5,'duty_codes','TS_AL','Annual Leave','#b38b3a',$6,true,3),($7,'duty_codes','TS_TR','Service Training','#2f8063',$8,true,4)", [working, JSON.stringify({ displayCode: 'ON', dutyClassification: 'working', countsAsWorking: true }), off, JSON.stringify({ displayCode: 'OFF', dutyClassification: 'off', countsAsWorking: false }), annual, JSON.stringify({ displayCode: 'AL', dutyClassification: 'annualLeave', countsAsWorking: false }), training, JSON.stringify({ displayCode: 'TR', dutyClassification: 'other', countsAsWorking: true })])
  const publicHoliday = randomUUID(); const sick = randomUUID(); const other = randomUUID()
  await fixture.db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes','TS_PH','Public Holiday','#587f98',$2,true,5),($3,'duty_codes','TS_SL','Sick Leave','#a45b57',$4,true,6),($5,'duty_codes','TS_OTHER','Special Assignment','#856c96',$6,true,7)", [publicHoliday, JSON.stringify({ displayCode: 'PH', dutyClassification: 'publicHoliday', countsAsWorking: false }), sick, JSON.stringify({ displayCode: 'SL', dutyClassification: 'sickLeave', countsAsWorking: false }), other, JSON.stringify({ displayCode: 'SP', dutyClassification: 'other', countsAsWorking: true })])
  for (const [date, code] of [['2026-10-01','TS_ON'],['2026-10-02','TS_ON'],['2026-10-03','TS_ON'],['2026-10-04','TS_OFF'],['2026-10-05','TS_TR'],['2026-10-06','TS_AL'],['2026-10-07','TS_PH'],['2026-10-08','TS_SL'],['2026-10-09','TS_OTHER'],['2026-09-30','TS_ON']] as const) await fixture.db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), staffOne, date, code])
  const rosterBefore = (await fixture.db.query<any>('select staff_id,duty_date,duty_code_value from duty_roster_entries order by duty_date')).rows

  const auth = new AuthService(fixture.db); const authorization = new AuthorizationService(fixture.db); const actor = { userId: fixture.ownerId, displayName: 'Fixture Owner' }
  const employee = await auth.createEmployeeAccount({ staffId: staffOne, identifier: 'timesheet.employee', outletScopeId: ANDALUCIA_SCOPE_ID }, actor)
  const second = await auth.createEmployeeAccount({ staffId: staffTwo, identifier: 'timesheet.other', outletScopeId: ANDALUCIA_SCOPE_ID }, actor)
  const employeeUserId = employee.account.userId; if (!employeeUserId) throw new Error('Employee account identity missing from isolated fixture.')
  const employeeLogin = await auth.login(employee.account.loginIdentifier!, employee.temporaryPassword)
  const firstPrincipal = (await auth.principalForToken(employeeLogin.token))!
  await requireOwnWorkforcePermission(authorization, firstPrincipal, 'edit_own_timesheet', ANDALUCIA_SCOPE_ID, staffOne)
  await assert.rejects(() => requireOwnWorkforcePermission(authorization, firstPrincipal, 'edit_own_timesheet', ANDALUCIA_SCOPE_ID, staffTwo), (error: unknown) => error instanceof AuthorizationError && error.code === 'FORBIDDEN')
  await assert.rejects(() => authorization.requireOutletPermission(firstPrincipal, 'manage_timesheets', ANDALUCIA_SCOPE_ID), (error: unknown) => error instanceof AuthorizationError && error.code === 'INSUFFICIENT_PERMISSION')
  assert(second.account.userId)

  const now = new Date('2026-10-15T10:00:00.000Z'); const service = new TimesheetService(fixture.db, () => now)
  const initial = await service.month(staffOne, '2026-10')
  assert.equal(initial.staff.number, 'TS-001'); assert.equal(initial.days[0].scheduledDuty?.name, 'Morning Service'); assert.equal(initial.days[3].scheduledDuty?.code, 'OFF'); assert.equal(initial.days[4].scheduledDuty?.name, 'Service Training')
  assert.deepEqual(initial.days.slice(5, 9).map(day => [day.scheduledDuty?.code, day.scheduledDuty?.name]), [['AL','Annual Leave'],['PH','Public Holiday'],['SL','Sick Leave'],['SP','Special Assignment']])
  const draft = await service.saveDraft(staffOne, '2026-10-01', { firstShift: { timeIn: '08:00', timeOut: null }, secondShift: { timeIn: null, timeOut: null } }, employeeUserId)
  assert.equal(draft.state, 'draft'); assert.equal(draft.totalMinutes, 0)
  const single = await service.confirmDay(staffOne, '2026-10-01', { firstShift: { timeIn: '08:00', timeOut: '17:00' }, secondShift: { timeIn: null, timeOut: null } }, employeeUserId)
  assert.equal(single.totalMinutes, 540); assert.equal(single.state, 'confirmed')
  const split = await service.confirmDay(staffOne, '2026-10-02', { firstShift: { timeIn: '08:00', timeOut: '12:00' }, secondShift: { timeIn: '13:00', timeOut: '17:00' } }, employeeUserId)
  assert.equal(split.totalMinutes, 480)
  const overnight = await service.confirmDay(staffOne, '2026-10-03', { firstShift: { timeIn: '22:00', timeOut: '02:00' }, secondShift: { timeIn: null, timeOut: null } }, employeeUserId)
  assert.equal(overnight.totalMinutes, 240)
  const nonWorking = await service.confirmDay(staffOne, '2026-10-04', { firstShift: { timeIn: null, timeOut: null }, secondShift: { timeIn: null, timeOut: null } }, employeeUserId)
  assert.equal(nonWorking.totalMinutes, 0)
  await assert.rejects(service.confirmDay(staffOne, '2026-10-05', { firstShift: { timeIn: null, timeOut: null }, secondShift: { timeIn: null, timeOut: null } }, employeeUserId), (error: unknown) => error instanceof TimesheetError && error.code === 'WORKING_HOURS_REQUIRED')
  await assert.rejects(service.confirmDay(staffOne, '2026-10-05', { firstShift: { timeIn: '08:00', timeOut: '14:00' }, secondShift: { timeIn: '13:00', timeOut: '17:00' } }, employeeUserId), (error: unknown) => error instanceof TimesheetError && error.code === 'OVERLAPPING_SHIFTS')
  await assert.rejects(service.confirmDay(staffOne, '2026-10-05', { firstShift: { timeIn: '08:00', timeOut: null }, secondShift: { timeIn: null, timeOut: null } }, employeeUserId), (error: unknown) => error instanceof TimesheetError && error.code === 'INCOMPLETE_SHIFT')
  const corrected = await service.saveDraft(staffOne, '2026-10-01', { firstShift: { timeIn: '09:00', timeOut: '17:00' }, secondShift: { timeIn: null, timeOut: null } }, employeeUserId)
  assert.equal(corrected.state, 'draft'); assert.equal(corrected.totalMinutes, 480); assert.equal(corrected.revision, 3)
  const audit = (await fixture.db.query<any>("select action,before_data,after_data from employee_timesheet_day_audits where timesheet_day_id in (select id from employee_timesheet_days where work_date='2026-10-01') order by created_at,id")).rows
  assert.deepEqual(audit.map(row => row.action), ['created','confirmed','corrected']); assert.equal(audit[2].before_data.state, 'confirmed'); assert.equal(audit[2].after_data.state, 'draft')

  const reconfirmedCorrection = await service.confirmDay(staffOne, '2026-10-02', { firstShift: { timeIn: '08:30', timeOut: '12:00' }, secondShift: { timeIn: '13:00', timeOut: '17:00' } }, employeeUserId)
  assert.equal(reconfirmedCorrection.state, 'confirmed'); assert.equal(reconfirmedCorrection.totalMinutes, 450); assert.equal(reconfirmedCorrection.revision, 2)
  const confirmedCorrectionAudit = (await fixture.db.query<any>("select action,before_data,after_data,actor_user_id from employee_timesheet_day_audits where timesheet_day_id in (select id from employee_timesheet_days where work_date='2026-10-02') order by created_at,id")).rows
  assert.deepEqual(confirmedCorrectionAudit.map(row => row.action), ['confirmed','corrected'])
  assert.equal(confirmedCorrectionAudit[1].before_data.total_minutes, 480); assert.equal(confirmedCorrectionAudit[1].before_data.state, 'confirmed')
  assert.equal(confirmedCorrectionAudit[1].after_data.total_minutes, 450); assert.equal(confirmedCorrectionAudit[1].after_data.state, 'confirmed')
  assert.equal(confirmedCorrectionAudit[1].actor_user_id, employeeUserId)
  const managerSummary = (await service.managerOverview('2026-10')).employees.find(item => item.staff.id === staffOne)
  assert(managerSummary); assert.equal(managerSummary.totalMinutes, 1170); assert.equal(managerSummary.confirmedDays, 3)

  await fixture.db.query("insert into employee_timesheets(id,staff_id,outlet_scope_id,month_start,status,created_by_user_id,updated_by_user_id) select $1,$2,id,'2026-09-01','approved',$3,$3 from outlet_scopes where scope_key='andalucia'", [randomUUID(), staffOne, fixture.ownerId])
  const maldivesBoundary = new TimesheetService(fixture.db, () => new Date('2026-09-30T20:00:00.000Z'))
  assert.equal((await maldivesBoundary.month(staffOne, '2026-09')).locked, true)
  await assert.rejects(service.saveDraft(staffOne, '2026-09-30', { firstShift: { timeIn: '08:00', timeOut: '17:00' }, secondShift: { timeIn: null, timeOut: null } }, employeeUserId), (error: unknown) => error instanceof TimesheetError && error.code === 'TIMESHEET_MONTH_LOCKED')
  await service.reopenMonth(staffOne, '2026-09', 'Manager-approved correction window', '2026-10-16T10:00:00.000Z', fixture.ownerId)
  const reopened = await service.saveDraft(staffOne, '2026-09-30', { firstShift: { timeIn: '08:00', timeOut: '17:00' }, secondShift: { timeIn: null, timeOut: null } }, employeeUserId)
  assert.equal(reopened.totalMinutes, 540)
  assert.equal(Number((await fixture.db.query<{ count: number }>('select count(*)::int count from employee_timesheet_reopenings')).rows[0].count), 1)
  assert.deepEqual((await fixture.db.query<any>('select staff_id,duty_date,duty_code_value from duty_roster_entries order by duty_date')).rows, rosterBefore)

  const ui = await readFile('src/my-timesheet.tsx', 'utf8'); const css = await readFile('src/my-timesheet.css', 'utf8'); const server = await readFile('server/index.ts', 'utf8')
  assert.match(ui, /Save Draft/); assert.match(ui, /Confirm Day/); assert.match(ui, /Second shift <small>Optional/); assert.match(ui, /scheduledDuty/); assert.match(ui, /verified by the server when saved/); assert.match(ui, /preserves the previous confirmed values in the audit history/)
  assert.match(css, /@media\(max-width:700px\)/); assert.match(css, /@media\(max-width:390px\)/)
  assert.match(server, /requireOwnWorkforcePermission/); assert.match(server, /assertTrustedOrigin\(request\).*authorizedOwnTimesheet/s); assert.doesNotMatch(ui, /Attendance & Duty Tracking/)
  console.log(JSON.stringify({ ownIdentityIsolation: true, crossEmployeeRejected: true, managerPermissionBoundary: true, allConfiguredRosterStatusesDynamic: ['ON','OFF','AL','PH','SL','TR','SP'], rosterUnchanged: true, draftIncompleteSupported: true, singleShift: true, splitShift: true, overnightShift: true, overlapRejected: true, workingHoursRequired: true, serverCalculatedTotals: true, confirmedDayEmployeeCorrection: true, correctionAuditPreserved: true, managerOverviewSynchronized: true, monthEndLockMaldivesTime: true, managerReopeningAudited: true, mobile390AndDesktopFoundation: true, canonicalDatabaseUsed: false }, null, 2))
} finally { await fixture.cleanup() }
