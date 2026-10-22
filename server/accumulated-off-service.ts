import { createHash, randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { AuthPrincipal, RosterBatchChange } from '../src/domain.js'
import { addCalendarDays, calendarDates, rosterWeekRange, serviceDate } from '../src/service-date.js'

export interface AccumulatedOffBalance {
  staffId: string
  opening: number
  earned: number
  reserved: number
  consumed: number
  available: number
  conflict: boolean
  evaluatedThrough: string | null
}

export interface AccumulatedOffHistoryInitializationResult {
  outletScopeId: string
  firstEligibleWeek: string
  evaluatedThrough: string | null
  eligibleStaff: number
  evaluations: number
  earnedDays: number
  incompleteWeeks: number
  ineligibleWeeks: number
}

const firstEligibleWeek = '2026-09-06'
const actorLabel = (actor: AuthPrincipal | string) => typeof actor === 'string' ? actor : `${actor.displayName} [${actor.userId}]`
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const metadata = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value || {}

export class AccumulatedOffService {
  constructor(private readonly db: PGlite) {}

  async ready() {
    const result = await this.db.query<{ count: number }>("select count(*)::int count from information_schema.tables where table_schema='public' and table_name='accumulated_off_week_evaluations'")
    return Number(result.rows[0]?.count || 0) === 1
  }

  private async outletId() {
    const result = await this.db.query<{ id: string }>("select id from outlet_scopes where scope_key='andalucia' and active=true")
    if (!result.rows[0]) throw new Error('Accumulated OFF requires the active Andalucía outlet.')
    return result.rows[0].id
  }

  async recalculateWeek(staffId: string, outletScopeId: string, dateOrWeekStart: string, actor: AuthPrincipal | string = 'Accumulated OFF evaluator') {
    if (!(await this.ready())) return null
    const [weekStart, weekEnd] = rosterWeekRange(dateOrWeekStart)
    const lastCompleted = addCalendarDays(rosterWeekRange(serviceDate())[0], -1)
    if (weekStart < firstEligibleWeek || weekEnd > lastCompleted) return null
    const membership = (await this.db.query<any>(`select m.id from staff_membership_history m join staff s on s.id=m.staff_id where m.staff_id=$1 and m.outlet_scope_id=$2 and m.membership_dimension='regular_outlet' and m.review_status='approved' and m.is_current_baseline=true and m.effective_from<=$3 and coalesce(m.effective_to,'9999-12-31'::date)>=$4 and s.join_date<=$3 and coalesce(s.resignation_date,'9999-12-31'::date)>=$4 order by m.effective_from desc limit 1`, [staffId, outletScopeId, weekStart, weekEnd])).rows[0]
    const roster = (await this.db.query<any>(`select r.id,r.duty_date::text date,r.duty_code_value,c.label,c.metadata from duty_roster_entries r left join configuration_options c on c.group_key='duty_codes' and c.value=r.duty_code_value where r.staff_id=$1 and r.duty_date between $2 and $3 order by r.duty_date`, [staffId, weekStart, weekEnd])).rows
    const evaluated = roster.map(row => {
      const meta = metadata(row.metadata) as any
      const displayCode = String(meta.displayCode || row.duty_code_value).toUpperCase()
      return { rosterEntryId: row.id, date: row.date, dutyCodeValue: row.duty_code_value, displayCode, label: row.label || row.duty_code_value, recognized: Boolean(row.metadata), working: meta.countsAsWorking === true, off: meta.countsAsOffDay === true || meta.dutyClassification === 'off' || displayCode === 'OFF' }
    })
    const assignmentCount = evaluated.length
    const workingCount = evaluated.filter(item => item.working).length
    const offCount = evaluated.filter(item => item.off).length
    const unknownCount = evaluated.filter(item => !item.recognized).length
    const state = !membership ? 'ineligible' : assignmentCount !== 7 || unknownCount ? 'incomplete' : workingCount === 7 && offCount === 0 ? 'earned' : 'not_earned'
    const earnedDays = state === 'earned' ? 1 : 0
    const evidence = { policy: 'one_off_per_completed_sunday_saturday_week', weekStart, weekEnd, membershipId: membership?.id || null, assignments: evaluated, outcome: state }
    const evidenceDigest = digest(evidence)
    const existing = (await this.db.query<any>('select * from accumulated_off_week_evaluations where outlet_scope_id=$1 and staff_id=$2 and week_start=$3', [outletScopeId, staffId, weekStart])).rows[0]
    if (existing?.evidence_digest === evidenceDigest && Number(existing.earned_days) === earnedDays) return existing
    const id = existing?.id || randomUUID()
    await this.db.transaction(async transaction => {
      await transaction.query(`insert into accumulated_off_week_evaluations(id,outlet_scope_id,staff_id,membership_id,week_start,week_end,evaluation_state,earned_days,assignment_count,working_count,off_count,evidence,evidence_digest,revision) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1) on conflict(outlet_scope_id,staff_id,week_start) do update set membership_id=excluded.membership_id,week_end=excluded.week_end,evaluation_state=excluded.evaluation_state,earned_days=excluded.earned_days,assignment_count=excluded.assignment_count,working_count=excluded.working_count,off_count=excluded.off_count,evidence=excluded.evidence,evidence_digest=excluded.evidence_digest,revision=accumulated_off_week_evaluations.revision+1,evaluated_at=now(),updated_at=now()`, [id, outletScopeId, staffId, membership?.id || null, weekStart, weekEnd, state, earnedDays, assignmentCount, workingCount, offCount, JSON.stringify(evidence), evidenceDigest])
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'accumulated_off_week', id, existing ? 'recalculated' : 'evaluated', existing ? JSON.stringify({ state: existing.evaluation_state, earnedDays: Number(existing.earned_days), evidenceDigest: existing.evidence_digest }) : null, JSON.stringify({ staffId, weekStart, weekEnd, state, earnedDays, evidenceDigest }), actorLabel(actor)])
    })
    return (await this.db.query<any>('select * from accumulated_off_week_evaluations where id=$1', [id])).rows[0]
  }

  async recalculateAffected(changes: RosterBatchChange[], actor: AuthPrincipal | string = 'Accumulated OFF evaluator') {
    if (!(await this.ready())) return
    const outletScopeId = await this.outletId()
    const unique = new Map<string, { staffId: string; date: string }>()
    for (const change of changes) { const weekStart = rosterWeekRange(change.date)[0]; unique.set(`${change.staffId}|${weekStart}`, { staffId: change.staffId, date: weekStart }) }
    for (const item of unique.values()) await this.recalculateWeek(item.staffId, outletScopeId, item.date, actor)
  }

  async recalculateStaff(staffId: string, outletScopeId: string, actor: AuthPrincipal | string = 'Accumulated OFF evaluator') {
    const lastCompleted = addCalendarDays(rosterWeekRange(serviceDate())[0], -1)
    for (let weekStart = firstEligibleWeek; addCalendarDays(weekStart, 6) <= lastCompleted; weekStart = addCalendarDays(weekStart, 7)) await this.recalculateWeek(staffId, outletScopeId, weekStart, actor)
  }

  async initializeEligibleHistory(outletScopeId: string, actor: AuthPrincipal | string = 'Accumulated OFF initial evaluator'): Promise<AccumulatedOffHistoryInitializationResult> {
    if (!(await this.ready())) throw new Error('ACCUMULATED_OFF_MIGRATION_026_REQUIRED')
    const lastCompleted = addCalendarDays(rosterWeekRange(serviceDate())[0], -1)
    if (lastCompleted < firstEligibleWeek) return { outletScopeId, firstEligibleWeek, evaluatedThrough: null, eligibleStaff: 0, evaluations: 0, earnedDays: 0, incompleteWeeks: 0, ineligibleWeeks: 0 }
    const staff = (await this.db.query<{ staff_id: string }>(`select distinct membership.staff_id
      from staff_membership_history membership
      join staff on staff.id=membership.staff_id
      where membership.outlet_scope_id=$1
        and membership.membership_dimension='regular_outlet'
        and membership.review_status='approved'
        and membership.is_current_baseline=true
        and membership.effective_from<=$2
        and coalesce(membership.effective_to,'9999-12-31'::date)>=$3
        and staff.join_date<=$2
        and coalesce(staff.resignation_date,'9999-12-31'::date)>=$3
      order by membership.staff_id`, [outletScopeId, lastCompleted, firstEligibleWeek])).rows
    for (const member of staff) await this.recalculateStaff(member.staff_id, outletScopeId, actor)
    const summary = (await this.db.query<{ evaluations: number; earned_days: number; incomplete_weeks: number; ineligible_weeks: number }>(`select count(*)::int evaluations,
      coalesce(sum(earned_days),0)::int earned_days,
      count(*) filter(where evaluation_state='incomplete')::int incomplete_weeks,
      count(*) filter(where evaluation_state='ineligible')::int ineligible_weeks
      from accumulated_off_week_evaluations
      where outlet_scope_id=$1 and week_start>=$2 and week_end<=$3`, [outletScopeId, firstEligibleWeek, lastCompleted])).rows[0]
    const auditSeed = digest(`accumulated-off-history|${outletScopeId}|${firstEligibleWeek}`)
    const auditId = `${auditSeed.slice(0, 8)}-${auditSeed.slice(8, 12)}-4${auditSeed.slice(13, 16)}-a${auditSeed.slice(17, 20)}-${auditSeed.slice(20, 32)}`
    await this.db.query(`insert into audit_logs(id,entity_type,entity_id,action,after_data,actor)
      values($1,'accumulated_off_history',$2,'initialized',$3,$4)
      on conflict(id) do nothing`, [auditId, outletScopeId, JSON.stringify({ firstEligibleWeek, evaluatedThrough: lastCompleted, eligibleStaff: staff.length, evaluations: Number(summary?.evaluations || 0), earnedDays: Number(summary?.earned_days || 0) }), actorLabel(actor)])
    return {
      outletScopeId,
      firstEligibleWeek,
      evaluatedThrough: lastCompleted,
      eligibleStaff: staff.length,
      evaluations: Number(summary?.evaluations || 0),
      earnedDays: Number(summary?.earned_days || 0),
      incompleteWeeks: Number(summary?.incomplete_weeks || 0),
      ineligibleWeeks: Number(summary?.ineligible_weeks || 0)
    }
  }

  async balance(staffId: string, outletScopeId: string, options: { excludePlannedLeaveId?: string } = {}): Promise<AccumulatedOffBalance> {
    if (!(await this.ready())) return { staffId, opening: 0, earned: 0, reserved: 0, consumed: 0, available: 0, conflict: false, evaluatedThrough: null }
    await this.recalculateStaff(staffId, outletScopeId)
    const totals = (await this.db.query<any>(`select coalesce((select sum(days) from accumulated_off_opening_entries where outlet_scope_id=$1 and staff_id=$2),0)::int opening,coalesce((select sum(earned_days) from accumulated_off_week_evaluations where outlet_scope_id=$1 and staff_id=$2),0)::int earned,coalesce((select sum(accumulated_off_days_allocated) from planned_leave_periods where outlet_scope_id=$1 and staff_id=$2 and planning_state='booked' and ($3::uuid is null or id<>$3::uuid)),0)::int allocated,coalesce((select count(*) from accumulated_off_consumptions where outlet_scope_id=$1 and staff_id=$2),0)::int consumed,coalesce((select max(week_end)::text from accumulated_off_week_evaluations where outlet_scope_id=$1 and staff_id=$2),null) evaluated_through`, [outletScopeId, staffId, options.excludePlannedLeaveId || null])).rows[0]
    const opening = Number(totals.opening), earned = Number(totals.earned), consumed = Number(totals.consumed), allocated = Number(totals.allocated)
    const activeConsumed = Number((await this.db.query<any>(`select count(*)::int count from accumulated_off_consumptions c join planned_leave_periods p on p.id=c.planned_leave_period_id where c.outlet_scope_id=$1 and c.staff_id=$2 and p.planning_state='booked' and ($3::uuid is null or p.id<>$3::uuid)`, [outletScopeId, staffId, options.excludePlannedLeaveId || null])).rows[0]?.count || 0)
    const reserved = Math.max(0, allocated - activeConsumed)
    const available = opening + earned - consumed - reserved
    return { staffId, opening, earned, reserved, consumed, available, conflict: available < 0, evaluatedThrough: totals.evaluated_through || null }
  }

  async addOpeningBalance(input: { staffId: string; days: number; effectiveDate: string; justification: string; evidenceReference: string }, context: { outletScopeId: string; actor: AuthPrincipal }) {
    if (!(await this.ready())) throw new Error('ACCUMULATED_OFF_MIGRATION_026_REQUIRED')
    if (!Number.isInteger(input.days) || input.days < 1) throw new Error('Accumulated OFF opening balance must be a positive whole number.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate) || input.effectiveDate >= firstEligibleWeek) throw new Error('Opening balance evidence must predate automatic accumulation on 06 September 2026.')
    if (input.justification.trim().length < 10 || input.evidenceReference.trim().length < 3) throw new Error('Verified historical evidence and a clear manager justification are required.')
    const id = randomUUID()
    await this.db.transaction(async transaction => {
      await transaction.query(`insert into accumulated_off_opening_entries(id,outlet_scope_id,staff_id,days,effective_date,justification,evidence_reference,created_by_user_id,created_by_name_snapshot) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, context.outletScopeId, input.staffId, input.days, input.effectiveDate, input.justification.trim(), input.evidenceReference.trim(), context.actor.userId, context.actor.displayName])
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,after_data,actor) values($1,$2,$3,$4,$5,$6)', [randomUUID(), 'accumulated_off_opening', id, 'created', JSON.stringify(input), actorLabel(context.actor)])
    })
    return this.balance(input.staffId, context.outletScopeId)
  }

  async confirmConsumption(plannedLeaveId: string, dutyDates: string[], context: { outletScopeId: string; actor: AuthPrincipal }) {
    if (!(await this.ready())) throw new Error('ACCUMULATED_OFF_MIGRATION_026_REQUIRED')
    if (!dutyDates.length || new Set(dutyDates).size !== dutyDates.length) throw new Error('Select distinct roster OFF dates to confirm accumulated OFF usage.')
    const period = (await this.db.query<any>(`select * from planned_leave_periods where id=$1 and outlet_scope_id=$2`, [plannedLeaveId, context.outletScopeId])).rows[0]
    if (!period) throw new Error('Booked leave period not found.')
    const existingCount = Number((await this.db.query<any>('select count(*)::int count from accumulated_off_consumptions where planned_leave_period_id=$1', [plannedLeaveId])).rows[0]?.count || 0)
    if (existingCount + dutyDates.length > Number(period.accumulated_off_days_allocated)) throw new Error('Confirmed accumulated OFF usage exceeds the manager allocation.')
    const rows = (await this.db.query<any>(`select r.id,r.duty_date::text date,r.duty_code_value,c.label,c.metadata from duty_roster_entries r left join configuration_options c on c.group_key='duty_codes' and c.value=r.duty_code_value where r.staff_id=$1 and r.duty_date=any($2::date[])`, [period.staff_id, dutyDates])).rows
    for (const date of dutyDates) {
      const row = rows.find(item => item.date === date); const meta = metadata(row?.metadata) as any; const code = String(meta.displayCode || row?.duty_code_value || '').toUpperCase()
      if (!row || date < period.start_date || date > period.end_date || !(meta.countsAsOffDay === true || meta.dutyClassification === 'off' || code === 'OFF')) throw new Error(`Accumulated OFF consumption requires confirmed Duty Roster OFF evidence for ${date}.`)
    }
    await this.db.transaction(async transaction => {
      for (const row of rows) {
        const evidence = { rosterEntryId: row.id, date: row.date, dutyCodeValue: row.duty_code_value, dutyLabel: row.label || row.duty_code_value, explicitManagerConfirmation: true }
        await transaction.query(`insert into accumulated_off_consumptions(id,outlet_scope_id,staff_id,planned_leave_period_id,roster_entry_id,duty_date,duty_code_value,evidence,confirmed_by_user_id,confirmed_by_name_snapshot) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [randomUUID(), context.outletScopeId, period.staff_id, plannedLeaveId, row.id, row.date, row.duty_code_value, JSON.stringify(evidence), context.actor.userId, context.actor.displayName])
      }
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,after_data,actor) values($1,$2,$3,$4,$5,$6)', [randomUUID(), 'accumulated_off_consumption', plannedLeaveId, 'confirmed', JSON.stringify({ dutyDates }), actorLabel(context.actor)])
    })
    return this.balance(period.staff_id, context.outletScopeId)
  }
}
