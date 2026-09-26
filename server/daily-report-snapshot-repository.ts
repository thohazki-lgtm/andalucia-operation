import { createHash, randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { AuthPrincipal } from '../src/domain.js'

export type DailyReportStatus = 'draft' | 'reviewed' | 'approved' | 'superseded'
export type DailyReportActor = Pick<AuthPrincipal, 'userId'> & Partial<Pick<AuthPrincipal, 'displayName'>>
type ResolvedDailyReportActor = Pick<AuthPrincipal, 'userId' | 'displayName'>
export type DailyReportRevenueVerification = { acknowledged: boolean; verifiedByUserId?: string; verifiedByName?: string; verifiedAt?: string; netSale?: string; totalRevenue?: string; difference?: string; messages?: string[] }

export type DailyReportManualPayload = {
  symphony: {
    foodRevenue: string; beverageRevenue: string; wineRevenue: string; liquorRevenue: string
    totalSale: string; totalDiscount: string; totalVoid: string; netSale: string; totalRevenue: string
    voidDetails: Array<{ amount: string; reason: string; checkInvoiceNumber: string }>
  }
  serviceVerification: { doubleDinePax: number | null; details: Array<{ roomNumber: string; pax: number; sourceOutlet: string; note: string }> }
  manager: { operationSummary: string; keyOperationalIssue?: string; guestFeedbackServiceRecovery?: string; followUpRequired?: string }
  revenueVerification?: DailyReportRevenueVerification
  completion?: Record<string, 'complete' | 'warning' | 'missing'>
}

export type DailyReportFrozenPayload = {
  servicePerformance: {
    totalCovers: number; adults: number; kids: number; totalBookings: number; arrivedCovers: number
    noShowCovers: number; noShowRooms: string[]; walkIns: number
    bookingByTimeSlot: Array<Record<string, unknown>>
  }
  symphony: DailyReportManualPayload['symphony']
  serviceVerification: DailyReportManualPayload['serviceVerification']
  upselling: { chargeables: Array<Record<string, unknown>>; wineSpirits: Array<Record<string, unknown>>; details?: Array<Record<string, unknown>>; totalUpsellRevenue: string; itemsSold?: number; topItem?: string; topSeller?: string }
  guestOccasions: { categories: Array<Record<string, unknown>>; roomDetails: Array<Record<string, unknown>> }
  manager: DailyReportManualPayload['manager']
  revenueVerification?: DailyReportRevenueVerification
  identity: {
    outletScopeId: string; serviceDate: string; revisionNumber: number; status: 'approved'
    preparedBy: { userId: string; name: string; at: string }
    reviewedBy: { userId: string; name: string; at: string }
    approvedBy: { userId: string; name: string; at: string }
  }
}
export type DailyReportSnapshotContent = Omit<DailyReportFrozenPayload, 'identity'>

export type DailyReportRecord = {
  id: string; outletScopeId: string; serviceDate: string; revisionNumber: number; status: DailyReportStatus
  isCurrentAuthority: boolean; manualPayload: DailyReportManualPayload
  preparedByUserId: string; preparedByName: string; preparedAt: string
  reviewedByUserId: string | null; reviewedByName: string | null; reviewedAt: string | null
  approvedByUserId: string | null; approvedByName: string | null; approvedAt: string | null
}

export type DailyReportSnapshot = {
  id: string; dailyReportId: string; outletScopeId: string; serviceDate: string; revisionNumber: number
  frozenPayload: DailyReportFrozenPayload; snapshotSha256: string; approvalIdempotencyKey: string
  approvedByUserId: string; approvedByName: string; approvedAt: string; createdAt: string
}

const validDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3])
}
const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
    : JSON.stringify(value)
export const dailyReportSnapshotChecksum = (payload: DailyReportFrozenPayload) => createHash('sha256').update(canonical(payload)).digest('hex')
const actorLabel = (actor: ResolvedDailyReportActor) => `${actor.displayName} [${actor.userId}]`
const json = <T>(value: T | string): T => typeof value === 'string' ? JSON.parse(value) as T : value

export class DailyReportSnapshotRepository {
  constructor(private readonly db: PGlite) {}

  private async authorizedActor(actor: DailyReportActor, outletScopeId: string, database: any = this.db): Promise<ResolvedDailyReportActor> {
    if (!actor.userId) throw new Error('Authenticated report actor is required.')
    const resolved = (await database.query(`select u.id::text user_id,u.display_name,
      exists(select 1 from authorization_user_roles ur join authorization_roles r on r.id=ur.role_id and r.active=true where ur.user_id=u.id and ur.active=true and r.global_scope=true) global_scope,
      exists(select 1 from authorization_user_roles ur join authorization_roles r on r.id=ur.role_id and r.active=true join authorization_role_permissions rp on rp.role_id=r.id join authorization_permissions p on p.id=rp.permission_id and p.active=true where ur.user_id=u.id and ur.active=true and p.permission_key='manage_reports') manage_reports,
      exists(select 1 from authorization_user_outlet_scopes uo join outlet_scopes o on o.id=uo.outlet_scope_id and o.active=true where uo.user_id=u.id and uo.outlet_scope_id=$2 and uo.active=true) allowed_outlet
      from user_accounts u where u.id=$1 and u.status='active'`, [actor.userId, outletScopeId])).rows[0]
    if (!resolved) throw new Error('Authenticated report actor is required.')
    if (!resolved.global_scope && !resolved.manage_reports) throw new Error('Manage Reports permission is required.')
    if (!resolved.global_scope && !resolved.allowed_outlet) throw new Error('The authenticated report actor is not authorized for this OutletScope.')
    return { userId: resolved.user_id, displayName: resolved.display_name }
  }
  resolveActor(actor: DailyReportActor, outletScopeId: string) { return this.authorizedActor(actor, outletScopeId) }

  private report(row: any): DailyReportRecord {
    return { id: row.id, outletScopeId: row.outlet_scope_id, serviceDate: row.service_date, revisionNumber: Number(row.revision_number), status: row.status, isCurrentAuthority: row.is_current_authority, manualPayload: json(row.manual_payload), preparedByUserId: row.prepared_by_user_id, preparedByName: row.prepared_by_name_snapshot, preparedAt: row.prepared_at, reviewedByUserId: row.reviewed_by_user_id, reviewedByName: row.reviewed_by_name_snapshot, reviewedAt: row.reviewed_at, approvedByUserId: row.approved_by_user_id, approvedByName: row.approved_by_name_snapshot, approvedAt: row.approved_at }
  }
  private snapshot(row: any): DailyReportSnapshot {
    return { id: row.id, dailyReportId: row.daily_report_id, outletScopeId: row.outlet_scope_id, serviceDate: row.service_date, revisionNumber: Number(row.revision_number), frozenPayload: json(row.frozen_payload), snapshotSha256: row.snapshot_sha256, approvalIdempotencyKey: row.approval_idempotency_key, approvedByUserId: row.approved_by_user_id, approvedByName: row.approved_by_name_snapshot, approvedAt: row.approved_at, createdAt: row.created_at }
  }
  private reportColumns = `id,outlet_scope_id,service_date::text,revision_number,status,is_current_authority,manual_payload,prepared_by_user_id,prepared_by_name_snapshot,prepared_at::text,reviewed_by_user_id,reviewed_by_name_snapshot,reviewed_at::text,approved_by_user_id,approved_by_name_snapshot,approved_at::text`
  private snapshotColumns = `id,daily_report_id,outlet_scope_id,service_date::text,revision_number,frozen_payload,snapshot_sha256,approval_idempotency_key,approved_by_user_id,approved_by_name_snapshot,approved_at::text,created_at::text`

  async byId(id: string) {
    const row = (await this.db.query<any>(`select ${this.reportColumns} from daily_reports where id=$1`, [id])).rows[0]
    return row ? this.report(row) : null
  }
  async currentForDate(outletScopeId: string, serviceDate: string) {
    const row = (await this.db.query<any>(`select ${this.reportColumns} from daily_reports where outlet_scope_id=$1 and service_date=$2 and is_current_authority=true`, [outletScopeId, serviceDate])).rows[0]
    return row ? this.report(row) : null
  }
  async snapshotForReport(reportId: string) {
    const row = (await this.db.query<any>(`select ${this.snapshotColumns} from daily_report_snapshots where daily_report_id=$1`, [reportId])).rows[0]
    return row ? this.snapshot(row) : null
  }
  async createDraft(input: { outletScopeId: string; serviceDate: string; manualPayload: DailyReportManualPayload }, actor: DailyReportActor) {
    if (!validDate(input.serviceDate)) throw new Error('Daily Report service date must use a valid YYYY-MM-DD date.')
    const resolvedActor = await this.authorizedActor(actor, input.outletScopeId)
    const id = randomUUID()
    await this.db.transaction(async transaction => {
      const current = (await transaction.query('select id from daily_reports where outlet_scope_id=$1 and service_date=$2 and is_current_authority=true for update', [input.outletScopeId, input.serviceDate])).rows[0]
      if (current) throw new Error('A current Daily Report revision already exists for this service date.')
      await transaction.query(`insert into daily_reports(id,outlet_scope_id,service_date,revision_number,status,is_current_authority,manual_payload,prepared_by_user_id,prepared_by_name_snapshot,created_by_user_id,created_by_name_snapshot,updated_by_user_id,updated_by_name_snapshot) values($1,$2,$3,1,'draft',true,$4,$5,$6,$5,$6,$5,$6)`, [id, input.outletScopeId, input.serviceDate, JSON.stringify(input.manualPayload), resolvedActor.userId, resolvedActor.displayName])
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,null,$5,$6)', [randomUUID(), 'daily_report', id, 'draft_created', JSON.stringify({ outletScopeId: input.outletScopeId, serviceDate: input.serviceDate, revisionNumber: 1 }), actorLabel(resolvedActor)])
    })
    return (await this.byId(id))!
  }
  async updateDraft(id: string, manualPayload: DailyReportManualPayload, actor: DailyReportActor) {
    const current = await this.byId(id)
    if (!current) throw new Error('Daily Report not found.')
    const resolvedActor = await this.authorizedActor(actor, current.outletScopeId)
    const updated = await this.db.query<any>(`update daily_reports set manual_payload=$2,updated_by_user_id=$3,updated_by_name_snapshot=$4,updated_at=now() where id=$1 and status='draft' returning ${this.reportColumns}`, [id, JSON.stringify(manualPayload), resolvedActor.userId, resolvedActor.displayName])
    if (!updated.rows[0]) throw new Error('Only Draft reports can be edited.')
    await this.db.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,null,$5,$6)', [randomUUID(), 'daily_report', id, 'manual_payload_updated', JSON.stringify({ manualPayload }), actorLabel(resolvedActor)])
    return this.report(updated.rows[0])
  }
  async review(id: string, actor: DailyReportActor) {
    const current = await this.byId(id)
    if (!current) throw new Error('Daily Report not found.')
    const resolvedActor = await this.authorizedActor(actor, current.outletScopeId)
    if (current.status === 'reviewed') return current
    if (current.status !== 'draft') throw new Error('Only Draft reports can be reviewed.')
    const updated = await this.db.query<any>(`update daily_reports set status='reviewed',reviewed_by_user_id=$2,reviewed_by_name_snapshot=$3,reviewed_at=now(),updated_by_user_id=$2,updated_by_name_snapshot=$3,updated_at=now() where id=$1 and status='draft' returning ${this.reportColumns}`, [id, resolvedActor.userId, resolvedActor.displayName])
    if (!updated.rows[0]) throw new Error('Daily Report review state changed before completion.')
    await this.db.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'daily_report', id, 'reviewed', JSON.stringify(current), JSON.stringify(this.report(updated.rows[0])), actorLabel(resolvedActor)])
    return this.report(updated.rows[0])
  }
  private validateFrozenPayload(payload: DailyReportSnapshotContent) {
    for (const key of ['servicePerformance', 'symphony', 'serviceVerification', 'upselling', 'guestOccasions', 'manager'] as const) if (!payload[key] || typeof payload[key] !== 'object') throw new Error(`Approved Daily Report snapshot is missing ${key}.`)
    if (!Array.isArray(payload.servicePerformance.bookingByTimeSlot) || !Array.isArray(payload.symphony.voidDetails) || !Array.isArray(payload.serviceVerification.details) || !Array.isArray(payload.upselling.chargeables) || !Array.isArray(payload.upselling.wineSpirits) || !Array.isArray(payload.guestOccasions.roomDetails)) throw new Error('Approved Daily Report snapshot detail collections are required.')
  }
  async approve(id: string, content: DailyReportSnapshotContent, idempotencyKey: string, actor: DailyReportActor) {
    if (!actor.userId) throw new Error('Authenticated report actor is required.')
    this.validateFrozenPayload(content)
    if (idempotencyKey.trim().length < 12) throw new Error('Approval idempotency key is required.')
    let snapshotId = ''
    await this.db.transaction(async transaction => {
      const locked = (await transaction.query<any>(`select ${this.reportColumns} from daily_reports where id=$1 for update`, [id])).rows[0]
      if (!locked) throw new Error('Daily Report not found.')
      const resolvedActor = await this.authorizedActor(actor, locked.outlet_scope_id, transaction)
      const existing = (await transaction.query<any>(`select ${this.snapshotColumns} from daily_report_snapshots where daily_report_id=$1`, [id])).rows[0]
      if (existing) {
        if (existing.approval_idempotency_key !== idempotencyKey) throw new Error('Daily Report revision is already approved.')
        snapshotId = existing.id
        return
      }
      if (locked.status !== 'reviewed') throw new Error('Only Reviewed reports can be approved.')
      const approved = (await transaction.query<any>(`update daily_reports set status='approved',approved_by_user_id=$2,approved_by_name_snapshot=$3,approved_at=now(),updated_by_user_id=$2,updated_by_name_snapshot=$3,updated_at=now() where id=$1 and status='reviewed' returning approved_at::text`, [id, resolvedActor.userId, resolvedActor.displayName])).rows[0]
      if (!approved) throw new Error('Daily Report approval state changed before completion.')
      snapshotId = randomUUID()
      const frozenPayload: DailyReportFrozenPayload = { ...content, identity: { outletScopeId: locked.outlet_scope_id, serviceDate: locked.service_date, revisionNumber: Number(locked.revision_number), status: 'approved', preparedBy: { userId: locked.prepared_by_user_id, name: locked.prepared_by_name_snapshot, at: locked.prepared_at }, reviewedBy: { userId: locked.reviewed_by_user_id, name: locked.reviewed_by_name_snapshot, at: locked.reviewed_at }, approvedBy: { userId: resolvedActor.userId, name: resolvedActor.displayName, at: approved.approved_at } } }
      const checksum = dailyReportSnapshotChecksum(frozenPayload)
      await transaction.query(`insert into daily_report_snapshots(id,daily_report_id,outlet_scope_id,service_date,revision_number,frozen_payload,snapshot_sha256,approval_idempotency_key,approved_by_user_id,approved_by_name_snapshot,approved_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [snapshotId, id, locked.outlet_scope_id, locked.service_date, locked.revision_number, JSON.stringify(frozenPayload), checksum, idempotencyKey, resolvedActor.userId, resolvedActor.displayName, approved.approved_at])
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'daily_report', id, 'approved_snapshot_created', JSON.stringify(this.report(locked)), JSON.stringify({ snapshotId, checksum, outletScopeId: locked.outlet_scope_id, serviceDate: locked.service_date, revisionNumber: locked.revision_number }), actorLabel(resolvedActor)])
    })
    return (await this.snapshotForReport(id))!
  }
  async createRevision(previousId: string, manualPayload: DailyReportManualPayload, actor: DailyReportActor) {
    if (!actor.userId) throw new Error('Authenticated report actor is required.')
    const newId = randomUUID()
    await this.db.transaction(async transaction => {
      const previous = (await transaction.query<any>(`select ${this.reportColumns} from daily_reports where id=$1 for update`, [previousId])).rows[0]
      if (!previous || previous.status !== 'approved' || !previous.is_current_authority) throw new Error('Only the current approved Daily Report can begin a correction revision.')
      const resolvedActor = await this.authorizedActor(actor, previous.outlet_scope_id, transaction)
      if (!(await transaction.query('select id from daily_report_snapshots where daily_report_id=$1', [previousId])).rows[0]) throw new Error('Approved Daily Report snapshot is missing.')
      await transaction.query(`update daily_reports set status='superseded',is_current_authority=false,updated_by_user_id=$2,updated_by_name_snapshot=$3,updated_at=now() where id=$1`, [previousId, resolvedActor.userId, resolvedActor.displayName])
      await transaction.query(`insert into daily_reports(id,outlet_scope_id,service_date,revision_number,status,is_current_authority,manual_payload,prepared_by_user_id,prepared_by_name_snapshot,created_by_user_id,created_by_name_snapshot,updated_by_user_id,updated_by_name_snapshot) values($1,$2,$3,$4,'draft',true,$5,$6,$7,$6,$7,$6,$7)`, [newId, previous.outlet_scope_id, previous.service_date, Number(previous.revision_number) + 1, JSON.stringify(manualPayload), resolvedActor.userId, resolvedActor.displayName])
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'daily_report', newId, 'revision_created', JSON.stringify({ previousId }), JSON.stringify({ revisionNumber: Number(previous.revision_number) + 1 }), actorLabel(resolvedActor)])
    })
    return (await this.byId(newId))!
  }
  async currentApprovedSnapshots(outletScopeId: string, startDate: string, endDate: string) {
    const columns = this.snapshotColumns.split(',').map(column => `snapshot.${column}`).join(',')
    const rows = (await this.db.query<any>(`select ${columns} from daily_report_snapshots snapshot join daily_reports report on report.id=snapshot.daily_report_id where snapshot.outlet_scope_id=$1 and snapshot.service_date between $2 and $3 and report.status='approved' and report.is_current_authority=true order by snapshot.service_date`, [outletScopeId, startDate, endDate])).rows
    return rows.map(row => this.snapshot(row))
  }
  async aggregateApproved(outletScopeId: string, startDate: string, endDate: string) {
    const snapshots = await this.currentApprovedSnapshots(outletScopeId, startDate, endDate)
    return snapshots.reduce((total, item) => ({ days: total.days + 1, covers: total.covers + item.frozenPayload.servicePerformance.totalCovers, doubleDinePax: total.doubleDinePax + Number(item.frozenPayload.serviceVerification.doubleDinePax || 0), totalRevenue: (Number(total.totalRevenue) + Number(item.frozenPayload.symphony.totalRevenue)).toFixed(2), totalUpsellRevenue: (Number(total.totalUpsellRevenue) + Number(item.frozenPayload.upselling.totalUpsellRevenue)).toFixed(2), guestOccasions: total.guestOccasions + item.frozenPayload.guestOccasions.categories.reduce((sum, category) => sum + Number(category.count || 0), 0) }), { days: 0, covers: 0, doubleDinePax: 0, totalRevenue: '0.00', totalUpsellRevenue: '0.00', guestOccasions: 0 })
  }
}
