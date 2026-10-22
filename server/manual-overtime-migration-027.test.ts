import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createFinancialFinalizationFingerprint, createOperationalFingerprint } from './database-backup.js'
import { runMigrations } from './migration-store.js'
import { TimesheetError, TimesheetService } from './timesheet-service.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const fixture = await createDisposableStoreThrough('manual-overtime-027', '025')
try {
  const staffId = randomUUID(); const dutyId = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'OT-001','Manual OT Employee','Waiter','active','2025-01-01')", [staffId])
  await fixture.db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes','OT_ON','Morning Service','#1b6288',$2,true,1)", [dutyId, JSON.stringify({ displayCode:'ON', dutyClassification:'working', countsAsWorking:true })])
  for (const date of ['2026-10-01','2026-10-02','2026-10-03']) await fixture.db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,\'OT_ON\')', [randomUUID(), staffId, date])
  const legacySheetId = randomUUID(); const legacyDayId = randomUUID()
  await fixture.db.query("insert into employee_timesheets(id,staff_id,outlet_scope_id,month_start,status,created_by_user_id,updated_by_user_id) select $1,$2,id,'2026-09-01','open',$3,$3 from outlet_scopes where scope_key='andalucia'", [legacySheetId, staffId, fixture.ownerId])
  await fixture.db.query("insert into employee_timesheet_days(id,timesheet_id,work_date,state,first_time_in,first_time_out,total_minutes,revision,confirmed_at,updated_by_user_id) values($1,$2,'2026-09-01','confirmed','08:00','17:00',540,1,now(),$3)", [legacyDayId, legacySheetId, fixture.ownerId])
  const before = (await fixture.db.query<any>('select * from employee_timesheet_days where id=$1', [legacyDayId])).rows[0]
  const beforeOperational = await createOperationalFingerprint(fixture.db)
  const beforeFinancial = await createFinancialFinalizationFingerprint(fixture.db)
  const beforeCredentials = (await fixture.db.query('select id::text,login_identifier,normalized_login_identifier,password_hash,status from user_accounts order by id')).rows
  const identityPath = join(fixture.root, 'development', 'andalucia-store-identity.json')
  const beforeIdentityDigest = createHash('sha256').update(await readFile(identityPath)).digest('hex')

  const sequential = await runMigrations(fixture.db, { throughVersion:'027' })
  assert.deepEqual(sequential.applied, ['026', '027'])
  assert.deepEqual((await runMigrations(fixture.db, { throughVersion:'027' })).applied, [])
  const preserved = (await fixture.db.query<any>('select * from employee_timesheet_days where id=$1', [legacyDayId])).rows[0]
  assert.equal(preserved.total_minutes, before.total_minutes); assert.equal(preserved.revision, before.revision)
  const afterOperational = await createOperationalFingerprint(fixture.db)
  const { generatedAt: _bog, migration: _bom, ...beforeOperationalProtected } = beforeOperational
  const { generatedAt: _aog, migration: _aom, ...afterOperationalProtected } = afterOperational
  assert.deepEqual(afterOperationalProtected, beforeOperationalProtected)
  assert.equal((await createFinancialFinalizationFingerprint(fixture.db)).digest, beforeFinancial.digest)
  assert.deepEqual((await fixture.db.query('select id::text,login_identifier,normalized_login_identifier,password_hash,status from user_accounts order by id')).rows, beforeCredentials)
  assert.equal(createHash('sha256').update(await readFile(identityPath)).digest('hex'), beforeIdentityDigest)
  const latestLedger = (await fixture.db.query<{ version:string }>("select version from schema_migrations where version in ('025','026','027') order by version")).rows.map(row => row.version)
  assert.deepEqual(latestLedger, ['025', '026', '027'])

  const service = new TimesheetService(fixture.db, () => new Date('2026-10-15T10:00:00.000Z'))
  const shifts = { firstShift:{ timeIn:'08:00',timeOut:'17:00' }, secondShift:{ timeIn:null,timeOut:null } }
  const write = (duration:string, expectedRevision=0) => ({ ...shifts, overtime:{ duration,expectedRevision } })

  const zero = await service.saveDraft(staffId,'2026-10-01',write('00:00'),fixture.ownerId)
  assert.equal(zero.overtime.status,null); assert.equal(zero.overtime.duration,'00:00'); assert.equal(zero.totalMinutes,540)
  assert.equal(Number((await fixture.db.query<{ count:number }>('select count(*)::int count from employee_timesheet_overtime')).rows[0].count),0)
  await assert.rejects(service.saveDraft(staffId,'2026-10-01',write('2:00'),fixture.ownerId), (error:unknown) => error instanceof TimesheetError && error.code==='INVALID_OVERTIME_DURATION')
  await assert.rejects(service.saveDraft(staffId,'2026-10-01',write('02:60'),fixture.ownerId), (error:unknown) => error instanceof TimesheetError && error.code==='INVALID_OVERTIME_DURATION')
  await assert.rejects(service.saveDraft(staffId,'2026-10-01',write('02:01'),fixture.ownerId), (error:unknown) => error instanceof TimesheetError && error.code==='OVERTIME_LIMIT_EXCEEDED' && error.message.includes('02:00'))

  const pending = await service.confirmDay(staffId,'2026-10-01',write('02:00'),fixture.ownerId)
  assert.equal(pending.totalMinutes,540); assert.equal(pending.overtime.durationMinutes,120); assert.equal(pending.overtime.status,'pending'); assert.equal(pending.overtime.revision,1)
  const corrected = await service.confirmDay(staffId,'2026-10-01',write('01:30',pending.overtime.revision),fixture.ownerId)
  assert.equal(corrected.overtime.status,'pending'); assert.equal(corrected.overtime.duration,'01:30'); assert.equal(corrected.overtime.revision,2)
  const managerPending = await service.managerMonth(staffId,'2026-10')
  assert.equal(managerPending.days.find(day => day.date === '2026-10-01')?.overtime.duration, '01:30'); assert.equal(managerPending.overtimeTotals.pendingMinutes, 90); assert.equal(managerPending.overtimeTotals.approvedMinutes, 0)
  await assert.rejects(service.reviewOvertime(staffId,'2026-10-01','approved','',1,fixture.ownerId), (error:unknown) => error instanceof TimesheetError && error.code==='OVERTIME_REVISION_CONFLICT')

  const secondPending = await service.confirmDay(staffId,'2026-10-02',write('00:45'),fixture.ownerId)
  await assert.rejects(service.reviewOvertime(staffId,'2026-10-02','rejected','',secondPending.overtime.revision,fixture.ownerId), (error:unknown) => error instanceof TimesheetError && error.code==='OVERTIME_REJECTION_REASON_REQUIRED')
  const rejected = await service.reviewOvertime(staffId,'2026-10-02','rejected','Operational evidence did not support OT',secondPending.overtime.revision,fixture.ownerId)
  assert.equal(rejected.overtime.status,'rejected'); assert.equal(rejected.overtime.rejectionReason,'Operational evidence did not support OT')
  const resubmitted = await service.confirmDay(staffId,'2026-10-02',write('00:30',rejected.overtime.revision),fixture.ownerId)
  assert.equal(resubmitted.overtime.status,'pending'); assert.equal(resubmitted.overtime.rejectionReason,null)
  await service.confirmDay(staffId,'2026-10-03',write('00:00'),fixture.ownerId)

  await service.submitMonth(staffId,'2026-10',fixture.ownerId)
  await assert.rejects(service.approveMonth(staffId,'2026-10',fixture.ownerId), (error:unknown) => error instanceof TimesheetError && error.code==='PENDING_OVERTIME_REVIEW')
  const approvedFirst = await service.reviewOvertime(staffId,'2026-10-01','approved','',corrected.overtime.revision,fixture.ownerId)
  const approvedSecond = await service.reviewOvertime(staffId,'2026-10-02','approved','',resubmitted.overtime.revision,fixture.ownerId)
  assert.equal(approvedFirst.overtime.status,'approved'); assert.equal(approvedSecond.overtime.status,'approved')
  const managerApproved = await service.managerMonth(staffId,'2026-10')
  assert.equal(managerApproved.days.find(day => day.date === '2026-10-01')?.overtime.duration, '01:30'); assert.equal(managerApproved.overtimeTotals.approvedMinutes, 120); assert.equal(managerApproved.overtimeTotals.pendingMinutes, 0)
  await service.approveMonth(staffId,'2026-10',fixture.ownerId)

  await assert.rejects(service.saveDraft(staffId,'2026-10-01',write('01:45',approvedFirst.overtime.revision),fixture.ownerId), (error:unknown) => error instanceof TimesheetError && ['TIMESHEET_MONTH_LOCKED','APPROVED_OVERTIME_MANAGER_REQUIRED'].includes(error.code))
  const managerCorrected = await service.managerCorrectDay(staffId,'2026-10-01',write('01:45',approvedFirst.overtime.revision),'Corrected from signed OT authorization',fixture.ownerId)
  assert.equal(managerCorrected.overtime.status,'pending'); assert.equal(managerCorrected.overtime.duration,'01:45')
  assert.equal((await service.managerMonth(staffId,'2026-10')).status,'submitted')
  await fixture.db.query("update employee_timesheets set status='approved' where staff_id=$1 and month_start='2026-10-01'", [staffId])
  await assert.rejects(service.lockMonth(staffId,'2026-10',fixture.ownerId), (error:unknown) => error instanceof TimesheetError && error.code==='PENDING_OVERTIME_REVIEW')
  await fixture.db.query("update employee_timesheets set status='submitted' where staff_id=$1 and month_start='2026-10-01'", [staffId])
  await assert.rejects(service.approveMonth(staffId,'2026-10',fixture.ownerId), (error:unknown) => error instanceof TimesheetError && error.code==='PENDING_OVERTIME_REVIEW')
  const reapproved = await service.reviewOvertime(staffId,'2026-10-01','approved','',managerCorrected.overtime.revision,fixture.ownerId)
  await service.approveMonth(staffId,'2026-10',fixture.ownerId)
  await service.lockMonth(staffId,'2026-10',fixture.ownerId)
  assert.equal(reapproved.overtime.status,'approved')

  const approvedMinutes = Number((await fixture.db.query<{ total:number }>("select coalesce(sum(duration_minutes),0)::int total from employee_timesheet_overtime where status='approved'")).rows[0].total)
  const unapprovedMinutes = Number((await fixture.db.query<{ total:number }>("select coalesce(sum(duration_minutes),0)::int total from employee_timesheet_overtime where status<>'approved'")).rows[0].total)
  assert.equal(approvedMinutes,135); assert.equal(unapprovedMinutes,0)
  const audits = (await fixture.db.query<any>('select action,actor_user_id,reason,before_data,after_data from employee_timesheet_overtime_audits order by created_at,id')).rows
  assert(audits.some(row => row.action==='rejected' && row.reason)); assert(audits.some(row => row.action==='manager_corrected' && row.reason==='Corrected from signed OT authorization'))
  assert(audits.every(row => row.actor_user_id)); assert(audits.some(row => row.before_data?.status==='approved' && row.after_data?.status==='pending'))

  const [server,employeeUi,managerUi,css] = await Promise.all(['server/index.ts','src/my-timesheet.tsx','src/manager-timesheets.tsx','src/manager-timesheets.css'].map(path => readFile(path,'utf8')))
  assert.match(server,/authorizedManagerTimesheet\(request\)/); assert(server.includes('const overtimeReviewMatch')); assert(server.includes('timesheets.reviewOvertime')); assert.match(employeeUi,/Manual OT/); assert.match(employeeUi,/maximum 02:00/)
  assert.match(managerUi,/<th>OT<\/th>/); assert.match(managerUi,/Approve .* overtime/); assert.match(managerUi,/Reason required/)
  assert.match(css,/manager-overtime-cell/); assert.match(css,/@media\(max-width:700px\)[\s\S]*manager-overtime-actions/)
  console.log(JSON.stringify({ schema025To026To027:true, migrationOrder:latestLedger, migrationIdempotent:true, operationalFingerprintPreserved:true, financialFingerprintPreserved:true, credentialsPreserved:true, storeIdentityDigestPreserved:true, existingTimesheetsPreserved:true, zeroMeansNoRequest:true, wholeMinuteDuration:true, twoHourLimit:true, schema027PolicyFoundation:true, workingHoursIndependent:true, pendingSubmission:true, managerPendingDisplay:'01:30', managerPendingTotal:90, employeePendingCorrection:true, rejectedCorrection:true, rejectionReasonRequired:true, managerApproval:true, managerApprovedDisplay:'01:30', approvedEmployeeEditBlocked:true, approvedManagerCorrectionReturnsPending:true, optimisticConcurrency:true, pendingBlocksApproval:true, pendingBlocksLockByWorkflow:true, auditIdentityAndBeforeAfter:true, approvedOfficialOtMinutes:approvedMinutes, unapprovedOfficialOtMinutes:unapprovedMinutes, responsiveOtControls:true, canonicalDatabaseUsed:false },null,2))
} finally { await fixture.cleanup() }
