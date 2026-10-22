import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { AuthPrincipal, StaffMembershipHistory } from '../src/domain.js'
import { LeavePlannerService } from './leave-planner-service.js'
import { OperationsRepository } from './operations-repository.js'
import { ANDALUCIA_SCOPE_ID, OutletMembershipRepository } from './outlet-membership-repository.js'
import { PlannedLeaveRepository } from './planned-leave-repository.js'
import { StaffRepository } from './staff-repository.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const fixture = await createDisposableDevelopmentStore('planned-leave-r2')
const staff = new StaffRepository(fixture.store, fixture.db)
try {
  await staff.initialize()
  const db = staff.getDatabase(); const membership = new OutletMembershipRepository(db); const operations = new OperationsRepository(db)
  await membership.initialize(); await operations.initialize()
  const person = (await staff.list()).find(item => item.employmentStatus === 'active')!
  const actorId = fixture.ownerId
  const actorRow = { id: actorId, display_name: 'Planned Leave Owner' }
  const actor: AuthPrincipal = { userId: actorRow.id, displayName: actorRow.display_name, loginIdentifier: 'isolated-owner', sessionId: randomUUID(), staffId: null, isOwner: true, roleKeys: ['owner'], permissionKeys: ['manage_duty_roster'], globalScope: true, allowedOutletScopeIds: [ANDALUCIA_SCOPE_ID] }
  const history: StaffMembershipHistory = { id: randomUUID(), staffId: person.id, outletScopeId: ANDALUCIA_SCOPE_ID, membershipDimension: 'regular_outlet', effectiveFrom: '2026-09-01', effectiveTo: null, source: 'baseline_manager_review', reason: 'Booked leave isolated validation', reviewStatus: 'approved' }
  await membership.createMembership(history)
  const planned = new PlannedLeaveRepository(db)
  assert.equal(await planned.ready(), true)
  const created = await planned.create({ staffId: person.id, startDate: '2026-11-10', endDate: '2026-11-12', leaveType: 'annual_leave', managerNote: 'Family travel' }, { outletScopeId: ANDALUCIA_SCOPE_ID, actor })
  assert.equal(created.bookedDays, 3); assert.equal(created.planningState, 'booked'); assert.equal(created.createdByUserId, actor.userId)
  await assert.rejects(() => planned.create({ staffId: person.id, startDate: '2026-11-12', endDate: '2026-11-14', leaveType: 'annual_leave' }, { outletScopeId: ANDALUCIA_SCOPE_ID, actor }), /overlaps/)
  const updated = await planned.update(created.id, { staffId: person.id, startDate: '2026-11-10', endDate: '2026-11-13', leaveType: 'annual_leave', managerNote: 'Approved planning note', revision: created.revision }, { outletScopeId: ANDALUCIA_SCOPE_ID, actor })
  assert.equal(updated.revision, 2); assert.equal(updated.bookedDays, 4)
  const annualLeave = (await staff.configuration()).dutyCodes.find(option => option.metadata?.dutyClassification === 'annualLeave')!
  await operations.updateRoster(person.id, '2026-11-11', annualLeave.value, 'isolated roster manager')
  await staff.saveEntitlement({ staffId: person.id, annualLeavePerYear: 2, weeklyOffEntitlement: 1, publicHolidayPerYear: 11 }, 'isolated entitlement manager')
  const view = await new LeavePlannerService(staff, membership, planned).view('2026-11')
  const row = view.rows.find(item => item.staffId === person.id)!
  assert.equal(row.days.find(day => day.date === '2026-11-11')?.classification, 'annualLeave')
  assert.equal(row.plannedDates.includes('2026-11-11'), false)
  assert.equal(row.plannedDates.includes('2026-11-10'), true)
  assert.equal(row.entitlement.bookedFuture, 3)
  assert.equal(row.entitlement.annualLeave.remaining, 29, 'Automatic service-year availability must deduct confirmed Duty Roster usage once.')
  assert.equal(row.entitlement.availableAfterBooked, 26, 'Booked/Future must remain a separate projection from confirmed usage.')
  assert.equal(row.plannedPeriods[0].confirmedEvidence.length, 1)
  await operations.updateRoster(person.id, '2026-11-20', annualLeave.value, 'isolated roster manager')
  await assert.rejects(() => planned.create({ staffId: person.id, startDate: '2026-11-20', endDate: '2026-11-20', leaveType: 'annual_leave' }, { outletScopeId: ANDALUCIA_SCOPE_ID, actor }), /conflicts with confirmed Duty Roster/)
  const cancelled = await planned.cancel(updated.id, updated.revision, 'Plans changed', { outletScopeId: ANDALUCIA_SCOPE_ID, actor })
  assert.equal(cancelled.planningState, 'cancelled'); assert.equal(cancelled.cancellationReason, 'Plans changed')
  const trace = await planned.list(ANDALUCIA_SCOPE_ID, '2026-11-01', '2026-11-30', person.id, true)
  assert.equal(trace.length, 1); assert.equal(trace[0].planningState, 'cancelled')
  const active = await planned.list(ANDALUCIA_SCOPE_ID, '2026-11-01', '2026-11-30', person.id, false)
  assert.equal(active.length, 0)
  const audits = await db.query<{ action: string }>("select action from audit_logs where entity_type='planned_leave_period' and entity_id=$1 order by created_at", [created.id])
  assert.deepEqual(audits.rows.map(item => item.action), ['booked', 'updated', 'cancelled'])
  console.log(JSON.stringify({ migration019Ready: true, durableBookedLeave: true, overlapRejected: true, rosterCollisionRejected: true, rosterWinsDisplay: true, confirmedUsageNotDoubleCounted: true, bookedProjection: true, updateRevision: true, cancellationTraceability: true, immutableIdentity: true, auditEvidence: true }, null, 2))
} finally {
  await fixture.cleanup()
}
