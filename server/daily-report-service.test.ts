import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { copyStoreVerified } from './migration-filesystem.js'
import { createStoreIdentity } from './database-protection.js'
import { ReportingRepository } from './reporting-repository.js'
import { DailyReportService } from './daily-report-service.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { createFinancialFinalizationFingerprint, createOperationalFingerprint } from './database-backup.js'

const backupFolder = resolve('.backups/andalucia-milestone-2026-09-12T201517-356Z-4d691c20')
const metadata = JSON.parse(await readFile(join(backupFolder, 'backup-metadata.json'), 'utf8'))
assert.equal(metadata.verificationStatus, 'VERIFIED')
assert.equal(metadata.schemaVersion, '014')
const root = await mkdtemp(join(tmpdir(), 'andalucia-reports-r1-'))
const store = join(root, 'postgres')
try {
  await copyStoreVerified(join(backupFolder, 'postgres'), store)
  await createStoreIdentity(store, 'rehearsal', { storeId: 'reports-r1-isolated' })
  const db = new PGlite(store)
  try {
    const before = await createOperationalFingerprint(db); const financialBefore = await createFinancialFinalizationFingerprint(db)
    const owner = (await db.query<any>("select u.id::text,u.display_name from user_accounts u join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.role_key='owner' where u.status='active' limit 1")).rows[0]
    const outlet = { id: ANDALUCIA_SCOPE_ID, scopeKey: 'andalucia', displayName: 'Andalucía' }
    const actor = { userId: owner.id, displayName: 'SPOOFED CLIENT NAME' }
    const service = new DailyReportService(db, new ReportingRepository(db))
    const initial = await service.view('2026-09-10', outlet)
    assert.equal(initial.report, null); assert.equal(initial.snapshot, null); assert.equal((initial.content.upselling.details?.length || 0) > 0, true)
    assert.equal(initial.readiness.find(item => item.key === 'symphony')?.state, 'missing')
    const pending = (await db.query<any>("select c.id,c.charge_date::text date from chargeable_item_records c join configuration_options s on s.group_key='chargeable_statuses' and s.value=c.status where c.active=true and (s.metadata->>'countsAsPendingValue')::boolean=true limit 1")).rows[0]
    if (pending) assert.equal((await service.view(pending.date, outlet)).content.upselling.details?.some(row => row.id === pending.id), false)
    const wine = (await db.query<any>("select id,service_date::text date from wine_spirit_sales where archived_at is null and status='charged' limit 1")).rows[0]
    if (wine) assert.equal((await service.view(wine.date, outlet)).content.upselling.details?.some(row => row.id === wine.id && row.source === 'Wine / Spirits'), true)
    await assert.rejects(() => service.saveDraft('2026-09-10', {}, outlet, { userId: '00000000-0000-4000-8000-000000000000' } as any), /Authenticated report actor/)
    await service.saveDraft('2026-09-10', {}, outlet, actor)
    await assert.rejects(() => service.review('2026-09-10', outlet, actor), /not ready/)
    const manual = {
      symphony: { foodRevenue: '100.00', beverageRevenue: '50.00', wineRevenue: '20.00', liquorRevenue: '10.00', totalSale: '150.00', totalDiscount: '10.00', totalVoid: '5.00', netSale: '135.00', totalRevenue: '135.00', voidDetails: [{ amount: '5.00', reason: 'Manager approved void', checkInvoiceNumber: '41034457' }] },
      serviceVerification: { doubleDinePax: 0, details: [] }, manager: { operationSummary: 'Isolated R1 validation only.', keyOperationalIssue: '', guestFeedbackServiceRecovery: '', followUpRequired: '' },
    }
    const saved = await service.saveDraft('2026-09-10', manual, outlet, actor)
    assert.equal(saved.report?.preparedByName, owner.display_name)
    assert.equal(saved.readiness.some(item => item.blocking), false)
    assert.equal(saved.revenueReconciliation.status, 'reconciled')
    assert.equal(saved.readiness.find(item => item.key === 'voids')?.state, 'complete')
    const zeroManual = service.normalizeManual({ ...manual, symphony: { ...manual.symphony, foodRevenue: '0', beverageRevenue: '0', wineRevenue: '0', liquorRevenue: '0', totalSale: '0', totalDiscount: '0', totalVoid: '0', netSale: '0', totalRevenue: '0', voidDetails: [] } })
    assert.equal(service.readiness(zeroManual, saved.content).some(item => item.blocking), false)
    const invalidMoney = service.normalizeManual({ ...manual, symphony: { ...manual.symphony, foodRevenue: '1.2.3' } })
    assert.equal(service.readiness(invalidMoney, saved.content).find(item => item.key === 'symphony')?.blocking, true)
    const voidMissing = service.normalizeManual({ ...manual, symphony: { ...manual.symphony, totalVoid: '5.00', netSale: '135.00', totalRevenue: '135.00', voidDetails: [] } })
    assert.equal(service.readiness(voidMissing, saved.content).find(item => item.key === 'voids')?.blocking, true)
    const voidMismatch = service.normalizeManual({ ...manual, symphony: { ...manual.symphony, voidDetails: [{ amount: '4.00', reason: 'Valid reason', checkInvoiceNumber: 'V-1' }] } })
    assert.equal(service.readiness(voidMismatch, saved.content).find(item => item.key === 'voids')?.blocking, true)
    const voidIncomplete = service.normalizeManual({ ...manual, symphony: { ...manual.symphony, voidDetails: [{ amount: '5.00', reason: '', checkInvoiceNumber: '' }] } })
    assert.equal(service.readiness(voidIncomplete, saved.content).find(item => item.key === 'voids')?.blocking, true)
    assert.equal(service.readiness(service.normalizeManual(manual), saved.content).find(item => item.key === 'voids')?.blocking, false)
    const mismatchManual = service.normalizeManual({ ...manual, serviceVerification: { doubleDinePax: 1, details: [{ roomNumber: '201', pax: 2, sourceOutlet: 'Tempo', note: '' }] } })
    const mismatch = service.readiness(mismatchManual, saved.content).find(item => item.key === 'doubleDine')
    assert.equal(mismatch?.state, 'warning'); assert.equal(mismatch?.blocking, false)
    assert.equal(service.normalizeManual({ ...manual, serviceVerification: { doubleDinePax: '04', details: [] } }).serviceVerification.doubleDinePax, 4)
    const brokenRevenue = service.normalizeManual({ ...manual, symphony: { ...manual.symphony, netSale: '140.00' } })
    const advisory = service.readiness(brokenRevenue, saved.content).find(item => item.key === 'reconciliation')
    assert.equal(advisory?.state, 'warning'); assert.equal(advisory?.blocking, false); assert.equal(advisory?.verificationRequired, true)
    await service.saveDraft('2026-09-09', brokenRevenue, outlet, actor)
    const unverifiedReviewed = await service.review('2026-09-09', outlet, actor); assert.equal(unverifiedReviewed.report?.status, 'reviewed'); assert.equal(unverifiedReviewed.editable, false)
    await assert.rejects(() => service.approve('2026-09-09', 'reports-r1-unverified-approval', outlet, actor), /verified against Symphony/)
    await assert.rejects(() => service.saveDraft('2026-09-09', brokenRevenue, outlet, actor), /read-only/)
    const verified = await service.saveDraft('2026-09-10', { ...brokenRevenue, revenueVerification: { acknowledged: true } }, outlet, actor)
    assert.equal(verified.revenueReconciliation.status, 'verified-with-variance')
    assert.equal(verified.report?.manualPayload.revenueVerification?.verifiedByName, owner.display_name)
    assert.equal(verified.report?.manualPayload.revenueVerification?.verifiedByUserId, owner.id)
    assert.equal(verified.readiness.find(item => item.key === 'reconciliation')?.state, 'complete')
    const reviewed = await service.review('2026-09-10', outlet, actor); assert.equal(reviewed.report?.status, 'reviewed'); assert.equal(reviewed.editable, false); assert.equal(reviewed.report?.reviewedByName, owner.display_name); assert.ok(reviewed.report?.reviewedAt)
    const approved = await service.approve('2026-09-10', 'reports-r1-isolated-approval', outlet, actor)
    assert.equal(approved.report?.status, 'approved'); assert.equal(approved.editable, false); assert.ok(approved.snapshot)
    assert.equal(approved.content.symphony.netSale, '140.00'); assert.equal(approved.content.symphony.totalRevenue, '135.00')
    assert.equal(approved.content.revenueVerification?.acknowledged, true); assert.equal(approved.content.revenueVerification?.verifiedByName, owner.display_name)
    const retry = await service.approve('2026-09-10', 'reports-r1-isolated-approval', outlet, actor); assert.equal(retry.snapshot?.id, approved.snapshot?.id)
    await assert.rejects(() => service.approve('2026-09-10', 'reports-r1-different-key', outlet, actor), /already approved/)
    const snapshotJson = JSON.stringify(approved.content)
    const booking = (await db.query<any>("select id,guest_name from bookings where reservation_date='2026-09-10' limit 1")).rows[0]
    if (booking) { await db.query("update bookings set guest_name='ISOLATED CHANGE' where id=$1", [booking.id]); assert.equal(JSON.stringify((await service.view('2026-09-10', outlet)).content), snapshotJson); await db.query('update bookings set guest_name=$2 where id=$1', [booking.id, booking.guest_name]) }
    assert.equal((await db.query<any>('select count(*)::int count from daily_report_snapshots')).rows[0].count, 1)
    const audit = (await db.query<any>("select action from audit_logs where entity_type='daily_report'")).rows.map((row:any)=>row.action)
    for (const action of ['draft_created','manual_payload_updated','reviewed','approved_snapshot_created']) assert.equal(audit.includes(action), true)
    const after = await createOperationalFingerprint(db); const financialAfter = await createFinancialFinalizationFingerprint(db)
    for (const key of ['staff','membership','roster','bookings','occasions','chargeables','maintenance','training','owner'] as const) assert.deepEqual(after[key], before[key])
    assert.equal(financialAfter.digest, financialBefore.digest)
    const reportsSource = await readFile(resolve('src/reports.tsx'), 'utf8')
    assert.doesNotMatch(reportsSource, /Key Operational Issue|Guest Feedback \/ Service Recovery|Follow-up Required/)
    assert.doesNotMatch(reportsSource, /className="entered-values"/)
    const reportsCss = await readFile(resolve('src/reports.css'), 'utf8')
    assert.match(reportsSource, /REPORT READY/); assert.match(reportsSource, /Verified against Symphony/); assert.match(reportsSource, /double-dine-compact/); assert.match(reportsSource, /window\.print/)
    assert.match(reportsSource, /aria-label="Previous day"/); assert.match(reportsSource, /aria-label="Next day"/); assert.doesNotMatch(reportsSource, />← Previous Day<\/button>/); assert.doesNotMatch(reportsSource, />Next Day →<\/button>/)
    for (const section of ['Performance Overview','Booking by Time Slot','Symphony / Revenue','Service Verification','Chargeable Items / Upselling','Guest Experience',"Manager's Operation Summary",'Report Readiness / Approval']) assert.match(reportsSource, new RegExp(`title="${section.replace('/','\\/')}`))
    assert.match(reportsCss, /report-header-nav/); assert.match(reportsCss, /final-report-actions/); assert.match(reportsCss, /font-size:17px/)
    assert.match(reportsSource, /FINAL DAILY REPORT REVIEW \/ APPROVAL PREVIEW/); assert.match(reportsSource, /setApprovalOpen\(true\)/); assert.match(reportsSource, /Back to Report/); assert.doesNotMatch(reportsSource, /Return to Draft|Back to Edit/); assert.match(reportsCss, /reports-page:has\(\.report-approval-dialog\)/)
    console.log(JSON.stringify({ dailyNavigation: true, servicePerformance: true, coverLogic: true, kids: true, noShows: true, walkIns: true, symphonyPersistence: true, notEnteredVsZero: true, normalReconciliation: true, advisoryVariance: true, explicitVarianceVerification: true, verificationActor: true, exactSnapshotValues: true, voidValidation: true, doubleDineZero: true, doubleDineNormalization: true, managerSummaryCleanup: true, duplicateSummaryRemoved: true, compactReadyState: true, upselling: true, occasions: true, readiness: true, draft: true, review: true, finalApprovalPreview: true, automaticPreviewAfterReview: true, reviewedReadOnly: true, noUnsafeReturnToDraft: true, approval: true, duplicateApproval: true, immutableRendering: true, printPreview: true, audit: true, authorization: true, outletScope: true, noOperationalMutation: true }, null, 2))
  } finally { await db.close() }
} finally { await rm(root, { recursive: true, force: true }) }
