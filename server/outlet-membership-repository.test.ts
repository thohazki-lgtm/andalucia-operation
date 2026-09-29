import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { BillTipManualAllocation, OutletScope, StaffMembershipHistory } from '../src/domain.js'
import { StaffRepository } from './staff-repository.js'
import { ANDALUCIA_SCOPE_ID, ANDALUCIA_SCOPE_KEY, OutletMembershipRepository } from './outlet-membership-repository.js'
import { IncentivesRepository } from './incentives-repository.js'

const storage = await mkdtemp(join(tmpdir(), 'andalucia-outlet-membership-'))
const databasePath = join(storage, 'postgres')
const schema = await readFile('database/schema.sql', 'utf8')
const initial = new PGlite(databasePath)
await initial.exec(schema)
await initial.close()

const staffRepository = new StaffRepository(databasePath, new PGlite(databasePath))
try {
  await staffRepository.initialize()
  const db = staffRepository.getDatabase()
  const memberships = new OutletMembershipRepository(db)
  const incentives = new IncentivesRepository(db)
  await memberships.initialize(); await incentives.initialize()

  const outlets = await memberships.outlets()
  assert.equal(outlets.length, 1)
  assert.deepEqual({ id: outlets[0].id, key: outlets[0].scopeKey, name: outlets[0].displayName, type: outlets[0].outletType }, { id: ANDALUCIA_SCOPE_ID, key: ANDALUCIA_SCOPE_KEY, name: 'Andalucía', type: 'restaurant' })
  await memberships.initialize()
  assert.equal((await memberships.outlets()).length, 1)

  const baselineMissing = await memberships.resolveRegularStaffScope('2026-09', ANDALUCIA_SCOPE_KEY)
  assert.equal(baselineMissing.blocker, 'STAFF_MEMBERSHIP_BASELINE_NOT_APPROVED')
  assert.equal(baselineMissing.members.length, 0)
  const augustMissing = await memberships.resolveRegularStaffScope('2026-08', ANDALUCIA_SCOPE_KEY)
  assert.equal(augustMissing.blocker, 'STAFF_MEMBERSHIP_HISTORY_PRE_BASELINE')

  const staff = await staffRepository.list()
  const active = staff.filter(person => person.employmentStatus === 'active')
  assert.equal(active.length >= 5, true)
  const record = (staffId: string, effectiveFrom: string, effectiveTo: string | null, source: StaffMembershipHistory['source'] = 'baseline_manager_review', reviewStatus: StaffMembershipHistory['reviewStatus'] = 'approved', outletScopeId = ANDALUCIA_SCOPE_ID): StaffMembershipHistory => ({ id: randomUUID(), staffId, outletScopeId, membershipDimension: 'regular_outlet', effectiveFrom, effectiveTo, source, reason: 'Isolated membership validation', reviewStatus })

  const baselineA = await memberships.createMembership(record(active[0].id, '2026-09-01', null))
  assert.equal(baselineA.reviewStatus, 'approved')
  assert.equal(Boolean(baselineA.reviewedAt && baselineA.reviewedBy), true)

  await db.query("update staff set join_date='2026-09-15' where id=$1", [active[1].id])
  await memberships.createMembership(record(active[1].id, '2026-09-15', null))
  await memberships.createMembership(record(active[2].id, '2026-09-01', '2026-09-20'))
  await db.query("update staff set employment_status_key='inactive' where id=$1", [active[3].id])
  await memberships.createMembership(record(active[3].id, '2026-09-01', null))
  await db.query("update staff set join_date='2026-09-12' where id=$1", [active[4].id])
  await memberships.createMembership(record(active[4].id, '2026-09-12', null, 'new_hire'))

  const september = await memberships.resolveRegularStaffScope('2026-09', ANDALUCIA_SCOPE_KEY)
  assert.equal(september.blocker, null)
  const byStaff = new Map(september.members.map(member => [member.staffId, member]))
  assert.deepEqual({ start: byStaff.get(active[0].id)?.membershipStartWithinPeriod, end: byStaff.get(active[0].id)?.membershipEndWithinPeriod, days: byStaff.get(active[0].id)?.membershipDays }, { start: '2026-09-01', end: '2026-09-30', days: 30 })
  assert.deepEqual({ start: byStaff.get(active[1].id)?.membershipStartWithinPeriod, days: byStaff.get(active[1].id)?.membershipDays }, { start: '2026-09-15', days: 16 })
  assert.deepEqual({ end: byStaff.get(active[2].id)?.membershipEndWithinPeriod, days: byStaff.get(active[2].id)?.membershipDays }, { end: '2026-09-20', days: 20 })
  assert.equal(byStaff.get(active[3].id)?.employmentStatus, 'inactive')
  assert.deepEqual({ start: byStaff.get(active[4].id)?.membershipStartWithinPeriod, days: byStaff.get(active[4].id)?.membershipDays }, { start: '2026-09-12', days: 19 })

  const renamed = await memberships.saveOutlet({ ...outlets[0], displayName: 'Andalucía Restaurant' })
  assert.deepEqual({ id: renamed.id, key: renamed.scopeKey, name: renamed.displayName }, { id: ANDALUCIA_SCOPE_ID, key: ANDALUCIA_SCOPE_KEY, name: 'Andalucía Restaurant' })
  const afterRename = await memberships.resolveRegularStaffScope('2026-09', ANDALUCIA_SCOPE_KEY)
  assert.equal(afterRename.members.every(member => member.outletScopeId === ANDALUCIA_SCOPE_ID && member.outletScopeKey === ANDALUCIA_SCOPE_KEY && member.outletDisplayName === 'Andalucía Restaurant'), true)
  await assert.rejects(() => memberships.saveOutlet({ ...renamed, scopeKey: 'renamed_andalucia' }), /immutable/)
  await assert.rejects(() => db.query("update outlet_scopes set scope_key='unsafe_change' where id=$1", [ANDALUCIA_SCOPE_ID]), /immutable/)

  const syntheticOutlet: OutletScope = { id: randomUUID(), scopeKey: 'test_bar', displayName: 'Synthetic Test Bar', active: true, outletType: 'bar' }
  await memberships.saveOutlet(syntheticOutlet)
  await assert.rejects(() => memberships.createMembership(record(active[0].id, '2026-10-01', null, 'transfer', 'approved', syntheticOutlet.id)), /overlaps/)
  await assert.rejects(() => db.query('insert into staff_membership_history(id,staff_id,outlet_scope_id,membership_dimension,effective_from,effective_to,source,review_status,reviewed_at,reviewed_by) values($1,$2,$3,$4,$5,$6,$7,$8,now(),$9)', [randomUUID(), active[0].id, syntheticOutlet.id, 'regular_outlet', '2026-10-01', null, 'transfer', 'approved', 'Database validation']), /overlaps/)

  const transferStaff = staff.find(person => person.employmentStatus === 'inactive')!
  await db.query("update staff set join_date='2026-01-01',resignation_date=null where id=$1", [transferStaff.id])
  const oldOutletMembership = await memberships.createMembership(record(transferStaff.id, '2026-09-01', null, 'baseline_manager_review', 'approved', syntheticOutlet.id))
  await memberships.closeMembership(oldOutletMembership.id, '2026-10-14', 'transfer', 'Transfer to Andalucía')
  await memberships.createMembership(record(transferStaff.id, '2026-10-15', null, 'transfer'))
  const octoberTransfer = await memberships.resolveRegularStaffScope('2026-10', ANDALUCIA_SCOPE_KEY)
  const transferred = octoberTransfer.members.find(member => member.staffId === transferStaff.id)
  assert.deepEqual({ start: transferred?.membershipStartWithinPeriod, end: transferred?.membershipEndWithinPeriod, days: transferred?.membershipDays }, { start: '2026-10-15', end: '2026-10-31', days: 17 })

  await db.query("update staff set resignation_date='2026-10-20' where id=$1", [active[0].id])
  const octoberEmployment = await memberships.resolveRegularStaffScope('2026-10', ANDALUCIA_SCOPE_KEY)
  const resigned = octoberEmployment.members.find(member => member.staffId === active[0].id)
  assert.deepEqual({ start: resigned?.membershipStartWithinPeriod, end: resigned?.membershipEndWithinPeriod, days: resigned?.membershipDays }, { start: '2026-10-01', end: '2026-10-20', days: 20 })

  const pending = await memberships.createMembership({ ...record(transferStaff.id, '2027-01-01', null, 'correction', 'pending_review', syntheticOutlet.id), membershipDimension: 'temporary_project' })
  assert.equal(pending.reviewStatus, 'pending_review')
  assert.equal((await memberships.approveMembership(pending.id)).reviewStatus, 'approved')

  const membershipCountBeforeHelper = Number((await db.query<{ count: number }>('select count(*)::int count from staff_membership_history')).rows[0].count)
  const distribution = await incentives.createDistribution({ id: randomUUID(), distributionMonth: '2027-04', poolAmount: '100.00' })
  const helper: BillTipManualAllocation = { id: randomUUID(), distributionId: distribution.id, linkedStaffId: null, helperName: 'Banquet Support', department: 'Banquet', outlet: 'Banquet', fixedAmount: '20.00', reason: 'Temporary support', notes: '', idempotencyKey: 'external-helper' }
  await incentives.createManualAllocation(helper)
  await incentives.createManualAllocation({ ...helper, id: randomUUID(), linkedStaffId: active[1].id, helperName: active[1].name, idempotencyKey: 'linked-helper' })
  assert.equal(Number((await db.query<{ count: number }>('select count(*)::int count from staff_membership_history')).rows[0].count), membershipCountBeforeHelper)
  assert.equal(Number((await db.query<{ count: number }>("select count(*)::int count from audit_logs where entity_type in ('outlet_scope','staff_membership_history')")).rows[0].count) >= 10, true)
  assert.equal((await db.query<{ outlet: string }>('select outlet from staff where id=$1', [active[0].id])).rows[0].outlet, active[0].outlet)

  console.log(JSON.stringify({ outletScope: { id: renamed.id, scopeKey: renamed.scopeKey, renamedDisplay: renamed.displayName, onlyApprovedOperationalSeed: true }, baseline: { septemberMembers: september.members.length, augustBlocker: augustMissing.blocker, missingBlocker: baselineMissing.blocker }, intersections: { fullMonth: 30, september15Start: 16, september20End: 20, newHire: 19, transferOctober: transferred?.membershipDays, resignationOctober: resigned?.membershipDays }, inactiveHistoryResolved: true, overlapRepositoryBlocked: true, overlapDatabaseBlocked: true, scopeKeyRepositoryImmutable: true, scopeKeyDatabaseImmutable: true, externalHelpersCreatedNoMembership: true, auditTrail: true }, null, 2))
} finally {
  await staffRepository.getDatabase().close().catch(() => undefined)
  await rm(storage, { recursive: true, force: true })
}
