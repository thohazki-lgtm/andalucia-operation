import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import type { BookingImportPreview, BookingImportReviewChanges } from '../src/domain.js'
import { ACTIVITY_PROGRAM_PARSER_VERSION, parseActivityProgramPdf } from './activity-program-parser.js'
import { BookingRepository } from './booking-repository.js'
import { syntheticActivityProgramPdf } from './activity-program-test-fixture.js'

const pdf = Buffer.from(syntheticActivityProgramPdf('import'))
const parsed = await parseActivityProgramPdf(new Uint8Array(pdf))
const input: Omit<BookingImportPreview, 'batchId' | 'duplicateFile'> = {
  fileName: '2026-09-01_02-04_daily_bookings_report.pdf', fileHash: createHash('sha256').update(pdf).digest('hex'), reportDate: parsed.reportDate, parserVersion: ACTIVITY_PROGRAM_PARSER_VERSION,
  summary: { bookingGroups: parsed.bookings.length, totalCovers: parsed.bookings.reduce((total, booking) => total + (booking.covers || 0), 0), confirmed: parsed.bookings.filter(booking => booking.sourceStatus.toLowerCase() === 'confirmed').length, pending: parsed.bookings.filter(booking => booking.sourceStatus.toLowerCase() === 'pending').length, warnings: parsed.bookings.filter(booking => booking.warnings.length > 0).length, possibleDuplicates: 0 },
  validation: parsed.validation, bookings: parsed.bookings
}
const setup = async () => { const db = new PGlite(); await db.exec(await readFile('database/schema.sql', 'utf8')); const repository = new BookingRepository(db); await repository.initialize(); return { db, repository } }
const readyIndexes = parsed.bookings.map((booking, index) => booking.readiness === 'READY' ? index : -1).filter(index => index >= 0)
const reviewIndex = parsed.bookings.findIndex(booking => booking.readiness === 'REVIEW_REQUIRED')
assert.equal(reviewIndex >= 0, true)

// A: ready records import while the manager explicitly skips the uncertain record.
{
  const { repository } = await setup()
  const preview = await repository.prepareImportPreview(input)
  const result = await repository.confirmImport(preview.batchId, readyIndexes, [{ index: reviewIndex, action: 'SKIP' }])
  assert.equal(result.importedBookings, 3)
  assert.equal(result.importedCovers, 6)
  assert.equal(result.skippedByManager, 1)
}

// B/F: manager approval imports the original record, re-import stays duplicate-safe, and operations remain untouched.
{
  const { db, repository } = await setup()
  const preview = await repository.prepareImportPreview(input)
  const result = await repository.confirmImport(preview.batchId, readyIndexes, [{ index: reviewIndex, action: 'IMPORT_ANYWAY' }])
  assert.equal(result.importedBookings, 4)
  assert.equal(result.importedCovers, 7)
  assert.equal(result.managerApprovedReviewItems, 1)
  const reviewBooking = (await repository.list(parsed.reportDate)).find(booking => booking.bookingNumber === '9000004')
  assert(reviewBooking)
  assert.equal(reviewBooking.roomNumber, '')
  assert.equal(reviewBooking.sourceBookingStatus?.toLowerCase(), 'confirmed')
  assert.equal(reviewBooking.bookingStatus, 'confirmed')
  assert(reviewBooking.covers > 0)
  await repository.save({ ...reviewBooking, tableNumber: 'T01', bookingStatus: 'arrived', guestNotes: 'Manager operation note' })
  const repeatedPreview = await repository.prepareImportPreview(input)
  assert.equal(repeatedPreview.bookings.filter(booking => booking.readiness === 'DUPLICATE').length, 4)
  const repeated = await repository.confirmImport(repeatedPreview.batchId, readyIndexes, [{ index: reviewIndex, action: 'IMPORT_ANYWAY' }])
  assert.equal(repeated.importedBookings, 0)
  assert.equal(repeated.skippedDuplicates, 4)
  const preserved = await repository.find(reviewBooking.id)
  assert.equal(preserved?.tableNumber, 'T01')
  assert.equal(preserved?.bookingStatus, 'arrived')
  assert.equal(preserved?.guestNotes, 'Manager operation note')
  const audit = await db.query<{ action: string; before_data: unknown; after_data: unknown }>("select action, before_data, after_data from audit_logs where entity_type='booking_import_review'")
  assert(audit.rows.some(row => row.action === 'imported_anyway'))
  assert(audit.rows.every(row => row.before_data && row.after_data))
}

// C/D/E: edits are validated, preserve source identity, rerun duplicate detection, and retain the original source payload.
{
  const { db, repository } = await setup()
  const preview = await repository.prepareImportPreview(input)
  const original = preview.bookings[reviewIndex]
  const changes: BookingImportReviewChanges = { reservationDate: original.reservationDate, reservationTime: original.reservationTime, primaryGuest: original.primaryGuest, room: 'R-REVIEW', covers: 3, sourceStatus: 'confirmed', sourceNotes: `${original.sourceNotes} Manager verified room.` }
  const validated = await repository.validateImportReview(preview.batchId, reviewIndex, changes)
  assert.equal(validated.record.rooms[0], 'R-REVIEW')
  assert.equal(validated.record.covers, 3)
  assert.equal(validated.record.bookingNumber, original.bookingNumber)
  await assert.rejects(() => repository.validateImportReview(preview.batchId, reviewIndex, { ...changes, covers: 0 }), /greater than zero/)
  const result = await repository.confirmImport(preview.batchId, readyIndexes, [{ index: reviewIndex, action: 'EDIT_BEFORE_IMPORT', changes }])
  assert.equal(result.importedBookings, 4)
  assert.equal(result.importedCovers, 9)
  const corrected = (await repository.list(parsed.reportDate)).find(booking => booking.bookingNumber === original.bookingNumber)
  assert(corrected)
  assert.equal(corrected.roomNumber, 'R-REVIEW')
  assert.equal(corrected.covers, 3)
  const raw = await db.query<any>('select raw_import_payload from bookings where id=$1', [corrected.id])
  const payload = typeof raw.rows[0].raw_import_payload === 'string' ? JSON.parse(raw.rows[0].raw_import_payload) : raw.rows[0].raw_import_payload
  assert.equal(payload.original.rooms.length, 0)
  assert.equal(payload.effective.rooms[0], 'R-REVIEW')
  const duplicateValidation = await repository.validateImportReview(preview.batchId, reviewIndex, changes)
  assert.equal(duplicateValidation.duplicateBookingId, corrected.id)
  const orphaned = await db.query<{ count: number }>('select count(*)::int count from booking_guest_members g left join bookings b on b.id=g.booking_id where b.id is null')
  assert.equal(orphaned.rows[0].count, 0)
}

console.log(JSON.stringify({ scenarios: ['ready-and-skip', 'import-anyway', 'edit-before-import', 'invalid-correction', 'duplicate-after-edit', 'safe-reimport'], bookings: parsed.bookings.length, covers: parsed.bookings.reduce((sum, booking) => sum + (booking.covers || 0), 0) }, null, 2))
