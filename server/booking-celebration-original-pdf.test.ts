import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { buildDashboardData, buildHostessServiceBoard } from '../src/dashboard-data.js'
import type { BookingImportReviewDecision } from '../src/domain.js'
import { parseActivityProgramPdf, ACTIVITY_PROGRAM_PARSER_VERSION } from './activity-program-parser.js'
import { analyzeBookingCandidates, reconcileAnalyzedBookingCovers } from './booking-intelligence-engine.js'
import { BookingRepository } from './booking-repository.js'
import { GuestOccasionRepository } from './guest-occasion-repository.js'
import { ReportingRepository } from './reporting-repository.js'

const pdfPath = process.argv[2]
assert(pdfPath, 'Pass the original October 15 Activity Program PDF path.')
const pdf = await readFile(pdfPath)
const sha256 = createHash('sha256').update(pdf).digest('hex')
const parsed = await parseActivityProgramPdf(new Uint8Array(pdf))
assert.equal(parsed.reportDate, '2026-10-15')
assert.equal(parsed.bookings.length, 24)
assert.equal(parsed.bookings.reduce((sum, booking) => sum + (booking.covers || 0), 0), 65)
assert.equal(parsed.validation.reconciled, true)
const celebration = parsed.bookings.filter(booking => booking.serviceKind === 'celebration')
assert.equal(celebration.length, 1)
assert.deepEqual({ number: celebration[0].bookingNumber, start: celebration[0].reservationTime, end: celebration[0].serviceEndTime, covers: celebration[0].covers }, { number: '2738768', start: '19:30', end: '21:30', covers: 6 })
assert.equal(parsed.bookings.filter(booking => booking.serviceKind !== 'celebration').every(booking => !booking.serviceEndTime), true)
assert.equal(parsed.bookings.filter(booking => booking.bookingNumber === '2738768').length, 1)

const db = new PGlite()
try {
  await db.exec(await readFile('database/schema.sql', 'utf8'))
  await db.exec(await readFile('database/migrations/017_booking_intelligence_foundation.sql', 'utf8'))
  const outletId = '00000000-0000-4000-8000-00000000c115'; const userId = randomUUID()
  await db.query("insert into outlet_scopes(id,scope_key,display_name,active) values($1,'andalucia','Andalucía',true)", [outletId])
  await db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status) values($1,'original.pdf.manager','original.pdf.manager','Original PDF Test Manager','isolated','active')", [userId])
  const bookings = new BookingRepository(db); await bookings.initialize()
  const occasions = new GuestOccasionRepository(db); await occasions.initialize()
  const analyzed = analyzeBookingCandidates(parsed.bookings, (await occasions.configuration()).types)
  const target = analyzed.find(booking => booking.bookingNumber === '2738768')!
  assert.deepEqual(target.intelligence?.newOccasionKeys, ['birthday'])
  assert.equal(target.intelligence?.operationalContributionPax, 6)
  const reconciliation = reconcileAnalyzedBookingCovers(analyzed, parsed.validation.declaredCovers)
  assert.equal(reconciliation.effectiveOperationalTotal, 65)
  const preview = await bookings.prepareImportPreview({ fileName: pdfPath.split(/[\\/]/).pop()!, fileHash: sha256, reportDate: parsed.reportDate, parserVersion: ACTIVITY_PROGRAM_PARSER_VERSION, summary: { bookingGroups: analyzed.length, totalCovers: reconciliation.effectiveOperationalTotal, confirmed: analyzed.filter(item => item.sourceStatus.toLowerCase() === 'confirmed').length, pending: analyzed.filter(item => item.sourceStatus.toLowerCase() === 'pending').length, warnings: analyzed.filter(item => item.warnings.length > 0).length, possibleDuplicates: 0 }, validation: { ...parsed.validation, coverReconciliation: reconciliation }, bookings: analyzed }, 'Original PDF Test Manager')
  const selectedIndexes = preview.bookings.map((_, index) => index)
  const reviewDecisions: BookingImportReviewDecision[] = []
  preview.bookings.forEach((booking, index) => { if (booking.readiness === 'REVIEW_REQUIRED') reviewDecisions.push({ index, action: 'IMPORT_ANYWAY' }) })
  const imported = await bookings.confirmImport(preview.batchId, selectedIndexes, reviewDecisions, 'Original PDF Test Manager', userId, outletId)
  assert.equal(imported.importedBookings, 24)
  assert.equal(imported.importedCovers, 65)
  for (const bookingId of imported.importedBookingIds) await occasions.detectForBooking(bookingId, outletId, 'Original PDF Test Manager')
  const live = await bookings.list('2026-10-15')
  assert.equal(live.length, 24)
  assert.equal(live.reduce((sum, booking) => sum + booking.covers, 0), 65)
  const persistedCelebration = live.filter(booking => booking.sourceServiceKind === 'celebration')
  assert.equal(persistedCelebration.length, 1)
  assert.deepEqual({ number: persistedCelebration[0].bookingNumber, start: persistedCelebration[0].reservationTime, end: persistedCelebration[0].sourceServiceEndTime, covers: persistedCelebration[0].covers }, { number: '2738768', start: '19:30', end: '21:30', covers: 6 })
  assert.equal(Number((await db.query<{ count: number }>("select count(*)::int count from guest_occasions o join bookings b on b.id=o.booking_id where b.booking_number='2738768' and o.occasion_type='birthday'", [])).rows[0].count), 1)
  const targetId = persistedCelebration[0].id
  assert.equal((await occasions.detectForBooking(targetId, outletId, 'Original PDF Test Manager')).length, 0)
  const summary = await bookings.summary('2026-10-15')
  const report = await new ReportingRepository(db).report('today', '2026-10-15', '2026-10-15')
  const dashboard = buildDashboardData(report, summary, { openIssues: 0, inProgress: 0, completedToday: 0 })
  const hostess = buildHostessServiceBoard(live, (await bookings.configuration()).statuses, '2026-10-15', new Date('2026-10-15T12:00:00.000Z'))
  assert.equal(summary.expectedCovers, 65)
  assert.equal(dashboard.bookings.totalCovers, 65)
  assert.equal(hostess.summary.upcomingCovers, 65)
  const raw = (await db.query<any>('select source_filename,source_parser_version,raw_import_payload from bookings where id=$1', [targetId])).rows[0]
  assert.equal(raw.source_filename, pdfPath.split(/[\\/]/).pop())
  assert.equal(raw.source_parser_version, ACTIVITY_PROGRAM_PARSER_VERSION)
  assert.ok(raw.raw_import_payload)
  console.log(JSON.stringify({ sha256, pagesFixture: 'original October 15', parsedBookings: 24, parsedCovers: 65, ordinaryDinnerBookings: 23, celebrationBookings: 1, target: { bookingNumber: '2738768', window: '19:30-21:30', covers: 6, occasion: 'birthday' }, persistedBookings: live.length, persistedCovers: live.reduce((sum, booking) => sum + booking.covers, 0), duplicateOccasionPrevented: true, dashboardCovers: dashboard.bookings.totalCovers, hostessCovers: hostess.summary.upcomingCovers, backendEvidencePreserved: true, canonicalDatabaseTouched: false }, null, 2))
} finally {
  await db.close()
}
