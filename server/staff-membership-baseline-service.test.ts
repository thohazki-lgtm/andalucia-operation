import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { StaffRepository } from './staff-repository.js'
import { ANDALUCIA_SCOPE_KEY, OutletMembershipRepository } from './outlet-membership-repository.js'
import { StaffMembershipBaselineService } from './staff-membership-baseline-service.js'

const storage = await mkdtemp(join(tmpdir(), 'andalucia-membership-baseline-'))
const databasePath = join(storage, 'postgres')
const initial = new PGlite(databasePath)
await initial.exec(await readFile('database/schema.sql', 'utf8'))
await initial.close()

const staffRepository = new StaffRepository(databasePath)
try {
  await staffRepository.initialize()
  const db = staffRepository.getDatabase()
  const memberships = new OutletMembershipRepository(db)
  const baseline = new StaffMembershipBaselineService(db)
  await memberships.initialize()

  assert.equal((await memberships.resolveRegularStaffScope('2026-09', ANDALUCIA_SCOPE_KEY)).blocker, 'STAFF_MEMBERSHIP_BASELINE_NOT_APPROVED')
  const initialStatus = await baseline.status('2026-09', ANDALUCIA_SCOPE_KEY)
  assert.deepEqual({ status: initialStatus.status, count: initialStatus.approvedMemberCount, blocker: initialStatus.blockers[0] }, { status: 'not_started', count: 0, blocker: 'STAFF_MEMBERSHIP_BASELINE_NOT_APPROVED' })

  const staff = await staffRepository.list()
  const active = staff.filter(person => person.employmentStatus === 'active')
  const ended = staff.find(person => person.resignationDate)!
  const [staffA, staffB, staffC, staffD, staffG] = active
  await db.query("update staff set join_date='2026-09-12' where id=$1", [staffB.id])
  await db.query("update staff set employment_status_key='inactive' where id=$1", [staffD.id])
  await db.query("update staff set outlet='Another Outlet' where id=$1", [staffG.id])
  await db.query("update staff set outlet='ANDALUCIA' where id=$1", [staffC.id])

  const previewBeforeReview = await baseline.preview('2026-09', ANDALUCIA_SCOPE_KEY)
  assert.equal(previewBeforeReview.status.status, 'not_started')
  assert.equal(previewBeforeReview.suggestedCandidates.some(candidate => candidate.staffId === staffA.id), true)
  assert.equal(previewBeforeReview.suggestedCandidates.some(candidate => candidate.staffId === staffC.id), true)
  assert.equal(previewBeforeReview.availableForManualInclusion.some(candidate => candidate.staffId === staffG.id), true)
  assert.equal(previewBeforeReview.suggestedCandidates.find(candidate => candidate.staffId === staffA.id)?.department, 'F&B Service')
  assert.equal(previewBeforeReview.suggestedCandidates.find(candidate => candidate.staffId === staffB.id)?.proposedEffectiveFrom, '2026-09-12')
  assert.equal(previewBeforeReview.suggestedCandidates.find(candidate => candidate.staffId === staffD.id)?.warnings.includes('CURRENT_STATUS_INACTIVE'), true)
  const endedCandidate = [...previewBeforeReview.suggestedCandidates, ...previewBeforeReview.availableForManualInclusion].find(candidate => candidate.staffId === ended.id)!
  assert.equal(endedCandidate.warnings.includes('EMPLOYMENT_ENDED_BEFORE_PROPOSED_START'), true)
  assert.equal(Number((await db.query<{ count: number }>('select count(*)::int count from staff_membership_history')).rows[0].count), 0)

  const review = await baseline.beginReview('2026-09', ANDALUCIA_SCOPE_KEY)
  assert.equal(review.status, 'in_review')
  assert.equal((await baseline.beginReview('2026-09', ANDALUCIA_SCOPE_KEY)).id, review.id)
  assert.equal((await baseline.status('2026-09', ANDALUCIA_SCOPE_KEY)).status, 'in_review')
  await assert.rejects(() => baseline.approve(review.id), /Select at least one/)

  await baseline.saveSelection(review.id, { staffId: staffA.id, included: true, effectiveFrom: '2026-09-01', effectiveTo: null })
  await baseline.saveSelection(review.id, { staffId: ended.id, included: true, effectiveFrom: '2026-09-01', effectiveTo: null })
  await assert.rejects(() => baseline.approve(review.id), /exceeds the Staff employment period/)
  assert.equal(Number((await db.query<{ count: number }>('select count(*)::int count from staff_membership_history')).rows[0].count), 0)
  assert.equal((await baseline.status('2026-09', ANDALUCIA_SCOPE_KEY)).status, 'in_review')

  await baseline.saveSelection(review.id, { staffId: ended.id, included: false, effectiveFrom: '2026-09-01', effectiveTo: null })
  await baseline.saveSelection(review.id, { staffId: staffB.id, included: true, effectiveFrom: '2026-09-12', effectiveTo: null })
  await baseline.saveSelection(review.id, { staffId: staffC.id, included: false, effectiveFrom: '2026-09-01', effectiveTo: null })
  await baseline.saveSelection(review.id, { staffId: staffD.id, included: true, effectiveFrom: '2026-09-01', effectiveTo: null, reviewNote: 'Manager confirmed valid September membership despite current inactive status.' })
  await baseline.saveSelection(review.id, { staffId: staffG.id, included: true, effectiveFrom: '2026-09-01', effectiveTo: null, reviewNote: 'Explicit manager inclusion from existing Staff records.' })
  await baseline.removeSelection(review.id, staffG.id)
  assert.equal((await baseline.preview('2026-09', ANDALUCIA_SCOPE_KEY)).availableForManualInclusion.find(candidate => candidate.staffId === staffG.id)?.selectedInclude, false)
  await baseline.saveSelection(review.id, { staffId: staffG.id, included: true, effectiveFrom: '2026-09-01', effectiveTo: null })
  await baseline.saveSelection(review.id, { staffId: staffA.id, included: true, effectiveFrom: '2026-09-01', effectiveTo: null, reviewNote: 'Updated without duplicating candidate selection.' })
  assert.equal(Number((await db.query<{ count: number }>('select count(*)::int count from staff_membership_baseline_selections where review_id=$1', [review.id])).rows[0].count), 6)

  const approved = await baseline.approve(review.id)
  assert.equal(approved.status, 'BASELINE_APPROVED')
  assert.equal(approved.membershipIds.length, 4)
  const membershipRows = await db.query<any>("select staff_id,effective_from::text,effective_to::text,source,review_status,reviewed_at,reviewed_by from staff_membership_history where outlet_scope_id=$1 order by staff_id", [approved.review.outletScopeId])
  assert.equal(membershipRows.rows.length, 4)
  assert.equal(membershipRows.rows.every((row: any) => row.source === 'baseline_manager_review' && row.review_status === 'approved' && row.reviewed_at && row.reviewed_by), true)
  assert.equal(membershipRows.rows.some((row: any) => row.staff_id === staffC.id), false)
  assert.equal(membershipRows.rows.some((row: any) => row.staff_id === ended.id), false)

  const approvedStatus = await baseline.status('2026-09', ANDALUCIA_SCOPE_KEY)
  assert.deepEqual({ status: approvedStatus.status, count: approvedStatus.approvedMemberCount, actor: approvedStatus.approvedBy }, { status: 'approved', count: 4, actor: 'Venue Manager' })
  assert.equal(approvedStatus.approvedMemberships.length, 4)
  const repeated = await baseline.approve(review.id)
  assert.equal(repeated.status, 'BASELINE_ALREADY_APPROVED')
  assert.equal(Number((await db.query<{ count: number }>('select count(*)::int count from staff_membership_history')).rows[0].count), 4)
  await assert.rejects(() => baseline.saveSelection(review.id, { staffId: staffC.id, included: true, effectiveFrom: '2026-09-01', effectiveTo: null }), /cannot be changed silently/)

  const resolved = await memberships.resolveRegularStaffScope('2026-09', ANDALUCIA_SCOPE_KEY)
  assert.equal(resolved.blocker, null)
  assert.equal(resolved.members.length, 4)
  assert.equal(resolved.members.find(member => member.staffId === staffA.id)?.membershipStartWithinPeriod, '2026-09-01')
  assert.equal(resolved.members.find(member => member.staffId === staffB.id)?.membershipStartWithinPeriod, '2026-09-12')
  assert.equal(resolved.members.find(member => member.staffId === staffD.id)?.employmentStatus, 'inactive')
  assert.equal(resolved.members.some(member => member.staffId === staffG.id), true)
  assert.equal((await memberships.resolveRegularStaffScope('2026-08', ANDALUCIA_SCOPE_KEY)).blocker, 'STAFF_MEMBERSHIP_HISTORY_PRE_BASELINE')
  assert.equal((await db.query<{ outlet: string }>('select outlet from staff where id=$1', [staffG.id])).rows[0].outlet, 'Another Outlet')
  assert.equal(Number((await db.query<{ count: number }>('select count(*)::int count from duty_roster_entries')).rows[0].count), 0)

  const octoberReview = await baseline.beginReview('2026-10', ANDALUCIA_SCOPE_KEY)
  await baseline.saveSelection(octoberReview.id, { staffId: staffC.id, included: true, effectiveFrom: '2026-10-01', effectiveTo: null })
  await baseline.resetReview(octoberReview.id, 'Restart manager review')
  assert.equal(Number((await db.query<{ count: number }>('select count(*)::int count from staff_membership_baseline_selections where review_id=$1', [octoberReview.id])).rows[0].count), 0)
  assert.equal((await baseline.status('2026-10', ANDALUCIA_SCOPE_KEY)).status, 'in_review')

  const audit = await db.query<{ action: string }>("select action from audit_logs where entity_type='staff_membership_baseline' order by created_at")
  assert.equal(audit.rows.some(row => row.action === 'review_started'), true)
  assert.equal(audit.rows.some(row => row.action === 'candidate_included'), true)
  assert.equal(audit.rows.some(row => row.action === 'candidate_excluded'), true)
  assert.equal(audit.rows.some(row => row.action === 'candidate_removed'), true)
  assert.equal(audit.rows.some(row => row.action === 'review_reset'), true)
  assert.equal(audit.rows.some(row => row.action === 'baseline_approved'), true)

  console.log(JSON.stringify({ candidatePreviewReadOnly: true, exactOutletSuggestion: true, manualExistingStaffIncluded: true, excludedSuggestedStaffOmitted: true, defaultJoinDateApplied: true, inactiveHistoricalMemberApproved: true, endedBeforeMonthBlocked: true, invalidApprovalAtomic: true, approvedMemberships: approved.membershipIds.length, duplicateApprovalStatus: repeated.status, resolverMembers: resolved.members.length, augustBlocker: 'STAFF_MEMBERSHIP_HISTORY_PRE_BASELINE', staffOutletUnchanged: true, rosterUnchanged: true, resetUnapprovedReview: true, auditTrail: true }, null, 2))
} finally {
  await staffRepository.getDatabase().close().catch(() => undefined)
  await rm(storage, { recursive: true, force: true })
}
