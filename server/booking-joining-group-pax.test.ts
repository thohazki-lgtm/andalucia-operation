import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { BookingImportPreviewRecord } from '../src/domain.js'
import { buildHostessServiceBoard } from '../src/dashboard-data.js'
import { resolveBookingCoverRecords } from './booking-cover-resolver.js'
import { analyzeBookingCandidates } from './booking-intelligence-engine.js'
import { BookingRepository } from './booking-repository.js'
import { ReportingRepository } from './reporting-repository.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const source = (bookingNumber: string, covers: number, sourceStatus: string, reservationTime: string, note: string): BookingImportPreviewRecord => ({
  venue: 'andalucia', reservationDate: '2026-10-07', reservationTime, bookingNumber,
  primaryGuest: `Guest ${bookingNumber}`, rooms: [bookingNumber === '2723242' ? '701' : '702'], covers,
  sourceStatus, bookedBy: 'Reservations', sourceNotes: note, activityLabel: 'Dinner at Andalucia', walkIn: false,
  guestMembers: [{ guestName: `Guest ${bookingNumber}`, roomNumber: bookingNumber === '2723242' ? '701' : '702', accommodationCode: '', birthDate: null, arrivalDate: null, departureDate: null, mealPlan: '', guestNotes: note, sourceRowOrder: 1 }],
  warnings: [], readiness: 'READY'
})

const analyzed = analyzeBookingCandidates(resolveBookingCoverRecords([
  source('2723242', 4, 'Pending', '19:00', 'joining with 20 PAX, GROUP'),
  source('2691640', 16, 'Confirmed', '20:30', '20.Pax GROUP')
]))

assert.deepEqual(analyzed.map(record => [record.bookingNumber, record.covers]), [['2723242', 4], ['2691640', 16]])
assert.deepEqual(analyzed.map(record => record.coverResolution?.groupTotal), [20, 20])
assert.deepEqual(analyzed.map(record => record.intelligence?.effectiveCandidatePax), [4, 16])
assert(analyzed.every(record => record.readiness === 'REVIEW_REQUIRED'))
assert(analyzed.every(record => record.intelligence?.findings.some(item => item.normalizedKey === 'GROUP_REVIEW_REQUIRED')))
assert.equal(analyzed.reduce((sum, record) => sum + (record.intelligence?.operationalContributionPax || 0), 0), 20)

const fixture = await createDisposableDevelopmentStore('booking-joining-group-pax')
const db = fixture.db
const bookings = new BookingRepository(db)
await bookings.initialize()
const preview = await bookings.prepareImportPreview({
  fileName: 'october-7-joining-group.pdf', fileHash: '7'.repeat(64), reportDate: '2026-10-07', parserVersion: 'joining-group-regression',
  summary: { bookingGroups: 2, totalCovers: 20, confirmed: 1, pending: 1, warnings: 2, possibleDuplicates: 0 },
  validation: { declaredBookingGroups: 2, declaredCovers: 20, reconciled: true, messages: [] }, bookings: analyzed
})
assert.equal(preview.summary.totalCovers, 20)
assert.equal(preview.validation.coverReconciliation?.effectiveOperationalTotal, 20)
assert.equal(preview.validation.coverReconciliation?.positiveAdjustments, 0)

const imported = await bookings.confirmImport(preview.batchId, [], [
  { index: 0, action: 'IMPORT_ANYWAY' }, { index: 1, action: 'IMPORT_ANYWAY' }
])
assert.equal(imported.importedCovers, 20)
const saved = await bookings.list('2026-10-07')
assert.deepEqual(saved.map(record => [record.bookingNumber, record.covers]), [['2723242', 4], ['2691640', 16]])
assert.deepEqual(saved.map(record => record.coverResolution?.groupTotal), [20, 20])
assert.equal((await bookings.summary('2026-10-07')).expectedCovers, 20)

const statuses = (await bookings.configuration()).statuses
const board = buildHostessServiceBoard(saved, statuses, '2026-10-07', new Date('2026-10-07T12:00:00Z'))
assert.equal(board.summary.upcomingCovers, 20)
assert.deepEqual(board.partySizes, [4, 16])

const report = await new ReportingRepository(db).report('custom', '2026-10-07', '2026-10-07')
assert.equal(report.bookings.expectedCovers, 20)
assert.equal(report.bookings.totalCovers, 20)

const persisted = await db.query<{ booking_number: string; covers: number; raw_import_payload: unknown }>('select booking_number,covers,raw_import_payload from bookings order by reservation_time')
assert.deepEqual(persisted.rows.map(row => [row.booking_number, Number(row.covers)]), [['2723242', 4], ['2691640', 16]])
for (const row of persisted.rows) {
  const payload: any = typeof row.raw_import_payload === 'string' ? JSON.parse(row.raw_import_payload) : row.raw_import_payload
  const effective = payload.effective || payload
  assert.equal(effective.coverResolution.groupTotal, 20)
  assert.equal(effective.covers, Number(row.covers))
}

const [bookingUi, intelligenceCss] = await Promise.all([readFile('src/bookings.tsx', 'utf8'), readFile('src/booking-intelligence.css', 'utf8')])
for (const label of ['Original booking PAX', 'Mentioned combined group', 'Operational booking PAX']) assert.match(bookingUi, new RegExp(label))
assert.match(intelligenceCss, /@media\(max-width:520px\)[\s\S]*?\.intelligence-pax\{grid-template-columns:1fr\}/)

await fixture.cleanup()
console.log(JSON.stringify({ examples: { '2723242': 4, '2691640': 16 }, combinedActual: 20, mentionedGroupSize: 20, managerReview: true, persistence: 'PASS', dashboard: 'PASS', reports: 'PASS', responsivePreview: 'PASS' }, null, 2))
