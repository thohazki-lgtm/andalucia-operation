import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { AuthPrincipal, ConfigOption, MaintenanceDuplicateWarning, MaintenanceRecord, MaintenanceSummary } from '../src/domain.js'
import { serviceDate } from '../src/service-date.js'

export type MaintenanceConfigGroup = 'areas' | 'statuses'
export interface MaintenanceWriteContext { outletScopeId: string; actor: AuthPrincipal }
const groupKeys: Record<MaintenanceConfigGroup, string> = { areas: 'maintenance_areas', statuses: 'maintenance_statuses' }
const protectedStatuses = new Set(['open', 'in_progress', 'completed'])
const seeds: Record<MaintenanceConfigGroup, Array<Omit<ConfigOption, 'id'>>> = {
  areas: ['Dining Area', 'Kitchen', 'Bar', 'Hostess Desk', 'Store', 'Back of House', 'Terrace', 'Other'].map(label => ({ value: label.toLowerCase().replaceAll(' ', '_'), label, active: true })),
  statuses: [
    { value: 'open', label: 'Open', color: '#b74b45', active: true, metadata: { maintenanceStage: 'open', protected: true } },
    { value: 'in_progress', label: 'In Progress', color: '#b38b3a', active: true, metadata: { maintenanceStage: 'inProgress', protected: true } },
    { value: 'completed', label: 'Completed', color: '#2f8063', active: true, metadata: { maintenanceStage: 'completed', protected: true } }
  ]
}
const mapOption = (row: any): ConfigOption => ({ ...row, sortOrder: row.sort_order, metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata })
const actorLabel = (actor: AuthPrincipal) => `${actor.displayName} (${actor.loginIdentifier})`
const normalizeIssue = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en').replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim()
const dateDistance = (left: string, right: string) => Math.abs(Math.round((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86400000))

export class MaintenanceRepository {
  private r2Capability: boolean | null = null
  constructor(private readonly db: PGlite) {}

  async initialize() {
    for (const group of Object.keys(groupKeys) as MaintenanceConfigGroup[]) {
      const existing = await this.db.query<{ count: number }>('select count(*)::int count from configuration_options where group_key=$1', [groupKeys[group]])
      if (existing.rows[0].count === 0) for (let index = 0; index < seeds[group].length; index++) {
        const option = seeds[group][index]
        await this.db.query('insert into configuration_options (id,group_key,value,label,color,metadata,active,sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), groupKeys[group], option.value, option.label, option.color || null, JSON.stringify(option.metadata || {}), option.active, index])
      }
    }
  }

  private async r2Ready() {
    if (this.r2Capability !== null) return this.r2Capability
    const result = await this.db.query<{ count: number }>("select count(*)::int count from information_schema.columns where table_schema='public' and table_name='maintenance_issues' and column_name in ('outlet_scope_id','reference_follow_up','completed_at','revision')")
    this.r2Capability = result.rows[0].count === 4
    return this.r2Capability
  }
  private async requireR2() { if (!(await this.r2Ready())) throw new Error('Maintenance R2 requires Migration 018 before records can be changed.') }

  async configuration(): Promise<Record<MaintenanceConfigGroup, ConfigOption[]>> {
    const output = {} as Record<MaintenanceConfigGroup, ConfigOption[]>
    for (const group of Object.keys(groupKeys) as MaintenanceConfigGroup[]) {
      const result = await this.db.query<any>('select id,value,label,color,metadata,active,sort_order from configuration_options where group_key=$1 order by sort_order,label', [groupKeys[group]])
      output[group] = result.rows.map(mapOption)
    }
    return output
  }

  async saveConfiguration(group: MaintenanceConfigGroup, option: ConfigOption, actor: AuthPrincipal): Promise<ConfigOption> {
    const current = option.id ? (await this.db.query<any>('select id,value,label,color,metadata,active,sort_order from configuration_options where id=$1 and group_key=$2', [option.id, groupKeys[group]])).rows[0] : null
    if (group === 'statuses') {
      if (!current || !protectedStatuses.has(current.value)) throw new Error('Maintenance workflow identities are protected.')
      const currentMetadata = typeof current.metadata === 'string' ? JSON.parse(current.metadata) : current.metadata || {}
      if (option.value !== current.value || option.label !== current.label || option.active !== true || JSON.stringify(option.metadata || {}) !== JSON.stringify(currentMetadata)) throw new Error('Only the display color of protected Maintenance workflow statuses can be changed.')
      const result = await this.db.query<any>('update configuration_options set color=$2,updated_at=now() where id=$1 returning id,value,label,color,metadata,active,sort_order', [current.id, option.color || null])
      await this.audit('maintenance_configuration', current.id, 'workflow_color_changed', mapOption(current), mapOption(result.rows[0]), actor)
      return mapOption(result.rows[0])
    }
    const label = option.label.trim()
    if (!label) throw new Error('Area name is required.')
    const duplicate = await this.db.query<{ id: string }>("select id from configuration_options where group_key=$1 and active=true and lower(regexp_replace(trim(label),'\\s+',' ','g'))=lower(regexp_replace(trim($2),'\\s+',' ','g')) and id<>$3", [groupKeys.areas, label, option.id || '00000000-0000-0000-0000-000000000000'])
    if (duplicate.rows[0]) throw new Error('An active Maintenance Area already uses that name.')
    const id = current?.id || option.id || randomUUID(); const value = current?.value || `maintenance_area_${randomUUID()}`
    const sortOrder = current?.sort_order ?? Number((await this.db.query<{ next: number }>('select coalesce(max(sort_order),-1)::int+1 next from configuration_options where group_key=$1', [groupKeys.areas])).rows[0].next)
    const result = await this.db.query<any>('insert into configuration_options (id,group_key,value,label,color,metadata,active,sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict(id) do update set label=excluded.label,color=excluded.color,active=excluded.active,updated_at=now() returning id,value,label,color,metadata,active,sort_order', [id, groupKeys.areas, value, label, option.color || null, JSON.stringify(current?.metadata || {}), option.active !== false, sortOrder])
    const saved = mapOption(result.rows[0]); const action = !current ? 'area_created' : current.active !== saved.active ? (saved.active ? 'area_restored' : 'area_archived') : current.label !== saved.label ? 'area_label_changed' : 'area_updated'
    await this.audit('maintenance_configuration', id, action, current ? mapOption(current) : null, saved, actor)
    return saved
  }

  private async select(outletScopeId?: string, id?: string) {
    const r2 = await this.r2Ready()
    const extra = r2 ? 'm.priority,m.outlet_scope_id,m.reference_follow_up,m.completed_at::text,m.completed_by_user_id,m.completed_by_name_snapshot,m.reporter_name_snapshot,m.reporter_number_snapshot,m.revision' : "m.priority,null::uuid outlet_scope_id,null::text reference_follow_up,null::text completed_at,null::uuid completed_by_user_id,null::text completed_by_name_snapshot,null::text reporter_name_snapshot,null::text reporter_number_snapshot,1::int revision"
    const values: unknown[] = []; const where: string[] = []
    if (r2 && outletScopeId) { values.push(outletScopeId); where.push(`m.outlet_scope_id=$${values.length}`) }
    if (id) { values.push(id); where.push(`m.id=$${values.length}`) }
    return this.db.query<any>(`select m.id,m.issue,m.issue_date::text,m.area_value,m.status,m.notes,m.reported_by_staff_id,m.created_at::text,m.updated_at::text,m.created_by,m.updated_by,${extra},s.full_name reporter_name,s.staff_number reporter_number,s.position_key reporter_position,s.employment_status_key reporter_employment_status from maintenance_issues m left join staff s on s.id=m.reported_by_staff_id ${where.length ? `where ${where.join(' and ')}` : ''} order by m.issue_date desc,m.created_at desc`, values)
  }
  private mapRecord(row: any): MaintenanceRecord { return { id: row.id, issue: row.issue, dateReported: row.issue_date, area: row.area_value, priority: row.priority || 'Operational', status: row.status, referenceFollowUp: row.reference_follow_up || '', notes: row.notes || '', reportedByStaffId: row.reported_by_staff_id, reportedBy: row.reported_by_staff_id && row.reporter_name ? { name: row.reporter_name, number: row.reporter_number, position: row.reporter_position, employmentStatus: row.reporter_employment_status } : null, reporterNameSnapshot: row.reporter_name_snapshot, reporterNumberSnapshot: row.reporter_number_snapshot, completedAt: row.completed_at, completedByUserId: row.completed_by_user_id, completedByNameSnapshot: row.completed_by_name_snapshot, outletScopeId: row.outlet_scope_id, revision: Number(row.revision || 1), createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by, updatedBy: row.updated_by } }
  async list(outletScopeId?: string): Promise<MaintenanceRecord[]> { return (await this.select(outletScopeId)).rows.map(row => this.mapRecord(row)) }
  async find(id: string, outletScopeId?: string): Promise<MaintenanceRecord | null> { const row = (await this.select(outletScopeId, id)).rows[0]; return row ? this.mapRecord(row) : null }
  private stage(statuses: ConfigOption[], value: string) { return statuses.find(option => option.value === value)?.metadata?.maintenanceStage || 'open' }

  async save(record: MaintenanceRecord, suppliedContext?: MaintenanceWriteContext): Promise<MaintenanceRecord> {
    await this.requireR2()
    const context = suppliedContext || await this.testContext()
    const previous = await this.find(record.id, context.outletScopeId)
    const expectedRevision = record.revision ?? 1
    if ((!previous && expectedRevision !== 1) || (previous && expectedRevision !== previous.revision)) throw new Error('MAINTENANCE_CONCURRENCY_CONFLICT')
    const configuration = await this.configuration(); const area = configuration.areas.find(option => option.value === record.area); const status = configuration.statuses.find(option => option.value === record.status)
    if (!area || ((!previous || previous.area !== record.area) && !area.active)) throw new Error('Inactive maintenance areas cannot be used for new assignments.')
    if (!status || !protectedStatuses.has(status.value) || !status.active) throw new Error('Select a protected Maintenance workflow status.')
    if (!['normal', 'urgent'].includes(String(record.priority).toLowerCase())) throw new Error('Select Normal or Urgent priority.')
    if (previous?.completedAt) throw new Error('Completed Maintenance issues are terminal and cannot be casually reopened or edited.')
    const previousStage = previous ? this.stage(configuration.statuses, previous.status) : null; const nextStage = this.stage(configuration.statuses, record.status)
    if (!previous && nextStage !== 'open') throw new Error('New Maintenance issues must begin Open.')
    if (previousStage === 'open' && !['open', 'inProgress'].includes(nextStage)) throw new Error('Move an Open issue to In Progress before completing it.')
    if (previousStage === 'inProgress' && !['inProgress', 'completed'].includes(nextStage)) throw new Error('In Progress issues can only remain In Progress or be Completed.')
    let reporter: any = null
    if (record.reportedByStaffId && record.reportedByStaffId !== previous?.reportedByStaffId) {
      reporter = (await this.db.query<any>('select full_name,staff_number,employment_status_key from staff where id=$1', [record.reportedByStaffId])).rows[0]
      if (!reporter) throw new Error('The selected staff member no longer exists.')
      if (reporter.employment_status_key !== 'active') throw new Error('Inactive staff cannot be assigned to new maintenance records.')
    }
    const actor = actorLabel(context.actor)
    if (previous) {
      const completing = previousStage !== 'completed' && nextStage === 'completed'
      const result = await this.db.query<any>('update maintenance_issues set issue=$2,issue_date=$3,area_value=$4,priority=$5,status=$6,reference_follow_up=$7,notes=$8,reported_by_staff_id=$9,reporter_name_snapshot=case when $9 is distinct from reported_by_staff_id then $10 else reporter_name_snapshot end,reporter_number_snapshot=case when $9 is distinct from reported_by_staff_id then $11 else reporter_number_snapshot end,completed_at=case when $12 then now() else completed_at end,completed_by_user_id=case when $12 then $13 else completed_by_user_id end,completed_by_name_snapshot=case when $12 then $14 else completed_by_name_snapshot end,updated_by=$14,updated_at=now(),revision=revision+1 where id=$1 and outlet_scope_id=$15 and revision=$16 returning id', [record.id, record.issue.trim(), record.dateReported, record.area, String(record.priority || 'normal').toLowerCase(), record.status, record.referenceFollowUp?.trim() || null, record.notes || '', record.reportedByStaffId || null, reporter?.full_name || null, reporter?.staff_number || null, completing, context.actor.userId, actor, context.outletScopeId, previous.revision])
      if (!result.rows[0]) throw new Error('MAINTENANCE_CONCURRENCY_CONFLICT')
    } else await this.db.query('insert into maintenance_issues (id,issue,issue_date,area_value,priority,status,reference_follow_up,notes,reported_by_staff_id,reporter_name_snapshot,reporter_number_snapshot,outlet_scope_id,revision,assigned_to,reported_at,created_by,updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,null,$3::date,$13,$13)', [record.id, record.issue.trim(), record.dateReported, record.area, String(record.priority || 'normal').toLowerCase(), record.status, record.referenceFollowUp?.trim() || null, record.notes || '', record.reportedByStaffId || null, reporter?.full_name || null, reporter?.staff_number || null, context.outletScopeId, actor])
    const saved = await this.find(record.id, context.outletScopeId); if (!saved) throw new Error('Maintenance issue could not be saved.')
    const action = !previous ? 'created' : saved.completedAt && !previous.completedAt ? 'completed' : previous.status !== saved.status ? 'status_changed' : previous.priority !== saved.priority ? 'priority_changed' : previous.referenceFollowUp !== saved.referenceFollowUp ? 'follow_up_changed' : 'updated'
    await this.audit('maintenance_issue', record.id, action, previous, saved, context.actor)
    return saved
  }

  async duplicateWarnings(record: Pick<MaintenanceRecord, 'issue' | 'area' | 'dateReported' | 'reportedByStaffId'>, outletScopeId: string): Promise<MaintenanceDuplicateWarning[]> {
    const configuration = await this.configuration(); const records = await this.list(outletScopeId)
    return records.filter(existing => this.stage(configuration.statuses, existing.status) !== 'completed' && existing.area === record.area && normalizeIssue(existing.issue) === normalizeIssue(record.issue)).map(existing => ({ id: existing.id, issue: existing.issue, area: existing.area, status: existing.status, dateReported: existing.dateReported, reporter: existing.reportedBy ? `${existing.reportedBy.name} · ${existing.reportedBy.number}` : existing.reporterNameSnapshot || 'Not recorded', sameReporter: Boolean(record.reportedByStaffId && record.reportedByStaffId === existing.reportedByStaffId), daysApart: dateDistance(record.dateReported, existing.dateReported) })).sort((a, b) => a.daysApart - b.daysApart)
  }

  async summary(date: string, outletScopeId?: string): Promise<MaintenanceSummary> {
    const records = await this.list(outletScopeId); const statuses = (await this.configuration()).statuses; const stage = (record: MaintenanceRecord) => this.stage(statuses, record.status); const unresolved = records.filter(record => stage(record) !== 'completed')
    return { openIssues: records.filter(record => stage(record) === 'open').length, inProgress: records.filter(record => stage(record) === 'inProgress').length, completedToday: records.filter(record => stage(record) === 'completed' && record.completedAt && serviceDate(new Date(record.completedAt)) === date).length, unresolved: unresolved.length, urgentUnresolved: unresolved.filter(record => record.priority === 'urgent').length, normalUnresolved: unresolved.filter(record => record.priority !== 'urgent').length }
  }
  private async testContext(): Promise<MaintenanceWriteContext> { const outlet = (await this.db.query<{ id: string }>("select id from outlet_scopes where scope_key='andalucia' and active=true limit 1")).rows[0]; if (!outlet) throw new Error('The Andalucía Maintenance outlet is unavailable.'); return { outletScopeId: outlet.id, actor: { userId: '00000000-0000-4000-8000-000000000001', sessionId: 'repository-test', loginIdentifier: 'repository.test', displayName: 'Repository Test', staffId: null, roleKeys: ['owner'], permissionKeys: ['manage_maintenance'], globalScope: true, allowedOutletScopeIds: [outlet.id], isOwner: true } } }
  private async audit(entityType: string, entityId: string, action: string, before: unknown, after: unknown, actor: AuthPrincipal) { await this.db.query('insert into audit_logs (id,entity_type,entity_id,action,before_data,after_data,actor) values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), entityType, entityId, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, actorLabel(actor)]) }
}
