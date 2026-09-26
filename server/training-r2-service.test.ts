import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { AuthPrincipal, TrainingCompletionInput, TrainingEligibilityState, TrainingParticipationState } from '../src/domain.js'
import { copyStoreVerified } from './migration-filesystem.js'
import { TrainingRepository } from './training-repository.js'
import { TrainingR2Service } from './training-r2-service.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'

const source = process.env.ANDALUCIA_TRAINING_R2_SOURCE_STORE
if (!source) throw new Error('ANDALUCIA_TRAINING_R2_SOURCE_STORE_REQUIRED')
const root = await mkdtemp(join(resolve('.tmp'), 'training-r2-service-'))
const store = join(root, 'postgres')

try {
  await copyStoreVerified(source, store)
  const db = new PGlite(store)
  const repository = new TrainingRepository(db)
  const service = new TrainingR2Service(db, repository)
  const actorRow = (await db.query<any>("select id,login_identifier,display_name from user_accounts where status='active' order by created_at limit 1")).rows[0]
  assert.ok(actorRow)
  const principal: AuthPrincipal = { userId: actorRow.id, loginIdentifier: actorRow.login_identifier, displayName: actorRow.display_name, sessionId: randomUUID(), staffId: null, roleKeys: ['owner'], permissionKeys: ['manage_training'], globalScope: true, allowedOutletScopeIds: [], isOwner: true }
  const beforeCounts = (await db.query<any>('select (select count(*)::int from training_sessions) sessions,(select count(*)::int from training_session_completion_evidence) completions,(select count(*)::int from training_session_staff_evidence) evidence')).rows[0]
  const planned = (await db.query<any>("select value from configuration_options where group_key='training_statuses' and active=true and coalesce(metadata->>'trainingStage','planned') in ('planned','upcoming') order by sort_order limit 1")).rows[0]?.value
  const category = (await db.query<any>("select value from configuration_options where group_key='training_categories' and active=true order by sort_order limit 1")).rows[0]?.value
  assert.ok(planned && category)
  const working = (await db.query<any>(`select r.staff_id from duty_roster_entries r join configuration_options c on c.group_key='duty_codes' and c.value=r.duty_code_value where r.duty_date='2026-09-10' and (c.metadata->>'countsAsWorking')::boolean=true order by r.staff_id limit 2`)).rows
  assert.equal(working.length, 2)
  const inactiveStaffId = working[0].staff_id
  const reviewStaffId = working[1].staff_id
  await db.query("update staff set employment_status_key='inactive' where id=$1", [inactiveStaffId])
  await db.query("delete from duty_roster_entries where staff_id=$1 and duty_date='2026-09-10'", [reviewStaffId])
  const sessionId = randomUUID()
  await repository.save({ id: sessionId, title: `R2 isolated ${sessionId.slice(0, 8)}`, category, date: '2026-09-10', time: '17:00', startTime: '17:00', endTime: '18:00', trainer: 'Isolated Manager', location: 'Andalucía', status: planned, notes: '', active: true, attendees: [], source: 'manual' }, 'Isolated R2 Test')
  const initial = await service.detail(sessionId)
  assert.equal(initial.operationalStatus, 'awaiting_confirmation')
  assert.equal(initial.completion, null)
  assert.equal(initial.staff.length, 11)
  assert.equal(initial.staff.some(item => item.staffId === inactiveStaffId), false)
  assert.ok(initial.staff.some(item => item.recommendedEligibility === 'eligible'))
  assert.equal(initial.staff.filter(item => item.recommendedEligibility === 'excluded_off').length, 2)
  assert.equal(initial.staff.filter(item => item.recommendedEligibility === 'excluded_annual_leave').length, 1)
  assert.equal(initial.staff.filter(item => item.recommendedEligibility === 'requires_review').length, 1)
  const decisions: TrainingCompletionInput['staff'] = initial.staff.map((item, index) => {
    const eligibilityState: TrainingEligibilityState = item.recommendedEligibility === 'requires_review' ? 'eligible' : item.recommendedEligibility
    const participationState: TrainingParticipationState = eligibilityState === 'eligible' ? (index === initial.staff.length - 1 ? 'did_not_participate' : 'participated') : 'not_applicable'
    return { staffId: item.staffId, eligibilityState, participationState, evidenceNote: item.recommendedEligibility === 'requires_review' ? 'Manager confirmed isolated eligibility.' : '' }
  })
  const completed = await service.confirm(sessionId, { actualDurationMinutes: 60, staff: decisions }, principal)
  assert.equal(completed.operationalStatus, 'completed')
  assert.equal(completed.completion?.creditedMinutesPerParticipant, 30)
  assert.equal(completed.completion?.requiresReviewCount, 0)
  assert.equal(completed.completion?.participantCount, decisions.filter(item => item.participationState === 'participated').length)
  assert.equal(completed.completion?.creditedMinutes, completed.completion!.participantCount * 30)
  assert.equal(completed.sessionTrainingHours, completed.completion!.creditedMinutes / 60)
  const completionIdentity = (await db.query<any>('select confirmed_by_user_id,confirmed_by_name_snapshot,confirmed_at from training_session_completion_evidence where id=$1', [completed.completion!.id])).rows[0]
  assert.equal(completionIdentity.confirmed_by_user_id, principal.userId)
  assert.equal(completionIdentity.confirmed_by_name_snapshot, principal.displayName)
  assert.ok(completionIdentity.confirmed_at)
  await assert.rejects(() => service.confirm(sessionId, { actualDurationMinutes: 60, staff: decisions }, principal), /already been confirmed/)
  const performance = await service.performance('2026-09')
  assert.ok(performance.sessionsCompleted >= 1)
  assert.ok(performance.trainingHours >= completed.sessionTrainingHours)
  assert.equal(performance.target.creditCapMinutes, 30)
  assert.equal(performance.staffCoverage.length, 12)
  assert.ok(performance.staffCovered > 0)
  const audit = (await db.query<any>("select action from audit_logs where entity_id=$1 or entity_id=$2", [sessionId, completed.completion!.id])).rows.map(row => row.action)
  assert.ok(audit.includes('completion_confirmed'))
  assert.ok(audit.includes('participants_confirmed'))
  if (initial.staff.some(item => item.recommendedEligibility === 'requires_review')) assert.ok(audit.includes('eligibility_corrected'))
  const sessionScope = (await db.query<any>('select outlet_scope_id from training_sessions where id=$1', [sessionId])).rows[0]?.outlet_scope_id
  assert.equal(sessionScope, ANDALUCIA_SCOPE_ID)
  const afterCounts = (await db.query<any>('select (select count(*)::int from training_sessions) sessions,(select count(*)::int from training_session_completion_evidence) completions,(select count(*)::int from training_session_staff_evidence) evidence')).rows[0]
  assert.equal(afterCounts.sessions, beforeCounts.sessions + 1)
  assert.equal(afterCounts.completions, beforeCounts.completions + 1)
  assert.equal(afterCounts.evidence, beforeCounts.evidence + 11)
  const cancelledStatus = (await db.query<any>("select value from configuration_options where group_key='training_statuses' and active=true and metadata->>'trainingStage'='cancelled' order by sort_order limit 1")).rows[0]?.value
  assert.ok(cancelledStatus)
  const unconfirmedId = randomUUID(); const cancelledId = randomUUID()
  await repository.save({ id: unconfirmedId, title: 'R2 isolated unconfirmed', category, date: '2026-09-09', time: '17:00', startTime: '17:00', endTime: '17:30', trainer: 'Isolated Manager', location: 'Andalucía', status: planned, notes: '', active: true, attendees: [], source: 'manual' }, 'Isolated R2 Test')
  await repository.save({ id: cancelledId, title: 'R2 isolated cancelled', category, date: '2026-09-09', time: '18:00', startTime: '18:00', endTime: '18:30', trainer: 'Isolated Manager', location: 'Andalucía', status: cancelledStatus, notes: '', active: true, attendees: [], source: 'manual' }, 'Isolated R2 Test')
  assert.equal((await service.detail(unconfirmedId)).completion, null)
  assert.equal((await service.detail(cancelledId)).operationalStatus, 'cancelled')
  const zeroCreditPerformance = await service.performance('2026-09')
  assert.equal(zeroCreditPerformance.sessionsCompleted, performance.sessionsCompleted)
  assert.equal(zeroCreditPerformance.creditedMinutes, performance.creditedMinutes)
  assert.equal(zeroCreditPerformance.trainingHours, performance.trainingHours)
  await db.close()
  console.log(JSON.stringify({ status: 'PASS', isolated: true, staffCandidates: initial.staff.length, inactiveStaffExcluded: true, offExcluded: 2, annualLeaveExcluded: 1, managerReviewResolved: 1, participantCreditCapMinutes: completed.completion?.creditedMinutesPerParticipant, creditedMinutes: completed.completion?.creditedMinutes, performanceHours: performance.trainingHours, hoursPerHead: performance.hoursPerHead, staffCovered: performance.staffCovered, unconfirmedCredit: 0, cancelledCredit: 0, authenticatedCompletionActor: completionIdentity.confirmed_by_name_snapshot, auditActions: audit }, null, 2))
} finally {
  await rm(root, { recursive: true, force: true })
}
