import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { AuthService } from './auth-service.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { TimesheetError, TimesheetService } from './timesheet-service.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const fixture = await createDisposableStoreThrough('manager-timesheet-workflow', '027')
try {
  const staffId = randomUUID(); const working = randomUUID(); const off = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'MT-001','Manager Timesheet Employee','Waiter','active','2024-01-01')", [staffId])
  await fixture.db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes','MT_ON','Morning Service','#1b6288',$2,true,1),($3,'duty_codes','MT_OFF','Day Off','#a7b0ba',$4,true,2)", [working, JSON.stringify({ displayCode:'ON', dutyClassification:'working', countsAsWorking:true }), off, JSON.stringify({ displayCode:'OFF', dutyClassification:'off', countsAsWorking:false })])
  for (const [date,code] of [['2026-10-01','MT_ON'],['2026-10-02','MT_ON'],['2026-10-03','MT_OFF']] as const) await fixture.db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), staffId, date, code])
  const rosterBefore = (await fixture.db.query<any>('select staff_id,duty_date,duty_code_value from duty_roster_entries order by duty_date')).rows
  const auth = new AuthService(fixture.db); const actor = { userId: fixture.ownerId, displayName: 'Fixture Owner' }
  const employee = await auth.createEmployeeAccount({ staffId, identifier:'manager.timesheet.employee', outletScopeId:ANDALUCIA_SCOPE_ID }, actor)
  const employeeId = employee.account.userId!
  const service = new TimesheetService(fixture.db, () => new Date('2026-10-15T10:00:00.000Z'))
  const hours = (start:string,end:string) => ({ firstShift:{ timeIn:start,timeOut:end }, secondShift:{ timeIn:null,timeOut:null } })
  const noHours = { firstShift:{ timeIn:null,timeOut:null }, secondShift:{ timeIn:null,timeOut:null } }

  await service.confirmDay(staffId,'2026-10-01',hours('08:00','17:00'),employeeId)
  assert.throws(() => service.managerCorrectDay(staffId,'2026-10-01',hours('09:00','17:00'),' ',fixture.ownerId), (error:unknown) => error instanceof TimesheetError && error.code==='CORRECTION_REASON_REQUIRED')
  await service.managerCorrectDay(staffId,'2026-10-01',hours('09:00','17:00'),'Corrected from signed clock record',fixture.ownerId)
  const correction = (await fixture.db.query<any>("select action,reason,before_data,after_data,actor_user_id,created_at from employee_timesheet_day_audits where action='corrected' and actor_user_id=$1 order by created_at desc limit 1", [fixture.ownerId])).rows[0]
  assert.equal(correction.reason,'Corrected from signed clock record'); assert.equal(correction.before_data.total_minutes,540); assert.equal(correction.after_data.total_minutes,480); assert(correction.created_at)

  const historicalService = new TimesheetService(fixture.db, () => new Date('2026-11-15T10:00:00.000Z'))
  await historicalService.managerCorrectDay(staffId,'2026-10-02',hours('08:00','17:00'),'Historical correction from signed clock record',fixture.ownerId)
  assert.equal((await historicalService.managerMonth(staffId,'2026-10')).locked,true)
  await assert.rejects(historicalService.confirmDay(staffId,'2026-10-03',noHours,employeeId), (error:unknown) => error instanceof TimesheetError && error.code==='TIMESHEET_MONTH_LOCKED')
  await assert.rejects(historicalService.reopenMonth(staffId,'2026-10',' ','2026-11-16T10:00:00.000Z',fixture.ownerId), (error:unknown) => error instanceof TimesheetError && error.code==='INVALID_REOPEN_REQUEST')
  await historicalService.reopenMonth(staffId,'2026-10','Reopen historical in-progress month','2026-11-16T10:00:00.000Z',fixture.ownerId)
  assert.equal((await historicalService.month(staffId,'2026-10')).locked,false)
  await assert.rejects(historicalService.reopenMonth(staffId,'2026-10','Already editable month','2026-11-16T10:00:00.000Z',fixture.ownerId), (error:unknown) => error instanceof TimesheetError && error.code==='TIMESHEET_ALREADY_EDITABLE')
  await historicalService.confirmDay(staffId,'2026-10-03',noHours,employeeId)
  assert.equal((await historicalService.submitMonth(staffId,'2026-10',employeeId)).status,'submitted')
  await assert.rejects(historicalService.saveDraft(staffId,'2026-10-01',hours('08:00','17:00'),employeeId), (error:unknown) => error instanceof TimesheetError && error.code==='TIMESHEET_MONTH_LOCKED')
  await historicalService.managerCorrectDay(staffId,'2026-10-01',hours('08:30','17:00'),'Manager correction while submitted',fixture.ownerId)
  assert.equal((await historicalService.managerMonth(staffId,'2026-10')).status,'submitted')
  assert.equal((await historicalService.approveMonth(staffId,'2026-10',fixture.ownerId)).status,'approved')
  const approvedSnapshotBeforeCorrection = (await fixture.db.query<any>("select snapshot_data from employee_timesheet_month_audits where action='approved' order by created_at desc,id desc limit 1")).rows[0].snapshot_data
  await historicalService.managerCorrectDay(staffId,'2026-10-01',hours('09:00','17:00'),'Manager correction to approved revision',fixture.ownerId)
  const revisedApproved = await historicalService.managerMonth(staffId,'2026-10')
  assert.equal(revisedApproved.status,'submitted'); assert.equal(revisedApproved.requiresReapproval,true)
  assert.deepEqual((await fixture.db.query<any>("select snapshot_data from employee_timesheet_month_audits where action='approved' order by created_at asc,id asc limit 1")).rows[0].snapshot_data,approvedSnapshotBeforeCorrection)
  assert.equal((await historicalService.approveMonth(staffId,'2026-10',fixture.ownerId)).status,'approved')
  assert.equal((await historicalService.lockMonth(staffId,'2026-10',fixture.ownerId)).status,'locked')
  await assert.rejects(historicalService.confirmDay(staffId,'2026-10-01',hours('08:00','17:00'),employeeId), (error:unknown) => error instanceof TimesheetError && error.code==='TIMESHEET_MONTH_LOCKED')
  const lockedSnapshotBeforeCorrection = (await fixture.db.query<any>("select snapshot_data from employee_timesheet_month_audits where action='locked' order by created_at desc,id desc limit 1")).rows[0].snapshot_data
  await historicalService.managerCorrectDay(staffId,'2026-10-01',hours('09:30','17:00'),'Manager correction to locked revision',fixture.ownerId)
  const revisedLocked = await historicalService.managerMonth(staffId,'2026-10')
  assert.equal(revisedLocked.status,'submitted'); assert.equal(revisedLocked.requiresReapproval,true)
  assert.deepEqual((await fixture.db.query<any>("select snapshot_data from employee_timesheet_month_audits where action='locked' order by created_at desc,id desc limit 1")).rows[0].snapshot_data,lockedSnapshotBeforeCorrection)
  await historicalService.approveMonth(staffId,'2026-10',fixture.ownerId)
  await historicalService.lockMonth(staffId,'2026-10',fixture.ownerId)
  await historicalService.reopenMonth(staffId,'2026-10','Approved correction after final review','2026-11-16T10:00:00.000Z',fixture.ownerId)
  assert.equal((await historicalService.month(staffId,'2026-10')).status,'open')

  const monthAudits = (await fixture.db.query<any>('select action,previous_status,new_status,reason,snapshot_data,actor_user_id from employee_timesheet_month_audits order by created_at,id')).rows
  assert.deepEqual(monthAudits.map(row => row.action), ['reopened','submitted','approved','approved','locked','approved','locked','reopened'])
  assert.equal(monthAudits[0].previous_status,'open'); assert.equal(monthAudits[0].reason,'Reopen historical in-progress month')
  assert.equal(monthAudits.at(-1).previous_status,'locked'); assert.equal(monthAudits.at(-1).new_status,'open'); assert.equal(monthAudits.at(-1).reason,'Approved correction after final review')
  assert.equal(monthAudits.at(-1).snapshot_data.sheet.status,'locked'); assert.equal(monthAudits.at(-1).snapshot_data.days.length,3)
  assert.equal(Number((await fixture.db.query<{ count:number }>("select count(*)::int count from employee_timesheet_month_audits where action='reopened'")).rows[0].count),2)
  assert.deepEqual((await fixture.db.query<any>('select staff_id,duty_date,duty_code_value from duty_roster_entries order by duty_date')).rows,rosterBefore)
  console.log(JSON.stringify({ mandatoryManagerCorrectionReason:true, mandatoryReopenReason:true, correctionBeforeAfter:true, managerIdentityTimestamp:true, submittedApprovedLocked:true, managerDirectHistoricalCorrection:true, managerDirectSubmittedCorrection:true, managerDirectApprovedCorrection:true, managerDirectLockedCorrection:true, approvedRevisionSnapshotPreserved:true, lockedRevisionSnapshotPreserved:true, reapprovalRequiredAfterFinalizedCorrection:true, historicalOpenReopenAllowed:true, alreadyEditableReopenRejected:true, employeeFrozenAfterSubmission:true, authorizedReopening:true, employeeCorrectionAfterReopen:true, dutyRosterUnchanged:true, canonicalDatabaseUsed:false }, null, 2))
} finally { await fixture.cleanup() }
