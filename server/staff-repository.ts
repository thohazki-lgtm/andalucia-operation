import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { CORE_DUTY_CODES, EMPLOYEE_OVERRIDE_LEAVE_CLASSIFICATIONS, LEAVE_CLASSIFICATIONS, YEARLY_ENTITLEMENT_LEAVE_CLASSIFICATIONS, config, coreDutyCode, isLeaveClassification, leaveClassificationForCode, type AnnualLeaveCarryForwardDraft, type AnnualLeaveCarryForwardPreview, type AnnualLeaveCarryForwardWrite, type AnnualLeaveServiceYearBalance, type AuthPrincipal, type ConfigOption, type EmployeeOverrideLeaveClassification, type EntitlementPolicy, type LeaveClassification, type PublicHoliday, type Staff, type StaffEntitlement, type StaffEntitlementReconciliation, type StaffEntitlementUpdate, type StaffLeaveDay, type StaffLeaveRecord, type StaffYearlyEntitlementBalance, type StaffYearlyEntitlementDraft, type StaffYearlyEntitlementPreview, type StaffYearlyEntitlementRecord, type StaffYearlyEntitlementWrite, type YearlyEntitlementLeaveClassification } from '../src/domain.js'
import { buildStaffLeaveRecords } from '../src/leave-records.js'
import { serviceDate, weekRange } from '../src/service-date.js'
import { calculateRenewingAnnualBalance } from './yearly-leave-entitlement-calculator.js'
import { ANNUAL_LEAVE_ZERO_CARRY_BASELINE_DATE, calculateServiceYearAnnualLeavePosition, serviceYearPeriodFor, type AnnualLeaveServiceYearEvidence } from './service-year-annual-leave-calculator.js'
import { approvedDutyFinancialRule } from '../src/duty-financial-policy.js'

type StaffRow = { id: string; staff_number: string; full_name: string; position_key: string; nationality: string; division: string; department: string; outlet: string; identity_document_number: string; employment_status_key: string; assignment_eligible: boolean; service_assignment_eligible: boolean; join_date: string; resignation_date: string | null; created_at: string; updated_at: string; created_by: string | null; updated_by: string | null }
export type StaffConfigGroup = 'duty-codes' | 'employment-statuses' | 'positions'
export type DutyCodeRemovalResult = { mode: 'deleted' | 'retired'; option?: ConfigOption }
const staffConfigKeys: Record<StaffConfigGroup, string> = { 'duty-codes': 'duty_codes', 'employment-statuses': 'employment_statuses', positions: 'staff_positions' }
const automaticallyConfiguredDutyCodes = new Set(['ON', 'AL', 'SL', 'OFF', 'PH'])
const staffConfigSeeds: Record<StaffConfigGroup, ConfigOption[]> = {
  'duty-codes': config.dutyCodes.filter(option => automaticallyConfiguredDutyCodes.has(String(option.metadata?.displayCode || option.value).trim().toUpperCase())),
  'employment-statuses': config.employmentStatuses,
  positions: config.positions
}
const entitlementPolicyGroup = 'leave_entitlement_policies'
const staffDisplayOrderGroup = 'staff_display_order'
const staffDisplayOrderValue = 'shared'
const entitlementFallbacks: Record<'annualLeave' | 'off' | 'publicHoliday', { allowance: number; cadence: 'annual' | 'weekly' }> = { annualLeave: { allowance: 30, cadence: 'annual' }, off: { allowance: 1, cadence: 'weekly' }, publicHoliday: { allowance: 11, cadence: 'annual' } }
const approvedEntitlementPolicyDefaults: Record<LeaveClassification, { allowance: number; cadence: 'annual' | 'weekly' }> = {
  annualLeave: { allowance: 30, cadence: 'annual' },
  sickLeave: { allowance: 30, cadence: 'annual' },
  emergencyLeave: { allowance: 10, cadence: 'annual' },
  paternityLeave: { allowance: 3, cadence: 'annual' },
  businessTrip: { allowance: 360, cadence: 'annual' },
  circumcisionLeave: { allowance: 5, cadence: 'annual' },
  hajjLeave: { allowance: 45, cadence: 'annual' },
  restAndRecuperation: { allowance: 6, cadence: 'annual' },
  off: { allowance: 1, cadence: 'weekly' },
  publicHoliday: { allowance: 11, cadence: 'annual' },
}
const normalizedDutyCode = (option: ConfigOption): ConfigOption => {
  const displayCode = String(option.metadata?.displayCode || option.value).trim().toUpperCase()
  const standard = coreDutyCode(displayCode)
  if (standard) return { ...option, label: standard.label, active: true, metadata: { ...option.metadata, displayCode: standard.code, dutyClassification: standard.classification, countsAsWorking: false, protected: true, systemControlled: true } }
  if (displayCode === 'SK') return { ...option, metadata: { ...option.metadata, displayCode: 'SK', dutyClassification: 'sickLeave', countsAsWorking: false, countsAsSickLeave: true, protected: true, legacyCompatibility: true } }
  return option
}

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

  constructor(private readonly dataDirectory: string, database: PGlite) { this.database = database }

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
        if (group === 'duty-codes') {
          const displayCode = String(option.metadata?.displayCode || option.value).trim().toUpperCase()
          const matchingDisplayCode = await this.database.query<{ id: string }>("select id from configuration_options where group_key=$1 and upper(coalesce(nullif(metadata->>'displayCode',''),value))=$2 limit 1", [staffConfigKeys[group], displayCode])
          if (matchingDisplayCode.rows[0]) continue
        }
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
    this.initialized = true
  }

  getDatabase() { return this.database }
  async close() { await this.database.close() }

  async list(): Promise<Staff[]> {
    const result = await this.database.query<StaffRow>(`${staffSelect} order by assignment_eligible desc,s.full_name,s.staff_number`)
    const staff = result.rows.map(mapStaff)
    const saved = (await this.database.query<{ metadata: unknown }>('select metadata from configuration_options where group_key=$1 and value=$2 and active=true', [staffDisplayOrderGroup, staffDisplayOrderValue])).rows[0]
    const metadata = typeof saved?.metadata === 'string' ? JSON.parse(saved.metadata) : saved?.metadata as { orderedIds?: unknown } | undefined
    const orderedIds: string[] = Array.isArray(metadata?.orderedIds) ? metadata.orderedIds.filter((id: unknown): id is string => typeof id === 'string') : []
    const rank = new Map(orderedIds.map((id, index) => [id, index]))
    return staff.sort((left, right) => (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER))
  }
  async reorderStaff(orderedIds: string[], actor = 'Venue Manager'): Promise<Staff[]> {
    const unique = new Set(orderedIds)
    const currentIds = (await this.database.query<{ id: string }>('select id from staff')).rows.map(row => row.id)
    if (orderedIds.length !== currentIds.length || unique.size !== currentIds.length || currentIds.some(id => !unique.has(id))) throw new Error('Staff order must include every current staff member exactly once.')
    await this.database.transaction(async transaction => {
      const existing = (await transaction.query<any>('select id,metadata from configuration_options where group_key=$1 and value=$2 for update', [staffDisplayOrderGroup, staffDisplayOrderValue])).rows[0]
      const id = existing?.id || randomUUID()
      const before = existing?.metadata || null
      const after = { orderedIds }
      await transaction.query("insert into configuration_options(id,group_key,value,label,metadata,active,sort_order) values($1,$2,$3,'Shared Staff Display Order',$4,true,0) on conflict(group_key,value) do update set metadata=excluded.metadata,active=true,updated_at=now()", [id, staffDisplayOrderGroup, staffDisplayOrderValue, JSON.stringify(after)])
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'staff_display_order', id, 'reordered', before ? JSON.stringify(before) : null, JSON.stringify(after), actor])
    })
    return this.list()
  }
  async find(id: string): Promise<Staff | null> { const result = await this.database.query<StaffRow>(`${staffSelect} where s.id=$1`, [id]); return result.rows[0] ? mapStaff(result.rows[0]) : null }
  async leaveRecords(start: string, end: string, staffId?: string): Promise<StaffLeaveRecord[]> {
    const result = await this.database.query<any>(`select s.id staff_id,s.full_name,s.staff_number,s.employment_status_key,r.duty_date::text duty_date,r.duty_code_value,c.label duty_label,c.metadata from duty_roster_entries r join staff s on s.id=r.staff_id left join configuration_options c on c.group_key=$3 and c.value=r.duty_code_value where r.duty_date between $1 and $2 and ($4::uuid is null or s.id=$4::uuid) order by s.id,r.duty_date`, [start, end, staffConfigKeys['duty-codes'], staffId || null])
    const days = result.rows.flatMap((row: any): StaffLeaveDay[] => {
      const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {}
      const displayCode = String(metadata.displayCode || row.duty_code_value).toUpperCase()
      const classification = (metadata.countsAsLeave ? 'annualLeave' : metadata.countsAsOffDay ? 'off' : metadata.countsAsPublicHoliday ? 'publicHoliday' : metadata.countsAsSickLeave ? 'sickLeave' : isLeaveClassification(metadata.dutyClassification) ? metadata.dutyClassification : leaveClassificationForCode(displayCode)) as LeaveClassification | undefined
      if (!classification) return []
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
      const options = result.rows.map((row: any) => ({ ...row, metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata })) as ConfigOption[]
      return group === 'duty-codes' ? options.map(normalizedDutyCode) : options
    }
    return { dutyCodes: await load('duty-codes'), employmentStatuses: await load('employment-statuses'), positions: await load('positions') }
  }

  async saveConfiguration(group: StaffConfigGroup, option: ConfigOption, actor = 'Configuration manager'): Promise<ConfigOption> {
    const id = option.id || randomUUID()
    const existing = await this.database.query<any>('select value,label,metadata,active,sort_order from configuration_options where id=$1 and group_key=$2', [id, staffConfigKeys[group]])
    let value = existing.rows[0]?.value || option.value
    let metadata = { ...(typeof existing.rows[0]?.metadata === 'string' ? JSON.parse(existing.rows[0].metadata) : existing.rows[0]?.metadata || {}), ...(option.metadata || {}) }
    if (group === 'duty-codes') {
      const displayCode = String(metadata.displayCode || value).trim().toUpperCase()
      let classification = metadata.dutyClassification
      const existingDisplayCode = String((typeof existing.rows[0]?.metadata === 'string' ? JSON.parse(existing.rows[0].metadata) : existing.rows[0]?.metadata || {}).displayCode || existing.rows[0]?.value || '').trim().toUpperCase()
      const existingStandard = coreDutyCode(existingDisplayCode)
      if (existingStandard) {
        if (displayCode !== existingStandard.code || option.label.trim() !== existingStandard.label || classification !== existingStandard.classification || !option.active) throw new Error(`${existingStandard.code} · ${existingStandard.label} is a protected core Duty Code. Only its color and display order can be changed.`)
        classification = existingStandard.classification
        metadata = { ...metadata, displayCode: existingStandard.code, dutyClassification: classification, countsAsWorking: false, protected: true, systemControlled: true }
      } else if (existingDisplayCode === 'SK') {
        if (displayCode !== 'SK' || classification !== 'sickLeave' || !option.active) throw new Error('SK is protected as the historical Sick Leave compatibility code. Use SL for new assignments.')
        metadata = { ...metadata, displayCode: 'SK', dutyClassification: 'sickLeave', countsAsWorking: false, countsAsSickLeave: true, protected: true, legacyCompatibility: true }
      } else if (coreDutyCode(displayCode)) {
        const approvedCore = coreDutyCode(displayCode)!
        throw new Error(`${approvedCore.code} · ${approvedCore.label} is a protected core Duty Code. Use Activate Duty Code in Leave & Entitlements when it is unavailable.`)
      } else if (displayCode === 'SK') throw new Error('SK is reserved for historical Sick Leave compatibility. Use SL for new assignments.')
      if (!displayCode || !option.label.trim() || !(['working', 'other', ...LEAVE_CLASSIFICATIONS] as string[]).includes(String(classification))) throw new Error('Display code, duty name and classification are required.')
      if (!/^#[0-9a-f]{6}$/i.test(option.color || '')) throw new Error('Select a valid duty color.')
      const conflict = await this.database.query<{ id: string }>("select id from configuration_options where group_key=$1 and active and id<>$2 and lower(coalesce(nullif(metadata->>'displayCode',''),value))=lower($3) limit 1", [staffConfigKeys[group], id, displayCode])
      if (conflict.rows[0]) throw new Error('That display code is already in use.')
      const countsAsWorking = classification === 'working' ? true : isLeaveClassification(classification) ? false : Boolean(metadata.countsAsWorking)
      metadata = { ...metadata, displayCode, dutyClassification: classification, countsAsWorking, countsAsLeave: classification === 'annualLeave', countsAsOffDay: classification === 'off', countsAsPublicHoliday: classification === 'publicHoliday', countsAsSickLeave: classification === 'sickLeave' }
      const approvedFinancialRule = approvedDutyFinancialRule({ value, label: option.label.trim(), metadata })
      if (approvedFinancialRule) {
        metadata = { ...metadata, billTipEligible: approvedFinancialRule.billTipEligible, billTipWorkedDayUnits: approvedFinancialRule.workedDayUnits }
      } else {
        if (typeof metadata.billTipEligible !== 'boolean') throw new Error(`Choose whether ${displayCode} · ${option.label.trim()} is eligible for Bill Tips.`)
        if (metadata.billTipEligible === false) metadata = { ...metadata, billTipWorkedDayUnits: 0 }
        else if (metadata.billTipWorkedDayUnits !== 0 && metadata.billTipWorkedDayUnits !== 1) throw new Error(`Choose whether ${displayCode} · ${option.label.trim()} receives zero or one worked-day credit.`)
      }
      if (!value) value = `DUTY_${randomUUID().replaceAll('-', '').toUpperCase()}`
    }
    const maximum = await this.database.query<{ value: number }>('select coalesce(max(sort_order),-1)::int value from configuration_options where group_key=$1', [staffConfigKeys[group]])
    const sortOrder = existing.rows[0]?.sort_order ?? maximum.rows[0].value + 1
    const result = await this.database.query<any>('insert into configuration_options (id,group_key,value,label,color,metadata,active,sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do update set label=excluded.label,color=excluded.color,metadata=excluded.metadata,active=excluded.active,updated_at=now() returning id,value,label,color,metadata,active,sort_order as "sortOrder"', [id, staffConfigKeys[group], value, option.label.trim(), option.color || null, JSON.stringify(metadata), option.active, sortOrder])
    const row = result.rows[0]
    const saved = { ...row, metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata } as ConfigOption
    await this.database.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'configuration_option', id, existing.rows[0] ? 'configuration_updated' : 'configuration_created', existing.rows[0] ? JSON.stringify(existing.rows[0]) : null, JSON.stringify({ group, ...saved }), actor])
    return saved
  }

  async activateProtectedDutyCode(code: string, actor = 'Venue Manager'): Promise<ConfigOption> {
    const definition = coreDutyCode(code)
    if (!definition) throw new Error('Select an approved protected Duty Code to activate.')
    return this.database.transaction(async transaction => {
      const matches = await transaction.query<any>("select id,value,label,color,metadata,active,sort_order as \"sortOrder\" from configuration_options where group_key=$1 and upper(coalesce(nullif(metadata->>'displayCode',''),value))=$2 order by active desc,sort_order", [staffConfigKeys['duty-codes'], definition.code])
      if (matches.rows.length > 1) throw new Error(`${definition.code} has multiple stored configurations. Activation was stopped to protect existing records.`)
      const existing = matches.rows[0]
      if (existing?.active) throw new Error(`${definition.code} · ${definition.label} is already configured and active.`)
      const beforeMetadata = typeof existing?.metadata === 'string' ? JSON.parse(existing.metadata) : existing?.metadata || {}
      let metadata = {
        ...beforeMetadata,
        displayCode: definition.code,
        dutyClassification: definition.classification,
        countsAsWorking: false,
        countsAsLeave: definition.classification === 'annualLeave',
        countsAsOffDay: definition.classification === 'off',
        countsAsPublicHoliday: definition.classification === 'publicHoliday',
        countsAsSickLeave: definition.classification === 'sickLeave',
        protected: true,
        systemControlled: true
      }
      const approvedFinancialRule = approvedDutyFinancialRule({ value: existing?.value || definition.code, label: definition.label, metadata })
      if (approvedFinancialRule) metadata = { ...metadata, billTipEligible: approvedFinancialRule.billTipEligible, billTipWorkedDayUnits: approvedFinancialRule.workedDayUnits }
      const maximum = await transaction.query<{ value: number }>('select coalesce(max(sort_order),-1)::int value from configuration_options where group_key=$1', [staffConfigKeys['duty-codes']])
      const id = existing?.id || randomUUID()
      const value = existing?.value || definition.code
      const color = existing?.color || definition.color
      const sortOrder = existing?.sortOrder ?? maximum.rows[0].value + 1
      const result = await transaction.query<any>('insert into configuration_options (id,group_key,value,label,color,metadata,active,sort_order) values ($1,$2,$3,$4,$5,$6,true,$7) on conflict (id) do update set label=excluded.label,color=coalesce(configuration_options.color,excluded.color),metadata=excluded.metadata,active=true,updated_at=now() returning id,value,label,color,metadata,active,sort_order as "sortOrder"', [id, staffConfigKeys['duty-codes'], value, definition.label, color, JSON.stringify(metadata), sortOrder])
      const row = result.rows[0]
      const saved = { ...row, metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata } as ConfigOption
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'configuration_option', id, 'protected_duty_code_activated', existing ? JSON.stringify({ ...existing, metadata: beforeMetadata }) : null, JSON.stringify(saved), actor])
      return saved
    })
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

  async reorderDutyCode(id: string, direction: 'up' | 'down', actor = 'Configuration manager'): Promise<ConfigOption[]> {
    const current = (await this.configuration()).dutyCodes.filter(option => option.active)
    const index = current.findIndex(option => option.id === id)
    if (index < 0) throw new Error('Duty code not found.')
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= current.length) return (await this.configuration()).dutyCodes
    const ordered = [...current]
    ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
    return this.reorderDutyCodes(ordered.map(option => option.id), actor)
  }

  async reorderDutyCodes(orderedIds: string[], actor = 'Configuration manager'): Promise<ConfigOption[]> {
    await this.database.transaction(async transaction => {
      const result = await transaction.query<{ id: string }>('select id from configuration_options where group_key=$1 and active order by sort_order,label', [staffConfigKeys['duty-codes']])
      const activeIds = result.rows.map(row => row.id)
      if (orderedIds.length !== activeIds.length || new Set(orderedIds).size !== orderedIds.length || orderedIds.some(id => !activeIds.includes(id))) throw new Error('Duty Code order no longer matches the active configuration. Refresh and try again.')
      for (let sortOrder = 0; sortOrder < orderedIds.length; sortOrder++) await transaction.query('update configuration_options set sort_order=$2,updated_at=now() where id=$1 and group_key=$3 and active', [orderedIds[sortOrder], sortOrder, staffConfigKeys['duty-codes']])
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'configuration_option', orderedIds[0], 'duty_codes_reordered', JSON.stringify({ orderedIds: activeIds }), JSON.stringify({ orderedIds }), actor])
    })
    return (await this.configuration()).dutyCodes
  }

  async removeDutyCode(id: string, actor = 'Configuration manager'): Promise<DutyCodeRemovalResult> {
    let result: DutyCodeRemovalResult = { mode: 'deleted' }
    await this.database.transaction(async transaction => {
      const found = await transaction.query<any>('select id,value,label,color,metadata,active,sort_order as "sortOrder" from configuration_options where id=$1 and group_key=$2', [id, staffConfigKeys['duty-codes']])
      const option = found.rows[0]
      if (!option) throw new Error('Duty code not found.')
      const metadata = typeof option.metadata === 'string' ? JSON.parse(option.metadata) : option.metadata || {}
      const displayCode = String(metadata.displayCode || option.value).trim().toUpperCase()
      if (coreDutyCode(displayCode)) throw new Error(`${displayCode} is a protected core Duty Code and cannot be removed.`)
      if (displayCode === 'SK') throw new Error('SK is retained for historical Sick Leave compatibility and cannot be removed.')
      const references = await transaction.query<{ count: number }>('select ((select count(*) from duty_roster_entries where duty_code_value=$1) + (select count(*) from attendance_records where actual_duty_code=$1))::int count', [option.value])
      if (references.rows[0].count > 0) {
        const retired = await transaction.query<any>('update configuration_options set active=false,updated_at=now() where id=$1 returning id,value,label,color,metadata,active,sort_order as "sortOrder"', [id])
        const row = retired.rows[0]
        result = { mode: 'retired', option: { ...row, metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata } }
      } else {
        await transaction.query('delete from configuration_options where id=$1 and group_key=$2', [id, staffConfigKeys['duty-codes']])
      }
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'configuration_option', id, result.mode === 'retired' ? 'duty_code_retired' : 'duty_code_deleted', JSON.stringify({ ...option, metadata }), result.option ? JSON.stringify(result.option) : null, actor])
    })
    return result
  }

  async entitlementPolicies(): Promise<EntitlementPolicy[]> {
    const result = await this.database.query<any>('select id,value,label,metadata,updated_at::text as "updatedAt" from configuration_options where group_key=$1', [entitlementPolicyGroup])
    const stored = new Map(result.rows.map((row: any) => [row.value, { ...row, metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {} }]))
    return CORE_DUTY_CODES.map(definition => {
      const current: any = stored.get(definition.classification)
      const approved = approvedEntitlementPolicyDefaults[definition.classification]
      const fallback = entitlementFallbacks[definition.classification as keyof typeof entitlementFallbacks]
      return { id: current?.id || null, code: definition.code, label: definition.label, classification: definition.classification, cadence: approved.cadence, defaultAllowance: current ? Number(current.metadata.defaultAllowance) : fallback?.allowance ?? null, approvedAllowance: approved.allowance, configurable: true, persisted: Boolean(current), activationRequired: !current && !fallback, updatedAt: current?.updatedAt, updatedBy: current?.updatedBy }
    })
  }

  async saveEntitlementPolicy(input: EntitlementPolicy, actor = 'Venue Manager'): Promise<EntitlementPolicy> {
    const definition = CORE_DUTY_CODES.find(item => item.classification === input.classification)
    const approved = approvedEntitlementPolicyDefaults[input.classification]
    if (!definition || !approved) throw new Error('This protected leave type has no approved allowance calculation. No HR entitlement value was changed.')
    if (!Number.isInteger(input.defaultAllowance) || Number(input.defaultAllowance) < 0) throw new Error('Default entitlement allowance must be a whole number of zero or more.')
    await this.database.transaction(async transaction => {
      const before = (await transaction.query<any>('select id,value,label,metadata,active,sort_order from configuration_options where group_key=$1 and value=$2', [entitlementPolicyGroup, input.classification])).rows[0] || null
      const id = before?.id || randomUUID()
      const metadata = { displayCode: definition.code, dutyClassification: definition.classification, defaultAllowance: Number(input.defaultAllowance), cadence: approved.cadence, protected: true, systemControlled: true }
      await transaction.query('insert into configuration_options(id,group_key,value,label,metadata,active,sort_order) values($1,$2,$3,$4,$5,true,$6) on conflict(group_key,value) do update set label=excluded.label,metadata=excluded.metadata,active=true,updated_at=now()', [id, entitlementPolicyGroup, definition.classification, definition.label, JSON.stringify(metadata), CORE_DUTY_CODES.findIndex(item => item.classification === definition.classification)])
      const after = (await transaction.query<any>('select id,value,label,metadata,active,sort_order from configuration_options where group_key=$1 and value=$2', [entitlementPolicyGroup, input.classification])).rows[0]
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'leave_entitlement_policy', id, before ? 'updated' : 'created', before ? JSON.stringify(before) : null, JSON.stringify(after), actor])
    })
    return (await this.entitlementPolicies()).find(policy => policy.classification === input.classification)!
  }

  private async entitlementPolicyDefaults() {
    const policies = await this.entitlementPolicies()
    const allowance = (classification: 'annualLeave' | 'off' | 'publicHoliday') => policies.find(policy => policy.classification === classification)?.defaultAllowance ?? entitlementFallbacks[classification].allowance
    return { annualLeave: allowance('annualLeave'), weeklyOff: allowance('off'), publicHoliday: allowance('publicHoliday') }
  }

  private async employeeLeaveOverrideTableAvailable() {
    return (await this.database.query<{ exists: boolean }>("select exists(select 1 from information_schema.tables where table_schema='public' and table_name='staff_leave_entitlement_overrides') exists")).rows[0].exists
  }

  private async yearlyEntitlementTableAvailable() {
    return (await this.database.query<{ exists: boolean }>("select exists(select 1 from information_schema.tables where table_schema='public' and table_name='staff_leave_entitlement_years') exists")).rows[0].exists
  }

  private async serviceYearEntitlementTableAvailable() {
    return (await this.database.query<{ exists: boolean }>("select exists(select 1 from information_schema.tables where table_schema='public' and table_name='staff_annual_leave_service_years') exists")).rows[0].exists
  }

  private async bookedFutureAnnualLeaveRange(staffId: string, startDate: string, endDate: string) {
    const today = serviceDate()
    const planned = await this.database.query<{ startDate: string; endDate: string }>(`select start_date::text as "startDate",end_date::text as "endDate" from planned_leave_periods where staff_id=$1 and leave_type='annual_leave' and planning_state='booked' and start_date<=$3 and end_date>=$2`, [staffId, startDate, endDate])
    const confirmed = await this.database.query<{ date: string }>(`select r.duty_date::text as date from duty_roster_entries r join configuration_options c on c.group_key=$2 and c.value=r.duty_code_value where r.staff_id=$1 and r.duty_date between $3 and $4 and c.metadata->>'dutyClassification'='annualLeave'`, [staffId, staffConfigKeys['duty-codes'], startDate, endDate])
    const confirmedDates = new Set(confirmed.rows.map(row => row.date))
    const dates = new Set<string>()
    for (const period of planned.rows) {
      const first = period.startDate < startDate ? startDate : period.startDate
      const last = period.endDate > endDate ? endDate : period.endDate
      for (let cursor = new Date(`${first}T00:00:00Z`); cursor <= new Date(`${last}T00:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        const date = cursor.toISOString().slice(0, 10)
        if (date >= today && !confirmedDates.has(date)) dates.add(date)
      }
    }
    return dates.size
  }

  private async annualLeaveServiceYearEvidence(staffId: string) {
    const rows = await this.database.query<any>(`select service_year_start::text as "serviceYearStart",service_year_end::text as "serviceYearEnd",available_from::text as "availableFrom",entitled_units::text as "entitledUnits",accrual_units_per_completed_month::text as "accrualUnitsPerCompletedMonth",approved_opening_carry_units::text as "approvedOpeningCarryUnits",opening_carry_effective_date::text as "openingCarryEffectiveDate",opening_carry_reason as "openingCarryReason" from staff_annual_leave_service_years where staff_id=$1 order by service_year_start`, [staffId])
    return rows.rows.map((row: any) => ({ serviceYearStart: row.serviceYearStart, serviceYearEnd: row.serviceYearEnd, availableFrom: row.availableFrom, entitledUnits: Number(row.entitledUnits), accrualUnitsPerCompletedMonth: Number(row.accrualUnitsPerCompletedMonth), approvedOpeningCarryUnits: row.approvedOpeningCarryUnits == null ? null : Number(row.approvedOpeningCarryUnits), openingCarryEffectiveDate: row.openingCarryEffectiveDate || null, openingCarryReason: row.openingCarryReason || null })) as Array<AnnualLeaveServiceYearEvidence & { openingCarryReason: string | null }>
  }

  private async annualLeaveServiceYearBalanceFromEvidence(staff: Staff, evidence: Array<AnnualLeaveServiceYearEvidence & { openingCarryReason?: string | null }>, asOf: string): Promise<AnnualLeaveServiceYearBalance> {
    const provisional = calculateServiceYearAnnualLeavePosition({ joinDate: staff.joinDate, asOf, serviceYears: evidence, confirmedAnnualLeaveDates: [] })
    const usage = await this.database.query<{ date: string }>(`select distinct r.duty_date::text as date from duty_roster_entries r join configuration_options c on c.group_key=$2 and c.value=r.duty_code_value where r.staff_id=$1 and r.duty_date between $3 and $4 and c.metadata->>'dutyClassification'='annualLeave' order by date`, [staff.id, staffConfigKeys['duty-codes'], staff.joinDate, provisional.period.end])
    const position = calculateServiceYearAnnualLeavePosition({ joinDate: staff.joinDate, asOf, serviceYears: evidence, confirmedAnnualLeaveDates: usage.rows.map(row => row.date) })
    const bookedFuture = await this.bookedFutureAnnualLeaveRange(staff.id, position.period.start, position.period.end)
    const latestOpening = evidence.filter(row => row.openingCarryEffectiveDate && row.openingCarryEffectiveDate >= ANNUAL_LEAVE_ZERO_CARRY_BASELINE_DATE && row.openingCarryEffectiveDate <= asOf).at(-1)
    const decimal = (value: number) => Number(value.toFixed(4))
    return {
      serviceYearNumber: position.period.serviceYearNumber, serviceYearStart: position.period.start, serviceYearEnd: position.period.end,
      nextEntitlementAvailabilityDate: position.period.availableFrom, availableLeave: position.availableBalance === null ? null : position.knownAvailableEntitlement,
      knownAvailableLeave: position.knownAvailableEntitlement, used: position.confirmedUsed, remaining: position.availableBalance,
      accruingForNextServiceYear: position.accruingForNextServiceYear, completedServiceMonths: position.completedServiceMonths,
      bookedFuture, availableAfterBooked: position.availableBalance === null ? null : decimal(position.availableBalance - bookedFuture),
      evidenceStatus: position.evidenceStatus, approvedOpeningCarry: latestOpening?.approvedOpeningCarryUnits == null ? null : Number(latestOpening.approvedOpeningCarryUnits),
      openingCarryReason: latestOpening?.openingCarryReason || null, preAvailabilityUsageDates: position.preAvailabilityUsageDates,
    }
  }

  async annualLeaveServiceYearBalance(staffId: string, asOf = serviceDate()): Promise<AnnualLeaveServiceYearBalance | null> {
    if (!(await this.serviceYearEntitlementTableAvailable())) return null
    const staff = await this.find(staffId)
    if (!staff) throw new Error('Staff member not found.')
    return this.annualLeaveServiceYearBalanceFromEvidence(staff, await this.annualLeaveServiceYearEvidence(staffId), asOf)
  }

  private async validatedAnnualLeaveCarryForward(input: AnnualLeaveCarryForwardDraft) {
    if (!(await this.serviceYearEntitlementTableAvailable())) throw new Error('Annual Leave Carry Forward requires database schema 022.')
    const staff = await this.find(input.staffId)
    if (!staff) throw new Error('Staff member not found.')
    let effectivePeriod
    try { effectivePeriod = serviceYearPeriodFor(staff.joinDate, serviceDate()) } catch { throw new Error('A valid Staff Management Date of Joining is required before Carry Forward can be configured.') }
    if (effectivePeriod.serviceYearNumber <= 1) throw new Error('Carry Forward is available only after the first completed service year.')
    const effectiveDate = effectivePeriod.start
    const previousDay = new Date(`${effectiveDate}T00:00:00Z`); previousDay.setUTCDate(previousDay.getUTCDate() - 1)
    const evidencePeriod = serviceYearPeriodFor(staff.joinDate, previousDay.toISOString().slice(0, 10))
    const carryForward = Number(input.carryForward)
    if (!Number.isFinite(carryForward) || carryForward < 0 || Math.abs(carryForward * 10000 - Math.round(carryForward * 10000)) > 1e-7) throw new Error('Carry Forward must be a non-negative number with no more than four decimal places.')
    return { staff, effectiveDate, evidencePeriod, carryForward, auditReason: 'Manager-confirmed manual carry forward' }
  }

  async previewAnnualLeaveCarryForward(input: AnnualLeaveCarryForwardDraft): Promise<AnnualLeaveCarryForwardPreview> {
    const validated = await this.validatedAnnualLeaveCarryForward(input)
    const evidence = await this.annualLeaveServiceYearEvidence(input.staffId)
    const proposed = { serviceYearStart: validated.evidencePeriod.start, serviceYearEnd: validated.evidencePeriod.end, availableFrom: validated.effectiveDate, entitledUnits: 30, accrualUnitsPerCompletedMonth: 2.5, approvedOpeningCarryUnits: validated.carryForward, openingCarryEffectiveDate: validated.effectiveDate, openingCarryReason: validated.auditReason }
    const afterEvidence = [...evidence.filter(row => row.serviceYearStart !== proposed.serviceYearStart), proposed].sort((left, right) => left.serviceYearStart.localeCompare(right.serviceYearStart))
    const [before, after] = await Promise.all([
      this.annualLeaveServiceYearBalanceFromEvidence(validated.staff, evidence, serviceDate()),
      this.annualLeaveServiceYearBalanceFromEvidence(validated.staff, afterEvidence, serviceDate()),
    ])
    return { staffId: validated.staff.id, staffName: validated.staff.name, staffNumber: validated.staff.number, joinDate: validated.staff.joinDate, effectiveDate: validated.effectiveDate, carryForward: validated.carryForward, evidenceServiceYearStart: validated.evidencePeriod.start, evidenceServiceYearEnd: validated.evidencePeriod.end, entitlementAvailabilityDate: validated.effectiveDate, before, after }
  }

  async saveAnnualLeaveCarryForward(input: AnnualLeaveCarryForwardWrite, approver: AuthPrincipal): Promise<AnnualLeaveCarryForwardPreview> {
    if (input.confirmation !== 'CONFIRM_ANNUAL_LEAVE_CARRY_FORWARD') throw new Error('Explicit manager confirmation is required before saving Carry Forward.')
    const preview = await this.previewAnnualLeaveCarryForward(input)
    const validated = await this.validatedAnnualLeaveCarryForward(input)
    await this.database.transaction(async transaction => {
      const existing = (await transaction.query<any>('select * from staff_annual_leave_service_years where staff_id=$1 and service_year_start=$2', [validated.staff.id, validated.evidencePeriod.start])).rows[0] || null
      const id = existing?.id || randomUUID()
      const saved = (await transaction.query<any>(`insert into staff_annual_leave_service_years (id,staff_id,service_year_start,service_year_end,available_from,entitled_units,accrual_units_per_completed_month,approved_opening_carry_units,opening_carry_effective_date,opening_carry_reason,approved_by_user_id,approved_by_name_snapshot) values ($1,$2,$3,$4,$5,30,2.5,$6,$5,$7,$8,$9) on conflict (staff_id,service_year_start) do update set service_year_end=excluded.service_year_end,available_from=excluded.available_from,entitled_units=excluded.entitled_units,accrual_units_per_completed_month=excluded.accrual_units_per_completed_month,approved_opening_carry_units=excluded.approved_opening_carry_units,opening_carry_effective_date=excluded.opening_carry_effective_date,opening_carry_reason=excluded.opening_carry_reason,approved_by_user_id=excluded.approved_by_user_id,approved_by_name_snapshot=excluded.approved_by_name_snapshot,updated_at=now() returning *`, [id, validated.staff.id, validated.evidencePeriod.start, validated.evidencePeriod.end, validated.effectiveDate, validated.carryForward, validated.auditReason, approver.userId, approver.displayName])).rows[0]
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'staff_annual_leave_service_year', id, existing ? 'carry_forward_updated' : 'carry_forward_created', existing ? JSON.stringify(existing) : null, JSON.stringify(saved), approver.displayName])
    })
    return preview
  }

  async yearlyEntitlements(staffId: string, year: number): Promise<StaffYearlyEntitlementRecord[]> {
    if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new Error('Select a valid entitlement year.')
    if (!(await this.find(staffId))) throw new Error('Staff member not found.')
    if (!(await this.yearlyEntitlementTableAvailable())) throw new Error('Yearly entitlements require database schema 021.')
    const [result, policies, employee] = await Promise.all([
      this.database.query<any>(`select leave_classification as classification,entitled_units::text as entitlement,accrual_units_per_completed_month::text as "accrualPerCompletedMonth",eligible_from::text as "eligibleFrom",eligible_through::text as "eligibleThrough",opening_balance_adjustment_units::text as "openingBalanceAdjustment",opening_balance_reason as "openingBalanceReason" from staff_leave_entitlement_years where staff_id=$1 and entitlement_year=$2`, [staffId, year]),
      this.entitlementPolicies(),
      this.entitlements().then(items => items.find(item => item.staffId === staffId))
    ])
    if (!employee) throw new Error('Staff member not found.')
    const configured = new Map(result.rows.map((row: any) => [row.classification, row]))
    const policyByClassification = new Map(policies.map(policy => [policy.classification, policy.defaultAllowance]))
    return YEARLY_ENTITLEMENT_LEAVE_CLASSIFICATIONS.map(classification => {
      const definition = CORE_DUTY_CODES.find(item => item.classification === classification)!
      const row: any = configured.get(classification)
      let inherited: number | null = null
      if (classification === 'publicHoliday') inherited = employee.persisted ? employee.publicHolidayPerYear : policyByClassification.get(classification) ?? null
      else if (EMPLOYEE_OVERRIDE_LEAVE_CLASSIFICATIONS.includes(classification as EmployeeOverrideLeaveClassification)) inherited = Object.prototype.hasOwnProperty.call(employee.leaveOverrides, classification) ? employee.leaveOverrides[classification as EmployeeOverrideLeaveClassification]! : policyByClassification.get(classification) ?? null
      return { classification, code: definition.code, label: definition.label, year, entitlement: row ? Number(row.entitlement) : inherited, accrualPerCompletedMonth: row?.accrualPerCompletedMonth == null ? null : Number(row.accrualPerCompletedMonth), eligibleFrom: row?.eligibleFrom || null, eligibleThrough: row?.eligibleThrough || null, openingBalanceAdjustment: row?.openingBalanceAdjustment == null ? null : Number(row.openingBalanceAdjustment), openingBalanceReason: row?.openingBalanceReason || null, configured: Boolean(row) }
    })
  }

  private async validatedYearlyDraft(input: StaffYearlyEntitlementDraft) {
    if (!Number.isInteger(input.year) || input.year < 1900 || input.year > 2200) throw new Error('Select a valid entitlement year.')
    const staff = await this.find(input.staffId)
    if (!staff) throw new Error('Staff member not found.')
    if (!(await this.yearlyEntitlementTableAvailable())) throw new Error('Yearly entitlements require database schema 021.')
    const unsupported = Object.keys(input.allowances || {}).filter(classification => !YEARLY_ENTITLEMENT_LEAVE_CLASSIFICATIONS.includes(classification as YearlyEntitlementLeaveClassification))
    if (unsupported.length) throw new Error('Only approved yearly leave classifications may be configured.')
    if (Object.prototype.hasOwnProperty.call(input.allowances || {}, 'annualLeave') || input.annualLeaveOpeningBalance !== null) throw new Error('Annual Leave is managed automatically by service year, with manual Carry Forward configured separately. Calendar-year AL records cannot be created or changed here.')
    for (const value of Object.values(input.allowances || {})) if (value !== null && value !== undefined && (!Number.isFinite(value) || value < 0 || Math.abs(value * 10000 - Math.round(value * 10000)) > 1e-7)) throw new Error('Yearly entitlement values must be non-negative numbers with no more than four decimal places, or left Unconfigured.')
    if (input.annualLeaveOpeningBalance !== null && (!Number.isFinite(input.annualLeaveOpeningBalance) || input.annualLeaveOpeningBalance < 0 || Math.abs(input.annualLeaveOpeningBalance * 10000 - Math.round(input.annualLeaveOpeningBalance * 10000)) > 1e-7)) throw new Error('Annual Leave opening balance must be a non-negative number with no more than four decimal places, or left blank.')
    const approvalReason = String(input.approvalReason || '').trim()
    if (!approvalReason) throw new Error('An HR approval reason is required before yearly entitlements can be reviewed or saved.')
    return { staff, approvalReason }
  }

  private annualEligibility(staff: Staff, year: number) {
    const yearStart = `${year}-01-01`; const yearEnd = `${year}-12-31`
    const validJoinDate = /^\d{4}-\d{2}-\d{2}$/.test(staff.joinDate) && !Number.isNaN(Date.parse(`${staff.joinDate}T00:00:00Z`)) && new Date(`${staff.joinDate}T00:00:00Z`).toISOString().slice(0, 10) === staff.joinDate
    if (!validJoinDate) throw new Error('A valid Staff Management Date of Joining is required before Annual Leave can be configured.')
    if (staff.joinDate > yearEnd) throw new Error('Annual Leave cannot be configured before the Staff Management Date of Joining.')
    const eligibleFrom = staff.joinDate > yearStart ? staff.joinDate : yearStart
    let eligibleThrough: string | null = null
    if (staff.resignationDate?.startsWith(`${year}-`)) {
      eligibleThrough = staff.resignationDate
    }
    return { eligibleFrom, eligibleThrough }
  }

  private projectedYearlyEntitlements(current: StaffYearlyEntitlementRecord[], input: StaffYearlyEntitlementDraft, staff: Staff, approvalReason: string) {
    const records = new Map(current.map(record => [record.classification, { ...record }]))
    for (const classification of YEARLY_ENTITLEMENT_LEAVE_CLASSIFICATIONS) {
      if (!Object.prototype.hasOwnProperty.call(input.allowances, classification)) continue
      const value = input.allowances[classification]
      const existing = records.get(classification)!
      if (value === null || value === undefined) {
        records.set(classification, { ...existing, entitlement: null, accrualPerCompletedMonth: null, eligibleFrom: null, eligibleThrough: null, openingBalanceAdjustment: null, openingBalanceReason: null, configured: false })
        continue
      }
      if (classification === 'annualLeave') {
        const eligibility = this.annualEligibility(staff, input.year)
        records.set(classification, { ...existing, entitlement: value, accrualPerCompletedMonth: value === 0 ? 0 : 2.5, ...eligibility, openingBalanceAdjustment: input.annualLeaveOpeningBalance, openingBalanceReason: input.annualLeaveOpeningBalance === null ? null : approvalReason, configured: true })
      } else records.set(classification, { ...existing, entitlement: value, configured: true })
    }
    const annual = records.get('annualLeave')!
    if (input.annualLeaveOpeningBalance !== null && !annual.configured) throw new Error('Configure the Annual Leave yearly allowance before entering an opening balance.')
    if (annual.configured && Object.prototype.hasOwnProperty.call(input, 'annualLeaveOpeningBalance')) records.set('annualLeave', { ...annual, openingBalanceAdjustment: input.annualLeaveOpeningBalance, openingBalanceReason: input.annualLeaveOpeningBalance === null ? null : approvalReason })
    return YEARLY_ENTITLEMENT_LEAVE_CLASSIFICATIONS.map(classification => records.get(classification)!)
  }

  async previewYearlyEntitlements(input: StaffYearlyEntitlementDraft): Promise<StaffYearlyEntitlementPreview> {
    const { staff, approvalReason } = await this.validatedYearlyDraft(input)
    const before = await this.yearlyEntitlements(input.staffId, input.year)
    const after = this.projectedYearlyEntitlements(before, input, staff, approvalReason)
    const weekDate = serviceDate(); const [weekStart, weekEnd] = weekRange(weekDate)
    let balanceBefore: StaffYearlyEntitlementBalance | null = null
    try { balanceBefore = await this.yearlyEntitlementBalance(input.staffId, input.year, weekStart, weekEnd) } catch { balanceBefore = null }
    const balanceAfter = await this.yearlyEntitlementBalance(input.staffId, input.year, weekStart, weekEnd, { year: input.year, records: after })
    return { staffId: input.staffId, staffName: staff.name, staffNumber: staff.number, year: input.year, approvalReason, before, after, balanceBefore, balanceAfter }
  }

  async saveYearlyEntitlements(input: StaffYearlyEntitlementWrite, approver: AuthPrincipal): Promise<StaffYearlyEntitlementRecord[]> {
    if (input.confirmation !== 'CONFIRM_HR_APPROVED_YEARLY_ENTITLEMENTS') throw new Error('Explicit manager confirmation is required before yearly entitlements can be saved.')
    const { staff, approvalReason } = await this.validatedYearlyDraft(input)
    const current = await this.yearlyEntitlements(input.staffId, input.year)
    const projected = this.projectedYearlyEntitlements(current, input, staff, approvalReason)
    await this.database.transaction(async transaction => {
      for (const classification of YEARLY_ENTITLEMENT_LEAVE_CLASSIFICATIONS) {
        if (!Object.prototype.hasOwnProperty.call(input.allowances, classification)) continue
        const before = (await transaction.query<any>('select * from staff_leave_entitlement_years where staff_id=$1 and entitlement_year=$2 and leave_classification=$3', [input.staffId, input.year, classification])).rows[0] || null
        const record = projected.find(item => item.classification === classification)!
        if (!record.configured) {
          if (!before) continue
          await transaction.query('delete from staff_leave_entitlement_years where staff_id=$1 and entitlement_year=$2 and leave_classification=$3', [input.staffId, input.year, classification])
          await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'staff_leave_entitlement_year', before.id, 'cleared', JSON.stringify(before), JSON.stringify({ approvalReason }), approver.displayName])
          continue
        }
        const id = before?.id || randomUUID()
        const saved = (await transaction.query<any>(`insert into staff_leave_entitlement_years(id,staff_id,entitlement_year,leave_classification,entitled_units,accrual_units_per_completed_month,eligible_from,eligible_through,opening_balance_adjustment_units,opening_balance_reason,approved_by_user_id,approved_by_name_snapshot) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict(staff_id,entitlement_year,leave_classification) do update set entitled_units=excluded.entitled_units,accrual_units_per_completed_month=excluded.accrual_units_per_completed_month,eligible_from=excluded.eligible_from,eligible_through=excluded.eligible_through,opening_balance_adjustment_units=excluded.opening_balance_adjustment_units,opening_balance_reason=excluded.opening_balance_reason,approved_by_user_id=excluded.approved_by_user_id,approved_by_name_snapshot=excluded.approved_by_name_snapshot,updated_at=now() returning *`, [id, input.staffId, input.year, classification, record.entitlement, record.accrualPerCompletedMonth, record.eligibleFrom, record.eligibleThrough, record.openingBalanceAdjustment, record.openingBalanceReason, approver.userId, approver.displayName])).rows[0]
        await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'staff_leave_entitlement_year', id, before ? 'updated' : 'created', before ? JSON.stringify(before) : null, JSON.stringify({ ...saved, approvalReason }), approver.displayName])
      }
    })
    return this.yearlyEntitlements(input.staffId, input.year)
  }

  async entitlements(): Promise<StaffEntitlement[]> {
    const [defaults, policies] = await Promise.all([this.entitlementPolicyDefaults(), this.entitlementPolicies()])
    const result = await this.database.query<any>(`select s.id as "staffId",s.staff_number as "staffNumber",s.full_name as "staffName",s.employment_status_key as "employmentStatus",coalesce(e.annual_leave_per_year,$1)::int as "annualLeavePerYear",coalesce(e.weekly_off_entitlement,$2)::int as "weeklyOffEntitlement",coalesce(e.public_holiday_per_year,$3)::int as "publicHolidayPerYear",(e.staff_id is not null) as persisted,e.created_by as "createdBy",e.updated_by as "updatedBy",e.created_at::text as "createdAt",e.updated_at::text as "updatedAt" from staff s left join staff_entitlements e on e.staff_id=s.id order by s.employment_status_key='active' desc,s.full_name`, [defaults.annualLeave, defaults.weeklyOff, defaults.publicHoliday])
    const overrideRows = await this.employeeLeaveOverrideTableAvailable() ? await this.database.query<{ staffId: string; classification: EmployeeOverrideLeaveClassification; entitledUnits: number }>('select staff_id as "staffId",leave_classification as classification,entitled_units::int as "entitledUnits" from staff_leave_entitlement_overrides order by staff_id,leave_classification') : { rows: [] }
    const overrides = new Map<string, StaffEntitlement['leaveOverrides']>()
    for (const row of overrideRows.rows) overrides.set(row.staffId, { ...(overrides.get(row.staffId) || {}), [row.classification]: row.entitledUnits })
    return result.rows.map((row: Omit<StaffEntitlement, 'leaveOverrides'>) => ({ ...row, leaveOverrides: overrides.get(row.staffId) || {} }))
  }

  async saveEntitlement(input: StaffEntitlementUpdate, actor = 'Venue Manager'): Promise<StaffEntitlement> {
    const values = [input.annualLeavePerYear, input.weeklyOffEntitlement, input.publicHolidayPerYear]
    if (values.some(value => !Number.isInteger(value) || value < 0)) throw new Error('Entitlement values must be whole numbers of zero or more.')
    if (input.leaveOverrides) {
      if (!(await this.employeeLeaveOverrideTableAvailable())) throw new Error('Employee leave entitlement overrides require database schema 020.')
      const unsupported = Object.keys(input.leaveOverrides).filter(classification => !EMPLOYEE_OVERRIDE_LEAVE_CLASSIFICATIONS.includes(classification as EmployeeOverrideLeaveClassification))
      if (unsupported.length) throw new Error('Only approved employee leave entitlement classifications may be configured.')
      const invalid = Object.values(input.leaveOverrides).some(value => value !== null && value !== undefined && (!Number.isInteger(value) || value < 0))
      if (invalid) throw new Error('Employee leave entitlement values must be whole numbers of zero or more, or left Unconfigured.')
    }
    const staff = await this.find(input.staffId)
    if (!staff) throw new Error('Staff member not found.')
    await this.database.transaction(async transaction => {
      const before = (await transaction.query<any>('select staff_id,"annual_leave_per_year","weekly_off_entitlement","public_holiday_per_year",created_by,updated_by from staff_entitlements where staff_id=$1', [input.staffId])).rows[0] || null
      await transaction.query(`insert into staff_entitlements(staff_id,annual_leave_per_year,weekly_off_entitlement,public_holiday_per_year,created_by,updated_by) values($1,$2,$3,$4,$5,$5) on conflict(staff_id) do update set annual_leave_per_year=excluded.annual_leave_per_year,weekly_off_entitlement=excluded.weekly_off_entitlement,public_holiday_per_year=excluded.public_holiday_per_year,updated_by=excluded.updated_by,updated_at=now()`, [input.staffId, input.annualLeavePerYear, input.weeklyOffEntitlement, input.publicHolidayPerYear, actor])
      const after = (await transaction.query<any>('select staff_id,"annual_leave_per_year","weekly_off_entitlement","public_holiday_per_year",created_by,updated_by from staff_entitlements where staff_id=$1', [input.staffId])).rows[0]
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'staff_entitlement', input.staffId, before ? 'updated' : 'created', before ? JSON.stringify(before) : null, JSON.stringify(after), actor])
      if (input.leaveOverrides) {
        for (const classification of EMPLOYEE_OVERRIDE_LEAVE_CLASSIFICATIONS) {
          if (!Object.prototype.hasOwnProperty.call(input.leaveOverrides, classification)) continue
          const beforeOverride = (await transaction.query<any>('select id,staff_id,leave_classification,entitled_units,created_by,updated_by from staff_leave_entitlement_overrides where staff_id=$1 and leave_classification=$2', [input.staffId, classification])).rows[0] || null
          const value = input.leaveOverrides[classification]
          if (value === null || value === undefined) {
            if (!beforeOverride) continue
            await transaction.query('delete from staff_leave_entitlement_overrides where staff_id=$1 and leave_classification=$2', [input.staffId, classification])
            await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,null,$6)', [randomUUID(), 'staff_leave_entitlement_override', beforeOverride.id, 'cleared', JSON.stringify(beforeOverride), actor])
            continue
          }
          const id = beforeOverride?.id || randomUUID()
          const saved = (await transaction.query<any>('insert into staff_leave_entitlement_overrides(id,staff_id,leave_classification,entitled_units,created_by,updated_by) values($1,$2,$3,$4,$5,$5) on conflict(staff_id,leave_classification) do update set entitled_units=excluded.entitled_units,updated_by=excluded.updated_by,updated_at=now() returning id,staff_id,leave_classification,entitled_units,created_by,updated_by', [id, input.staffId, classification, value, actor])).rows[0]
          await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'staff_leave_entitlement_override', saved.id, beforeOverride ? 'updated' : 'created', beforeOverride ? JSON.stringify(beforeOverride) : null, JSON.stringify(saved), actor])
        }
      }
    })
    return (await this.entitlements()).find(item => item.staffId === input.staffId)!
  }

  async entitlementBalance(staffId: string, year: number, weekStart: string, weekEnd: string) {
    if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new Error('Select a valid entitlement year.')
    const [defaults, policies] = await Promise.all([this.entitlementPolicyDefaults(), this.entitlementPolicies()])
    const allowance = await this.database.query<{ annualLeave: number; weeklyOff: number; publicHoliday: number }>(`select coalesce(e.annual_leave_per_year,$2)::int as "annualLeave",coalesce(e.weekly_off_entitlement,$3)::int as "weeklyOff",coalesce(e.public_holiday_per_year,$4)::int as "publicHoliday" from staff s left join staff_entitlements e on e.staff_id=s.id where s.id=$1`, [staffId, defaults.annualLeave, defaults.weeklyOff, defaults.publicHoliday])
    if (!allowance.rows[0]) throw new Error('Staff member not found.')
    const annualStart = `${year}-01-01`
    const annualEnd = `${year + 1}-01-01`
    const annualUsage = await this.database.query<{ annualLeaveUsed: number; publicHolidayUsed: number }>(`select count(*) filter(where c.metadata->>'dutyClassification'='annualLeave')::int as "annualLeaveUsed",count(*) filter(where c.metadata->>'dutyClassification'='publicHoliday')::int as "publicHolidayUsed" from duty_roster_entries r join configuration_options c on c.group_key=$2 and c.value=r.duty_code_value where r.staff_id=$1 and r.duty_date >= $3 and r.duty_date < $4`, [staffId, staffConfigKeys['duty-codes'], annualStart, annualEnd])
    const additionalUsage = await this.database.query<{ classification: EmployeeOverrideLeaveClassification; used: number }>(`select case when upper(r.duty_code_value) in ('SK','SL') then 'sickLeave' else c.metadata->>'dutyClassification' end as classification,count(*)::int as used from duty_roster_entries r left join configuration_options c on c.group_key=$2 and c.value=r.duty_code_value where r.staff_id=$1 and r.duty_date >= $3 and r.duty_date < $4 group by 1`, [staffId, staffConfigKeys['duty-codes'], annualStart, annualEnd])
    const overrides = await this.employeeLeaveOverrideTableAvailable() ? await this.database.query<{ classification: EmployeeOverrideLeaveClassification; entitlement: number }>('select leave_classification as classification,entitled_units::int as entitlement from staff_leave_entitlement_overrides where staff_id=$1', [staffId]) : { rows: [] }
    const weeklyUsage = await this.database.query<{ assigned: number }>(`select count(*)::int as assigned from duty_roster_entries r join configuration_options c on c.group_key=$2 and c.value=r.duty_code_value where r.staff_id=$1 and r.duty_date between $3 and $4 and c.metadata->>'dutyClassification'='off'`, [staffId, staffConfigKeys['duty-codes'], weekStart, weekEnd])
    const annualLeaveUsed = annualUsage.rows[0].annualLeaveUsed
    const publicHolidayUsed = annualUsage.rows[0].publicHolidayUsed
    const assigned = weeklyUsage.rows[0].assigned
    const difference = assigned - allowance.rows[0].weeklyOff
    const usageByClassification = new Map(additionalUsage.rows.filter(row => EMPLOYEE_OVERRIDE_LEAVE_CLASSIFICATIONS.includes(row.classification)).map(row => [row.classification, Number(row.used)]))
    const entitlementByClassification = new Map(overrides.rows.map(row => [row.classification, Number(row.entitlement)]))
    const policyByClassification = new Map(policies.map(policy => [policy.classification, policy.defaultAllowance]))
    const additionalLeave = EMPLOYEE_OVERRIDE_LEAVE_CLASSIFICATIONS.map(classification => {
      const definition = CORE_DUTY_CODES.find(item => item.classification === classification)!
      const entitlement = entitlementByClassification.has(classification) ? entitlementByClassification.get(classification)! : policyByClassification.get(classification) ?? null
      const used = usageByClassification.get(classification) || 0
      return { classification, code: definition.code, label: definition.label, entitlement, used, remaining: entitlement === null ? null : entitlement - used, bookedFuture: null, availableAfterBooked: null }
    })
    const today = serviceDate(); const yearStart = `${year}-01-01`; const yearEnd = `${year}-12-31`; const asOf = today < yearStart ? yearStart : today > yearEnd ? yearEnd : today
    const serviceYearSupported = await this.serviceYearEntitlementTableAvailable()
    const serviceYear = await this.annualLeaveServiceYearBalance(staffId, asOf).catch(error => { if (error instanceof Error && error.message === 'SERVICE_YEAR_NOT_STARTED') return null; throw error })
    const annualLeave = serviceYear
      ? { entitlement: serviceYear.availableLeave, used: serviceYear.used, remaining: serviceYear.remaining, serviceYear }
      : serviceYearSupported ? { entitlement: null, used: 0, remaining: null } : { entitlement: allowance.rows[0].annualLeave, used: annualLeaveUsed, remaining: allowance.rows[0].annualLeave - annualLeaveUsed }
    return { staffId, year, annualLeave, publicHoliday: { entitlement: allowance.rows[0].publicHoliday, used: publicHolidayUsed, remaining: allowance.rows[0].publicHoliday - publicHolidayUsed }, weeklyOff: { weekStart, weekEnd, required: allowance.rows[0].weeklyOff, assigned, difference, status: difference < 0 ? 'short' as const : difference > 0 ? 'additional' as const : 'compliant' as const }, additionalLeave }
  }

  private async confirmedYearlyUsage(staffId: string, year: number) {
    const result = await this.database.query<{ classification: YearlyEntitlementLeaveClassification; used: number }>(`select case when upper(r.duty_code_value) in ('SK','SL') then 'sickLeave' else c.metadata->>'dutyClassification' end as classification,count(*)::int as used from duty_roster_entries r left join configuration_options c on c.group_key=$2 and c.value=r.duty_code_value where r.staff_id=$1 and r.duty_date >= $3 and r.duty_date < $4 group by 1`, [staffId, staffConfigKeys['duty-codes'], `${year}-01-01`, `${year + 1}-01-01`])
    return new Map(result.rows.filter(row => YEARLY_ENTITLEMENT_LEAVE_CLASSIFICATIONS.includes(row.classification)).map(row => [row.classification, Number(row.used)]))
  }

  async yearlyEntitlementBalance(staffId: string, year: number, weekStart: string, weekEnd: string, proposal?: { year: number; records: StaffYearlyEntitlementRecord[] }): Promise<StaffYearlyEntitlementBalance> {
    const staff = await this.find(staffId)
    if (!staff) throw new Error('Staff member not found.')
    const configured = proposal?.year === year ? proposal.records : await this.yearlyEntitlements(staffId, year)
    const usage = await this.confirmedYearlyUsage(staffId, year)
    const today = serviceDate(); const yearStart = `${year}-01-01`; const yearEnd = `${year}-12-31`; const asOf = today < yearStart ? today : today > yearEnd ? yearEnd : today
    const serviceYear = await this.annualLeaveServiceYearBalance(staffId, asOf).catch(error => { if (error instanceof Error && error.message === 'SERVICE_YEAR_NOT_STARTED') return null; throw error })
    const yearlyLeave = configured.map((record): StaffYearlyEntitlementBalance['yearlyLeave'][number] => {
      const used = usage.get(record.classification) || 0
      if (record.classification === 'annualLeave') return { ...record, entitlement: serviceYear?.availableLeave ?? null, accrualPerCompletedMonth: 2.5, eligibleFrom: serviceYear?.serviceYearStart ?? null, eligibleThrough: serviceYear?.serviceYearEnd ?? null, openingBalanceAdjustment: serviceYear?.approvedOpeningCarry ?? null, openingBalanceReason: serviceYear?.openingCarryReason ?? null, configured: serviceYear?.evidenceStatus === 'complete', accrued: serviceYear?.accruingForNextServiceYear ?? null, carriedForward: serviceYear?.approvedOpeningCarry ?? null, used: serviceYear?.used ?? used, remaining: serviceYear?.remaining ?? null, bookedFuture: serviceYear?.bookedFuture ?? 0, availableAfterBooked: serviceYear?.availableAfterBooked ?? null, ...(serviceYear ? { serviceYear } : {}) }
      const renewing = calculateRenewingAnnualBalance(record.entitlement, used)
      return { ...record, accrued: record.entitlement, carriedForward: 0, used, remaining: renewing.remaining, bookedFuture: null, availableAfterBooked: null }
    })
    const weeklyOff = (await this.entitlementBalance(staffId, year, weekStart, weekEnd)).weeklyOff
    return { staffId, year, asOf, yearlyLeave, weeklyOff }
  }

  async entitlementReconciliation(staffId: string, year: number, weekStart: string, weekEnd: string): Promise<StaffEntitlementReconciliation> {
    const staff = await this.find(staffId)
    if (!staff) throw new Error('Staff member not found.')
    const [records, balance, policies, employee] = await Promise.all([
      this.yearlyEntitlements(staffId, year),
      this.yearlyEntitlementBalance(staffId, year, weekStart, weekEnd),
      this.entitlementPolicies(),
      this.entitlements().then(items => items.find(item => item.staffId === staffId))
    ])
    if (!employee) throw new Error('Staff member not found.')
    const policyByClassification = new Map(policies.map(policy => [policy.classification, policy.defaultAllowance]))
    const yearlyByClassification = new Map(balance.yearlyLeave.map(line => [line.classification, line]))
    const individualEvidence = (classification: LeaveClassification) => {
      if (classification === 'annualLeave') return employee.persisted ? employee.annualLeavePerYear : null
      if (classification === 'off') return employee.persisted ? employee.weeklyOffEntitlement : null
      if (classification === 'publicHoliday') return employee.persisted ? employee.publicHolidayPerYear : null
      if (EMPLOYEE_OVERRIDE_LEAVE_CLASSIFICATIONS.includes(classification as EmployeeOverrideLeaveClassification)) return Object.prototype.hasOwnProperty.call(employee.leaveOverrides, classification) ? employee.leaveOverrides[classification as EmployeeOverrideLeaveClassification]! : null
      return null
    }
    const lines: StaffEntitlementReconciliation['lines'] = CORE_DUTY_CODES.map(definition => {
      const policyEntitlement = policyByClassification.get(definition.classification) ?? null
      const individualEntitlement = individualEvidence(definition.classification)
      if (definition.classification === 'off') {
        const source = individualEntitlement !== null ? 'individual_override' as const : policyEntitlement !== null ? 'policy_default' as const : 'unconfigured' as const
        const required = balance.weeklyOff.required
        return { classification: definition.classification, code: definition.code, label: definition.label, cadence: 'weekly' as const, policyEntitlement, individualEntitlement, yearlyEntitlement: null, source, openingBalance: null, openingBalanceReason: null, accrualPerCompletedMonth: null, completedEligibleMonths: null, accrued: required, carriedForward: null, used: balance.weeklyOff.assigned, remaining: required - balance.weeklyOff.assigned, bookedFuture: null, availableAfterBooked: null, evidenceStatus: 'weekly_recurring' as const, issues: ['OFF follows the existing weekly recurring policy and does not use yearly carry-forward.'] }
      }
      const record = records.find(item => item.classification === definition.classification)!
      const calculated = yearlyByClassification.get(record.classification)!
      if (definition.classification === 'annualLeave') {
        const serviceYear = calculated.serviceYear
        const issues: string[] = []
        if (serviceYear?.preAvailabilityUsageDates.length) issues.push(`${serviceYear.preAvailabilityUsageDates.length} roster-confirmed AL day(s) occurred before verified entitlement availability and require HR review.`)
        if (serviceYear && serviceYear.knownAvailableLeave < serviceYear.used) issues.push(`${serviceYear.used} roster-confirmed AL day(s) exceed the ${serviceYear.knownAvailableLeave}-day available entitlement; manager review of Carry Forward is required.`)
        const discrepancy = issues.some(issue => issue.includes('before verified') || issue.includes('exceed'))
        return { classification: definition.classification, code: definition.code, label: definition.label, cadence: 'annual' as const, policyEntitlement, individualEntitlement, yearlyEntitlement: serviceYear?.availableLeave ?? null, source: serviceYear?.evidenceStatus === 'complete' ? 'service_year_hr_evidence' as const : 'unconfigured' as const, openingBalance: serviceYear?.approvedOpeningCarry ?? null, openingBalanceReason: serviceYear?.openingCarryReason ?? null, accrualPerCompletedMonth: 2.5, completedEligibleMonths: serviceYear?.completedServiceMonths ?? null, accrued: serviceYear?.accruingForNextServiceYear ?? null, carriedForward: serviceYear?.approvedOpeningCarry ?? null, used: serviceYear?.used ?? 0, remaining: serviceYear?.remaining ?? null, bookedFuture: serviceYear?.bookedFuture ?? 0, availableAfterBooked: serviceYear?.availableAfterBooked ?? null, serviceYear, evidenceStatus: !serviceYear || serviceYear.evidenceStatus === 'unconfigured' ? 'missing_hr_evidence' as const : discrepancy ? 'discrepancy' as const : 'complete' as const, issues }
      }
      const issues: string[] = []
      const comparison = individualEntitlement ?? policyEntitlement
      const comparisonName = individualEntitlement !== null ? 'individual override' : 'policy default'
      const source = record.configured ? 'yearly_hr_approval' as const : individualEntitlement !== null ? 'individual_override' as const : policyEntitlement !== null ? 'policy_default' as const : 'unconfigured' as const
      if (!record.configured && comparison === null) issues.push(`No manager-approved ${year} yearly entitlement or active shared policy default is configured.`)
      if (record.configured && comparison !== null && Math.abs(Number(record.entitlement) - comparison) > 0.0001) issues.push(`Yearly HR-approved entitlement differs from the current ${comparisonName} (${comparison}).`)
      if (record.openingBalanceAdjustment !== null && !record.openingBalanceReason) issues.push('Annual Leave opening balance is missing its approval reason.')
      const discrepancy = issues.some(issue => issue.includes('differs') || issue.includes('approval reason'))
      return { classification: definition.classification, code: definition.code, label: definition.label, cadence: 'annual' as const, policyEntitlement, individualEntitlement, yearlyEntitlement: record.entitlement, source, openingBalance: record.openingBalanceAdjustment, openingBalanceReason: record.openingBalanceReason, accrualPerCompletedMonth: record.accrualPerCompletedMonth, completedEligibleMonths: null, accrued: calculated.accrued, carriedForward: calculated.carriedForward, used: calculated.used, remaining: calculated.remaining, bookedFuture: calculated.bookedFuture, availableAfterBooked: calculated.availableAfterBooked, evidenceStatus: source === 'unconfigured' ? 'missing_hr_evidence' as const : discrepancy ? 'discrepancy' as const : 'complete' as const, issues }
    })
    return { staffId, staffName: staff.name, staffNumber: staff.number, year, asOf: balance.asOf, lines, missingEvidence: lines.flatMap(line => line.evidenceStatus === 'missing_hr_evidence' ? line.issues : []), discrepancies: lines.flatMap(line => line.evidenceStatus === 'discrepancy' ? line.issues : []), confirmedUsageSource: 'DUTY_ROSTER', bookedFutureSource: 'PLANNED_LEAVE_SEPARATE', readOnly: true }
  }

  async publicHolidays(year: number): Promise<PublicHoliday[]> {
    if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new Error('Select a valid holiday year.')
    const result = await this.database.query<any>(`select id,holiday_name as name,holiday_date::text as date,days::int,active,created_by as "createdBy",updated_by as "updatedBy",created_at::text as "createdAt",updated_at::text as "updatedAt" from public_holidays where extract(year from holiday_date)=$1 order by holiday_date,holiday_name`, [year])
    return result.rows
  }

  async savePublicHoliday(holiday: PublicHoliday, actor = 'Venue Manager'): Promise<PublicHoliday> {
    const date = holiday.date?.trim()
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
    if (!holiday.name?.trim() || !validDate || !Number.isInteger(holiday.days) || holiday.days < 1) throw new Error('Holiday name, valid date and whole days of one or more are required.')
    return this.database.transaction(async transaction => {
      const id = holiday.id || randomUUID()
      const before = (await transaction.query<any>('select id,holiday_name,holiday_date::text,days,active,created_by,updated_by from public_holidays where id=$1', [id])).rows[0] || null
      const result = await transaction.query<any>(`insert into public_holidays(id,holiday_name,holiday_date,days,active,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$6) on conflict(id) do update set holiday_name=excluded.holiday_name,holiday_date=excluded.holiday_date,days=excluded.days,active=excluded.active,updated_by=excluded.updated_by,updated_at=now() returning id,holiday_name as name,holiday_date::text as date,days::int,active,created_by as "createdBy",updated_by as "updatedBy",created_at::text as "createdAt",updated_at::text as "updatedAt"`, [id, holiday.name.trim(), date, holiday.days, holiday.active, actor])
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'public_holiday', id, before ? 'updated' : 'created', before ? JSON.stringify(before) : null, JSON.stringify(result.rows[0]), actor])
      return result.rows[0]
    })
  }

  async removePublicHoliday(id: string, actor = 'Venue Manager'): Promise<void> {
    await this.database.transaction(async transaction => {
      const before = (await transaction.query<any>('select id,holiday_name,holiday_date::text,days,active,created_by,updated_by from public_holidays where id=$1', [id])).rows[0]
      if (!before) throw new Error('Public holiday not found.')
      await transaction.query('delete from public_holidays where id=$1', [id])
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,null,$6)', [randomUUID(), 'public_holiday', id, 'deleted', JSON.stringify(before), actor])
    })
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
