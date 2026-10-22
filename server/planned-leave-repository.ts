import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { isLeaveClassification, leaveClassificationForCode, type AuthPrincipal, type LeaveClassification, type PlannedLeavePeriod, type PlannedLeaveWriteInput } from '../src/domain.js'
import { calendarDates } from '../src/service-date.js'
import { serviceDate } from '../src/service-date.js'
import type { AccumulatedOffService } from './accumulated-off-service.js'

type Context = { outletScopeId: string; actor: AuthPrincipal }
const actorLabel = (actor: AuthPrincipal) => `${actor.displayName} [${actor.userId}]`
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const classification = (metadata: any, value: string): LeaveClassification | null => {
  const code = String(metadata?.displayCode || value).toUpperCase()
  const result = metadata?.countsAsLeave ? 'annualLeave' : metadata?.countsAsOffDay ? 'off' : metadata?.countsAsPublicHoliday ? 'publicHoliday' : metadata?.countsAsSickLeave ? 'sickLeave' : metadata?.dutyClassification
  return isLeaveClassification(result) ? result : leaveClassificationForCode(code) || null
}

export class PlannedLeaveRepository {
  constructor(private readonly db: PGlite, private readonly accumulatedOff?: AccumulatedOffService) {}

  async ready() {
    const result = await this.db.query<{ count: number }>("select count(*)::int count from information_schema.tables where table_schema='public' and table_name='planned_leave_periods'")
    return Number(result.rows[0]?.count || 0) === 1
  }

  private async requireReady() { if (!(await this.ready())) throw new Error('PLANNED_LEAVE_MIGRATION_019_REQUIRED') }
  private validate(input: PlannedLeaveWriteInput) {
    if (!validDate(input.startDate) || !validDate(input.endDate) || input.endDate < input.startDate) throw new Error('Select a valid booked leave date range.')
    if (input.startDate < serviceDate()) throw new Error('Booked leave must begin today or later. Historical leave remains Duty Roster-derived.')
    if (input.leaveType !== 'annual_leave') throw new Error('Annual Leave is the only supported booked leave type.')
    if ((input.managerNote || '').length > 500) throw new Error('Booked leave notes are limited to 500 characters.')
    const calendarDays = calendarDates(input.startDate, input.endDate).length
    const allocatedOff = input.accumulatedOffDaysAllocated ?? 0
    if (!Number.isInteger(allocatedOff) || allocatedOff < 0 || allocatedOff > calendarDays) throw new Error('Accumulated OFF allocation must be a whole number within the booking period.')
  }

  private async requireAvailableAccumulatedOff(input: PlannedLeaveWriteInput, context: Context, excludeId?: string) {
    const allocatedOff = input.accumulatedOffDaysAllocated ?? 0
    if (!allocatedOff) return
    if (!this.accumulatedOff || !(await this.accumulatedOff.ready())) throw new Error('ACCUMULATED_OFF_MIGRATION_026_REQUIRED')
    const balance = await this.accumulatedOff.balance(input.staffId, context.outletScopeId, { excludePlannedLeaveId: excludeId })
    if (allocatedOff > balance.available) throw new Error(`Accumulated OFF allocation exceeds the verified available balance of ${Math.max(0, balance.available)}.`)
  }

  private async requireMembership(staffId: string, startDate: string, endDate: string, outletScopeId: string) {
    const result = await this.db.query<{ count: number }>(`select count(*)::int count from staff_membership_history membership join staff on staff.id=membership.staff_id where membership.staff_id=$1 and membership.outlet_scope_id=$2 and membership.membership_dimension='regular_outlet' and membership.review_status='approved' and membership.is_current_baseline=true and membership.effective_from<=$3 and coalesce(membership.effective_to,'9999-12-31'::date)>=$4 and staff.join_date<=$3 and coalesce(staff.resignation_date,'9999-12-31'::date)>=$4`, [staffId, outletScopeId, startDate, endDate])
    if (Number(result.rows[0]?.count || 0) !== 1) throw new Error('The booked period must remain within one approved Andalucía Team Membership.')
  }

  private async requireNoOverlap(staffId: string, startDate: string, endDate: string, outletScopeId: string, excludeId?: string) {
    const result = await this.db.query<{ id: string }>(`select id from planned_leave_periods where outlet_scope_id=$1 and staff_id=$2 and planning_state='booked' and start_date<=$4 and $3<=end_date and ($5::uuid is null or id<>$5::uuid) limit 1`, [outletScopeId, staffId, startDate, endDate, excludeId || null])
    if (result.rows[0]) throw new Error('This booked period overlaps another active booked period for the staff member.')
  }

  private async rosterEvidence(staffId: string, startDate: string, endDate: string) {
    const rows = await this.db.query<any>(`select roster.duty_date::text date,roster.duty_code_value,configuration.label,configuration.metadata from duty_roster_entries roster left join configuration_options configuration on configuration.group_key='duty_codes' and configuration.value=roster.duty_code_value where roster.staff_id=$1 and roster.duty_date between $2 and $3 order by roster.duty_date`, [staffId, startDate, endDate])
    return rows.rows.flatMap(row => { const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {}; const kind = classification(metadata, row.duty_code_value); return kind ? [{ date: row.date, dutyCode: String(metadata.displayCode || row.duty_code_value).toUpperCase(), dutyLabel: row.label || row.duty_code_value, classification: kind }] : [] })
  }

  private async requireNoConfirmedCollision(staffId: string, startDate: string, endDate: string) {
    const evidence = await this.rosterEvidence(staffId, startDate, endDate)
    if (evidence.length) throw new Error(`Booked leave conflicts with confirmed Duty Roster evidence on ${evidence.map(item => item.date).join(', ')}.`)
  }

  private map(row: any, evidence: Awaited<ReturnType<PlannedLeaveRepository['rosterEvidence']>>): PlannedLeavePeriod {
    return {
      id: row.id, outletScopeId: row.outlet_scope_id, staffId: row.staff_id, staffName: row.full_name, staffNumber: row.staff_number, designation: row.position_key,
      startDate: row.start_date, endDate: row.end_date, leaveType: row.leave_type, planningState: row.planning_state, managerNote: row.manager_note || '', bookedDays: calendarDates(row.start_date, row.end_date).length, accumulatedOffDaysAllocated: Number(row.accumulated_off_days_allocated || 0), plannedAnnualLeaveDays: calendarDates(row.start_date, row.end_date).length - Number(row.accumulated_off_days_allocated || 0), accumulatedOffDaysConsumed: Number(row.accumulated_off_days_consumed || 0), revision: Number(row.revision), confirmedEvidence: evidence,
      createdAt: row.created_at, updatedAt: row.updated_at, createdByUserId: row.created_by_user_id, createdByName: row.created_by_name_snapshot, updatedByUserId: row.updated_by_user_id, updatedByName: row.updated_by_name_snapshot,
      cancelledAt: row.cancelled_at, cancelledByUserId: row.cancelled_by_user_id, cancelledByName: row.cancelled_by_name_snapshot, cancellationReason: row.cancellation_reason || ''
    }
  }

  async list(outletScopeId: string, startDate: string, endDate: string, staffId?: string, includeCancelled = true) {
    await this.requireReady()
    if (!validDate(startDate) || !validDate(endDate) || endDate < startDate) throw new Error('Select a valid booked leave date range.')
    const result = await this.db.query<any>(`select planned.id,planned.outlet_scope_id,planned.staff_id,planned.start_date::text,planned.end_date::text,planned.leave_type,planned.planning_state,planned.manager_note,planned.accumulated_off_days_allocated,planned.revision,planned.cancelled_at::text,planned.cancelled_by_user_id,planned.cancelled_by_name_snapshot,planned.cancellation_reason,planned.created_by_user_id,planned.created_by_name_snapshot,planned.updated_by_user_id,planned.updated_by_name_snapshot,planned.created_at::text,planned.updated_at::text,staff.full_name,staff.staff_number,staff.position_key,(select count(*)::int from accumulated_off_consumptions consumption where consumption.planned_leave_period_id=planned.id) accumulated_off_days_consumed from planned_leave_periods planned join staff on staff.id=planned.staff_id where planned.outlet_scope_id=$1 and planned.start_date<=$3 and planned.end_date>=$2 and ($4::uuid is null or planned.staff_id=$4::uuid) and ($5::boolean or planned.planning_state='booked') order by planned.start_date,staff.full_name`, [outletScopeId, startDate, endDate, staffId || null, includeCancelled])
    return Promise.all(result.rows.map(async row => this.map(row, await this.rosterEvidence(row.staff_id, row.start_date, row.end_date))))
  }

  async find(id: string, outletScopeId: string) {
    await this.requireReady()
    const result = await this.db.query<any>(`select planned.id,planned.outlet_scope_id,planned.staff_id,planned.start_date::text,planned.end_date::text,planned.leave_type,planned.planning_state,planned.manager_note,planned.accumulated_off_days_allocated,planned.revision,planned.cancelled_at::text,planned.cancelled_by_user_id,planned.cancelled_by_name_snapshot,planned.cancellation_reason,planned.created_by_user_id,planned.created_by_name_snapshot,planned.updated_by_user_id,planned.updated_by_name_snapshot,planned.created_at::text,planned.updated_at::text,staff.full_name,staff.staff_number,staff.position_key,(select count(*)::int from accumulated_off_consumptions consumption where consumption.planned_leave_period_id=planned.id) accumulated_off_days_consumed from planned_leave_periods planned join staff on staff.id=planned.staff_id where planned.id=$1 and planned.outlet_scope_id=$2`, [id, outletScopeId])
    const row = result.rows[0]
    return row ? this.map(row, await this.rosterEvidence(row.staff_id, row.start_date, row.end_date)) : null
  }

  async create(input: PlannedLeaveWriteInput, context: Context) {
    await this.requireReady(); this.validate(input)
    await this.requireMembership(input.staffId, input.startDate, input.endDate, context.outletScopeId)
    await this.requireNoOverlap(input.staffId, input.startDate, input.endDate, context.outletScopeId)
    await this.requireNoConfirmedCollision(input.staffId, input.startDate, input.endDate)
    await this.requireAvailableAccumulatedOff(input, context)
    const id = randomUUID(); const actor = actorLabel(context.actor)
    await this.db.transaction(async transaction => {
      await transaction.query(`insert into planned_leave_periods(id,outlet_scope_id,staff_id,start_date,end_date,leave_type,planning_state,manager_note,accumulated_off_days_allocated,revision,created_by_user_id,created_by_name_snapshot,updated_by_user_id,updated_by_name_snapshot) values($1,$2,$3,$4,$5,'annual_leave','booked',$6,$7,1,$8,$9,$8,$9)`, [id, context.outletScopeId, input.staffId, input.startDate, input.endDate, input.managerNote?.trim() || null, input.accumulatedOffDaysAllocated ?? 0, context.actor.userId, context.actor.displayName])
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,null,$5,$6)', [randomUUID(), 'planned_leave_period', id, 'booked', JSON.stringify({ staffId: input.staffId, startDate: input.startDate, endDate: input.endDate, leaveType: 'annual_leave', managerNote: input.managerNote?.trim() || '', accumulatedOffDaysAllocated: input.accumulatedOffDaysAllocated }), actor])
    })
    return (await this.find(id, context.outletScopeId))!
  }

  async update(id: string, input: PlannedLeaveWriteInput, context: Context) {
    await this.requireReady(); this.validate(input)
    const before = await this.find(id, context.outletScopeId)
    if (!before) throw new Error('Booked leave period not found.')
    if (before.planningState !== 'booked') throw new Error('Cancelled booked leave is immutable.')
    if (before.staffId !== input.staffId) throw new Error('Booked leave staff identity is immutable.')
    if (!Number.isInteger(input.revision) || input.revision !== before.revision) throw new Error('PLANNED_LEAVE_CONCURRENCY_CONFLICT')
    if ((input.accumulatedOffDaysAllocated ?? 0) < before.accumulatedOffDaysConsumed) throw new Error('Accumulated OFF allocation cannot be reduced below confirmed roster consumption.')
    const outsideEvidence = await this.db.query<{ count: number }>('select count(*)::int count from accumulated_off_consumptions where planned_leave_period_id=$1 and (duty_date<$2 or duty_date>$3)', [id, input.startDate, input.endDate])
    if (Number(outsideEvidence.rows[0]?.count || 0) > 0) throw new Error('The edited booking range must retain every confirmed accumulated OFF roster date.')
    await this.requireMembership(input.staffId, input.startDate, input.endDate, context.outletScopeId)
    await this.requireNoOverlap(input.staffId, input.startDate, input.endDate, context.outletScopeId, id)
    await this.requireNoConfirmedCollision(input.staffId, input.startDate, input.endDate)
    await this.requireAvailableAccumulatedOff(input, context, id)
    const actor = actorLabel(context.actor)
    await this.db.transaction(async transaction => {
      const result = await transaction.query('update planned_leave_periods set start_date=$3,end_date=$4,manager_note=$5,accumulated_off_days_allocated=$6,revision=revision+1,updated_by_user_id=$7,updated_by_name_snapshot=$8,updated_at=now() where id=$1 and outlet_scope_id=$2 and revision=$9 and planning_state=\'booked\' returning id', [id, context.outletScopeId, input.startDate, input.endDate, input.managerNote?.trim() || null, input.accumulatedOffDaysAllocated ?? 0, context.actor.userId, context.actor.displayName, before.revision])
      if (!result.rows[0]) throw new Error('PLANNED_LEAVE_CONCURRENCY_CONFLICT')
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'planned_leave_period', id, 'updated', JSON.stringify(before), JSON.stringify({ ...before, startDate: input.startDate, endDate: input.endDate, managerNote: input.managerNote?.trim() || '', accumulatedOffDaysAllocated: input.accumulatedOffDaysAllocated, revision: before.revision + 1 }), actor])
    })
    return (await this.find(id, context.outletScopeId))!
  }

  async cancel(id: string, revision: number, reason: string, context: Context) {
    await this.requireReady()
    const before = await this.find(id, context.outletScopeId)
    if (!before) throw new Error('Booked leave period not found.')
    if (before.planningState !== 'booked') return before
    if (!Number.isInteger(revision) || revision !== before.revision) throw new Error('PLANNED_LEAVE_CONCURRENCY_CONFLICT')
    const actor = actorLabel(context.actor)
    await this.db.transaction(async transaction => {
      const result = await transaction.query(`update planned_leave_periods set planning_state='cancelled',cancelled_at=now(),cancelled_by_user_id=$3,cancelled_by_name_snapshot=$4,cancellation_reason=$5,revision=revision+1,updated_by_user_id=$3,updated_by_name_snapshot=$4,updated_at=now() where id=$1 and outlet_scope_id=$2 and revision=$6 and planning_state='booked' returning id`, [id, context.outletScopeId, context.actor.userId, context.actor.displayName, reason.trim() || null, before.revision])
      if (!result.rows[0]) throw new Error('PLANNED_LEAVE_CONCURRENCY_CONFLICT')
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'planned_leave_period', id, 'cancelled', JSON.stringify(before), JSON.stringify({ ...before, planningState: 'cancelled', cancellationReason: reason.trim(), revision: before.revision + 1 }), actor])
    })
    return (await this.find(id, context.outletScopeId))!
  }
}
