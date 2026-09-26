import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { BookingRepository } from './booking-repository.js'
import { GuestOccasionRepository } from './guest-occasion-repository.js'
import type { BookingRecord, GuestOccasionRecord } from '../src/domain.js'

const db = new PGlite()
await db.exec(await readFile('database/schema.sql', 'utf8'))
const waiterOne = randomUUID(); const waiterTwo = randomUUID()
await db.query('insert into staff (id, staff_number, full_name, position_key, employment_status_key, join_date) values ($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12)', [waiterOne, 'OCC-001', 'Occasion Waiter One', 'Waiter', 'active', '2026-01-01', waiterTwo, 'OCC-002', 'Occasion Waiter Two', 'Waiter', 'active', '2026-01-01'])
const bookings = new BookingRepository(db); await bookings.initialize()
const occasions = new GuestOccasionRepository(db); await occasions.initialize()
const booking = (guestName: string, notes: string, time: string): BookingRecord => ({ id: randomUUID(), guestName, roomNumber: '201', birthDate: null, arrivalDate: null, departureDate: null, mealPeriod: 'Dinner', reservationDate: '2026-09-02', reservationTime: time, bookingNumber: `OCC-${time.replace(':', '')}`, covers: 2, bookingStatus: 'confirmed', bookingSource: 'manual', bookedBy: 'Test', guestNotes: notes, tableNumber: 'T01', waiterId: waiterOne, waiter: null, importSource: 'manual' })

const honeymoonBooking = await bookings.save(booking('Honeymoon Guest', 'Please prepare a honeymoon table.', '18:00'))
const firstDetection = await occasions.detectForBooking(honeymoonBooking.id)
assert.equal(firstDetection.length, 1)
assert.equal(firstDetection[0].occasionType, 'honeymoon')
assert.match(firstDetection[0].sourceText, /matched “honeymoon”/i)
assert.equal((await occasions.detectForBooking(honeymoonBooking.id)).length, 0)
assert.equal((await occasions.list('2026-09-02')).filter(item => item.bookingId === honeymoonBooking.id).length, 1)

await bookings.save({ ...honeymoonBooking, reservationTime: '18:15', tableNumber: 'T02', waiterId: waiterTwo })
const linked = (await occasions.list('2026-09-02')).find(item => item.bookingId === honeymoonBooking.id)!
assert.equal(linked.tableNumber, 'T02')
assert.equal(linked.waiterId, waiterTwo)
assert.equal(linked.reservationTime, '18:15')

const birthdayBooking = await bookings.save(booking('Birthday Guest', 'Birthday surprise requested.', '18:30'))
const birthdayDetection = await occasions.detectForBooking(birthdayBooking.id)
assert.equal(birthdayDetection[0].occasionType, 'birthday')
const configuration = await occasions.configuration()
const manual: GuestOccasionRecord = { id: randomUUID(), occasionType: 'see_you_soon', bookingId: birthdayBooking.id, guestName: birthdayBooking.guestName, roomNumber: birthdayBooking.roomNumber, reservationDate: birthdayBooking.reservationDate, reservationTime: birthdayBooking.reservationTime, tableNumber: birthdayBooking.tableNumber, waiterId: birthdayBooking.waiterId, waiter: null, status: configuration.statuses.find(option => option.active)?.value || 'pending', source: 'manual', sourceText: 'Manager-created occasion', notes: 'Manual validation', active: true }
assert.equal((await occasions.save(manual)).source, 'manager_created')

const memberBooking = await bookings.save(booking('Member Note Guest', '', '19:00'))
await db.query('insert into booking_guest_members (id, booking_id, guest_name, room_number, guest_notes, source_row_order) values ($1,$2,$3,$4,$5,$6)', [randomUUID(), memberBooking.id, 'Secondary Guest', '202', 'Birthday cake for secondary guest', 1])
const memberDetection = await occasions.detectForBooking(memberBooking.id)
assert.equal(memberDetection[0].occasionType, 'birthday')
assert.match(memberDetection[0].sourceText, /Guest member Secondary Guest/)

const expectedDetections = [
  ['Anniversary Guest', 'Wedding anniversary setup requested.', '19:15', 'anniversary'],
  ['Departure Guest', 'Please arrange a See You Soon recognition.', '19:30', 'see_you_soon'],
  ['Famtrip Guest', 'FAM TRIP hosted dinner.', '19:45', 'famtrip'],
  ['Press Guest', 'Press Trip dinner party.', '20:00', 'presstrip'],
  ['Family Guest', 'G: VIP | Siyam World Family Members\n- 4th Visit', '20:15', 'siyam_family']
] as const
for (const [guest, note, time, expectedType] of expectedDetections) {
  const savedBooking = await bookings.save(booking(guest, note, time))
  const detected = await occasions.detectForBooking(savedBooking.id)
  assert.equal(detected.length, 1)
  assert.equal(detected[0].occasionType, expectedType)
  if (expectedType === 'siyam_family') {
    assert.equal(detected[0].visitNumber, 4)
    assert.equal(detected[0].covers, 2)
    assert.match(detected[0].sourceText, /Siyam World Family Members/)
    assert.equal((await occasions.detectForBooking(savedBooking.id)).length, 0)
    await bookings.save({ ...savedBooking, roomNumber: '909' })
    assert.equal((await occasions.find(detected[0].id))?.roomNumber, '909')
    const prepared = configuration.statuses.find(option => option.metadata?.occasionWorkflow === 'prepared')!
    const completed = configuration.statuses.find(option => option.metadata?.occasionWorkflow === 'completed')!
    const preparedRecord = await occasions.save({ ...detected[0], status: prepared.value })
    assert.equal(preparedRecord.status, 'ready')
    const completedRecord = await occasions.save({ ...preparedRecord, status: completed.value })
    assert.equal(completedRecord.status, 'completed')
  }
}

const honeymoonType = configuration.types.find(option => option.value === 'honeymoon')!
await assert.rejects(occasions.saveConfiguration('types', { ...honeymoonType, active: false }), /display color changes only/i)
assert.equal((await occasions.configuration()).types.find(option => option.value === 'honeymoon')?.active, true)
assert((await occasions.list('2026-09-02')).some(item => item.id === firstDetection[0].id))
const summary = await occasions.summary('2026-09-02')
assert.deepEqual(summary, { totalOccasions: 9, attentionRequired: 8, vipSpecialGuests: 3, completed: 1 })
console.log(JSON.stringify({ approvedCategoriesDetected: true, evidencePreserved: true, visitNumberExtracted: true, duplicatePrevented: true, linkedAssignmentsUpdated: true, guestMemberDetected: true, manualCreated: true, statusWorkflowPersisted: true, protectedTypeCannotDeactivate: true, historicalRetained: true, summary }, null, 2))
