import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { OutletScope, ResolvedStaffMembership, StaffMembershipHistory, StaffMembershipReviewStatus, StaffMembershipScopeResolution, StaffMembershipSource } from '../src/domain.js'

export const STAFF_MEMBERSHIP_BASELINE_DATE = '2026-09-01'
export const ANDALUCIA_SCOPE_KEY = 'andalucia'
export const ANDALUCIA_SCOPE_ID = '00000000-0000-4000-8000-00000000a001'

const dateParts = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const maximum = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  return month >= 1 && month <= 12 && day >= 1 && day <= maximum ? { year, month, day } : null
}
const ordinal = (value: string) => {
  const parts = dateParts(value)
  if (!parts) throw new Error('Membership dates must use valid YYYY-MM-DD calendar dates.')
  const previousYear = parts.year - 1
  const daysBeforeYear = previousYear * 365 + Math.floor(previousYear / 4) - Math.floor(previousYear / 100) + Math.floor(previousYear / 400)
  const monthDays = [31, parts.year % 4 === 0 && (parts.year % 100 !== 0 || parts.year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return daysBeforeYear + monthDays.slice(0, parts.month - 1).reduce((sum, days) => sum + days, 0) + parts.day
}
const monthRange = (month: string) => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month)
  if (!match) throw new Error('Membership month must use YYYY-MM.')
  const year = Number(match[1]); const monthNumber = Number(match[2]); const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const last = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][monthNumber - 1]
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` }
}
const maxDate = (...values: string[]) => values.reduce((maximum, value) => value > maximum ? value : maximum)
const minDate = (...values: string[]) => values.reduce((minimum, value) => value < minimum ? value : minimum)
export class OutletMembershipRepository {
  constructor(private readonly db: PGlite) {}

  async initialize() {
    const existing = await this.findOutletByKey(ANDALUCIA_SCOPE_KEY)
    if (existing) return
    const outlet: OutletScope = { id: ANDALUCIA_SCOPE_ID, scopeKey: ANDALUCIA_SCOPE_KEY, displayName: 'Andalucía', active: true, outletType: 'restaurant' }
    await this.db.transaction(async transaction => {
      await transaction.query('insert into outlet_scopes(id,scope_key,display_name,active,outlet_type,created_by,updated_by) values($1,$2,$3,true,$4,$5,$5)', [outlet.id, outlet.scopeKey, outlet.displayName, outlet.outletType, 'System initialization'])
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,null,$5,$6)', [randomUUID(), 'outlet_scope', outlet.id, 'created', JSON.stringify(outlet), 'System initialization'])
    })
  }

  private mapOutlet(row: any): OutletScope {
    return { id: row.id, scopeKey: row.scope_key, displayName: row.display_name, active: row.active, outletType: row.outlet_type, createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by, updatedBy: row.updated_by }
  }

  async outlets(): Promise<OutletScope[]> {
    const result = await this.db.query<any>('select id,scope_key,display_name,active,outlet_type,created_at::text,updated_at::text,created_by,updated_by from outlet_scopes order by active desc,display_name')
    return result.rows.map(row => this.mapOutlet(row))
  }

  async findOutletByKey(scopeKey: string): Promise<OutletScope | null> {
    const result = await this.db.query<any>('select id,scope_key,display_name,active,outlet_type,created_at::text,updated_at::text,created_by,updated_by from outlet_scopes where scope_key=$1', [scopeKey])
    return result.rows[0] ? this.mapOutlet(result.rows[0]) : null
  }

  async saveOutlet(outlet: OutletScope, actor = 'Venue Manager') {
    if (!/^[a-z][a-z0-9_]*$/.test(outlet.scopeKey) || !outlet.displayName.trim()) throw new Error('Outlet scope key and display name are required.')
    const found = await this.db.query<any>('select id,scope_key,display_name,active,outlet_type from outlet_scopes where id=$1', [outlet.id])
    const before = found.rows[0] ? this.mapOutlet(found.rows[0]) : null
    if (before && before.scopeKey !== outlet.scopeKey) throw new Error('Outlet scope key is immutable.')
    await this.db.transaction(async transaction => {
      if (before) await transaction.query('update outlet_scopes set display_name=$2,active=$3,outlet_type=$4,updated_by=$5,updated_at=now() where id=$1', [outlet.id, outlet.displayName.trim(), outlet.active, outlet.outletType || null, actor])
      else await transaction.query('insert into outlet_scopes(id,scope_key,display_name,active,outlet_type,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$6)', [outlet.id, outlet.scopeKey, outlet.displayName.trim(), outlet.active, outlet.outletType || null, actor])
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'outlet_scope', outlet.id, before ? 'updated' : 'created', before ? JSON.stringify(before) : null, JSON.stringify(outlet), actor])
    })
    return (await this.findOutletByKey(outlet.scopeKey))!
  }

  private mapMembership(row: any): StaffMembershipHistory {
    return { id: row.id, staffId: row.staff_id, outletScopeId: row.outlet_scope_id, membershipDimension: row.membership_dimension, effectiveFrom: row.effective_from, effectiveTo: row.effective_to, source: row.source, reason: row.reason, reviewStatus: row.review_status, reviewedAt: row.reviewed_at, reviewedBy: row.reviewed_by, baselineRevisionId: row.baseline_revision_id, isCurrentBaseline: row.is_current_baseline, createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by, updatedBy: row.updated_by }
  }

  async membership(id: string): Promise<StaffMembershipHistory | null> {
    const result = await this.db.query<any>('select id,staff_id,outlet_scope_id,membership_dimension,effective_from::text,effective_to::text,source,reason,review_status,reviewed_at::text,reviewed_by,baseline_revision_id,is_current_baseline,created_at::text,updated_at::text,created_by,updated_by from staff_membership_history where id=$1', [id])
    return result.rows[0] ? this.mapMembership(result.rows[0]) : null
  }

  private validateMembership(input: StaffMembershipHistory) {
    if (!dateParts(input.effectiveFrom) || (input.effectiveTo && !dateParts(input.effectiveTo))) throw new Error('Membership dates must use valid YYYY-MM-DD calendar dates.')
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw new Error('Membership end date cannot be before its start date.')
    if (!input.membershipDimension.trim() || !['baseline_manager_review', 'transfer', 'new_hire', 'resignation', 'correction', 'system'].includes(input.source) || !['pending_review', 'approved'].includes(input.reviewStatus)) throw new Error('Membership dimension, source and review status are required.')
  }

  async createMembership(input: StaffMembershipHistory, actor = 'Venue Manager') {
    this.validateMembership(input)
    const staff = await this.db.query<any>('select join_date::text from staff where id=$1', [input.staffId])
    if (!staff.rows[0]) throw new Error('Staff member not found.')
    if (input.effectiveFrom < staff.rows[0].join_date) throw new Error('Membership cannot begin before the staff joining date.')
    const outlet = await this.db.query('select id from outlet_scopes where id=$1', [input.outletScopeId])
    if (!outlet.rows[0]) throw new Error('Outlet scope not found.')
    const overlap = await this.db.query('select id from staff_membership_history where staff_id=$1 and membership_dimension=$2 and $3<=coalesce(effective_to,\'9999-12-31\'::date) and effective_from<=coalesce($4::date,\'9999-12-31\'::date) limit 1', [input.staffId, input.membershipDimension, input.effectiveFrom, input.effectiveTo || null])
    if (input.membershipDimension === 'regular_outlet' && overlap.rows[0]) throw new Error('Regular outlet membership overlaps an existing period.')
    const reviewedAt = input.reviewStatus === 'approved' ? input.reviewedAt || new Date().toISOString() : null
    const reviewedBy = input.reviewStatus === 'approved' ? input.reviewedBy || actor : null
    await this.db.transaction(async transaction => {
      await transaction.query('insert into staff_membership_history(id,staff_id,outlet_scope_id,membership_dimension,effective_from,effective_to,source,reason,review_status,reviewed_at,reviewed_by,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)', [input.id, input.staffId, input.outletScopeId, input.membershipDimension, input.effectiveFrom, input.effectiveTo || null, input.source, input.reason || '', input.reviewStatus, reviewedAt, reviewedBy, actor])
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,null,$5,$6)', [randomUUID(), 'staff_membership_history', input.id, input.source === 'baseline_manager_review' && input.reviewStatus === 'approved' ? 'baseline_approved' : 'created', JSON.stringify({ ...input, reviewedAt, reviewedBy }), actor])
    })
    return (await this.membership(input.id))!
  }

  async closeMembership(id: string, effectiveTo: string, source: StaffMembershipSource, reason: string, actor = 'Venue Manager') {
    const before = await this.membership(id)
    if (!before) throw new Error('Staff membership record not found.')
    if (!dateParts(effectiveTo) || effectiveTo < before.effectiveFrom) throw new Error('Membership end date cannot be before its start date.')
    await this.db.transaction(async transaction => {
      await transaction.query('update staff_membership_history set effective_to=$2,source=$3,reason=$4,updated_by=$5,updated_at=now() where id=$1', [id, effectiveTo, source, reason.trim(), actor])
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'staff_membership_history', id, source === 'transfer' ? 'transferred' : 'closed', JSON.stringify(before), JSON.stringify({ ...before, effectiveTo, source, reason: reason.trim() }), actor])
    })
    return (await this.membership(id))!
  }

  async approveMembership(id: string, actor = 'Venue Manager') {
    const before = await this.membership(id)
    if (!before) throw new Error('Staff membership record not found.')
    if (before.reviewStatus === 'approved') return before
    await this.db.transaction(async transaction => {
      await transaction.query("update staff_membership_history set review_status='approved',reviewed_at=now(),reviewed_by=$2,updated_by=$2,updated_at=now() where id=$1", [id, actor])
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'staff_membership_history', id, before.source === 'baseline_manager_review' ? 'baseline_approved' : 'approved', JSON.stringify(before), JSON.stringify({ ...before, reviewStatus: 'approved', reviewedBy: actor }), actor])
    })
    return (await this.membership(id))!
  }

  async resolveRegularStaffScope(month: string, outletScopeKey: string): Promise<StaffMembershipScopeResolution> {
    const range = monthRange(month)
    return this.resolveStaffMembershipForRange(range.start, range.end, outletScopeKey, 'regular_outlet')
  }

  async resolveStaffMembershipForDate(date: string, outletScopeKey: string, membershipDimension = 'regular_outlet') {
    return this.resolveStaffMembershipForRange(date, date, outletScopeKey, membershipDimension)
  }

  async resolveStaffMembershipForRange(startDate: string, endDate: string, outletScopeKey: string, membershipDimension = 'regular_outlet'): Promise<StaffMembershipScopeResolution> {
    if (!dateParts(startDate) || !dateParts(endDate) || endDate < startDate) throw new Error('Select a valid membership date range.')
    const outlet = await this.findOutletByKey(outletScopeKey)
    if (!outlet) return { outlet: null, startDate, endDate, members: [], blocker: 'OUTLET_SCOPE_NOT_FOUND' }
    const rows = await this.db.query<any>(`select m.id membership_id,m.staff_id,m.outlet_scope_id,m.effective_from::text,m.effective_to::text,m.source,m.review_status,s.full_name,s.staff_number,s.position_key,s.employment_status_key,s.join_date::text,s.resignation_date::text from staff_membership_history m join staff s on s.id=m.staff_id where m.outlet_scope_id=$1 and m.membership_dimension=$2 and m.review_status='approved' and m.is_current_baseline=true and m.effective_from<=$4 and coalesce(m.effective_to,'9999-12-31'::date)>=$3 order by m.effective_from,s.full_name`, [outlet.id, membershipDimension, startDate, endDate])
    if (membershipDimension === 'regular_outlet' && endDate < STAFF_MEMBERSHIP_BASELINE_DATE && rows.rows.length === 0) return { outlet, startDate, endDate, members: [], blocker: 'STAFF_MEMBERSHIP_HISTORY_PRE_BASELINE' }
    if (membershipDimension === 'regular_outlet' && outletScopeKey === ANDALUCIA_SCOPE_KEY && endDate >= STAFF_MEMBERSHIP_BASELINE_DATE) {
      const baseline = await this.db.query("select id from staff_membership_history where outlet_scope_id=$1 and membership_dimension='regular_outlet' and source='baseline_manager_review' and review_status='approved' and is_current_baseline=true and effective_from between '2026-09-01' and '2026-09-30' limit 1", [outlet.id])
      if (!baseline.rows[0]) return { outlet, startDate, endDate, members: [], blocker: 'STAFF_MEMBERSHIP_BASELINE_NOT_APPROVED' }
    }
    const members = rows.rows.flatMap((row: any): ResolvedStaffMembership[] => {
      const start = maxDate(startDate, row.effective_from, row.join_date)
      const end = minDate(endDate, row.effective_to || endDate, row.resignation_date || endDate)
      if (end < start) return []
      return [{ membershipId: row.membership_id, staffId: row.staff_id, staffName: row.full_name, staffNumber: row.staff_number, designation: row.position_key, employmentStatus: row.employment_status_key, outletScopeId: row.outlet_scope_id, outletScopeKey: outlet.scopeKey, outletDisplayName: outlet.displayName, membershipStartWithinPeriod: start, membershipEndWithinPeriod: end, membershipDays: ordinal(end) - ordinal(start) + 1, source: row.source, reviewStatus: row.review_status as StaffMembershipReviewStatus }]
    })
    return { outlet, startDate, endDate, members, blocker: null }
  }
}
