import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { config, type AuthPrincipal, type ConfigOption, type LeaveClassification, type PublicHoliday, type Staff, type StaffEntitlement, type StaffLeaveDay, type StaffLeaveRecord } from '../src/domain.js'
import { buildStaffLeaveRecords } from '../src/leave-records.js'

type StaffRow = { id: string; staff_number: string; full_name: string; position_key: string; nationality: string; division: string; department: string; outlet: string; identity_document_number: string; employment_status_key: string; assignment_eligible: boolean; service_assignment_eligible: boolean; join_date: string; resignation_date: string | null; created_at: string; updated_at: string; created_by: string | null; updated_by: string | null }
export type StaffConfigGroup = 'duty-codes' | 'employment-statuses' | 'positions'
export type DutyCodeRemovalResult = { mode: 'deleted' | 'retired'; option?: ConfigOption }
const staffConfigKeys: Record<StaffConfigGroup, string> = { 'duty-codes': 'duty_codes', 'employment-statuses': 'employment_statuses', positions: 'staff_positions' }
const staffConfigSeeds: Record<StaffConfigGroup, ConfigOption[]> = { 'duty-codes': config.dutyCodes, 'employment-statuses': config.employmentStatuses, positions: config.positions }

const seedStaff: Staff[] = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Ana Martínez', number: 'AND-001', position: 'Restaurant Supervisor', employmentStatus: 'active', joinDate: '2024-02-12' },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Mohamed Rasheed', number: 'AND-014', position: 'Waiter', employmentStatus: 'active', joinDate: '2024-08-06' },
  { id: '00000000-0000-4000-8000-000000000003', name: 'Sofia García', number: 'AND-021', position: 'Host', employmentStatus: 'active', joinDate: '2025-01-15' },
  { id: '00000000-0000-4000-8000-000000000004', name: 'Ibrahim Nasir', number: 'AND-028', position: 'Waiter', employmentStatus: 'active', joinDate: '2025-04-20' },
  { id: '00000000-0000-4000-8000-000000000005', name: 'Elena Torres', number: 'AND-031', position: 'Waiter', employmentStatus: 'active', joinDate: '2025-06-03' },
  { id: '00000000-0000-4000-8000-000000000006', name: 'David Romero', number: 'AND-009', position: 'Waiter', employmentStatus: 'inactive', joinDate: '2023-07-10', resignationDate: '2026-08-22' }
].map(person => ({ ...person, nationality: '', division: 'Food & Beverage', department: 'F&B Service', outlet: 'Andalucía', identityDocumentNumber: '' }))
const mapStaff = (row: StaffRow): Staff => ({ id: row.id, number: row.staff_number, name: row.full_name, position: row.position_key, nationality: row.nationality, division: row.division, department: row.department, outlet: row.outlet, identityDocumentNumber: row.identity_document_number, employmentStatus: row.employment_status_key, assignmentEligible: row.assignment_eligible, serviceAssignmentEligible: row.service_assignment_eligible, joinDate: row.join_date, resignationDate: row.resignation_date || undefined, createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by || undefined, updatedBy: row.updated_by || undefined })
const staffSelect = `select s.id,s.staff_number,s.full_name,s.position_key,s.nationality,s.division,s.department,s.outlet,s.identity_document_number,s.employment_status_key,coalesce((select (c.metadata->>'eligibleForAssignments')::boolean from configuration_options c where c.group_key='employment_statuses' and c.value=s.employment_status_key),s.employment_status_key='active') assignment_eligible,coalesce((select (c.metadata->>'serviceAssignmentEligible')::boolean from configuration_options c where c.group_key='staff_positions' and c.value=s.position_key),lower(s.position_key) in ('venue manager','assistant restaurant manager','restaurant supervisor','f&b attendant','waiter')) service_assignment_eligible,s.join_date::text,s.resignation_date::text,s.created_at::text,s.updated_at::text,s.created_by,s.updated_by from staff s`

export class StaffRepository {
  private readonly database: PGlite
  private initialized = false

  constructor(private readonly dataDirectory = process.env.ANDALUCIA_DATA_DIR || resolve('.data/postgres'), database?: PGlite) { this.database = database || new PGlite(dataDirectory) }

  async assertCompatibleSchema() {
    const requiredTables = ['staff', 'configuration_options', 'duty_roster_entries', 'bookings', 'schema_migrations', 'outlet_scopes', 'user_accounts', 'authorization_roles', 'bill_tip_distributions']
    const tables = await this.database.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public'")
    const present = new Set(tables.rows.map(row => row.table_name))
    const missing = requiredTables.filter(table => !present.has(table))
    if (missing.length) throw new Error(`DATABASE_MIGRATION_REQUIRED:missing_tables:${missing.join(',')}`)
    const requiredVersions = ['001', '002', '003', '004', '005', '006', '007', '008', '009', '010']
    const applied = await this.database.query<{ version: string }>("select version from schema_migrations where status='applied' order by version")
    const presentVersions = new Set(applied.rows.map(row => row.version))
    const missingVersions = requiredVersions.filter(version => !presentVersions.has(version))
    if (missingVersions.length) throw new Error(`DATABASE_MIGRATION_REQUIRED:missing_versions:${missingVersions.join(',')}`)
  }

  async initialize() {
    if (this.initialized) return
    await mkdir(resolve(this.dataDirectory, '..'), { recursive: true })
    const schema = await readFile(resolve('database/schema.sql'), 'utf8')
    await this.database.exec(schema)
    for (const group of Object.keys(staffConfigKeys) as StaffConfigGroup[]) {
      for (let index = 0; index < staffConfigSeeds[group].length; index++) {
        const option = staffConfigSeeds[group][index]
        await this.database.query('insert into configuration_options (id, group_key, value, label, color, metadata, active, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (group_key,value) do nothing', [randomUUID(), staffConfigKeys[group], option.value, option.label, option.color || null, JSON.stringify(option.metadata || {}), option.active, index])
      }
    }
    for (const option of config.employmentStatuses) await this.database.query("update configuration_options set metadata=metadata || $3::jsonb,color=coalesce(color,$4) where group_key=$1 and value=$2", [staffConfigKeys['employment-statuses'], option.value, JSON.stringify(option.metadata || {}), option.color || null])
    for (const option of config.positions) await this.database.query('update configuration_options set metadata=metadata || $3::jsonb where group_key=$1 and value=$2', [staffConfigKeys.positions, option.value, JSON.stringify(option.metadata || {})])
    const existing = await this.database.query<{ count: number }>('select count(*)::int as count from staff')
    if (existing.rows[0].count === 0) for (const person of seedStaff) await this.create(person, 'System initialization')
    await this.preserveReferencedConfiguration()
    const dutyClassifications: Array<[string, NonNullable<ConfigOption['metadata']>['dutyClassification']]> = [['ON', 'working'], ['OFF', 'off'], ['AL', 'annualLeave'], ['PH', 'publicHoliday'], ['SK', 'sickLeave']]
    for (const [displayCode, classification] of dutyClassifications) await this.database.query("update configuration_options set metadata=metadata || jsonb_build_object('dutyClassification',$3::text,'countsAsWorking',$4::boolean) where group_key=$1 and upper(coalesce(nullif(metadata->>'displayCode',''),value))=$2 and (not (metadata ? 'dutyClassification') or metadata->>'dutyClassification'='other')", [staffConfigKeys['duty-codes'], displayCode, classification, classification === 'working'])
    await this.database.query("update configuration_options set metadata=metadata || jsonb_build_object('dutyClassification',case when coalesce((metadata->>'countsAsWorking')::boolean,false) then 'working' else 'other' end) where group_key=$1 and not (metadata ? 'dutyClassification')", [staffConfigKeys['duty-codes']])
    await this.database.query("update configuration_options set metadata=metadata || jsonb_build_object('countsAsLeave',metadata->>'dutyClassification'='annualLeave','countsAsOffDay',metadata->>'dutyClassification'='off','countsAsPublicHoliday',metadata->>'dutyClassification'='publicHoliday','countsAsSickLeave',metadata->>'dutyClassification'='sickLeave') where group_key=$1", [staffConfigKeys['duty-codes']])
    await this.database.query("update configuration_options set metadata=metadata || jsonb_build_object('billTipEligible',case when metadata->>'dutyClassification'='annualLeave' or upper(coalesce(nullif(metadata->>'displayCode',''),value))='AL' then false else true end) where group_key=$1 and not (metadata ? 'billTipEligible')", [staffConfigKeys['duty-codes']])
    this.initialized = true
  }

  getDatabase() { return this.database }
  async close() { await this.database.close() }

  async list(): Promise<Staff[]> { const result = await this.database.query<StaffRow>(`${staffSelect} order by assignment_eligible desc,s.full_name`); return result.rows.map(mapStaff) }
  async find(id: string): Promise<Staff | null> { const result = await this.database.query<StaffRow>(`${staffSelect} where s.id=$1`, [id]); return result.rows[0] ? mapStaff(result.rows[0]) : null }
  async leaveRecords(start: string, end: string, staffId?: string): Promise<StaffLeaveRecord[]> {
    const result = await this.database.query<any>(`select s.id staff_id,s.full_name,s.staff_number,s.employment_status_key,r.duty_date::text duty_date,r.duty_code_value,c.label duty_label,c.metadata from duty_roster_entries r join staff s on s.id=r.staff_id left join configuration_options c on c.group_key=$3 and c.value=r.duty_code_value where r.duty_date between $1 and $2 and ($4::uuid is null or s.id=$4::uuid) order by s.id,r.duty_date`, [start, end, staffConfigKeys['duty-codes'], staffId || null])
    const days = result.rows.flatMap((row: any): StaffLeaveDay[] => {
      const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {}
      const displayCode = String(metadata.displayCode || row.duty_code_value).toUpperCase()
      const fallback: Record<string, LeaveClassification | undefined> = { AL: 'annualLeave', OFF: 'off', PH: 'publicHoliday', SK: 'sickLeave' }
      const classification = (metadata.countsAsLeave ? 'annualLeave' : metadata.countsAsOffDay ? 'off' : metadata.countsAsPublicHoliday ? 'publicHoliday' : metadata.countsAsSickLeave ? 'sickLeave' : metadata.dutyClassification !== 'other' ? metadata.dutyClassification : fallback[displayCode]) as LeaveClassification | undefined
      if (!classification || !['annualLeave', 'off', 'publicHoliday', 'sickLeave'].includes(classification)) return []
      return [{ staffId: row.staff_id, staffName: row.full_name, staffNumber: row.staff_number, employmentStatus: row.employment_status_key, date: row.duty_date, dutyCode: displayCode, dutyLabel: row.duty_label || displayCode, classification }]
    })
    return buildStaffLeaveRecords(days)
  }
  private async validateStaffConfiguration(staff: Staff, previous?: Staff) {
    const values: Array<{ group: StaffConfigGroup; value: string; prior?: string; label: string }> = [{ group: 'positions', value: staff.position, prior: previous?.position, label: 'designation' }, { group: 'employment-statuses', value: staff.employmentStatus, prior: previous?.employmentStatus, label: 'employment status' }]
    for (const item of values) {
      const result = await this.database.query<{ active: boolean }>('select active from configuration_options where group_key=$1 and value=$2', [staffConfigKeys[item.group], item.value])
      if (!result.rows[0]) throw new Error(`Select a configured ${item.label}.`)
      if (!result.rows[0].active && item.prior !== item.value) throw new Error(`Select an active ${item.label}.`)
    }
  }
  async create(staff: Staff, actor = 'Venue Manager'): Promise<Staff> {
    await this.validateStaffConfiguration(staff)
    const duplicate = await this.database.query('select id from staff where lower(staff_number)=lower($1) limit 1', [staff.number.trim()])
    if (duplicate.rows[0]) throw new Error('That Employee ID already belongs to another staff member.')
    await this.database.query('insert into staff (id,staff_number,full_name,position_key,nationality,division,department,outlet,identity_document_number,employment_status_key,join_date,resignation_date,created_by,updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)', [staff.id, staff.number.trim(), staff.name.trim(), staff.position, staff.nationality.trim(), staff.division.trim(), staff.department.trim(), staff.outlet.trim() || 'Andalucía', staff.identityDocumentNumber.trim(), staff.employmentStatus, staff.joinDate, staff.resignationDate || null, actor])
    const saved = await this.find(staff.id)
    if (!saved) throw new Error('Staff member could not be saved.')
    await this.database.query('insert into audit_logs (id,entity_type,entity_id,action,before_data,after_data,actor) values ($1,$2,$3,$4,null,$5,$6)', [randomUUID(), 'staff', staff.id, 'created', JSON.stringify(saved), actor])
    return saved
  }
  async update(id: string, staff: Staff, actor = 'Venue Manager'): Promise<Staff | null> {
    const previous = await this.find(id)
    if (!previous) return null
    await this.validateStaffConfiguration(staff, previous)
    const duplicate = await this.database.query('select id from staff where lower(staff_number)=lower($1) and id<>$2 limit 1', [staff.number.trim(), id])
    if (duplicate.rows[0]) throw new Error('That Employee ID already belongs to another staff member.')
    await this.database.query('update staff set staff_number=$2,full_name=$3,position_key=$4,nationality=$5,division=$6,department=$7,outlet=$8,identity_document_number=$9,employment_status_key=$10,join_date=$11,resignation_date=$12,updated_by=$13,updated_at=now() where id=$1', [id, staff.number.trim(), staff.name.trim(), staff.position, staff.nationality.trim(), staff.division.trim(), staff.department.trim(), staff.outlet.trim() || 'Andalucía', staff.identityDocumentNumber.trim(), staff.employmentStatus, staff.joinDate, staff.resignationDate || null, actor])
    const saved = await this.find(id)
    await this.database.query('insert into audit_logs (id,entity_type,entity_id,action,before_data,after_data,actor) values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'staff', id, previous.employmentStatus !== saved?.employmentStatus ? 'status_changed' : previous.position !== saved?.position ? 'designation_changed' : 'updated', JSON.stringify(previous), JSON.stringify(saved), actor])
    return saved
  }

  async configuration(): Promise<{ dutyCodes: ConfigOption[]; employmentStatuses: ConfigOption[]; positions: ConfigOption[] }> {
    const load = async (group: StaffConfigGroup) => {
      const result = await this.database.query<any>('select id,value,label,color,metadata,active,sort_order as "sortOrder" from configuration_options where group_key=$1 order by sort_order,label', [staffConfigKeys[group]])
      return result.rows.map((row: any) => ({ ...row, metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata })) as ConfigOption[]
    }
    return { dutyCodes: await load('duty-codes'), employmentStatuses: await load('employment-statuses'), positions: await load('positions') }
  }

  async saveConfiguration(group: StaffConfigGroup, option: ConfigOption): Promise<ConfigOption> {
    const id = option.id || randomUUID()
    const existing = await this.database.query<any>('select value,metadata,sort_order from configuration_options where id=$1 and group_key=$2', [id, staffConfigKeys[group]])
    let value = existing.rows[0]?.value || option.value
    let metadata = { ...(typeof existing.rows[0]?.metadata === 'string' ? JSON.parse(existing.rows[0].metadata) : existing.rows[0]?.metadata || {}), ...(option.metadata || {}) }
    if (group === 'duty-codes') {
      const displayCode = String(metadata.displayCode || value).trim().toUpperCase()
      const classification = metadata.dutyClassification
      if (!displayCode || !option.label.trim() || !['working', 'off', 'annualLeave', 'publicHoliday', 'sickLeave', 'other'].includes(String(classification))) throw new Error('Display code, duty name and classification are required.')
      if (!/^#[0-9a-f]{6}$/i.test(option.color || '')) throw new Error('Select a valid duty color.')
      const conflict = await this.database.query<{ id: string }>("select id from configuration_options where group_key=$1 and active and id<>$2 and lower(coalesce(nullif(metadata->>'displayCode',''),value))=lower($3) limit 1", [staffConfigKeys[group], id, displayCode])
      if (conflict.rows[0]) throw new Error('That display code is already in use.')
      const countsAsWorking = classification === 'working' ? true : classification === 'off' || classification === 'annualLeave' || classification === 'publicHoliday' || classification === 'sickLeave' ? false : Boolean(metadata.countsAsWorking)
      const billTipEligible = classification === 'annualLeave' ? false : typeof metadata.billTipEligible === 'boolean' ? metadata.billTipEligible : true
      metadata = { ...metadata, displayCode, dutyClassification: classification, countsAsWorking, billTipEligible, countsAsLeave: classification === 'annualLeave', countsAsOffDay: classification === 'off', countsAsPublicHoliday: classification === 'publicHoliday', countsAsSickLeave: classification === 'sickLeave' }
      if (!value) value = `DUTY_${randomUUID().replaceAll('-', '').toUpperCase()}`
    }
    const maximum = await this.database.query<{ value: number }>('select coalesce(max(sort_order),-1)::int value from configuration_options where group_key=$1', [staffConfigKeys[group]])
    const sortOrder = existing.rows[0]?.sort_order ?? maximum.rows[0].value + 1
    const result = await this.database.query<any>('insert into configuration_options (id,group_key,value,label,color,metadata,active,sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do update set label=excluded.label,color=excluded.color,metadata=excluded.metadata,active=excluded.active,updated_at=now() returning id,value,label,color,metadata,active,sort_order as "sortOrder"', [id, staffConfigKeys[group], value, option.label.trim(), option.color || null, JSON.stringify(metadata), option.active, sortOrder])
    const row = result.rows[0]
    return { ...row, metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata }
  }

  async correctPublicHolidaySemantics(actor: AuthPrincipal): Promise<{ changed: boolean; option: ConfigOption }> {
    return this.database.transaction(async transaction => {
      const found = await transaction.query<any>("select id,value,label,color,metadata,active,sort_order as \"sortOrder\" from configuration_options where group_key=$1 and upper(coalesce(nullif(metadata->>'displayCode',''),value))='PH' order by active desc,sort_order limit 1", [staffConfigKeys['duty-codes']])
      const row = found.rows[0]
      if (!row) throw new Error('The configured PH Duty Code was not found.')
      const beforeMetadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {}
      const metadata = { ...beforeMetadata, displayCode: 'PH', dutyClassification: 'publicHoliday', countsAsWorking: false, countsAsLeave: false, countsAsOffDay: false, countsAsPublicHoliday: true, countsAsSickLeave: false, billTipEligible: true, billTipWorkedDayUnits: 1 }
      const changed = JSON.stringify(beforeMetadata) !== JSON.stringify(metadata)
      if (changed) {
        await transaction.query('update configuration_options set metadata=$2::jsonb,updated_at=now() where id=$1', [row.id, JSON.stringify(metadata)])
        await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'configuration_option', row.id, 'public_holiday_semantics_corrected', JSON.stringify({ ...row, metadata: beforeMetadata }), JSON.stringify({ ...row, metadata }), `${actor.displayName} [${actor.userId}]`])
      }
      return { changed, option: { ...row, metadata } }
    })
  }

  async reorderDutyCode(id: string, direction: 'up' | 'down'): Promise<ConfigOption[]> {
    await this.database.transaction(async transaction => {
      const result = await transaction.query<{ id: string }>('select id from configuration_options where group_key=$1 and active order by sort_order,label', [staffConfigKeys['duty-codes']])
      const index = result.rows.findIndex(row => row.id === id)
      if (index < 0) throw new Error('Duty code not found.')
      const target = direction === 'up' ? index - 1 : index + 1
      if (target < 0 || target >= result.rows.length) return
      const ordered = [...result.rows]
      ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
      for (let sortOrder = 0; sortOrder < ordered.length; sortOrder++) await transaction.query('update configuration_options set sort_order=$2,updated_at=now() where id=$1 and group_key=$3', [ordered[sortOrder].id, sortOrder, staffConfigKeys['duty-codes']])
    })
    return (await this.configuration()).dutyCodes
  }

  async removeDutyCode(id: string): Promise<DutyCodeRemovalResult> {
    let result: DutyCodeRemovalResult = { mode: 'deleted' }
    await this.database.transaction(async transaction => {
      const found = await transaction.query<any>('select id,value,label,color,metadata,active,sort_order as "sortOrder" from configuration_options where id=$1 and group_key=$2', [id, staffConfigKeys['duty-codes']])
      const option = found.rows[0]
      if (!option) throw new Error('Duty code not found.')
      const references = await transaction.query<{ count: number }>('select ((select count(*) from duty_roster_entries where duty_code_value=$1) + (select count(*) from attendance_records where actual_duty_code=$1))::int count', [option.value])
      if (references.rows[0].count > 0) {
        const retired = await transaction.query<any>('update configuration_options set active=false,updated_at=now() where id=$1 returning id,value,label,color,metadata,active,sort_order as "sortOrder"', [id])
        const row = retired.rows[0]
        result = { mode: 'retired', option: { ...row, metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata } }
      } else {
        await transaction.query('delete from configuration_options where id=$1 and group_key=$2', [id, staffConfigKeys['duty-codes']])
      }
    })
    return result
  }

  async entitlements(): Promise<StaffEntitlement[]> {
    const result = await this.database.query<any>(`select s.id as "staffId",s.staff_number as "staffNumber",s.full_name as "staffName",s.employment_status_key as "employmentStatus",coalesce(e.annual_leave_per_year,30)::int as "annualLeavePerYear",coalesce(e.weekly_off_entitlement,1)::int as "weeklyOffEntitlement",coalesce(e.public_holiday_per_year,11)::int as "publicHolidayPerYear",(e.staff_id is not null) as persisted,e.created_by as "createdBy",e.updated_by as "updatedBy",e.created_at::text as "createdAt",e.updated_at::text as "updatedAt" from staff s left join staff_entitlements e on e.staff_id=s.id order by s.employment_status_key='active' desc,s.full_name`)
    return result.rows
  }

  async saveEntitlement(input: Pick<StaffEntitlement, 'staffId' | 'annualLeavePerYear' | 'weeklyOffEntitlement' | 'publicHolidayPerYear'>): Promise<StaffEntitlement> {
    const values = [input.annualLeavePerYear, input.weeklyOffEntitlement, input.publicHolidayPerYear]
    if (values.some(value => !Number.isInteger(value) || value < 0)) throw new Error('Entitlement values must be whole numbers of zero or more.')
    const staff = await this.find(input.staffId)
    if (!staff) throw new Error('Staff member not found.')
    await this.database.query(`insert into staff_entitlements(staff_id,annual_leave_per_year,weekly_off_entitlement,public_holiday_per_year,created_by,updated_by) values($1,$2,$3,$4,'Venue Manager','Venue Manager') on conflict(staff_id) do update set annual_leave_per_year=excluded.annual_leave_per_year,weekly_off_entitlement=excluded.weekly_off_entitlement,public_holiday_per_year=excluded.public_holiday_per_year,updated_by='Venue Manager',updated_at=now()`, [input.staffId, input.annualLeavePerYear, input.weeklyOffEntitlement, input.publicHolidayPerYear])
    return (await this.entitlements()).find(item => item.staffId === input.staffId)!
  }

  async entitlementBalance(staffId: string, year: number, weekStart: string, weekEnd: string) {
    if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new Error('Select a valid entitlement year.')
    const allowance = await this.database.query<{ annualLeave: number; weeklyOff: number; publicHoliday: number }>(`select coalesce(e.annual_leave_per_year,30)::int as "annualLeave",coalesce(e.weekly_off_entitlement,1)::int as "weeklyOff",coalesce(e.public_holiday_per_year,11)::int as "publicHoliday" from staff s left join staff_entitlements e on e.staff_id=s.id where s.id=$1`, [staffId])
    if (!allowance.rows[0]) throw new Error('Staff member not found.')
    const annualStart = `${year}-01-01`
    const annualEnd = `${year + 1}-01-01`
    const annualUsage = await this.database.query<{ annualLeaveUsed: number; publicHolidayUsed: number }>(`select count(*) filter(where c.metadata->>'dutyClassification'='annualLeave')::int as "annualLeaveUsed",count(*) filter(where c.metadata->>'dutyClassification'='publicHoliday')::int as "publicHolidayUsed" from duty_roster_entries r join configuration_options c on c.group_key=$2 and c.value=r.duty_code_value where r.staff_id=$1 and r.duty_date >= $3 and r.duty_date < $4`, [staffId, staffConfigKeys['duty-codes'], annualStart, annualEnd])
    const weeklyUsage = await this.database.query<{ assigned: number }>(`select count(*)::int as assigned from duty_roster_entries r join configuration_options c on c.group_key=$2 and c.value=r.duty_code_value where r.staff_id=$1 and r.duty_date between $3 and $4 and c.metadata->>'dutyClassification'='off'`, [staffId, staffConfigKeys['duty-codes'], weekStart, weekEnd])
    const annualLeaveUsed = annualUsage.rows[0].annualLeaveUsed
    const publicHolidayUsed = annualUsage.rows[0].publicHolidayUsed
    const assigned = weeklyUsage.rows[0].assigned
    const difference = assigned - allowance.rows[0].weeklyOff
    return { staffId, year, annualLeave: { entitlement: allowance.rows[0].annualLeave, used: annualLeaveUsed, remaining: allowance.rows[0].annualLeave - annualLeaveUsed }, publicHoliday: { entitlement: allowance.rows[0].publicHoliday, used: publicHolidayUsed, remaining: allowance.rows[0].publicHoliday - publicHolidayUsed }, weeklyOff: { weekStart, weekEnd, required: allowance.rows[0].weeklyOff, assigned, difference, status: difference < 0 ? 'short' as const : difference > 0 ? 'additional' as const : 'compliant' as const } }
  }

  async publicHolidays(year: number): Promise<PublicHoliday[]> {
    if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new Error('Select a valid holiday year.')
    const result = await this.database.query<any>(`select id,holiday_name as name,holiday_date::text as date,days::int,active,created_by as "createdBy",updated_by as "updatedBy",created_at::text as "createdAt",updated_at::text as "updatedAt" from public_holidays where extract(year from holiday_date)=$1 order by holiday_date,holiday_name`, [year])
    return result.rows
  }

  async savePublicHoliday(holiday: PublicHoliday): Promise<PublicHoliday> {
    const date = holiday.date?.trim()
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
    if (!holiday.name?.trim() || !validDate || !Number.isInteger(holiday.days) || holiday.days < 1) throw new Error('Holiday name, valid date and whole days of one or more are required.')
    const result = await this.database.query<any>(`insert into public_holidays(id,holiday_name,holiday_date,days,active,created_by,updated_by) values($1,$2,$3,$4,$5,'Venue Manager','Venue Manager') on conflict(id) do update set holiday_name=excluded.holiday_name,holiday_date=excluded.holiday_date,days=excluded.days,active=excluded.active,updated_by='Venue Manager',updated_at=now() returning id,holiday_name as name,holiday_date::text as date,days::int,active,created_by as "createdBy",updated_by as "updatedBy",created_at::text as "createdAt",updated_at::text as "updatedAt"`, [holiday.id || randomUUID(), holiday.name.trim(), date, holiday.days, holiday.active])
    return result.rows[0]
  }

  async removePublicHoliday(id: string): Promise<void> {
    const result = await this.database.query('delete from public_holidays where id=$1 returning id', [id])
    if (!result.rows[0]) throw new Error('Public holiday not found.')
  }

  private async preserveReferencedConfiguration() {
    const referenced: Array<{ group: StaffConfigGroup; sql: string }> = [
      { group: 'positions', sql: 'select distinct position_key value from staff' },
      { group: 'employment-statuses', sql: 'select distinct employment_status_key value from staff' },
      { group: 'duty-codes', sql: 'select distinct duty_code_value value from duty_roster_entries union select distinct actual_duty_code value from attendance_records where actual_duty_code is not null' }
    ]
    for (const item of referenced) {
      const values = await this.database.query<{ value: string }>(item.sql)
      for (const row of values.rows) await this.database.query('insert into configuration_options (id,group_key,value,label,metadata,active,sort_order) values ($1,$2,$3,$3,$4,false,999) on conflict (group_key,value) do nothing', [randomUUID(), staffConfigKeys[item.group], row.value, '{}'])
    }
  }
}
