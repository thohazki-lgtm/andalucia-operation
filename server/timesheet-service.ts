import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { DutyClassification, ManagerTimesheetMonthView, ManagerTimesheetOverview, ManagerTimesheetSummary, TimesheetDayInput, TimesheetDayView, TimesheetException, TimesheetMonthStatus, TimesheetMonthView, TimesheetScheduledDuty, TimesheetWorkflowAudit } from '../src/domain.js'
import { serviceDate } from '../src/service-date.js'

export class TimesheetError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message) }
}

type Clock = () => Date
type DayRow = {
  id: string; state: 'draft' | 'confirmed'; first_time_in: string | null; first_time_out: string | null
  second_time_in: string | null; second_time_out: string | null; total_minutes: number; revision: number; confirmed_at: string | null
  overtime_id?: string | null; overtime_minutes?: number | null; overtime_status?: 'pending' | 'approved' | 'rejected' | null
  overtime_revision?: number | null; overtime_submitted_at?: string | null; overtime_reviewed_at?: string | null; overtime_rejection_reason?: string | null
}
type QueryExecutor = Pick<PGlite, 'query'>

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/
const datePattern = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/
const asDate = (value: string) => { const date = new Date(`${value}T00:00:00Z`); return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date }
const normalizeTime = (value: string | null | undefined) => value?.trim() || null
const minute = (value: string) => { const match = value.match(timePattern)!; return Number(match[1]) * 60 + Number(match[2]) }
const json = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : (value || {})
const timeValue = (value: unknown) => value ? String(value).slice(0, 5) : null
const dateValue = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : (String(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '')
const overtimePattern = /^(\d{2}):([0-5]\d)$/
const overtimeDuration = (value: string | undefined) => {
  const normalized = value?.trim() || '00:00'; const match = normalized.match(overtimePattern)
  if (!match) throw new TimesheetError('INVALID_OVERTIME_DURATION', 'Overtime must use the duration format HH:mm.')
  const minutes = Number(match[1]) * 60 + Number(match[2])
  if (minutes > 120) throw new TimesheetError('OVERTIME_LIMIT_EXCEEDED', 'Manual overtime cannot exceed 02:00 per employee per day.')
  return minutes
}
const overtimeText = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

function normalizedInput(input: TimesheetDayInput) {
  const clean = {
    firstShift: { timeIn: normalizeTime(input?.firstShift?.timeIn), timeOut: normalizeTime(input?.firstShift?.timeOut) },
    secondShift: { timeIn: normalizeTime(input?.secondShift?.timeIn), timeOut: normalizeTime(input?.secondShift?.timeOut) }
  }
  for (const value of [clean.firstShift.timeIn, clean.firstShift.timeOut, clean.secondShift.timeIn, clean.secondShift.timeOut]) if (value && !timePattern.test(value)) throw new TimesheetError('INVALID_TIME', 'Times must use the 24-hour HH:mm format.')
  return clean
}

function duration(input: ReturnType<typeof normalizedInput>, completeRequired: boolean) {
  const firstPartial = Boolean(input.firstShift.timeIn) !== Boolean(input.firstShift.timeOut)
  const secondPartial = Boolean(input.secondShift.timeIn) !== Boolean(input.secondShift.timeOut)
  if (completeRequired && (firstPartial || secondPartial)) throw new TimesheetError('INCOMPLETE_SHIFT', 'Complete both Time In and Time Out before confirming the day.')
  const segments: Array<{ start: number; end: number }> = []
  for (const shift of [input.firstShift, input.secondShift]) {
    if (!shift.timeIn || !shift.timeOut) continue
    const start = minute(shift.timeIn); let end = minute(shift.timeOut)
    if (end <= start) end += 1440
    segments.push({ start, end })
  }
  if (segments.length === 2) {
    while (segments[1].start < segments[0].start) { segments[1].start += 1440; segments[1].end += 1440 }
    if (segments[1].start < segments[0].end) throw new TimesheetError('OVERLAPPING_SHIFTS', 'The second shift overlaps the first shift.')
  }
  const total = segments.reduce((sum, item) => sum + item.end - item.start, 0)
  if (total > 1440) throw new TimesheetError('HOURS_EXCEED_DAY', 'Total working time cannot exceed 24 hours.')
  return { total, complete: !firstPartial && !secondPartial, hasFirst: Boolean(input.firstShift.timeIn && input.firstShift.timeOut) }
}

export class TimesheetService {
  constructor(private readonly db: PGlite, private readonly now: Clock = () => new Date()) {}

  private currentMonth() { return serviceDate(this.now()).slice(0, 7) }
  private async staff(staffId: string) {
    const row = (await this.db.query<any>('select id,staff_number,full_name from staff where id=$1', [staffId])).rows[0]
    if (!row) throw new TimesheetError('STAFF_NOT_FOUND', 'The linked Staff profile was not found.', 404)
    return row
  }
  private async sheet(staffId: string, month: string, executor: QueryExecutor = this.db) {
    return (await executor.query<any>('select * from employee_timesheets where staff_id=$1 and month_start=$2::date', [staffId, `${month}-01`])).rows[0] || null
  }
  private unlocked(sheet: any, month: string) {
    if (month >= this.currentMonth()) return true
    return Boolean(sheet?.reopened_until && new Date(sheet.reopened_until).getTime() > this.now().getTime())
  }
  private editable(sheet: any, month: string) { return (!sheet || sheet.status === 'open') && this.unlocked(sheet, month) }
  private async ensureSheet(staffId: string, month: string, actorUserId: string, executor: QueryExecutor) {
    await executor.query(`insert into employee_timesheets(id,staff_id,outlet_scope_id,month_start,created_by_user_id,updated_by_user_id)
      select $1,$2,id,$3::date,$4,$4 from outlet_scopes where scope_key='andalucia' and active=true
      on conflict(staff_id,month_start) do nothing`, [randomUUID(), staffId, `${month}-01`, actorUserId])
    const sheet = await this.sheet(staffId, month, executor)
    if (!sheet) throw new TimesheetError('OUTLET_NOT_CONFIGURED', 'The Andalucía outlet scope is not available.', 409)
    return sheet
  }
  private async scheduledDuty(staffId: string, date: string, executor: QueryExecutor = this.db): Promise<TimesheetScheduledDuty | null> {
    const row = (await executor.query<any>(`select r.duty_code_value,c.label,c.color,c.metadata
      from duty_roster_entries r left join configuration_options c on c.group_key='duty_codes' and c.value=r.duty_code_value
      where r.staff_id=$1 and r.duty_date=$2::date`, [staffId, date])).rows[0]
    if (!row) return null
    const metadata = json(row.metadata) as Record<string, unknown>
    return {
      code: String(metadata.displayCode || row.duty_code_value), name: String(row.label || row.duty_code_value), color: row.color || null,
      countsAsWorking: metadata.countsAsWorking === true, classification: (metadata.dutyClassification as DutyClassification) || null
    }
  }
  private viewDay(date: string, duty: TimesheetScheduledDuty | null, row: DayRow | undefined, editable: boolean): TimesheetDayView {
    const overtimeMinutes = Number(row?.overtime_minutes || 0); const overtimeStatus = row?.overtime_status || null
    const rosterConflict = Boolean(duty && !duty.countsAsWorking && (Number(row?.total_minutes || 0) > 0 || row?.first_time_in || row?.first_time_out || row?.second_time_in || row?.second_time_out))
    return {
      date, weekday: new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)), scheduledDuty: duty,
      state: row?.state || null,
      firstShift: { timeIn: timeValue(row?.first_time_in), timeOut: timeValue(row?.first_time_out) },
      secondShift: { timeIn: timeValue(row?.second_time_in), timeOut: timeValue(row?.second_time_out) },
      totalMinutes: Number(row?.total_minutes || 0), revision: Number(row?.revision || 0), confirmedAt: row?.confirmed_at || null, editable, rosterConflict,
      overtime: {
        duration: overtimeText(overtimeMinutes), durationMinutes: overtimeMinutes, status: overtimeStatus,
        revision: Number(row?.overtime_revision || 0), submittedAt: row?.overtime_submitted_at || null,
        reviewedAt: row?.overtime_reviewed_at || null, rejectionReason: row?.overtime_rejection_reason || null,
        editable: editable && overtimeStatus !== 'approved'
      }
    }
  }

  async month(staffId: string, month: string): Promise<TimesheetMonthView> {
    if (!monthPattern.test(month)) throw new TimesheetError('INVALID_MONTH', 'Month must use YYYY-MM.')
    const staff = await this.staff(staffId); const sheet = await this.sheet(staffId, month); const editable = this.editable(sheet, month)
    const stored = sheet ? (await this.db.query<any>(`select d.*,o.id overtime_id,o.duration_minutes overtime_minutes,o.status overtime_status,
      o.revision overtime_revision,o.submitted_at overtime_submitted_at,o.reviewed_at overtime_reviewed_at,o.rejection_reason overtime_rejection_reason
      from employee_timesheet_days d left join employee_timesheet_overtime o on o.timesheet_day_id=d.id where d.timesheet_id=$1`, [sheet.id])).rows : []
    const byDate = new Map<string, DayRow>(stored.map((row: any) => [dateValue(row.work_date), row]))
    const start = new Date(`${month}-01T00:00:00Z`); const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)); const days: TimesheetDayView[] = []
    for (let day = 1; day <= end.getUTCDate(); day++) {
      const date = `${month}-${String(day).padStart(2, '0')}`
      days.push(this.viewDay(date, await this.scheduledDuty(staffId, date), byDate.get(date), editable))
    }
    return { staff: { id: staff.id, name: staff.full_name, number: staff.staff_number }, month, status: (sheet?.status || 'open') as TimesheetMonthStatus, locked: !editable, reopenedUntil: sheet?.reopened_until || null, days }
  }

  private exceptions(days: TimesheetDayView[]): TimesheetException[] {
    const issues: TimesheetException[] = []
    const labels: Record<TimesheetException['code'], string> = {
      MISSING_WORKING_HOURS: 'Missing working-time entry', INCOMPLETE_SHIFT: 'Incomplete shift', UNCONFIRMED_WORKING_DAY: 'Working day not confirmed',
      INVALID_OR_OVERLAPPING_HOURS: 'Invalid or overlapping working hours', WORK_RECORDED_ON_NON_WORKING_DUTY: 'Work recorded on OFF or leave day', UNUSUALLY_LONG_HOURS: 'Unusually long working day'
    }
    for (const day of days) {
      const partial = Boolean(day.firstShift.timeIn) !== Boolean(day.firstShift.timeOut) || Boolean(day.secondShift.timeIn) !== Boolean(day.secondShift.timeOut)
      const add = (code: TimesheetException['code'], blocking = true) => issues.push({ date: day.date, code, label: labels[code], blocking })
      let invalidHours = false
      if (!partial) {
        try { duration(normalizedInput({ firstShift: day.firstShift, secondShift: day.secondShift }), true) }
        catch { invalidHours = true }
      }
      // Show one primary completeness issue per date. Approval validation stays
      // independent and continues to evaluate every underlying safety rule.
      if (day.scheduledDuty?.countsAsWorking && (!day.firstShift.timeIn || !day.firstShift.timeOut)) add('MISSING_WORKING_HOURS')
      else if (partial) add('INCOMPLETE_SHIFT')
      else if (day.scheduledDuty?.countsAsWorking && day.state !== 'confirmed') add('UNCONFIRMED_WORKING_DAY')
      if (invalidHours) add('INVALID_OR_OVERLAPPING_HOURS')
      if (day.scheduledDuty && !day.scheduledDuty.countsAsWorking && day.totalMinutes > 0) add('WORK_RECORDED_ON_NON_WORKING_DUTY')
      if (day.totalMinutes > 12 * 60) add('UNUSUALLY_LONG_HOURS', false)
    }
    return issues
  }

  async managerMonth(staffId: string, month: string): Promise<ManagerTimesheetMonthView> {
    const view = await this.month(staffId, month); const sheet = await this.sheet(staffId, month)
    const workflowHistory: TimesheetWorkflowAudit[] = sheet ? (await this.db.query<any>(`select a.id,a.action,a.previous_status,a.new_status,a.reason,a.created_at,coalesce(u.display_name,'Unknown manager') actor_name
      from employee_timesheet_month_audits a left join user_accounts u on u.id=a.actor_user_id where a.timesheet_id=$1 order by a.created_at desc,a.id desc`, [sheet.id])).rows.map((row: any) => ({
        id: row.id, action: row.action, previousStatus: row.previous_status, newStatus: row.new_status, reason: row.reason, actorName: row.actor_name, createdAt: row.created_at
      })) : []
    const requiresReapproval = Boolean(sheet && sheet.status === 'submitted' && (await this.db.query<{ exists: boolean }>(`select exists(
      select 1 from (
        select created_at from employee_timesheet_day_audits where timesheet_id=$1 and action='corrected'
        union all select created_at from employee_timesheet_overtime_audits where timesheet_id=$1 and action='manager_corrected'
      ) correction
      where correction.created_at > coalesce((select max(approval.created_at) from employee_timesheet_month_audits approval where approval.timesheet_id=$1 and approval.action='approved'), 'epoch'::timestamptz)
        and exists(select 1 from employee_timesheet_month_audits approval where approval.timesheet_id=$1 and approval.action='approved')
    ) exists`, [sheet.id])).rows[0]?.exists)
    const overtimeTotals = {
      approvedMinutes: view.days.filter(day => day.overtime.status === 'approved').reduce((sum, day) => sum + day.overtime.durationMinutes, 0),
      pendingMinutes: view.days.filter(day => day.overtime.status === 'pending').reduce((sum, day) => sum + day.overtime.durationMinutes, 0),
      rejectedMinutes: view.days.filter(day => day.overtime.status === 'rejected').reduce((sum, day) => sum + day.overtime.durationMinutes, 0)
    }
    return { ...view, exceptions: this.exceptions(view.days), workflowHistory, requiresReapproval, overtimeTotals }
  }

  async managerOverview(month: string): Promise<ManagerTimesheetOverview> {
    if (!monthPattern.test(month)) throw new TimesheetError('INVALID_MONTH', 'Month must use YYYY-MM.')
    const staff = (await this.db.query<any>('select id from staff order by full_name,staff_number')).rows
    const employees: ManagerTimesheetSummary[] = []
    for (const person of staff) {
      const view = await this.month(person.id, month); const exceptions = this.exceptions(view.days)
      employees.push({
        staff: view.staff, month, status: view.status,
        workingDays: view.days.filter(day => day.scheduledDuty?.countsAsWorking).length,
        offOrLeaveDays: view.days.filter(day => day.scheduledDuty && !day.scheduledDuty.countsAsWorking).length,
        totalMinutes: view.days.reduce((sum, day) => sum + day.totalMinutes, 0), confirmedDays: view.days.filter(day => day.state === 'confirmed').length,
        missingEntries: exceptions.filter(issue => issue.code === 'MISSING_WORKING_HOURS').length,
        incompleteEntries: exceptions.filter(issue => issue.code === 'INCOMPLETE_SHIFT').length,
        exceptionCount: exceptions.length, blockingExceptionCount: exceptions.filter(issue => issue.blocking).length
      })
    }
    return { month, employees }
  }

  private async writeOvertime(executor: QueryExecutor, sheetId: string, dayId: string, input: TimesheetDayInput['overtime'], actorUserId: string, managerReason?: string, managerCorrection = false) {
    if (!input) return
    const minutes = overtimeDuration(input.duration)
    const before = (await executor.query<any>('select * from employee_timesheet_overtime where timesheet_day_id=$1 for update', [dayId])).rows[0] || null
    const expectedRevision = Number(input.expectedRevision || 0)
    if (Number(before?.revision || 0) !== expectedRevision) throw new TimesheetError('OVERTIME_REVISION_CONFLICT', 'This overtime request changed since it was opened. Refresh and try again.', 409)
    if (before?.status === 'approved' && !managerCorrection && minutes !== Number(before.duration_minutes)) throw new TimesheetError('APPROVED_OVERTIME_MANAGER_REQUIRED', 'Approved overtime can only be corrected by an authorized manager.', 403)
    const unchanged = Boolean(before && minutes === Number(before.duration_minutes) && before.status !== 'rejected')
    if (unchanged || (!before && minutes === 0)) return
    if (managerCorrection && before?.status === 'approved' && !managerReason?.trim()) throw new TimesheetError('CORRECTION_REASON_REQUIRED', 'A manager correction reason is required.')
    const id = before?.id || randomUUID(); const revision = Number(before?.revision || 0) + 1
    const status = minutes > 0 ? 'pending' : null
    await executor.query(`insert into employee_timesheet_overtime(id,timesheet_id,timesheet_day_id,duration_minutes,status,revision,submitted_by_user_id,submitted_at,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,$4,$5,$6,$7,now(),$7,$7)
      on conflict(timesheet_day_id) do update set duration_minutes=excluded.duration_minutes,status=excluded.status,revision=excluded.revision,
        submitted_by_user_id=excluded.submitted_by_user_id,submitted_at=now(),reviewed_by_user_id=null,reviewed_at=null,rejection_reason=null,
        updated_by_user_id=excluded.updated_by_user_id,updated_at=now()`, [id, sheetId, dayId, minutes, status, revision, actorUserId])
    const after = (await executor.query<any>('select * from employee_timesheet_overtime where id=$1', [id])).rows[0]
    const action = minutes === 0 ? 'cleared' : !before ? 'submitted' : managerCorrection ? 'manager_corrected' : 'employee_corrected'
    await executor.query(`insert into employee_timesheet_overtime_audits(id,overtime_id,timesheet_id,timesheet_day_id,actor_user_id,action,before_data,after_data,reason)
      values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`, [randomUUID(), id, sheetId, dayId, actorUserId, action, before ? JSON.stringify(before) : null, JSON.stringify(after), managerCorrection ? managerReason?.trim() || null : null])
  }

  private async writeDay(staffId: string, date: string, input: TimesheetDayInput, actorUserId: string, confirm: boolean, options: { managerReason?: string; forceCorrection?: boolean } = {}) {
    if (!datePattern.test(date) || !asDate(date)) throw new TimesheetError('INVALID_DATE', 'Date must be a valid YYYY-MM-DD date.')
    await this.staff(staffId)
    const clean = normalizedInput(input); const calculated = duration(clean, confirm); const month = date.slice(0, 7)
    if (confirm) {
      const duty = await this.scheduledDuty(staffId, date)
      if (!duty) throw new TimesheetError('ROSTER_ASSIGNMENT_REQUIRED', 'A Duty Roster assignment is required before confirming this day.', 409)
      if (duty.countsAsWorking && !calculated.hasFirst) throw new TimesheetError('WORKING_HOURS_REQUIRED', 'A working roster day requires a complete first shift.', 409)
    }
    return this.db.transaction(async transaction => {
      const existingSheet = await this.sheet(staffId, month, transaction)
      if (!options.forceCorrection && !this.editable(existingSheet, month)) throw new TimesheetError('TIMESHEET_MONTH_LOCKED', 'This month is locked. A manager must reopen it before changes can be made.', 409)
      const sheet = existingSheet || await this.ensureSheet(staffId, month, actorUserId, transaction)
      const lockedSheet = (await transaction.query<any>('select * from employee_timesheets where id=$1 for update', [sheet.id])).rows[0]
      if (!options.forceCorrection && !this.editable(lockedSheet, month)) throw new TimesheetError('TIMESHEET_MONTH_LOCKED', 'This month is locked. A manager must reopen it before changes can be made.', 409)
      const requiresReapproval = Boolean(options.forceCorrection && ['approved', 'locked'].includes(lockedSheet.status))
      const before = (await transaction.query<any>('select * from employee_timesheet_days where timesheet_id=$1 and work_date=$2::date for update', [sheet.id, date])).rows[0] || null
      const id = before?.id || randomUUID(); const state = confirm ? 'confirmed' : 'draft'; const revision = Number(before?.revision || 0) + 1
      const confirmedAt = confirm ? this.now().toISOString() : null
      await transaction.query(`insert into employee_timesheet_days(id,timesheet_id,work_date,state,first_time_in,first_time_out,second_time_in,second_time_out,total_minutes,revision,confirmed_at,updated_by_user_id)
        values($1,$2,$3::date,$4,$5::time,$6::time,$7::time,$8::time,$9,$10,$11,$12)
        on conflict(timesheet_id,work_date) do update set state=excluded.state,first_time_in=excluded.first_time_in,first_time_out=excluded.first_time_out,second_time_in=excluded.second_time_in,second_time_out=excluded.second_time_out,total_minutes=excluded.total_minutes,revision=excluded.revision,confirmed_at=excluded.confirmed_at,updated_by_user_id=excluded.updated_by_user_id,updated_at=now()`,
      [id, sheet.id, date, state, clean.firstShift.timeIn, clean.firstShift.timeOut, clean.secondShift.timeIn, clean.secondShift.timeOut, calculated.total, revision, confirmedAt, actorUserId])
      await this.writeOvertime(transaction, sheet.id, id, input.overtime, actorUserId, options.managerReason, Boolean(options.forceCorrection))
      const dayAfter = (await transaction.query<any>('select * from employee_timesheet_days where id=$1', [id])).rows[0]
      const viewAfter = (await transaction.query<any>(`select d.*,o.id overtime_id,o.duration_minutes overtime_minutes,o.status overtime_status,
        o.revision overtime_revision,o.submitted_at overtime_submitted_at,o.reviewed_at overtime_reviewed_at,o.rejection_reason overtime_rejection_reason
        from employee_timesheet_days d left join employee_timesheet_overtime o on o.timesheet_day_id=d.id where d.id=$1`, [id])).rows[0]
      const action = options.forceCorrection || before?.state === 'confirmed' ? 'corrected' : confirm ? 'confirmed' : before ? 'draft_saved' : 'created'
      await transaction.query('insert into employee_timesheet_day_audits(id,timesheet_id,timesheet_day_id,actor_user_id,action,before_data,after_data,reason) values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)', [randomUUID(), sheet.id, id, actorUserId, action, before ? JSON.stringify(before) : null, JSON.stringify(dayAfter), options.managerReason?.trim() || null])
      await transaction.query(`update employee_timesheets set status=case when $3 then 'submitted' else status end,
        reopened_until=case when $3 then null else reopened_until end,reopened_by_user_id=case when $3 then null else reopened_by_user_id end,
        reopen_reason=case when $3 then null else reopen_reason end,updated_by_user_id=$2,updated_at=now() where id=$1`, [sheet.id, actorUserId, requiresReapproval])
      return this.viewDay(date, await this.scheduledDuty(staffId, date, transaction), viewAfter, true)
    })
  }
  saveDraft(staffId: string, date: string, input: TimesheetDayInput, actorUserId: string) { return this.writeDay(staffId, date, input, actorUserId, false) }
  confirmDay(staffId: string, date: string, input: TimesheetDayInput, actorUserId: string) { return this.writeDay(staffId, date, input, actorUserId, true) }

  managerCorrectDay(staffId: string, date: string, input: TimesheetDayInput, reason: string, actorUserId: string) {
    if (!reason.trim()) throw new TimesheetError('CORRECTION_REASON_REQUIRED', 'A manager correction reason is required.')
    return this.writeDay(staffId, date, input, actorUserId, true, { managerReason: reason, forceCorrection: true })
  }

  async reviewOvertime(staffId: string, date: string, decision: 'approved' | 'rejected', reason: string, expectedRevision: number, actorUserId: string) {
    if (!datePattern.test(date) || !asDate(date)) throw new TimesheetError('INVALID_DATE', 'Date must be a valid YYYY-MM-DD date.')
    if (decision === 'rejected' && reason.trim().length < 3) throw new TimesheetError('OVERTIME_REJECTION_REASON_REQUIRED', 'A rejection reason is required.')
    await this.staff(staffId)
    await this.db.transaction(async transaction => {
      const row = (await transaction.query<any>(`select o.* from employee_timesheet_overtime o
        join employee_timesheet_days d on d.id=o.timesheet_day_id join employee_timesheets t on t.id=o.timesheet_id
        where t.staff_id=$1 and d.work_date=$2::date for update of o`, [staffId, date])).rows[0]
      if (!row || Number(row.duration_minutes) <= 0) throw new TimesheetError('OVERTIME_REQUEST_NOT_FOUND', 'No positive overtime request exists for this day.', 404)
      if (row.status !== 'pending') throw new TimesheetError('OVERTIME_NOT_PENDING', 'Only pending overtime can be approved or rejected.', 409)
      if (Number(row.revision) !== Number(expectedRevision)) throw new TimesheetError('OVERTIME_REVISION_CONFLICT', 'This overtime request changed since it was opened. Refresh and try again.', 409)
      const before = row; const revision = Number(row.revision) + 1
      await transaction.query(`update employee_timesheet_overtime set status=$2,revision=$3,reviewed_by_user_id=$4,reviewed_at=now(),
        rejection_reason=$5,updated_by_user_id=$4,updated_at=now() where id=$1`, [row.id, decision, revision, actorUserId, decision === 'rejected' ? reason.trim() : null])
      const after = (await transaction.query<any>('select * from employee_timesheet_overtime where id=$1', [row.id])).rows[0]
      await transaction.query(`insert into employee_timesheet_overtime_audits(id,overtime_id,timesheet_id,timesheet_day_id,actor_user_id,action,before_data,after_data,reason)
        values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`, [randomUUID(), row.id, row.timesheet_id, row.timesheet_day_id, actorUserId, decision, JSON.stringify(before), JSON.stringify(after), decision === 'rejected' ? reason.trim() : null])
    })
    const view = await this.month(staffId, date.slice(0, 7))
    return view.days.find(day => day.date === date)!
  }

  private async snapshot(sheetId: string, executor: QueryExecutor) {
    const sheet = (await executor.query<any>('select id,staff_id,month_start,status,reopened_until,updated_at from employee_timesheets where id=$1', [sheetId])).rows[0]
    const days = (await executor.query<any>('select work_date,state,first_time_in,first_time_out,second_time_in,second_time_out,total_minutes,revision,confirmed_at from employee_timesheet_days where timesheet_id=$1 order by work_date', [sheetId])).rows
    const overtime = (await executor.query<any>('select timesheet_day_id,duration_minutes,status,revision,submitted_by_user_id,submitted_at,reviewed_by_user_id,reviewed_at,rejection_reason from employee_timesheet_overtime where timesheet_id=$1 order by timesheet_day_id', [sheetId])).rows
    return { sheet, days, overtime }
  }

  private async assertNoPendingOvertime(sheetId: string, executor: QueryExecutor) {
    const pending = Number((await executor.query<{ count: number }>("select count(*)::int count from employee_timesheet_overtime where timesheet_id=$1 and duration_minutes>0 and status='pending'", [sheetId])).rows[0]?.count || 0)
    if (pending) throw new TimesheetError('PENDING_OVERTIME_REVIEW', `Resolve ${pending} pending overtime request${pending === 1 ? '' : 's'} before monthly approval or locking.`, 409)
  }

  private async transition(staffId: string, month: string, action: 'submitted' | 'approved' | 'locked', expected: TimesheetMonthStatus, next: TimesheetMonthStatus, actorUserId: string) {
    if (!monthPattern.test(month)) throw new TimesheetError('INVALID_MONTH', 'Month must use YYYY-MM.')
    await this.staff(staffId)
    return this.db.transaction(async transaction => {
      const sheet = await this.ensureSheet(staffId, month, actorUserId, transaction)
      const locked = (await transaction.query<any>('select * from employee_timesheets where id=$1 for update', [sheet.id])).rows[0]
      if (locked.status !== expected) throw new TimesheetError('TIMESHEET_STATUS_CONFLICT', `The month must be ${expected} before it can be ${next}.`, 409)
      if (action === 'approved' || action === 'locked') await this.assertNoPendingOvertime(locked.id, transaction)
      const snapshot = await this.snapshot(sheet.id, transaction)
      await transaction.query('update employee_timesheets set status=$2,reopened_until=null,reopened_by_user_id=null,reopen_reason=null,updated_by_user_id=$3,updated_at=now() where id=$1', [sheet.id, next, actorUserId])
      await transaction.query('insert into employee_timesheet_month_audits(id,timesheet_id,actor_user_id,action,previous_status,new_status,snapshot_data) values($1,$2,$3,$4,$5,$6,$7::jsonb)', [randomUUID(), sheet.id, actorUserId, action, expected, next, JSON.stringify(snapshot)])
      return { staffId, month, status: next }
    })
  }

  async submitMonth(staffId: string, month: string, actorUserId: string) {
    const sheet = await this.sheet(staffId, month)
    if (!this.editable(sheet, month)) throw new TimesheetError('TIMESHEET_MONTH_LOCKED', 'This month is locked. A manager must reopen it before submission.', 409)
    return this.transition(staffId, month, 'submitted', 'open', 'submitted', actorUserId)
  }

  private async approvalIssues(staffId: string, month: string, sheetId: string, executor: QueryExecutor) {
    const rows = (await executor.query<any>(`select r.duty_date,c.metadata,d.state,d.first_time_in,d.first_time_out,d.second_time_in,d.second_time_out,d.total_minutes
      from duty_roster_entries r
      left join configuration_options c on c.group_key='duty_codes' and c.value=r.duty_code_value
      left join employee_timesheet_days d on d.timesheet_id=$3 and d.work_date=r.duty_date
      where r.staff_id=$1 and r.duty_date>=$2::date and r.duty_date<($2::date+interval '1 month') order by r.duty_date`, [staffId, `${month}-01`, sheetId])).rows
    const issues: Array<{ date: string; code: string }> = []
    for (const row of rows) {
      const metadata = json(row.metadata) as Record<string, unknown>; const working = metadata.countsAsWorking === true; const date = dateValue(row.duty_date)
      const firstPartial = Boolean(row.first_time_in) !== Boolean(row.first_time_out); const secondPartial = Boolean(row.second_time_in) !== Boolean(row.second_time_out)
      if (firstPartial || secondPartial) issues.push({ date, code: 'INCOMPLETE_SHIFT' })
      if (!firstPartial && !secondPartial) {
        try { duration(normalizedInput({ firstShift: { timeIn: timeValue(row.first_time_in), timeOut: timeValue(row.first_time_out) }, secondShift: { timeIn: timeValue(row.second_time_in), timeOut: timeValue(row.second_time_out) } }), true) }
        catch { issues.push({ date, code: 'INVALID_OR_OVERLAPPING_HOURS' }) }
      }
      if (working && (!row.first_time_in || !row.first_time_out)) issues.push({ date, code: 'MISSING_WORKING_HOURS' })
      if (working && row.state !== 'confirmed') issues.push({ date, code: 'UNCONFIRMED_WORKING_DAY' })
      if (!working && Number(row.total_minutes || 0) > 0) issues.push({ date, code: 'WORK_RECORDED_ON_NON_WORKING_DUTY' })
    }
    return issues
  }

  async approveMonth(staffId: string, month: string, actorUserId: string) {
    const sheet = await this.sheet(staffId, month)
    if (!sheet || sheet.status !== 'submitted') throw new TimesheetError('TIMESHEET_STATUS_CONFLICT', 'The month must be submitted before approval.', 409)
    const issues = await this.approvalIssues(staffId, month, sheet.id, this.db)
    if (issues.length) throw new TimesheetError('TIMESHEET_APPROVAL_BLOCKED', `Resolve ${issues.length} timesheet exception${issues.length === 1 ? '' : 's'} before approval.`, 409)
    await this.assertNoPendingOvertime(sheet.id, this.db)
    return this.transition(staffId, month, 'approved', 'submitted', 'approved', actorUserId)
  }

  async lockMonth(staffId: string, month: string, actorUserId: string) {
    const sheet = await this.sheet(staffId, month)
    if (!sheet || sheet.status !== 'approved') throw new TimesheetError('TIMESHEET_STATUS_CONFLICT', 'The month must be approved before it can be locked.', 409)
    await this.assertNoPendingOvertime(sheet.id, this.db)
    return this.transition(staffId, month, 'locked', 'approved', 'locked', actorUserId)
  }

  async reopenMonth(staffId: string, month: string, reason: string, reopenedUntil: string, actorUserId: string) {
    if (!monthPattern.test(month) || !reason.trim()) throw new TimesheetError('INVALID_REOPEN_REQUEST', 'A valid month and reason are required.')
    const until = new Date(reopenedUntil)
    if (Number.isNaN(until.getTime()) || until.getTime() <= this.now().getTime()) throw new TimesheetError('INVALID_REOPEN_WINDOW', 'The reopening window must end in the future.')
    await this.staff(staffId)
    return this.db.transaction(async transaction => {
      let locked = await this.sheet(staffId, month, transaction)
      if (this.editable(locked, month)) throw new TimesheetError('TIMESHEET_ALREADY_EDITABLE', 'This month is already open for editing.', 409)
      locked = locked || await this.ensureSheet(staffId, month, actorUserId, transaction)
      locked = (await transaction.query<any>('select * from employee_timesheets where id=$1 for update', [locked.id])).rows[0]
      if (this.editable(locked, month)) throw new TimesheetError('TIMESHEET_ALREADY_EDITABLE', 'This month is already open for editing.', 409)
      const snapshot = await this.snapshot(locked.id, transaction)
      await transaction.query("update employee_timesheets set status='open',reopened_until=$2,reopened_by_user_id=$3,reopen_reason=$4,updated_by_user_id=$3,updated_at=now() where id=$1", [locked.id, until.toISOString(), actorUserId, reason.trim()])
      await transaction.query('insert into employee_timesheet_reopenings(id,timesheet_id,actor_user_id,reason,reopened_until) values($1,$2,$3,$4,$5)', [randomUUID(), locked.id, actorUserId, reason.trim(), until.toISOString()])
      await transaction.query("insert into employee_timesheet_month_audits(id,timesheet_id,actor_user_id,action,previous_status,new_status,reason,snapshot_data) values($1,$2,$3,'reopened',$4,'open',$5,$6::jsonb)", [randomUUID(), locked.id, actorUserId, locked.status, reason.trim(), JSON.stringify(snapshot)])
      return { staffId, month, status: 'open' as const, reopenedUntil: until.toISOString() }
    })
  }
}
