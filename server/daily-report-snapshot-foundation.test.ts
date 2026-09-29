import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { createFinancialFinalizationFingerprint, createOperationalFingerprint } from './database-backup.js'
import { DailyReportSnapshotRepository, dailyReportSnapshotChecksum, type DailyReportManualPayload, type DailyReportSnapshotContent } from './daily-report-snapshot-repository.js'
import { copyStoreVerified } from './migration-filesystem.js'
import { compareOperationalFingerprints, createMigrationFingerprint, migrationStatus, runMigrations, runPreflight } from './migration-store.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { serviceDate } from '../src/service-date.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const sourceFixture = await createDisposableStoreThrough('reports-014-source', '013')
const retainedBackup = sourceFixture.store
const sourceOperational = await createOperationalFingerprint(sourceFixture.db)
const sourceMigration = await createMigrationFingerprint(sourceFixture.db)
const sourceFinancial = await createFinancialFinalizationFingerprint(sourceFixture.db)
await sourceFixture.db.close()
const root = await mkdtemp(join(tmpdir(), 'andalucia-reports-014-'))
const migratedStore = join(root, 'migrated', 'postgres')
const rollbackStore = join(root, 'rollback', 'postgres')

const manual = (doubleDinePax = 2): DailyReportManualPayload => ({
  symphony: { foodRevenue: '800.00', beverageRevenue: '300.00', wineRevenue: '120.00', liquorRevenue: '80.00', totalSale: '1100.00', totalDiscount: '25.00', totalVoid: '15.00', netSale: '1060.00', totalRevenue: '1060.00', voidDetails: [{ amount: '15.00', reason: 'Manager authorized correction', checkInvoiceNumber: 'VOID-4101' }] },
  serviceVerification: { doubleDinePax, details: [{ roomNumber: '201', pax: doubleDinePax, sourceOutlet: 'Tempo', note: 'Verified in Symphony' }] },
  manager: { operationSummary: 'Stable dinner service.', keyOperationalIssue: '', guestFeedbackServiceRecovery: '', followUpRequired: 'Review tomorrow.' },
  completion: { operationalData: 'complete', symphonyRevenue: 'complete', doubleDineVerification: 'complete', managerSummary: 'complete' }
})
const content = (date: string, covers: number, doubleDinePax: number, revenue: string, upsell: string, occasions: number): DailyReportSnapshotContent => ({
  servicePerformance: { totalCovers: covers, adults: covers - 2, kids: 2, totalBookings: 5, arrivedCovers: covers - 1, noShowCovers: 1, noShowRooms: ['404'], walkIns: 2, bookingByTimeSlot: [{ time: '19:30', bookings: 2, covers: covers, adults: covers - 2, kids: 2, noShows: 1, status: 'Service' }] },
  symphony: { ...manual(doubleDinePax).symphony, totalRevenue: revenue, netSale: revenue },
  serviceVerification: manual(doubleDinePax).serviceVerification,
  upselling: { chargeables: [{ id: `charge-${date}`, item: 'Lobster Paella', amount: '85.00' }], wineSpirits: [{ id: `wine-${date}`, item: 'Macan', amount: '277.91' }], totalUpsellRevenue: upsell },
  guestOccasions: { categories: [{ category: 'birthday', count: occasions, covers: occasions * 2 }], roomDetails: [{ bookingId: `booking-${date}`, roomNumber: '337', category: 'Birthday', covers: occasions * 2 }] },
  manager: manual(doubleDinePax).manager
})

try {
  await copyStoreVerified(retainedBackup, migratedStore)
  const db = new PGlite(migratedStore)
  try {
    const before = await createOperationalFingerprint(db)
    const migrationBefore = await createMigrationFingerprint(db)
    const financialBefore = await createFinancialFinalizationFingerprint(db)
    const wineBefore = Number((await db.query<{ count: number }>('select count(*)::int count from wine_spirit_sales')).rows[0]?.count)
    assert.equal((await migrationStatus(db)).migrations.find(item => item.version === '014')?.state, 'pending')
    const migration = await runMigrations(db, { throughVersion: '014' })
    assert.deepEqual(migration.applied, ['014'])
    const status = await migrationStatus(db)
    assert.equal(status.migrations.filter(item => item.version <= '014').length, 14)
    assert.equal(status.migrations.filter(item => item.version <= '014').every(item => item.state === 'applied' && item.checksumMatches === true), true)
    assert.equal(status.migrations.find(item => item.version === '015')?.state, 'pending')
    const ledger = (await db.query<{ version: string; count: number }>('select version,count(*)::int count from schema_migrations group by version order by version')).rows
    assert.equal(ledger.length, 14)
    assert.equal(ledger.every(row => Number(row.count) === 1), true)
    assert.deepEqual((await db.query<{ reports: number; snapshots: number }>('select (select count(*) from daily_reports)::int reports,(select count(*) from daily_report_snapshots)::int snapshots')).rows[0], { reports: 0, snapshots: 0 })
    assert.equal((await runPreflight(db, migratedStore)).status, 'READY')
    const after = await createOperationalFingerprint(db)
    const migrationAfter = await createMigrationFingerprint(db)
    const financialAfter = await createFinancialFinalizationFingerprint(db)
    const wineAfter = Number((await db.query<{ count: number }>('select count(*)::int count from wine_spirit_sales')).rows[0]?.count)
    assert.deepEqual(compareOperationalFingerprints(migrationBefore, migrationAfter), { preserved: true, differences: [] })
    assert.deepEqual({ ...after, generatedAt: before.generatedAt, migration: before.migration }, before)
    assert.equal(financialAfter.digest, financialBefore.digest)
    assert.equal(wineAfter, wineBefore)

    const owner = (await db.query<any>("select u.id::text,u.display_name from user_accounts u join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.role_key='owner' where u.status='active' limit 1")).rows[0]
    const actor = { userId: owner.id, displayName: 'CLIENT-SUPPLIED SPOOF' }
    const reports = new DailyReportSnapshotRepository(db)
    await assert.rejects(() => reports.createDraft({ outletScopeId: ANDALUCIA_SCOPE_ID, serviceDate: '2026-02-30', manualPayload: manual() }, actor), /valid YYYY-MM-DD/)
    await assert.rejects(() => reports.createDraft({ outletScopeId: ANDALUCIA_SCOPE_ID, serviceDate: '2026-09-11', manualPayload: manual() }, { userId: '', displayName: '' }), /Authenticated report actor/)
    const draft = await reports.createDraft({ outletScopeId: ANDALUCIA_SCOPE_ID, serviceDate: '2026-09-11', manualPayload: manual(2) }, actor)
    assert.equal(draft.status, 'draft')
    assert.equal(draft.revisionNumber, 1)
    assert.equal(draft.preparedByName, owner.display_name)
    assert.equal(draft.manualPayload.symphony.voidDetails[0].checkInvoiceNumber, 'VOID-4101')
    assert.equal(draft.manualPayload.serviceVerification.doubleDinePax, 2)
    await assert.rejects(() => reports.createDraft({ outletScopeId: ANDALUCIA_SCOPE_ID, serviceDate: '2026-09-11', manualPayload: manual() }, actor), /current Daily Report revision/)
    const reviewed = await reports.review(draft.id, actor)
    assert.equal(reviewed.status, 'reviewed')
    assert.equal(reviewed.reviewedByUserId, actor.userId)
    const approvalContent = content('2026-09-11', 20, 2, '1060.00', '362.91', 1)
    const [firstApproval, retriedApproval] = await Promise.all([
      reports.approve(draft.id, approvalContent, 'approval-2026-09-11-r1', actor),
      reports.approve(draft.id, approvalContent, 'approval-2026-09-11-r1', actor)
    ])
    assert.equal(firstApproval.id, retriedApproval.id)
    assert.equal(firstApproval.snapshotSha256, dailyReportSnapshotChecksum(firstApproval.frozenPayload))
    assert.equal(firstApproval.approvedByUserId, actor.userId)
    assert.equal(firstApproval.approvedByName, owner.display_name)
    assert.equal(firstApproval.frozenPayload.identity.approvedBy.userId, actor.userId)
    assert.equal(firstApproval.frozenPayload.identity.approvedBy.name, owner.display_name)
    assert.equal((await db.query<{ count: number }>('select count(*)::int count from daily_report_snapshots where daily_report_id=$1', [draft.id])).rows[0].count, 1)
    await assert.rejects(() => reports.approve(draft.id, approvalContent, 'different-approval-key', actor), /already approved/)
    await assert.rejects(() => db.query("update daily_report_snapshots set frozen_payload='{}'::jsonb where id=$1", [firstApproval.id]), /immutable/i)
    await assert.rejects(() => db.query('delete from daily_report_snapshots where id=$1', [firstApproval.id]), /immutable/i)
    await assert.rejects(() => db.query("update daily_reports set manual_payload='{}'::jsonb where id=$1", [draft.id]), /immutable/i)
    await assert.rejects(() => db.query('delete from daily_reports where id=$1', [draft.id]), /cannot be deleted/i)

    const snapshotBeforeSourceChange = JSON.stringify((await reports.snapshotForReport(draft.id))?.frozenPayload)
    await assert.rejects(() => db.transaction(async transaction => {
      await transaction.query("update configuration_options set updated_at=now() where id=(select id from configuration_options order by id limit 1)")
      const frozenDuringSourceChange = (await transaction.query<{ frozen_payload: unknown }>('select frozen_payload from daily_report_snapshots where daily_report_id=$1', [draft.id])).rows[0]?.frozen_payload
      assert.equal(JSON.stringify(frozenDuringSourceChange), snapshotBeforeSourceChange)
      throw new Error('ROLLBACK_DISPOSABLE_SOURCE_CHANGES')
    }), /ROLLBACK_DISPOSABLE_SOURCE_CHANGES/)
    assert.equal(JSON.stringify((await reports.snapshotForReport(draft.id))?.frozenPayload), snapshotBeforeSourceChange)

    const revision = await reports.createRevision(draft.id, manual(3), actor)
    assert.equal(revision.revisionNumber, 2)
    assert.equal((await reports.byId(draft.id))?.status, 'superseded')
    assert.equal((await reports.snapshotForReport(draft.id))?.id, firstApproval.id)
    await reports.review(revision.id, actor)
    await reports.approve(revision.id, content('2026-09-11', 22, 3, '1200.00', '400.00', 2), 'approval-2026-09-11-r2', actor)
    const nextDay = await reports.createDraft({ outletScopeId: ANDALUCIA_SCOPE_ID, serviceDate: '2026-09-12', manualPayload: manual(4) }, actor)
    await reports.review(nextDay.id, actor)
    await reports.approve(nextDay.id, content('2026-09-12', 30, 4, '1500.00', '500.00', 3), 'approval-2026-09-12-r1', actor)
    const current = await reports.currentApprovedSnapshots(ANDALUCIA_SCOPE_ID, '2026-09-11', '2026-09-17')
    assert.equal(current.length, 2)
    assert.deepEqual(current.map(item => item.revisionNumber), [2, 1])
    const weekly = await reports.aggregateApproved(ANDALUCIA_SCOPE_ID, '2026-09-11', '2026-09-17')
    assert.deepEqual(weekly, { days: 2, covers: 52, doubleDinePax: 7, totalRevenue: '2700.00', totalUpsellRevenue: '900.00', guestOccasions: 5 })
    const monthly = await reports.aggregateApproved(ANDALUCIA_SCOPE_ID, '2026-09-01', '2026-09-30')
    assert.deepEqual(monthly, weekly)
    assert.equal(serviceDate(new Date('2026-09-12T18:59:59Z')), '2026-09-12')
    assert.equal(serviceDate(new Date('2026-09-12T19:00:00Z')), '2026-09-13')
    const auditActions = (await db.query<{ action: string }>("select action from audit_logs where entity_type='daily_report' order by created_at")).rows.map(row => row.action)
    for (const action of ['draft_created', 'reviewed', 'approved_snapshot_created', 'revision_created']) assert.equal(auditActions.includes(action), true)
  } finally { await db.close() }

  await copyStoreVerified(retainedBackup, rollbackStore)
  const rollback = new PGlite(rollbackStore)
  try {
    const status = await migrationStatus(rollback)
    assert.equal(status.migrations.find(item => item.version === '014')?.state, 'pending')
    assert.equal(status.migrations.filter(item => item.state === 'applied').length, 13)
    assert.equal(status.migrations.filter(item => item.state === 'applied').every(item => item.checksumMatches === true), true)
    assert.equal((await runPreflight(rollback, rollbackStore)).status, 'READY')
    const operational = await createOperationalFingerprint(rollback)
    const financial = await createFinancialFinalizationFingerprint(rollback)
    assert.deepEqual({ ...operational, generatedAt: sourceOperational.generatedAt, migration: sourceOperational.migration }, sourceOperational)
    assert.equal(compareOperationalFingerprints(sourceMigration, await createMigrationFingerprint(rollback)).preserved, true)
    assert.equal(financial.digest, sourceFinancial.digest)
  } finally { await rollback.close() }
  console.log(JSON.stringify({ migration014: true, schema014Disposable: true, operationalPreserved: true, financialPreserved: true, lifecycle: true, snapshotChecksum: true, immutable: true, idempotentApproval: true, concurrentApproval: true, revisions: true, actorSnapshots: true, outletScope: true, payloadPreservation: true, liveSourceChangeIsolation: true, weeklyMonthlyAggregation: true, maldivesTimezone: true, rollbackSchema013: true }, null, 2))
} finally {
  await rm(root, { recursive: true, force: true })
  await sourceFixture.cleanup()
}
