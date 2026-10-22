import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { BookingRecord } from '../src/domain.js'
import { BookingRepository } from './booking-repository.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const fixture = await createDisposableDevelopmentStore('booking-arrival-time')
const repository = new BookingRepository(fixture.db)
const booking = (id: string, status = 'confirmed'): BookingRecord => ({
  id, guestName: 'Arrival Timestamp Guest', roomNumber: '501', birthDate: null, arrivalDate: null, departureDate: null,
  mealPeriod: 'Dinner', reservationDate: '2026-10-15', reservationTime: '18:00', bookingNumber: `ARR-${id.slice(0, 6)}`,
  covers: 2, bookingStatus: status, bookingSource: 'manual', bookedBy: 'Arrival test', guestNotes: '', tableNumber: '', waiterId: null, waiter: null,
})

try {
  const id = randomUUID()
  const created = await repository.save(booking(id), 'Arrival Test Manager')
  assert.equal(created.arrivedAt, null)

  const before = Date.now()
  const arrived = await repository.save({ ...created, bookingStatus: 'arrived' }, 'Arrival Test Manager')
  const after = Date.now()
  assert.ok(arrived.arrivedAt)
  assert.ok(Date.parse(arrived.arrivedAt!) >= before && Date.parse(arrived.arrivedAt!) <= after)

  const firstArrival = arrived.arrivedAt
  await repository.save({ ...arrived, bookingStatus: 'confirmed' }, 'Arrival Test Manager')
  const arrivedAgain = await repository.save({ ...(await repository.find(id))!, bookingStatus: 'arrived' }, 'Arrival Test Manager')
  assert.equal(arrivedAgain.arrivedAt, firstArrival, 'the original recorded arrival must survive status corrections')
  assert.equal((await repository.find(id))?.arrivedAt, firstArrival, 'arrival time must persist after reopening the booking')
  assert.equal((await repository.list('2026-10-15')).find(item => item.id === id)?.arrivedAt, firstArrival, 'arrival time must persist after list refresh')

  const historicalId = randomUUID()
  await fixture.db.query("insert into bookings(id,guest_name,reservation_date,reservation_time,booking_status,covers,booking_source,created_by,updated_by) values($1,'Historical Arrival','2026-10-15','18:30','arrived',2,'manual','Legacy import','Legacy import')", [historicalId])
  assert.equal((await repository.find(historicalId))?.arrivedAt, null, 'historical arrivals without reliable audit evidence must remain unrecorded')

  const audits = (await fixture.db.query<{ actor: string }>("select actor from audit_logs where entity_type='booking' and entity_id=$1 and after_data->>'bookingStatus'='arrived' order by created_at", [id])).rows
  assert.equal(audits.length, 2)
  assert.ok(audits.every(audit => audit.actor === 'Arrival Test Manager'))

  const maldives = new Intl.DateTimeFormat('en-GB', { timeZone: 'Indian/Maldives', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date('2026-10-15T13:12:35.000Z'))
  assert.equal(maldives, '18:12:35')
  console.log(JSON.stringify({ arrivalCapturedOnSuccessfulTransition: true, originalArrivalPreserved: true, refreshPersistence: true, historicalUnknownRemainsUnknown: true, managerAuditPreserved: true, maldivesFormatting: maldives, canonicalDatabaseTouched: false }, null, 2))
} finally {
  await fixture.cleanup()
}
