import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { TimesheetError, TimesheetService } from './timesheet-service.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'
import { activeTimesheetEditingWindow, calculatedShiftMinutes, officialTimesheetExportAvailable, timesheetReopenAvailable, timesheetShiftPresentation } from '../src/manager-timesheets.js'
import { timesheetConfirmationPresentation } from '../src/timesheet-presentation.js'

const fixture = await createDisposableStoreThrough('manager-timesheet-interface', '027')
try {
  assert.equal(officialTimesheetExportAvailable('open'), false)
  assert.equal(officialTimesheetExportAvailable('submitted'), false)
  assert.equal(officialTimesheetExportAvailable('approved'), true)
  assert.equal(officialTimesheetExportAvailable('locked'), true)
  assert.equal(timesheetReopenAvailable(false), false)
  assert.equal(timesheetReopenAvailable(true), true)
  assert.equal(activeTimesheetEditingWindow(false, '2026-10-16T10:00:00.000Z', Date.parse('2026-10-15T10:00:00.000Z')), true)
  assert.equal(activeTimesheetEditingWindow(false, '2026-10-14T10:00:00.000Z', Date.parse('2026-10-15T10:00:00.000Z')), false)
  assert.equal(activeTimesheetEditingWindow(true, '2026-10-16T10:00:00.000Z', Date.parse('2026-10-15T10:00:00.000Z')), false)
  assert.equal(activeTimesheetEditingWindow(false, null, Date.parse('2026-10-15T10:00:00.000Z')), false)
  assert.equal(calculatedShiftMinutes({ firstShift: { timeIn: '22:00', timeOut: '02:00' }, secondShift: { timeIn: null, timeOut: null } }), 240)
  assert.equal(calculatedShiftMinutes({ firstShift: { timeIn: '08:00', timeOut: '12:00' }, secondShift: { timeIn: '14:00', timeOut: '18:30' } }), 510)
  const staffIds: string[] = []
  for (let index = 1; index <= 12; index++) {
    const id = randomUUID(); staffIds.push(id)
    await fixture.db.query('insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,$2,$3,$4,$5,$6)', [id, `TS-${String(index).padStart(3, '0')}`, `Timesheet Employee ${String(index).padStart(2, '0')}`, 'Waiter', 'active', '2024-01-01'])
  }
  const working = randomUUID(); const off = randomUUID(); const annual = randomUUID(); const publicHoliday = randomUUID()
  await fixture.db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes','TS_ON','Morning Service','#1b6288',$2,true,1),($3,'duty_codes','TS_OFF','Day Off','#a7b0ba',$4,true,2),($5,'duty_codes','TS_AL','Annual Leave','#b38b3a',$6,true,3),($7,'duty_codes','TS_PH','Public Holiday','#587f98',$8,true,4)", [working, JSON.stringify({ displayCode:'ON', dutyClassification:'working', countsAsWorking:true }), off, JSON.stringify({ displayCode:'OFF', dutyClassification:'off', countsAsWorking:false }), annual, JSON.stringify({ displayCode:'AL', dutyClassification:'annualLeave', countsAsWorking:false }), publicHoliday, JSON.stringify({ displayCode:'PH', dutyClassification:'publicHoliday', countsAsWorking:false })])
  for (const [date, code] of [['2026-10-01','TS_ON'],['2026-10-02','TS_ON'],['2026-10-03','TS_OFF'],['2026-10-04','TS_AL'],['2026-10-05','TS_PH']] as const) await fixture.db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), staffIds[0], date, code])
  const service = new TimesheetService(fixture.db, () => new Date('2026-10-15T10:00:00.000Z'))
  const shift = (timeIn: string | null, timeOut: string | null) => ({ firstShift:{ timeIn,timeOut }, secondShift:{ timeIn:null,timeOut:null } })
  await service.confirmDay(staffIds[0], '2026-10-01', shift('08:00','17:00'), fixture.ownerId)
  await service.saveDraft(staffIds[0], '2026-10-02', shift('08:00',null), fixture.ownerId)

  const overview = await service.managerOverview('2026-10')
  assert.equal(overview.employees.length, 12)
  assert.deepEqual(overview.employees[0], {
    staff: { id: staffIds[0], name:'Timesheet Employee 01', number:'TS-001' }, month:'2026-10', status:'open', workingDays:2, offOrLeaveDays:3,
    totalMinutes:540, confirmedDays:1, missingEntries:1, incompleteEntries:0, exceptionCount:1, blockingExceptionCount:1
  })
  const detail = await service.managerMonth(staffIds[0], '2026-10')
  assert.equal(detail.days[0].scheduledDuty?.name, 'Morning Service')
  assert.deepEqual(detail.exceptions.map(item => item.code), ['MISSING_WORKING_HOURS'])
  assert.deepEqual(timesheetShiftPresentation(detail.days[2], 'firstShift'), { text: 'OFF', rostered: true })
  assert.deepEqual(timesheetShiftPresentation(detail.days[2], 'secondShift'), { text: 'OFF', rostered: true })
  assert.deepEqual(timesheetShiftPresentation(detail.days[3], 'firstShift'), { text: 'AL', rostered: true })
  assert.deepEqual(timesheetShiftPresentation(detail.days[3], 'secondShift'), { text: 'AL', rostered: true })
  assert.deepEqual(timesheetShiftPresentation(detail.days[4], 'firstShift'), { text: 'PH', rostered: true })
  assert.deepEqual(timesheetShiftPresentation(detail.days[4], 'secondShift'), { text: 'PH', rostered: true })
  assert.deepEqual(timesheetConfirmationPresentation(detail.days[2]), { label: 'Not started', state: 'not-started' })

  assert.throws(() => service.managerCorrectDay(staffIds[0], '2026-10-02', shift('08:00','17:00'), '', fixture.ownerId), (error: unknown) => error instanceof TimesheetError && error.code === 'CORRECTION_REASON_REQUIRED')
  await service.managerCorrectDay(staffIds[0], '2026-10-02', shift('08:00','17:00'), 'Verified against signed clock record', fixture.ownerId)
  await service.managerCorrectDay(staffIds[0], '2026-10-03', shift('09:00','12:30'), 'Manager verified exceptional work on rostered day off', fixture.ownerId)
  const offWork = await service.managerMonth(staffIds[0], '2026-10')
  assert.equal(offWork.days[2].scheduledDuty?.classification, 'off')
  assert.deepEqual(timesheetShiftPresentation(offWork.days[2], 'firstShift'), { text: '09:00–12:30', rostered: false })
  assert.deepEqual(timesheetShiftPresentation(offWork.days[2], 'secondShift'), { text: '—', rostered: false })
  assert.equal(offWork.days[2].totalMinutes, 210)
  assert.equal(offWork.days[2].rosterConflict, true)
  assert.deepEqual(timesheetConfirmationPresentation(offWork.days[2]), { label: 'Confirmed', state: 'confirmed' })
  assert.deepEqual(offWork.exceptions.map(item => item.code), ['WORK_RECORDED_ON_NON_WORKING_DUTY'])
  await service.managerCorrectDay(staffIds[0], '2026-10-03', shift(null,null), 'Removed test discrepancy before monthly workflow validation', fixture.ownerId)
  await service.confirmDay(staffIds[0], '2026-10-03', shift(null,null), fixture.ownerId)
  await service.submitMonth(staffIds[0], '2026-10', fixture.ownerId)
  await service.approveMonth(staffIds[0], '2026-10', fixture.ownerId)
  await service.lockMonth(staffIds[0], '2026-10', fixture.ownerId)
  const locked = await service.managerMonth(staffIds[0], '2026-10')
  assert.equal(locked.status, 'locked'); assert.equal(locked.exceptions.length, 0)
  assert.deepEqual(locked.workflowHistory.map(item => item.action), ['locked','approved','submitted'])
  const correction = (await fixture.db.query<any>("select before_data,after_data,reason,actor_user_id from employee_timesheet_day_audits where action='corrected' and reason='Verified against signed clock record' limit 1")).rows[0]
  assert.equal(correction.reason, 'Verified against signed clock record'); assert.equal(correction.before_data.total_minutes, 0); assert.equal(correction.after_data.total_minutes, 540); assert.equal(correction.actor_user_id, fixture.ownerId)

  const [app, api, server, css, ui, presentation] = await Promise.all(['src/App.tsx','src/api.ts','server/index.ts','src/manager-timesheets.css','src/manager-timesheets.tsx','src/timesheet-presentation.ts'].map(path => readFile(path, 'utf8')))
  assert.match(app, /canManageTimesheets=\{user\.permissionKeys\.includes\('manage_timesheets'\)\}/)
  assert.match(app, /<ManagerTimesheets \/>/); assert.match(api, /overview: \(month: string\)/)
  assert.match(server, /authorizedManagerTimesheet\(request\)/); assert.match(server, /assertTrustedOrigin\(request\).*authorizedManagerTimesheet/)
  assert.match(css, /@media\(max-width:760px\)/); assert.match(css, /@media\(max-width:390px\)/); assert.match(css, /manager-correction-context/); assert.match(css, /width:100%/)
  assert.match(ui, /Approve Month/); assert.match(ui, /Lock Month/); assert.match(ui, /Reopen Timesheet/); assert.match(ui, /Correction reason/); assert.match(ui, /Correct Timesheet Entry/); assert.match(ui, /Working hours differ from the Duty Roster status/)
  assert.match(ui, /timesheetReopenAvailable\(detail\.locked\)/); assert.match(ui, /\{canReopen && <ActionButton icon="restore"[\s\S]*?setReopening\(true\)[\s\S]*?>Reopen<\/ActionButton>\}/)
  assert.match(ui, /Employee editing window active/); assert.match(ui, /Managers may correct entries directly at any time/)
  assert.match(ui, /Reapproval required/); assert.match(ui, /Official export remains unavailable until this month is approved again/)
  assert.doesNotMatch(ui, /disabled=\{detail\.locked\}/)
  assert.match(css, /manager-editing-window/)
  assert.match(css, /manager-reapproval-required/)
  assert.match(ui, /Generate Official Timesheet/); assert.match(ui, /Available after manager approval\./); assert.match(ui, /official-timesheet-export-help/)
  assert.match(css, /official-timesheet-export-action/); assert.match(css, /@media\(max-width:390px\)[\s\S]*official-timesheet-export-action button\{width:100%\}/)
  assert.match(ui, /timesheetConfirmationPresentation/); assert.match(presentation, /label: 'Not started'/); assert.match(presentation, /label: 'Incomplete'/); assert.match(presentation, /label: 'Confirmed'/); assert.doesNotMatch(presentation, /label: day\.scheduledDuty\.code/)
  assert.match(ui, /Calculated working hours/); assert.match(ui, /24-hour time/); assert.match(ui, /pattern="\(\?:\[01\]\[0-9\]\|2\[0-3\]\):\[0-5\]\[0-9\]"/)
  assert.doesNotMatch(ui, /Exceptions requiring review/); assert.doesNotMatch(css, /manager-exceptions/); assert.doesNotMatch(ui, /className="modal-close"/)
  assert.doesNotMatch(ui, /<ActionButton[^>]*onClick=\{onClose\}[^>]*>Close<\/ActionButton>/); assert.doesNotMatch(ui, /icon="close" onClick=\{onClose\}>Close/)
  assert.doesNotMatch(ui, /<small>Exceptions<\/small><b>\{detail\.exceptions\.length\}<\/b>/); assert.match(css, /manager-detail-summary\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/)
  assert.match(ui, /event\.target === event\.currentTarget/); assert.match(ui, /event\.key === 'Escape'/); assert.match(ui, /openDialogs\[openDialogs\.length - 1\] === dialogRef\.current/)
  assert.match(ui, /timesheetShiftPresentation/); assert.match(css, /manager-shift-duty/)
  assert.match(css, /manager-timesheet-modal__body\{[^}]*overflow-y:auto/); assert.match(css, /manager-shift-grid/)
  assert.match(css, /manager-timesheet-modal>header\{[^}]*margin:0[^}]*padding:9px 16px/)
  assert.match(css, /manager-detail-summary\{[^}]*gap:6px[^}]*padding:7px 16px/)
  assert.match(css, /manager-timesheet-modal\.wide\{width:min\(940px,calc\(100vw - 28px\)\)\}/)
  assert.match(css, /manager-detail-table table\{min-width:860px;table-layout:fixed\}/)
  assert.match(css, /manager-detail-table th,.manager-detail-table td\{padding:7px 6px\}/)
  assert.match(css, /manager-detail-table th:nth-child\(1\)\{width:10%;text-align:left\}\.manager-detail-table th:nth-child\(2\)\{width:22%;text-align:left\}/); assert.match(css, /manager-detail-table th:nth-child\(6\)\{width:18%\}/); assert.match(css, /manager-detail-table th:last-child[^}]*width:52px/)
  assert.match(ui, /<th>OT<\/th>/); assert.match(ui, /manager-overtime-cell/); assert.match(ui, /reviewOvertime/)

  console.log(JSON.stringify({ twelveEmployeeOverview:true, onePrimaryExceptionPerDate:true, independentNonWorkingDutyException:true, offAndLeaveShiftLabels:true, recordedNonWorkingHoursPreserved:true, rosterConflictFlag:true, confirmationSeparatedFromRosterDuty:true, exceptionsPanelRemoved:true, exceptionsSummaryCardRemoved:true, footerCloseRemoved:true, threeEqualSummaryCards:true, compactMonthlyDetailDensity:true, compactMonthlyDetailWidth:true, topmostModalDismissal:true, unassignedDaysExcludedFromMissingTotals:true, workingMissingIncompleteConfirmedLabels:true, dutyRosterReadOnlyIntegration:true, managerCorrectionContext:true, managerCorrectionAudit:true, submittedApprovedLocked:true, workflowAuditHistory:true, managerPermissionGate:true, trustedOriginMutations:true, mobile390And760Layouts:true, canonicalDatabaseUsed:false }, null, 2))
} finally { await fixture.cleanup() }
