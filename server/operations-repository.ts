import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { AttendanceRecord, ConfigOption, RosterBatchChange, RosterEntry, RosterMonthState, Staff } from '../src/domain.js'
import { addCalendarMonths, serviceDate } from '../src/service-date.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'

const attendanceStatuses: ConfigOption[] = [
  { id: 'worked-as-scheduled', value: 'worked_as_scheduled', label: 'Worked as scheduled', color: '#1b6288', active: true, metadata: { description: 'Completed the scheduled duty.', countsAsException: false } },
  { id: 'different-duty', value: 'different_duty', label: 'Different duty', color: '#b38b3a', active: true, metadata: { description: 'Worked a duty different from the schedule.', countsAsException: true } },
  { id: 'absent', value: 'absent', label: 'Absent', color: '#b74b45', active: true, metadata: { description: 'Did not attend the assigned duty.', countsAsException: true } },
  { id: 'late', value: 'late', label: 'Late', color: '#b38b3a', active: true, metadata: { description: 'Late arrival.', countsAsException: true } },
  { id: 'left-early', value: 'left_early', label: 'Left early', color: '#a86842', active: true, metadata: { description: 'Left before completing the duty.', countsAsException: true } }
]

export class OperationsRepository {
  constructor(private readonly db: PGlite, private readonly rosterSaved?: (changes: RosterBatchChange[], actor: string) => Promise<void>, private readonly now = () => new Date()) {}
  async initialize() {
    const options = await this.db.query<{ count: number }>("select count(*)::int as count from configuration_options where group_key = 'attendance_statuses'")
    if (options.rows[0].count === 0) for (let index = 0; index < attendanceStatuses.length; index++) { const item = attendanceStatuses[index]; await this.db.query('insert into configuration_options (id, group_key, value, label, color, metadata, active, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), 'attendance_statuses', item.value, item.label, item.color || null, JSON.stringify(item.metadata || {}), item.active, index]) }
    for (const item of attendanceStatuses) await this.db.query("update configuration_options set metadata = metadata || $1::jsonb where group_key='attendance_statuses' and value=$2", [JSON.stringify(item.metadata || {}), item.value])
  }
  async roster(start: string, end: string): Promise<RosterEntry[]> { const result = await this.db.query<{ staff_id: string; duty_date: string; duty_code_value: string; updated_at: string }>('select staff_id, duty_date::text, duty_code_value, updated_at::text from duty_roster_entries where duty_date between $1 and $2', [start, end]); return result.rows.map(row => ({ staffId: row.staff_id, date: row.duty_date, dutyCode: row.duty_code_value, updatedAt: row.updated_at, updatedBy: 'Venue Manager' })) }
  private validMonth(month: string) { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('A valid Duty Roster month is required.'); return month }
  private months(start: string, end: string) { const first = this.validMonth(start.slice(0, 7)); const last = this.validMonth(end.slice(0, 7)); const months: string[] = []; for (let month = first; month <= last; month = addCalendarMonths(`${month}-01`, 1).slice(0, 7)) months.push(month); return months }
  private async lockSchemaAvailable(executor: Pick<PGlite, 'query'>) { return Boolean((await executor.query<{ available: boolean }>("select to_regclass('public.duty_roster_month_states') is not null available")).rows[0]?.available) }
  private automaticLockAt(month: string) { return `${addCalendarMonths(`${month}-01`, 1)}T00:00:00+05:00` }
  private monthStateView(row: any): RosterMonthState { const month = row.month_start instanceof Date ? row.month_start.toISOString().slice(0, 7) : String(row.month_start).slice(0, 7); return { month, status: row.status, locked: row.status === 'locked', automatic: row.status === 'locked' && !row.locked_by_user_id, lockedAt: row.locked_at ? new Date(row.locked_at).toISOString() : null, lockedBy: row.locked_by_name_snapshot || null, reopenedAt: row.reopened_at ? new Date(row.reopened_at).toISOString() : null, reopenedBy: row.reopened_by_name_snapshot || null } }
  private async ensureMonthState(executor: Pick<PGlite, 'query'>, month: string) {
    this.validMonth(month)
    const automatic = month < serviceDate(this.now()).slice(0, 7)
    const initialStatus = automatic ? 'locked' : 'open'
    const id = randomUUID()
    const inserted = await executor.query<any>(`insert into duty_roster_month_states(id,outlet_scope_id,month_start,status,locked_at,locked_by_name_snapshot)
      values($1,$2,$3,$4,$5,$6) on conflict(outlet_scope_id,month_start) do nothing returning *`, [id, ANDALUCIA_SCOPE_ID, `${month}-01`, initialStatus, automatic ? this.automaticLockAt(month) : null, automatic ? 'Automatic month-end lock' : null])
    if (inserted.rows[0] && automatic) await executor.query('insert into duty_roster_month_audits(id,month_state_id,action,previous_status,new_status,actor_name_snapshot,created_at) values($1,$2,\'automatic_lock\',\'open\',\'locked\',\'Automatic month-end lock\',$3)', [randomUUID(), id, this.automaticLockAt(month)])
    let row = (await executor.query<any>('select * from duty_roster_month_states where outlet_scope_id=$1 and month_start=$2 for update', [ANDALUCIA_SCOPE_ID, `${month}-01`])).rows[0]
    if (automatic && row.status === 'open') {
      const lockedAt = this.automaticLockAt(month)
      row = (await executor.query<any>("update duty_roster_month_states set status='locked',locked_at=$3,locked_by_user_id=null,locked_by_name_snapshot='Automatic month-end lock',updated_at=now() where outlet_scope_id=$1 and month_start=$2 returning *", [ANDALUCIA_SCOPE_ID, `${month}-01`, lockedAt])).rows[0]
      await executor.query("insert into duty_roster_month_audits(id,month_state_id,action,previous_status,new_status,actor_name_snapshot,created_at) values($1,$2,'automatic_lock','open','locked','Automatic month-end lock',$3)", [randomUUID(), row.id, lockedAt])
    }
    return row
  }
  async rosterMonthStates(start: string, end: string): Promise<RosterMonthState[]> {
    const months = this.months(start, end)
    if (!await this.lockSchemaAvailable(this.db)) throw new Error('Duty Roster month locking requires Schema 028.')
    return this.db.transaction(async transaction => { const states: RosterMonthState[] = []; for (const month of months) states.push(this.monthStateView(await this.ensureMonthState(transaction as any, month))); return states })
  }
  async lockRosterMonth(month: string, actor: { userId: string; displayName: string }): Promise<RosterMonthState> {
    if (!await this.lockSchemaAvailable(this.db)) throw new Error('Duty Roster month locking requires Schema 028.')
    return this.db.transaction(async transaction => {
      const row = await this.ensureMonthState(transaction as any, this.validMonth(month))
      if (row.status === 'locked') return this.monthStateView(row)
      const updated = (await transaction.query<any>("update duty_roster_month_states set status='locked',locked_at=now(),locked_by_user_id=$3,locked_by_name_snapshot=$4,updated_at=now() where outlet_scope_id=$1 and month_start=$2 returning *", [ANDALUCIA_SCOPE_ID, `${month}-01`, actor.userId, actor.displayName])).rows[0]
      await transaction.query("insert into duty_roster_month_audits(id,month_state_id,action,previous_status,new_status,actor_user_id,actor_name_snapshot) values($1,$2,'manual_lock',$3,'locked',$4,$5)", [randomUUID(), updated.id, row.status, actor.userId, actor.displayName])
      return this.monthStateView(updated)
    })
  }
  async reopenRosterMonth(month: string, actor: { userId: string; displayName: string }): Promise<RosterMonthState> {
    if (!await this.lockSchemaAvailable(this.db)) throw new Error('Duty Roster month locking requires Schema 028.')
    return this.db.transaction(async transaction => {
      const row = await this.ensureMonthState(transaction as any, this.validMonth(month))
      if (row.status !== 'locked') throw new Error('The Duty Roster month is already open for editing.')
      const updated = (await transaction.query<any>("update duty_roster_month_states set status='reopened',reopened_at=now(),reopened_by_user_id=$3,reopened_by_name_snapshot=$4,updated_at=now() where outlet_scope_id=$1 and month_start=$2 returning *", [ANDALUCIA_SCOPE_ID, `${month}-01`, actor.userId, actor.displayName])).rows[0]
      await transaction.query("insert into duty_roster_month_audits(id,month_state_id,action,previous_status,new_status,actor_user_id,actor_name_snapshot) values($1,$2,'reopen','locked','reopened',$3,$4)", [randomUUID(), updated.id, actor.userId, actor.displayName])
      return this.monthStateView(updated)
    })
  }
  async updateRoster(staffId: string, date: string, dutyCode: string, actor = 'Venue Manager') {
    const existing = await this.db.query<{ updated_at: string }>('select updated_at::text from duty_roster_entries where staff_id=$1 and duty_date=$2', [staffId, date])
    await this.updateRosterBatch([{ staffId, date, dutyCode, expectedUpdatedAt: existing.rows[0]?.updated_at || null }], actor)
  }
  async updateRosterBatch(changes: RosterBatchChange[], actor = 'Venue Manager') {
    if (!changes.length) throw new Error('Select at least one Duty Roster change to save.')
    const keys = changes.map(change => `${change.staffId}|${change.date}`)
    if (new Set(keys).size !== keys.length) throw new Error('Each staff member and date may appear only once in a Duty Roster batch.')
    if (changes.some(change => !/^\d{4}-\d{2}-\d{2}$/.test(change.date) || typeof change.dutyCode !== 'string' || change.expectedUpdatedAt !== null && typeof change.expectedUpdatedAt !== 'string')) throw new Error('Duty Roster batch contains an invalid assignment.')
    await this.db.transaction(async transaction => {
      if (await this.lockSchemaAvailable(transaction as any)) for (const month of [...new Set(changes.map(change => change.date.slice(0, 7)))].sort()) {
        const state = await this.ensureMonthState(transaction as any, month)
        if (state.status === 'locked') throw new Error(`DUTY_ROSTER_MONTH_LOCKED: ${month} is locked. An Owner or Outlet Manager must reopen it before changes can be saved.`)
      }
      const prepared: Array<{ change: RosterBatchChange; existing: { id: string; duty_code_value: string; updated_at: string } | undefined }> = []
      for (const change of changes) {
        const staff = await transaction.query<{ eligible: boolean }>("select coalesce((select (c.metadata->>'eligibleForAssignments')::boolean from configuration_options c where c.group_key='employment_statuses' and c.value=s.employment_status_key),s.employment_status_key='active') eligible from staff s where s.id=$1", [change.staffId])
        if (!staff.rows[0]) throw new Error('The selected staff member no longer exists.')
        const existing = (await transaction.query<{ id: string; duty_code_value: string; updated_at: string }>('select id,duty_code_value,updated_at::text from duty_roster_entries where staff_id=$1 and duty_date=$2 for update', [change.staffId, change.date])).rows[0]
        if ((existing?.updated_at || null) !== change.expectedUpdatedAt) throw new Error('ROSTER_BATCH_CONFLICT: The Duty Roster changed after you opened it. Your unsaved edits were preserved; review the latest roster before trying again.')
        if (!staff.rows[0].eligible && existing?.duty_code_value !== change.dutyCode) throw new Error('This staff member is not eligible for new duty assignments.')
        if (change.dutyCode) {
          const configuredDuty = await transaction.query<{ active: boolean; displayCode: string }>("select active,upper(coalesce(nullif(metadata->>'displayCode',''),value)) as \"displayCode\" from configuration_options where group_key='duty_codes' and value=$1", [change.dutyCode])
          if (!configuredDuty.rows[0]) throw new Error('The selected duty code no longer exists.')
          if (!configuredDuty.rows[0].active && existing?.duty_code_value !== change.dutyCode) throw new Error('Inactive duty codes cannot receive new roster assignments.')
          if (configuredDuty.rows[0].displayCode === 'SK' && existing?.duty_code_value !== change.dutyCode) throw new Error('SK is retained only for historical Sick Leave compatibility. Use SL for new roster assignments.')
        }
        prepared.push({ change, existing })
      }
      for (const { change, existing } of prepared) {
        if (!change.dutyCode) {
          if (!existing) continue
          await transaction.query('update attendance_records set roster_entry_id=null where staff_id=$1 and attendance_date=$2', [change.staffId, change.date])
          await transaction.query('delete from duty_roster_entries where staff_id=$1 and duty_date=$2', [change.staffId, change.date])
          await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,null,$6)', [randomUUID(), 'duty_roster_entry', existing.id, 'deleted', JSON.stringify({ staffId: change.staffId, date: change.date, dutyCode: existing.duty_code_value }), actor])
          continue
        }
        const id = existing?.id || randomUUID()
        await transaction.query('insert into duty_roster_entries (id, staff_id, duty_date, duty_code_value) values ($1,$2,$3,$4) on conflict (staff_id, duty_date) do update set duty_code_value=excluded.duty_code_value, updated_at=now()', [id, change.staffId, change.date, change.dutyCode])
        await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'duty_roster_entry', id, existing ? 'updated' : 'created', existing ? JSON.stringify({ staffId: change.staffId, date: change.date, dutyCode: existing.duty_code_value }) : null, JSON.stringify({ staffId: change.staffId, date: change.date, dutyCode: change.dutyCode }), actor])
      }
    })
    await this.rosterSaved?.(changes, actor)
    return { saved: changes.length }
  }
  async attendance(start: string, end: string): Promise<AttendanceRecord[]> { const result = await this.db.query<any>('select s.id staff_id, s.staff_number, s.full_name, s.position_key, s.employment_status_key, r.duty_date::text duty_date, r.duty_code_value, a.actual_duty_code, a.actual_status, a.notes, a.updated_at::text from duty_roster_entries r join staff s on s.id=r.staff_id left join attendance_records a on a.staff_id=r.staff_id and a.attendance_date=r.duty_date where r.duty_date between $1 and $2 union all select s.id staff_id, s.staff_number, s.full_name, s.position_key, s.employment_status_key, a.attendance_date::text duty_date, null duty_code_value, a.actual_duty_code, a.actual_status, a.notes, a.updated_at::text from attendance_records a join staff s on s.id=a.staff_id where a.attendance_date between $1 and $2 and not exists (select 1 from duty_roster_entries r where r.staff_id=a.staff_id and r.duty_date=a.attendance_date) order by duty_date, full_name', [start, end]); return result.rows.map((row: any) => ({ staffId: row.staff_id, date: row.duty_date, scheduledDuty: row.duty_code_value, actualDuty: row.actual_duty_code, attendanceStatus: row.actual_status, notes: row.notes, updatedAt: row.updated_at, staff: { id: row.staff_id, number: row.staff_number, name: row.full_name, position: row.position_key, employmentStatus: row.employment_status_key } })) }
  async saveAttendance(record: AttendanceRecord): Promise<void> { const roster = await this.db.query<{ id: string }>('select id from duty_roster_entries where staff_id=$1 and duty_date=$2', [record.staffId, record.date]); await this.db.query('insert into attendance_records (id, staff_id, attendance_date, roster_entry_id, actual_status, actual_duty_code, notes, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$8) on conflict (staff_id, attendance_date) do update set roster_entry_id=excluded.roster_entry_id, actual_status=excluded.actual_status, actual_duty_code=excluded.actual_duty_code, notes=excluded.notes, updated_by=excluded.updated_by, updated_at=now()', [randomUUID(), record.staffId, record.date, roster.rows[0]?.id || null, record.attendanceStatus || 'worked_as_scheduled', record.actualDuty, record.notes, 'Venue Manager']) }
  async statuses(): Promise<ConfigOption[]> { const result = await this.db.query<any>("select id, value, label, color, metadata, active from configuration_options where group_key='attendance_statuses' order by sort_order, label"); return result.rows.map((row: any) => ({ ...row, metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata })) }
  async saveStatus(option: ConfigOption): Promise<ConfigOption> { const result = await this.db.query<any>('insert into configuration_options (id, group_key, value, label, color, metadata, active, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do update set value=excluded.value, label=excluded.label, color=excluded.color, metadata=excluded.metadata, active=excluded.active, updated_at=now() returning id, value, label, color, metadata, active', [option.id || randomUUID(), 'attendance_statuses', option.value, option.label, option.color || null, JSON.stringify(option.metadata || {}), option.active, 100]); const row = result.rows[0]; return { ...row, metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata } }
}
