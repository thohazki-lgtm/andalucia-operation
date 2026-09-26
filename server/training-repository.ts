import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { ConfigOption, TrainingDefaults, TrainingOperationalStatus, TrainingTargetVersion, TrainingWorkflowOption, StaffTrainingHistory, TrainingAttendee, TrainingImportBatch, TrainingSession } from '../src/domain.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'

export type TrainingConfigGroup = 'categories' | 'statuses' | 'attendance-statuses'

const groupKeys: Record<TrainingConfigGroup, string> = {
  categories: 'training_categories',
  statuses: 'training_statuses',
  'attendance-statuses': 'training_attendance_statuses'
}

const seeds: Record<TrainingConfigGroup, Array<Omit<ConfigOption, 'id'>>> = {
  categories: ['Service Standards', 'Menu Knowledge', 'Wine Knowledge', 'Upselling', 'Guest Experience', 'Hygiene', 'Safety', 'Other'].map(label => ({ value: label.toLowerCase().replaceAll(' ', '_'), label, active: true })),
  statuses: [
    { value: 'planned', label: 'Planned', color: '#b38b3a', active: true, metadata: { trainingStage: 'planned' } },
    { value: 'upcoming', label: 'Upcoming', color: '#2f8063', active: true, metadata: { trainingStage: 'upcoming' } },
    { value: 'completed', label: 'Completed', color: '#1b6288', active: true, metadata: { trainingStage: 'completed' } },
    { value: 'cancelled', label: 'Cancelled', color: '#a7b0ba', active: true, metadata: { trainingStage: 'cancelled' } }
  ],
  'attendance-statuses': [
    { value: 'attended', label: 'Attended', color: '#1b6288', active: true, metadata: { trainingAttendanceOutcome: 'attended' } },
    { value: 'absent', label: 'Absent', color: '#b74b45', active: true, metadata: { trainingAttendanceOutcome: 'absent' } },
    { value: 'excused', label: 'Excused', color: '#b38b3a', active: true, metadata: { trainingAttendanceOutcome: 'excused' } }
  ]
}

const mapOption = (row: any): ConfigOption => ({ ...row, metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata })
const DEFAULTS_GROUP = 'training_defaults'
const DEFAULTS_VALUE = 'andalucia_manual_defaults'
const WORKFLOW_GROUP = 'training_workflow_colors'
const protectedWorkflow: Array<Omit<TrainingWorkflowOption, 'color'> & { color: string }> = [
  { state: 'scheduled', label: 'Scheduled', color: '#2f8063', protected: true },
  { state: 'awaiting_confirmation', label: 'Awaiting Confirmation', color: '#b38b3a', protected: true },
  { state: 'completed', label: 'Completed', color: '#1b6288', protected: true },
  { state: 'cancelled', label: 'Cancelled', color: '#a7b0ba', protected: true }
]
const defaultTrainingDefaults = (): TrainingDefaults => ({ durationMinutes: 30, trainerMode: 'venue_manager', trainerStaffId: null, location: 'Andalucía', categoryValue: null, participantSelection: 'eligible_staff' })

export class TrainingRepository {
  constructor(private readonly db: PGlite) {}

  async initialize() {
    for (const group of Object.keys(groupKeys) as TrainingConfigGroup[]) {
      const groupKey = groupKeys[group]
      const existing = await this.db.query<{ count: number }>('select count(*)::int as count from configuration_options where group_key=$1', [groupKey])
      if (existing.rows[0].count === 0) {
        for (let index = 0; index < seeds[group].length; index++) {
          const option = seeds[group][index]
          await this.db.query('insert into configuration_options (id, group_key, value, label, color, metadata, active, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), groupKey, option.value, option.label, option.color || null, JSON.stringify(option.metadata || {}), option.active, index])
        }
      }
    }
    for (const option of seeds.statuses) await this.db.query("update configuration_options set metadata=metadata || $1::jsonb where group_key=$2 and value=$3 and not (metadata ? 'trainingStage')", [JSON.stringify(option.metadata || {}), groupKeys.statuses, option.value])
    const upcoming = seeds.statuses.find(option => option.value === 'upcoming')!
    await this.db.query("insert into configuration_options (id,group_key,value,label,color,metadata,active,sort_order) select $1,$2,$3,$4,$5,$6,true,1 where not exists (select 1 from configuration_options where group_key=$2 and value=$3)", [randomUUID(), groupKeys.statuses, upcoming.value, upcoming.label, upcoming.color, JSON.stringify(upcoming.metadata)])
    for (const option of seeds['attendance-statuses']) await this.db.query("update configuration_options set metadata=metadata || $1::jsonb where group_key=$2 and value=$3 and not (metadata ? 'trainingAttendanceOutcome')", [JSON.stringify(option.metadata || {}), groupKeys['attendance-statuses'], option.value])
  }

  async configuration(): Promise<Record<TrainingConfigGroup, ConfigOption[]>> {
    const output = {} as Record<TrainingConfigGroup, ConfigOption[]>
    for (const group of Object.keys(groupKeys) as TrainingConfigGroup[]) {
      const result = await this.db.query<any>('select id, value, label, color, metadata, active, sort_order "sortOrder" from configuration_options where group_key=$1 order by sort_order, label', [groupKeys[group]])
      output[group] = result.rows.map(mapOption)
    }
    return output
  }

  async saveCategory(option: ConfigOption, actor: string): Promise<ConfigOption> {
    const currentResult = await this.db.query<any>('select id,value,label,color,metadata,active,sort_order "sortOrder" from configuration_options where id=$1 and group_key=$2', [option.id, groupKeys.categories])
    const current = currentResult.rows[0] ? mapOption(currentResult.rows[0]) : null
    const label = option.label.trim()
    if (!label) throw new Error('Category name is required.')
    const duplicate = await this.db.query<{ present: boolean }>('select exists(select 1 from configuration_options where group_key=$1 and id<>$2 and active=true and lower(trim(label))=lower(trim($3))) present', [groupKeys.categories, option.id, label])
    if (option.active && duplicate.rows[0].present) throw new Error('An active Training category with this name already exists.')
    const value = current?.value || `TRAINING_CATEGORY_${randomUUID().replaceAll('-', '').toUpperCase()}`
    const id = option.id || randomUUID()
    const savedResult = await this.db.query<any>('insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(id) do update set label=excluded.label,color=excluded.color,active=excluded.active,sort_order=excluded.sort_order,updated_at=now() returning id,value,label,color,metadata,active,sort_order "sortOrder"', [id, groupKeys.categories, value, label, option.color || null, JSON.stringify({ ...(current?.metadata || {}), systemControlled: false }), option.active, current?.sortOrder ?? option.sortOrder ?? 100])
    const saved = mapOption(savedResult.rows[0])
    await this.auditConfiguration(saved.id, current ? 'updated' : 'created', current, saved, actor)
    return saved
  }

  /** Internal compatibility path for legacy reporting tests. Manager-facing routes never expose protected status mutation. */
  async saveConfiguration(group: TrainingConfigGroup, option: ConfigOption): Promise<ConfigOption> {
    if (group === 'categories') return this.saveCategory(option, 'Internal compatibility')
    const current = await this.db.query<any>('select id,value,label,color,metadata,active,sort_order from configuration_options where id=$1 and group_key=$2', [option.id, groupKeys[group]])
    if (!current.rows[0]) throw new Error('Training configuration option not found.')
    const result = await this.db.query<any>('update configuration_options set label=$3,color=$4,updated_at=now() where id=$1 and group_key=$2 returning id,value,label,color,metadata,active,sort_order "sortOrder"', [option.id, groupKeys[group], option.label.trim(), option.color || current.rows[0].color])
    return mapOption(result.rows[0])
  }

  async reorderCategory(id: string, direction: 'up' | 'down', actor: string): Promise<ConfigOption[]> {
    const options = (await this.configuration()).categories
    const index = options.findIndex(option => option.id === id)
    const target = direction === 'up' ? index - 1 : index + 1
    if (index < 0) throw new Error('Training category not found.')
    if (target < 0 || target >= options.length) return options
    const before = options.map(option => ({ id: option.id, sortOrder: option.sortOrder }))
    await this.db.transaction(async transaction => {
      for (let position = 0; position < options.length; position++) {
        const next = position === index ? options[target] : position === target ? options[index] : options[position]
        await transaction.query('update configuration_options set sort_order=$2,updated_at=now() where id=$1 and group_key=$3', [next.id, position, groupKeys.categories])
      }
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'training_configuration', id, 'categories_reordered', JSON.stringify(before), JSON.stringify({ id, direction }), actor])
    })
    return (await this.configuration()).categories
  }

  async reorderCategories(orderedIds: string[], actor: string): Promise<ConfigOption[]> {
    const options = (await this.configuration()).categories
    const currentIds = options.map(option => option.id)
    if (orderedIds.length !== currentIds.length || new Set(orderedIds).size !== currentIds.length || orderedIds.some(id => !currentIds.includes(id))) throw new Error('Training category order must include every category exactly once.')
    if (orderedIds.every((id, index) => id === currentIds[index])) return options
    await this.db.transaction(async transaction => {
      for (let position = 0; position < orderedIds.length; position++) await transaction.query('update configuration_options set sort_order=$2,updated_at=now() where id=$1 and group_key=$3', [orderedIds[position], position, groupKeys.categories])
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'training_configuration', orderedIds[0], 'categories_reordered', JSON.stringify({ orderedIds: currentIds }), JSON.stringify({ orderedIds }), actor])
    })
    return (await this.configuration()).categories
  }

  async defaults(): Promise<TrainingDefaults> {
    const result = await this.db.query<any>('select metadata from configuration_options where group_key=$1 and value=$2', [DEFAULTS_GROUP, DEFAULTS_VALUE])
    if (!result.rows[0]) return defaultTrainingDefaults()
    const stored = typeof result.rows[0].metadata === 'string' ? JSON.parse(result.rows[0].metadata) : result.rows[0].metadata || {}
    return { durationMinutes: Number(stored.durationMinutes || 30), trainerMode: stored.trainerMode === 'staff' ? 'staff' : 'venue_manager', trainerStaffId: stored.trainerStaffId || null, location: String(stored.location || 'Andalucía'), categoryValue: stored.categoryValue || null, participantSelection: 'eligible_staff' }
  }

  async saveDefaults(input: TrainingDefaults, actor: string): Promise<TrainingDefaults> {
    if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 5 || input.durationMinutes > 480) throw new Error('Default duration must be between 5 and 480 minutes.')
    if (!input.location.trim()) throw new Error('Default location is required.')
    if (input.participantSelection !== 'eligible_staff') throw new Error('Eligible Staff is the protected default participant selection.')
    if (input.trainerMode !== 'venue_manager' && input.trainerMode !== 'staff') throw new Error('Select a supported default trainer.')
    if (input.trainerMode === 'staff') {
      if (!input.trainerStaffId) throw new Error('Select an active Staff member as the default trainer.')
      const staff = await this.db.query<{ eligible: boolean }>("select coalesce((select (c.metadata->>'eligibleForAssignments')::boolean from configuration_options c where c.group_key='employment_statuses' and c.value=s.employment_status_key),s.employment_status_key='active') eligible from staff s where s.id=$1", [input.trainerStaffId])
      if (!staff.rows[0]?.eligible) throw new Error('The default trainer must be an active Staff member.')
    }
    if (input.categoryValue) {
      const category = await this.db.query<{ active: boolean }>('select active from configuration_options where group_key=$1 and value=$2', [groupKeys.categories, input.categoryValue])
      if (!category.rows[0]?.active) throw new Error('The default category must be active.')
    }
    const saved: TrainingDefaults = { durationMinutes: input.durationMinutes, trainerMode: input.trainerMode, trainerStaffId: input.trainerMode === 'staff' ? input.trainerStaffId : null, location: input.location.trim(), categoryValue: input.categoryValue || null, participantSelection: 'eligible_staff' }
    const before = await this.defaults()
    const existing = await this.db.query<{ id: string }>('select id from configuration_options where group_key=$1 and value=$2', [DEFAULTS_GROUP, DEFAULTS_VALUE])
    const id = existing.rows[0]?.id || randomUUID()
    await this.db.query("insert into configuration_options(id,group_key,value,label,metadata,active,sort_order) values($1,$2,$3,'Manual Training Defaults',$4,true,0) on conflict(id) do update set metadata=excluded.metadata,active=true,updated_at=now()", [id, DEFAULTS_GROUP, DEFAULTS_VALUE, JSON.stringify({ ...saved, outletScopeId: ANDALUCIA_SCOPE_ID, systemControlled: true, protected: true })])
    await this.auditConfiguration(id, existing.rows[0] ? 'updated' : 'created', before, saved, actor)
    return saved
  }

  async target(): Promise<TrainingTargetVersion> {
    const result = await this.db.query<any>('select id,version_number,effective_month::text,monthly_target_credited_minutes,per_head_target_minutes,participant_credit_cap_minutes,calculation_policy_version,approved_by_name_snapshot,approved_at::text from training_target_versions where outlet_scope_id=$1 order by effective_month desc,version_number desc limit 1', [ANDALUCIA_SCOPE_ID])
    if (!result.rows[0]) throw new Error('Training target policy is unavailable.')
    return this.mapTarget(result.rows[0])
  }

  async createTargetVersion(input: { effectiveMonth: string; monthlyTargetHours: number; perHeadTargetHours: number }, actor: { userId: string; displayName: string }): Promise<TrainingTargetVersion> {
    if (!/^\d{4}-\d{2}-01$/.test(input.effectiveMonth)) throw new Error('Target effective month must be the first day of a month.')
    const monthlyMinutes = Math.round(Number(input.monthlyTargetHours) * 60)
    const perHeadMinutes = Math.round(Number(input.perHeadTargetHours) * 60)
    if (!(monthlyMinutes > 0) || !(perHeadMinutes > 0)) throw new Error('Training targets must be greater than zero.')
    const previous = await this.target()
    if (input.effectiveMonth <= previous.effectiveMonth) throw new Error('A new Training target must take effect after the current target version.')
    const id = randomUUID()
    const versionNumber = previous.versionNumber + 1
    await this.db.transaction(async transaction => {
      await transaction.query('insert into training_target_versions(id,outlet_scope_id,version_number,effective_month,monthly_target_credited_minutes,per_head_target_minutes,participant_credit_cap_minutes,calculation_policy_version,approved_by_user_id,approved_by_name_snapshot,approved_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())', [id, ANDALUCIA_SCOPE_ID, versionNumber, input.effectiveMonth, monthlyMinutes, perHeadMinutes, 30, previous.calculationPolicyVersion, actor.userId, actor.displayName])
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'training_target_version', id, 'created', JSON.stringify(previous), JSON.stringify({ effectiveMonth: input.effectiveMonth, monthlyTargetMinutes: monthlyMinutes, perHeadTargetMinutes: perHeadMinutes, participantCreditCapMinutes: 30, calculationPolicyVersion: previous.calculationPolicyVersion }), `${actor.displayName} [${actor.userId}]`])
    })
    return this.target()
  }

  async workflow(): Promise<TrainingWorkflowOption[]> {
    const rows = (await this.db.query<any>('select value,color from configuration_options where group_key=$1', [WORKFLOW_GROUP])).rows
    const colors = new Map(rows.map((row: any) => [row.value, row.color]))
    return protectedWorkflow.map(item => ({ ...item, color: String(colors.get(item.state) || item.color) }))
  }

  async saveWorkflowColor(state: TrainingOperationalStatus, color: string, actor: string): Promise<TrainingWorkflowOption> {
    const definition = protectedWorkflow.find(item => item.state === state)
    if (!definition) throw new Error('Protected Training workflow state not found.')
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Select a valid workflow color.')
    const before = (await this.workflow()).find(item => item.state === state)
    const existing = await this.db.query<{ id: string }>('select id from configuration_options where group_key=$1 and value=$2', [WORKFLOW_GROUP, state])
    const id = existing.rows[0]?.id || randomUUID()
    await this.db.query('insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,$2,$3,$4,$5,$6,true,$7) on conflict(id) do update set color=excluded.color,active=true,updated_at=now()', [id, WORKFLOW_GROUP, state, definition.label, color, JSON.stringify({ workflowState: state, systemControlled: true, protected: true }), protectedWorkflow.findIndex(item => item.state === state)])
    const saved = { ...definition, color }
    await this.auditConfiguration(id, existing.rows[0] ? 'updated' : 'created', before, saved, actor)
    return saved
  }

  private mapTarget(row: any): TrainingTargetVersion {
    const monthlyTargetMinutes = Number(row.monthly_target_credited_minutes); const perHeadTargetMinutes = Number(row.per_head_target_minutes)
    return { id: row.id, versionNumber: Number(row.version_number), effectiveMonth: row.effective_month, monthlyTargetMinutes, monthlyTargetHours: monthlyTargetMinutes / 60, perHeadTargetMinutes, perHeadTargetHours: perHeadTargetMinutes / 60, participantCreditCapMinutes: Number(row.participant_credit_cap_minutes), calculationPolicyVersion: row.calculation_policy_version, approvedBy: row.approved_by_name_snapshot, approvedAt: row.approved_at }
  }

  private async auditConfiguration(entityId: string, action: string, before: unknown, after: unknown, actor: string) {
    await this.db.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'training_configuration', entityId, action, before == null ? null : JSON.stringify(before), JSON.stringify(after), actor])
  }

  private async attendees(trainingId: string): Promise<TrainingAttendee[]> {
    const result = await this.db.query<any>('select a.staff_id, a.attendance_status_value, s.staff_number, s.full_name, s.position_key, s.employment_status_key from training_session_attendees a join staff s on s.id=a.staff_id where a.training_id=$1 order by s.full_name', [trainingId])
    return result.rows.map((row: any) => ({ staffId: row.staff_id, attendanceStatus: row.attendance_status_value, staff: { number: row.staff_number, name: row.full_name, position: row.position_key, employmentStatus: row.employment_status_key } }))
  }

  private async mapSession(row: any): Promise<TrainingSession> {
    const startTime = row.training_time.slice(0, 5)
    return { id: row.id, title: row.title, category: row.category_value, date: row.training_date, time: startTime, startTime, endTime: row.end_time?.slice(0, 5) || startTime, trainer: row.trainer, location: row.location || 'Andalucía', status: row.status_value, notes: row.notes, description: row.notes, active: row.active, attendees: await this.attendees(row.id), source: row.source || 'manual', sourceFileName: row.source_file_name, importBatchId: row.import_batch_id, importedAt: row.imported_at, sourceData: typeof row.source_data === 'string' ? JSON.parse(row.source_data) : row.source_data, managerCorrected: row.manager_corrected, createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by, updatedBy: row.updated_by }
  }

  private select = 'select id, title, category_value, training_date::text, training_time::text, end_time::text, trainer, location, status_value, notes, active, source, source_file_name, import_batch_id, imported_at::text, source_data, manager_corrected, created_at::text, updated_at::text, created_by, updated_by from training_sessions'

  async list(): Promise<TrainingSession[]> {
    const result = await this.db.query<any>(`${this.select} order by training_date desc, training_time desc, title`)
    return Promise.all(result.rows.map((row: any) => this.mapSession(row)))
  }

  async find(id: string): Promise<TrainingSession | null> {
    const result = await this.db.query<any>(`${this.select} where id=$1`, [id])
    return result.rows[0] ? this.mapSession(result.rows[0]) : null
  }

  async save(session: TrainingSession, actor = 'Venue Manager'): Promise<TrainingSession> {
    const previous = await this.find(session.id)
    const startTime = session.startTime || session.time
    const endTime = session.endTime || startTime
    const duplicate = await this.findDuplicate(session.date, session.title, startTime, endTime, session.id)
    if (duplicate) throw new Error('An active training with the same date, topic and time already exists.')
    const selectedIds = [...new Set(session.attendees.map(attendee => attendee.staffId))]
    for (const staffId of selectedIds) {
      const existingAttendee = previous?.attendees.some(attendee => attendee.staffId === staffId)
      const staff = await this.db.query<{ employment_status_key: string }>('select employment_status_key from staff where id=$1', [staffId])
      if (!staff.rows[0]) throw new Error('A selected staff member no longer exists.')
      if (!existingAttendee && staff.rows[0].employment_status_key !== 'active') throw new Error('Inactive staff cannot be assigned to new training sessions.')
    }
    if (previous) {
      await this.db.query('update training_sessions set title=$2, category_value=$3, training_date=$4, training_time=$5, end_time=$6, trainer=$7, location=$8, status_value=$9, notes=$10, active=$11, source=$12, source_file_name=$13, import_batch_id=$14, imported_at=$15, source_data=$16, manager_corrected=$17, updated_by=$18, updated_at=now() where id=$1', [session.id, session.title, session.category, session.date, startTime, endTime, session.trainer, session.location || 'Andalucía', session.status, session.description ?? session.notes ?? '', session.active, session.source || previous.source || 'manual', session.sourceFileName || previous.sourceFileName || null, session.importBatchId || previous.importBatchId || null, session.importedAt || previous.importedAt || null, JSON.stringify(session.sourceData || previous.sourceData || null), Boolean(session.managerCorrected), actor])
    } else {
      await this.db.query('insert into training_sessions (id, title, category_value, training_date, training_time, end_time, trainer, location, status_value, notes, active, source, source_file_name, import_batch_id, imported_at, source_data, manager_corrected, outlet_scope_id, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)', [session.id, session.title, session.category, session.date, startTime, endTime, session.trainer, session.location || 'Andalucía', session.status, session.description ?? session.notes ?? '', session.active, session.source || 'manual', session.sourceFileName || null, session.importBatchId || null, session.importedAt || null, JSON.stringify(session.sourceData || null), Boolean(session.managerCorrected), ANDALUCIA_SCOPE_ID, actor])
    }
    const current = await this.attendees(session.id)
    for (const attendee of current) if (!selectedIds.includes(attendee.staffId)) await this.db.query('delete from training_session_attendees where training_id=$1 and staff_id=$2', [session.id, attendee.staffId])
    for (const attendee of session.attendees) await this.db.query('insert into training_session_attendees (id, training_id, staff_id, attendance_status_value, created_by, updated_by) values ($1,$2,$3,$4,$5,$5) on conflict (training_id, staff_id) do update set attendance_status_value=coalesce(excluded.attendance_status_value, training_session_attendees.attendance_status_value), updated_by=excluded.updated_by, updated_at=now()', [randomUUID(), session.id, attendee.staffId, attendee.attendanceStatus, actor])
    const saved = await this.find(session.id)
    const cancelled = previous && previous.status !== session.status && Boolean((await this.db.query<any>("select 1 from configuration_options where group_key='training_statuses' and value=$1 and metadata->>'trainingStage'='cancelled'", [session.status])).rows[0])
    await this.db.query('insert into audit_logs (id, entity_type, entity_id, action, before_data, after_data, actor) values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'training_session', session.id, previous ? (cancelled ? 'cancelled' : 'updated') : 'created', previous ? JSON.stringify(previous) : null, JSON.stringify(saved), actor])
    if (!saved) throw new Error('Training session could not be saved.')
    return saved
  }

  async findDuplicate(date: string, title: string, startTime: string, endTime: string, excludeId?: string): Promise<string | null> {
    const result = await this.db.query<{ id: string }>("select id from training_sessions where active=true and training_date=$1 and lower(trim(title))=lower(trim($2)) and training_time=$3 and coalesce(end_time,training_time)=$4 and ($5::uuid is null or id<>$5::uuid) limit 1", [date, title, startTime, endTime, excludeId || null])
    return result.rows[0]?.id || null
  }

  async importBatchByHash(fileHash: string): Promise<{ id: string } | null> {
    const result = await this.db.query<{ id: string }>('select id from training_import_batches where file_hash=$1 and active=true', [fileHash])
    return result.rows[0] || null
  }

  async createImportBatch(id: string, fileName: string, fileHash: string, fileType: string, actor = 'Venue Manager') {
    await this.db.query('insert into training_import_batches (id,file_name,file_hash,file_type,created_by,active) values ($1,$2,$3,$4,$5,true)', [id, fileName, fileHash, fileType, actor])
  }

  async importBatch(id: string): Promise<TrainingImportBatch | null> {
    const result = await this.db.query<any>('select id,file_name,file_hash,file_type,imported_at::text,created_by,active,removed_at::text,removed_by,removal_action,replacement_batch_id from training_import_batches where id=$1', [id])
    if (!result.rows[0]) return null
    const sessions = await this.db.query<any>('select id,title,training_date::text,training_time::text,end_time::text,trainer,manager_corrected,source_data,active from training_sessions where import_batch_id=$1 order by training_date,training_time,title', [id])
    const row = result.rows[0]
    return { id: row.id, fileName: row.file_name, fileHash: row.file_hash, fileType: row.file_type, importedAt: row.imported_at, createdBy: row.created_by, active: row.active, removedAt: row.removed_at, removedBy: row.removed_by, removalAction: row.removal_action, replacementBatchId: row.replacement_batch_id, sessionCount: sessions.rows.filter((session: any) => session.active).length, sessions: sessions.rows.map((session: any) => ({ id: session.id, title: session.title, date: session.training_date, startTime: session.training_time.slice(0, 5), endTime: (session.end_time || session.training_time).slice(0, 5), trainer: session.trainer, managerCorrected: session.manager_corrected, originalValues: typeof session.source_data === 'string' ? JSON.parse(session.source_data) : session.source_data, active: session.active })) }
  }

  async importBatchForTraining(trainingId: string): Promise<TrainingImportBatch | null> {
    const result = await this.db.query<{ import_batch_id: string | null }>('select import_batch_id from training_sessions where id=$1 and active=true', [trainingId])
    return result.rows[0]?.import_batch_id ? this.importBatch(result.rows[0].import_batch_id) : null
  }

  private async removeImportBatchWithinTransaction(id: string, action: 'removed' | 'replaced', actor: string, replacementBatchId?: string): Promise<number> {
    const previous = await this.importBatch(id)
    if (!previous || !previous.active) throw new Error('Active training import batch not found.')
    const activeSessions = previous.sessions.filter(session => session.active)
    await this.db.query('update training_sessions set active=false,updated_by=$2,updated_at=now() where import_batch_id=$1 and active=true', [id, actor])
    await this.db.query('update training_import_batches set active=false,removed_at=now(),removed_by=$2,removal_action=$3,replacement_batch_id=$4 where id=$1', [id, actor, action, replacementBatchId || null])
    const after = await this.importBatch(id)
    await this.db.query('insert into audit_logs (id,entity_type,entity_id,action,before_data,after_data,actor) values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'training_import_batch', id, action, JSON.stringify(previous), JSON.stringify(after), actor])
    return activeSessions.length
  }

  async removeImportBatch(id: string, actor = 'Venue Manager'): Promise<number> {
    await this.db.exec('begin')
    try { const removed = await this.removeImportBatchWithinTransaction(id, 'removed', actor); await this.db.exec('commit'); return removed } catch (error) { await this.db.exec('rollback'); throw error }
  }

  async replaceImportBatch(existingBatchId: string, batch: { id: string; fileName: string; fileHash: string; fileType: string }, sessions: TrainingSession[], actor = 'Venue Manager'): Promise<{ removed: number; importedIds: string[] }> {
    await this.db.exec('begin')
    try {
      const removed = await this.removeImportBatchWithinTransaction(existingBatchId, 'replaced', actor, batch.id)
      await this.createImportBatch(batch.id, batch.fileName, batch.fileHash, batch.fileType, actor)
      const importedIds: string[] = []
      for (const session of sessions) { await this.save(session, actor); importedIds.push(session.id) }
      await this.db.exec('commit')
      return { removed, importedIds }
    } catch (error) { await this.db.exec('rollback'); throw error }
  }

  async archive(id: string, actor = 'Venue Manager'): Promise<TrainingSession> {
    const previous = await this.find(id)
    if (!previous) throw new Error('Training session not found.')
    await this.db.query('update training_sessions set active=false,updated_by=$2,updated_at=now() where id=$1', [id, actor])
    const saved = await this.find(id)
    await this.db.query('insert into audit_logs (id,entity_type,entity_id,action,before_data,after_data,actor) values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'training_session', id, 'archived', JSON.stringify(previous), JSON.stringify(saved), actor])
    if (!saved) throw new Error('Training session not found.')
    return saved
  }

  async saveAttendance(trainingId: string, attendance: Array<{ staffId: string; attendanceStatus: string | null }>, actor = 'Venue Manager'): Promise<TrainingSession> {
    const previous = await this.find(trainingId)
    if (!previous) throw new Error('Training session not found.')
    for (const item of attendance) {
      const result = await this.db.query('update training_session_attendees set attendance_status_value=$3, updated_by=$4, updated_at=now() where training_id=$1 and staff_id=$2', [trainingId, item.staffId, item.attendanceStatus, actor])
      if (!result.affectedRows) throw new Error('Attendance can only be recorded for selected attendees.')
    }
    const saved = await this.find(trainingId)
    await this.db.query('insert into audit_logs (id, entity_type, entity_id, action, before_data, after_data, actor) values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'training_session', trainingId, 'attendance_updated', JSON.stringify(previous), JSON.stringify(saved), actor])
    if (!saved) throw new Error('Training attendance could not be saved.')
    return saved
  }

  async staffHistory(staffId: string): Promise<StaffTrainingHistory[]> {
    const result = await this.db.query<any>('select t.id training_id, t.title, t.training_date::text, t.category_value, a.attendance_status_value, t.status_value, t.active from training_session_attendees a join training_sessions t on t.id=a.training_id where a.staff_id=$1 order by t.training_date desc, t.training_time desc', [staffId])
    return result.rows.map((row: any) => ({ trainingId: row.training_id, title: row.title, date: row.training_date, category: row.category_value, attendanceStatus: row.attendance_status_value, status: row.status_value, active: row.active }))
  }
}
