import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { StaffRepository } from './staff-repository.js'
import { ANDALUCIA_SCOPE_KEY, OutletMembershipRepository } from './outlet-membership-repository.js'
import { StaffMembershipBaselineService } from './staff-membership-baseline-service.js'

const storage = await mkdtemp(join(tmpdir(), 'andalucia-membership-boundary-'))
const repository = new StaffRepository(join(storage, 'postgres'), new PGlite())
try {
  await repository.initialize()
  const db = repository.getDatabase()
  const memberships = new OutletMembershipRepository(db)
  const service = new StaffMembershipBaselineService(db)
  await memberships.initialize()
  const actor = { userId: randomUUID(), displayName: 'Isolated Membership Manager' }
  await db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status) values($1,'membership.manager','membership.manager',$2,'test-only','active')", [actor.userId, actor.displayName])
  const existing = await repository.list()
  for (let index = existing.length; index < 12; index++) await repository.create({ id: randomUUID(), number: `BOUND-${index + 1}`, name: `Boundary Staff ${index + 1}`, position: 'Waiter', nationality: '', division: 'Food & Beverage', department: 'F&B Service', outlet: 'Andalucía', identityDocumentNumber: '', employmentStatus: 'active', joinDate: '2024-01-01' }, 'Isolated test setup')
  const staff = (await repository.list()).slice(0, 12)
  assert.equal(staff.length, 12)
  await db.query("update staff set employment_status_key='active',outlet='Andalucía',join_date='2024-01-01',resignation_date=null")
  await db.query("update staff set full_name='TOMIRIS' where id=$1", [staff[0].id])

  const september = await service.beginReview('2026-09', ANDALUCIA_SCOPE_KEY, actor)
  for (const person of staff) await service.saveSelection(september.id, { staffId: person.id, included: true, effectiveFrom: '2026-09-01', effectiveTo: null }, actor)
  await service.approve(september.id, actor)

  // Reproduce the legacy defect: old monthly approvals stored an open-ended range.
  await db.query('update staff_membership_history set effective_to=null where baseline_revision_id=$1', [september.id])
  await db.query('update staff_membership_baseline_selections set effective_to=null where review_id=$1', [september.id])
  const october = await service.beginReview('2026-10', ANDALUCIA_SCOPE_KEY, actor)
  for (const person of staff) await service.saveSelection(october.id, { staffId: person.id, included: true, effectiveFrom: '2026-10-01', effectiveTo: null }, actor)
  const octoberPreview = await service.preview('2026-10', ANDALUCIA_SCOPE_KEY)
  const octoberSelected = [...octoberPreview.suggestedCandidates, ...octoberPreview.availableForManualInclusion].filter(candidate => candidate.selectedInclude)
  assert.equal(octoberSelected.length, 12)
  assert.equal(octoberSelected.every(candidate => !candidate.warnings.includes('REGULAR_OUTLET_MEMBERSHIP_OVERLAP')), true)
  assert.equal(octoberSelected.find(candidate => candidate.name === 'TOMIRIS')?.proposedEffectiveTo, '2026-10-31')
  const octoberApproval = await service.approve(october.id, actor)
  assert.equal(octoberApproval.membershipIds.length, 12)
  const normalizedAuditCount = Number((await db.query<{ count: number }>("select count(*)::int count from audit_logs where action='monthly_membership_legacy_end_normalized'")).rows[0].count)
  assert.equal(normalizedAuditCount, 12)
  assert.equal(Number((await db.query<{ count: number }>('select count(*)::int count from staff_membership_history where baseline_revision_id=$1', [september.id])).rows[0].count), 12)

  const correction = await service.reopen(september.id, { outletScopeId: september.outletScopeId, month: '2026-09', reason: 'Bound the legacy monthly membership evidence to September.' }, actor)
  const correctionDraft = await db.query<{ effective_to: string }>('select effective_to::text from staff_membership_baseline_selections where review_id=$1', [correction.id])
  assert.equal(correctionDraft.rows.every(row => row.effective_to === '2026-09-30'), true)
  const correctionDiff = await service.diff(correction.id)
  assert.equal(correctionDiff?.summary.dateChanges, 12)
  await service.approve(correction.id, actor)
  const correctedSeptember = await db.query<{ effective_to: string }>('select effective_to::text from staff_membership_history where baseline_revision_id=$1', [correction.id])
  assert.equal(correctedSeptember.rows.every(row => row.effective_to === '2026-09-30'), true)
  console.log(JSON.stringify({
    simplifiedMonthlySelection: true,
    selectedStaff: octoberSelected.length,
    legacyCrossMonthOverlapIgnored: true,
    legacyNormalizationAuditEvents: normalizedAuditCount,
    septemberHistoryPreserved: true,
    tomirisOctoberEnd: octoberSelected.find(candidate => candidate.name === 'TOMIRIS')?.proposedEffectiveTo,
    correctionDraftExplicitlyBounded: correctionDraft.rows.every(row => row.effective_to === '2026-09-30'),
    correctionDateChanges: correctionDiff?.summary.dateChanges,
    septemberCorrectionBoundedAt: '2026-09-30',
    octoberApprovalAfterBlockersCleared: octoberApproval.membershipIds.length === 12,
  }, null, 2))
} finally {
  await repository.getDatabase().close().catch(() => undefined)
  await rm(storage, { recursive: true, force: true })
}
