import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import type { AuthPrincipal, BookingRecord } from '../src/domain.js'
import { BookingDayLockService } from './booking-day-lock-service.js'
import { BookingRepository } from './booking-repository.js'
import { ACTIVITY_PROGRAM_PARSER_VERSION, parseActivityProgramPdf } from './activity-program-parser.js'
import { syntheticActivityProgramPdf } from './activity-program-test-fixture.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const fixture = await createDisposableDevelopmentStore('booking-day-lock')
const db = fixture.db
let clock = new Date('2026-11-02T01:00:00.000Z') // 06:00 Maldives
const manager: AuthPrincipal = {
  userId: randomUUID(), displayName: 'Isolated Booking Manager', sessionId: randomUUID(), loginIdentifier: 'isolated-manager', staffId: null,
  roleKeys: ['outlet_manager'], permissionKeys: ['manage_bookings'], globalScope: false, allowedOutletScopeIds: [], isOwner: false
}
const locks = new BookingDayLockService(db, { now: () => clock })
const bookings = new BookingRepository(db, { assertDateEditable: (date, database) => locks.assertEditable(date, database) })
await bookings.initialize()

const automatic = await locks.status('2026-11-01', true)
assert.equal(automatic.state, 'locked')
assert.equal(automatic.lockKind, 'automatic')
assert.equal(automatic.cutoffAt, '2026-11-01T23:00:00.000Z')
assert.equal((await db.query<{ count: number }>("select count(*)::int count from configuration_options where group_key='booking_day_locks'")).rows[0].count, 0, 'automatic status must not silently bulk-write historical lock rows')

const record = (date: string): BookingRecord => ({
  id: randomUUID(), guestName: 'Synthetic Lock Guest', roomNumber: 'I01', birthDate: null, arrivalDate: null, departureDate: null,
  mealPeriod: 'Dinner', reservationDate: date, reservationTime: '19:00', bookingNumber: 'LOCK-TEST', covers: 2,
  bookingStatus: 'confirmed', bookingSource: 'manual', bookedBy: manager.displayName, guestNotes: '', tableNumber: '', waiterId: null, waiter: null
})

await assert.rejects(() => bookings.save(record('2026-11-01'), manager.displayName), /BOOKING_DAY_LOCKED/)

const current = '2026-11-02'
assert.equal((await locks.status(current, true)).state, 'open')
await assert.rejects(() => locks.lock(current, 'LOCK BOOKINGS WRONG', manager), /Type LOCK BOOKINGS/)
assert.equal((await locks.lock(current, `LOCK BOOKINGS ${current}`, manager)).state, 'locked')
await assert.rejects(() => bookings.save(record(current), manager.displayName), /BOOKING_DAY_LOCKED/)
await assert.rejects(() => locks.reopen(current, 'short', `REOPEN BOOKINGS ${current}`, manager), /clear Booking day reopening reason/)

const reopened = await locks.reopen(current, 'Correct table assignment after signed manager review', `REOPEN BOOKINGS ${current}`, manager)
assert.equal(reopened.state, 'reopened')
assert.match(reopened.reopenedBy || '', /^Isolated Booking Manager \[/)
const corrected = await bookings.save(record(current), manager.displayName)
const correctionAudit = await db.query<{ after_data: any }>("select after_data from audit_logs where entity_type='booking' and entity_id=$1 order by created_at desc limit 1", [corrected.id])
const after = typeof correctionAudit.rows[0].after_data === 'string' ? JSON.parse(correctionAudit.rows[0].after_data) : correctionAudit.rows[0].after_data
assert.equal(after.bookingDayCorrection.reason, 'Correct table assignment after signed manager review')
assert.equal(after.bookingDayCorrection.reopenedByUserId, manager.userId)

assert.equal((await locks.relock(current, 'Correction reviewed and service day finalized', `RELOCK BOOKINGS ${current}`, manager)).state, 'locked')
await assert.rejects(() => bookings.save({ ...corrected, covers: 3 }, manager.displayName), /BOOKING_DAY_LOCKED/)

await locks.reopen(current, 'Second isolated correction window expiry check', `REOPEN BOOKINGS ${current}`, manager)
clock = new Date(clock.getTime() + 121 * 60_000)
assert.equal((await locks.status(current, true)).state, 'locked')
await assert.rejects(() => bookings.save({ ...corrected, covers: 3 }, manager.displayName), /BOOKING_DAY_LOCKED/)

const lockAudits = await db.query<{ action: string }>("select action from audit_logs where entity_type='booking_day_lock' order by created_at")
assert.deepEqual(lockAudits.rows.map(row => row.action), ['locked', 'reopened', 'relocked', 'reopened'])

const pdf = Buffer.from(syntheticActivityProgramPdf('import'))
const parsed = await parseActivityProgramPdf(new Uint8Array(pdf))
const preview = await bookings.prepareImportPreview({ fileName: 'locked-service-day.pdf', fileHash: createHash('sha256').update(pdf).digest('hex'), reportDate: parsed.reportDate, parserVersion: ACTIVITY_PROGRAM_PARSER_VERSION, summary: { bookingGroups: parsed.bookings.length, totalCovers: parsed.bookings.reduce((total, booking) => total + (booking.covers || 0), 0), confirmed: parsed.bookings.filter(booking => booking.sourceStatus.toLowerCase() === 'confirmed').length, pending: parsed.bookings.filter(booking => booking.sourceStatus.toLowerCase() === 'pending').length, warnings: parsed.bookings.filter(booking => booking.warnings.length > 0).length, possibleDuplicates: 0 }, validation: parsed.validation, bookings: parsed.bookings })
const readyIndexes = preview.bookings.map((booking, index) => booking.readiness === 'READY' ? index : -1).filter(index => index >= 0)
await assert.rejects(() => bookings.confirmImport(preview.batchId, readyIndexes, [], manager.displayName), /BOOKING_DAY_LOCKED/)
assert.equal((await bookings.list(parsed.reportDate)).length, 0, 'locked import confirmation must not partially mutate the booking sheet')

await fixture.cleanup()
console.log('Booking daily lock automatic cutoff, manual lock, audited reopen correction, re-lock, expiry and import denial tests passed.')
