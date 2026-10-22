import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { buildDashboardData, buildHostessServiceBoard } from '../src/dashboard-data.js'
import { parseActivityProgramPdf, ACTIVITY_PROGRAM_PARSER_VERSION } from './activity-program-parser.js'
import { syntheticActivityProgramPdf } from './activity-program-test-fixture.js'
import { analyzeBookingCandidates, reconcileAnalyzedBookingCovers } from './booking-intelligence-engine.js'
import { BookingRepository } from './booking-repository.js'
import { GuestOccasionRepository } from './guest-occasion-repository.js'
import { ReportingRepository } from './reporting-repository.js'

const parsed = await parseActivityProgramPdf(syntheticActivityProgramPdf('celebration'))
assert.equal(parsed.reportDate, '2026-10-15')
assert.equal(parsed.bookings.length, 1)
const source = parsed.bookings[0]
assert.deepEqual({ number: source.bookingNumber, covers: source.covers, start: source.reservationTime, end: source.serviceEndTime, kind: source.serviceKind }, { number: '2738768', covers: 6, start: '19:30', end: '21:30', kind: 'celebration' })
assert.match(source.activityLabel, /Celebration @ Andalucia/i)
assert.match(source.guestMembers[0].guestNotes, /Birthday celebration for Ritu/i)
assert.equal(parsed.validation.reconciled, true)

const db = new PGlite()
try {
  await db.exec(await readFile('database/schema.sql', 'utf8'))
  await db.exec(await readFile('database/migrations/017_booking_intelligence_foundation.sql', 'utf8'))
  const outletId = '00000000-0000-4000-8000-00000000c015'
  const userId = randomUUID()
  await db.query("insert into outlet_scopes(id,scope_key,display_name,active) values($1,'andalucia','Andalucía',true)", [outletId])
  await db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status) values($1,'celebration.manager','celebration.manager','Celebration Test Manager','isolated','active')", [userId])
  const bookings = new BookingRepository(db); await bookings.initialize()
  const occasions = new GuestOccasionRepository(db); await occasions.initialize()
  const analyzed = analyzeBookingCandidates(parsed.bookings, (await occasions.configuration()).types)
  assert.equal(analyzed[0].intelligence?.newOccasionKeys.includes('birthday'), true)
  const coverReconciliation = reconcileAnalyzedBookingCovers(analyzed, parsed.validation.declaredCovers)
  assert.equal(coverReconciliation.effectiveOperationalTotal, 6)
  const preview = await bookings.prepareImportPreview({
    fileName: 'activity-program-15-october-2026-fixture.pdf', fileHash: 'c'.repeat(64), reportDate: parsed.reportDate, parserVersion: ACTIVITY_PROGRAM_PARSER_VERSION,
    summary: { bookingGroups: 1, totalCovers: 6, confirmed: 1, pending: 0, warnings: 0, possibleDuplicates: 0 },
    validation: { ...parsed.validation, coverReconciliation }, bookings: analyzed
  }, 'Celebration Test Manager')
  const imported = await bookings.confirmImport(preview.batchId, [0], [], 'Celebration Test Manager', userId, outletId)
  assert.equal(imported.importedBookings, 1)
  assert.equal(imported.importedCovers, 6)
  const bookingId = imported.importedBookingIds[0]
  assert.deepEqual((await occasions.detectForBooking(bookingId, outletId, 'Celebration Test Manager')).map(item => item.occasionType), ['birthday'])
  assert.equal((await occasions.detectForBooking(bookingId, outletId, 'Celebration Test Manager')).length, 0)

  const live = await bookings.list('2026-10-15')
  assert.equal(live.length, 1)
  assert.deepEqual({ number: live[0].bookingNumber, covers: live[0].covers, kind: live[0].sourceServiceKind, end: live[0].sourceServiceEndTime }, { number: '2738768', covers: 6, kind: 'celebration', end: '21:30' })
  assert.equal((await bookings.summary('2026-10-15')).expectedCovers, 6)
  const report = await new ReportingRepository(db).report('today', '2026-10-15', '2026-10-15')
  const dashboard = buildDashboardData(report, await bookings.summary('2026-10-15'), { openIssues: 0, inProgress: 0, completedToday: 0 })
  const hostess = buildHostessServiceBoard(live, (await bookings.configuration()).statuses, '2026-10-15', new Date('2026-10-15T12:00:00.000Z'))
  assert.equal(dashboard.bookings.totalCovers, 6)
  assert.equal(hostess.summary.upcomingCovers, 6)
  assert.equal(Number((await db.query<{ count: number }>('select count(*)::int count from guest_occasions where booking_id=$1 and occasion_type=$2', [bookingId, 'birthday'])).rows[0].count), 1)
  assert.equal(Number((await db.query<{ count: number }>('select count(*)::int count from chargeable_item_records where booking_id=$1', [bookingId])).rows[0].count), 0)
  const raw = (await db.query<{ raw_import_payload: any }>('select raw_import_payload from bookings where id=$1', [bookingId])).rows[0].raw_import_payload
  const payload = typeof raw === 'string' ? JSON.parse(raw) : raw
  assert.equal((payload.effective || payload).serviceEndTime, '21:30')
  console.log(JSON.stringify({ parser: true, actualWindow: '19:30-21:30', bookingNumber: '2738768', covers: 6, persistedOnce: true, birthdayOccasionOnce: true, dashboardCovers: 6, hostessCovers: 6, chargeableSalesCreated: 0, canonicalDatabaseTouched: false }, null, 2))
} finally {
  await db.close()
}
