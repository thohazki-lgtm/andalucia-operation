import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { AttendanceRecord, ConfigOption, RosterEntry, Staff } from '../src/domain.js'

const attendanceStatuses: ConfigOption[] = [
  { id: 'worked-as-scheduled', value: 'worked_as_scheduled', label: 'Worked as scheduled', color: '#1b6288', active: true, metadata: { description: 'Completed the scheduled duty.', countsAsException: false } },
  { id: 'different-duty', value: 'different_duty', label: 'Different duty', color: '#b38b3a', active: true, metadata: { description: 'Worked a duty different from the schedule.', countsAsException: true } },
  { id: 'absent', value: 'absent', label: 'Absent', color: '#b74b45', active: true, metadata: { description: 'Did not attend the assigned duty.', countsAsException: true } },
  { id: 'late', value: 'late', label: 'Late', color: '#b38b3a', active: true, metadata: { description: 'Late arrival.', countsAsException: true } },
  { id: 'left-early', value: 'left_early', label: 'Left early', color: '#a86842', active: true, metadata: { description: 'Left before completing the duty.', countsAsException: true } }
]

export class OperationsRepository {
  constructor(private readonly db: PGlite) {}
  async initialize() {
    const options = await this.db.query<{ count: number }>("select count(*)::int as count from configuration_options where group_key = 'attendance_statuses'")
    if (options.rows[0].count === 0) for (let index = 0; index < attendanceStatuses.length; index++) { const item = attendanceStatuses[index]; await this.db.query('insert into configuration_options (id, group_key, value, label, color, metadata, active, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), 'attendance_statuses', item.value, item.label, item.color || null, JSON.stringify(item.metadata || {}), item.active, index]) }
    for (const item of attendanceStatuses) await this.db.query("update configuration_options set metadata = metadata || $1::jsonb where group_key='attendance_statuses' and value=$2", [JSON.stringify(item.metadata || {}), item.value])
  }
  async roster(start: string, end: string): Promise<RosterEntry[]> { const result = await this.db.query<{ staff_id: string; duty_date: string; duty_code_value: string; updated_at: string }>('select staff_id, duty_date::text, duty_code_value, updated_at::text from duty_roster_entries where duty_date between $1 and $2', [start, end]); return result.rows.map(row => ({ staffId: row.staff_id, date: row.duty_date, dutyCode: row.duty_code_value, updatedAt: row.updated_at, updatedBy: 'Venue Manager' })) }
  async updateRoster(staffId: string, date: string, dutyCode: string) {
    const staff = await this.db.query<{ eligible: boolean }>("select coalesce((select (c.metadata->>'eligibleForAssignments')::boolean from configuration_options c where c.group_key='employment_statuses' and c.value=s.employment_status_key),s.employment_status_key='active') eligible from staff s where s.id=$1", [staffId])
    if (!staff.rows[0]) throw new Error('The selected staff member no longer exists.')
    const existing = await this.db.query<{ duty_code_value: string }>('select duty_code_value from duty_roster_entries where staff_id=$1 and duty_date=$2', [staffId, date])
    if (!staff.rows[0].eligible && existing.rows[0]?.duty_code_value !== dutyCode) throw new Error('This staff member is not eligible for new duty assignments.')
    if (!dutyCode) {
      await this.db.transaction(async transaction => {
        await transaction.query('update attendance_records set roster_entry_id=null where staff_id=$1 and attendance_date=$2', [staffId, date])
        await transaction.query('delete from duty_roster_entries where staff_id=$1 and duty_date=$2', [staffId, date])
      })
      return
    }
    const configuredDuty = await this.db.query<{ active: boolean }>("select active from configuration_options where group_key='duty_codes' and value=$1", [dutyCode])
    if (!configuredDuty.rows[0]) throw new Error('The selected duty code no longer exists.')
    if (!configuredDuty.rows[0].active && existing.rows[0]?.duty_code_value !== dutyCode) throw new Error('Inactive duty codes cannot receive new roster assignments.')
    await this.db.query('insert into duty_roster_entries (id, staff_id, duty_date, duty_code_value) values ($1,$2,$3,$4) on conflict (staff_id, duty_date) do update set duty_code_value=excluded.duty_code_value, updated_at=now()', [randomUUID(), staffId, date, dutyCode])
  }
  async attendance(start: string, end: string): Promise<AttendanceRecord[]> { const result = await this.db.query<any>('select s.id staff_id, s.staff_number, s.full_name, s.position_key, s.employment_status_key, r.duty_date::text duty_date, r.duty_code_value, a.actual_duty_code, a.actual_status, a.notes, a.updated_at::text from duty_roster_entries r join staff s on s.id=r.staff_id left join attendance_records a on a.staff_id=r.staff_id and a.attendance_date=r.duty_date where r.duty_date between $1 and $2 union all select s.id staff_id, s.staff_number, s.full_name, s.position_key, s.employment_status_key, a.attendance_date::text duty_date, null duty_code_value, a.actual_duty_code, a.actual_status, a.notes, a.updated_at::text from attendance_records a join staff s on s.id=a.staff_id where a.attendance_date between $1 and $2 and not exists (select 1 from duty_roster_entries r where r.staff_id=a.staff_id and r.duty_date=a.attendance_date) order by duty_date, full_name', [start, end]); return result.rows.map((row: any) => ({ staffId: row.staff_id, date: row.duty_date, scheduledDuty: row.duty_code_value, actualDuty: row.actual_duty_code, attendanceStatus: row.actual_status, notes: row.notes, updatedAt: row.updated_at, staff: { id: row.staff_id, number: row.staff_number, name: row.full_name, position: row.position_key, employmentStatus: row.employment_status_key } })) }
  async saveAttendance(record: AttendanceRecord): Promise<void> { const roster = await this.db.query<{ id: string }>('select id from duty_roster_entries where staff_id=$1 and duty_date=$2', [record.staffId, record.date]); await this.db.query('insert into attendance_records (id, staff_id, attendance_date, roster_entry_id, actual_status, actual_duty_code, notes, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$8) on conflict (staff_id, attendance_date) do update set roster_entry_id=excluded.roster_entry_id, actual_status=excluded.actual_status, actual_duty_code=excluded.actual_duty_code, notes=excluded.notes, updated_by=excluded.updated_by, updated_at=now()', [randomUUID(), record.staffId, record.date, roster.rows[0]?.id || null, record.attendanceStatus || 'worked_as_scheduled', record.actualDuty, record.notes, 'Venue Manager']) }
  async statuses(): Promise<ConfigOption[]> { const result = await this.db.query<any>("select id, value, label, color, metadata, active from configuration_options where group_key='attendance_statuses' order by sort_order, label"); return result.rows.map((row: any) => ({ ...row, metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata })) }
  async saveStatus(option: ConfigOption): Promise<ConfigOption> { const result = await this.db.query<any>('insert into configuration_options (id, group_key, value, label, color, metadata, active, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do update set value=excluded.value, label=excluded.label, color=excluded.color, metadata=excluded.metadata, active=excluded.active, updated_at=now() returning id, value, label, color, metadata, active', [option.id || randomUUID(), 'attendance_statuses', option.value, option.label, option.color || null, JSON.stringify(option.metadata || {}), option.active, 100]); const row = result.rows[0]; return { ...row, metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata } }
}
