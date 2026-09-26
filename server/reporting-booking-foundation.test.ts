import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { BookingRepository } from './booking-repository.js'
import { ReportingRepository } from './reporting-repository.js'
import type { BookingRecord } from '../src/domain.js'

const db = new PGlite()
await db.exec(await readFile('database/schema.sql', 'utf8'))
const bookings = new BookingRepository(db)
await bookings.initialize()
const makeBooking = (date: string, time: string, status: string, covers: number): BookingRecord => ({ id: randomUUID(), guestName: 'Reporting guest', roomNumber: '101', birthDate: null, arrivalDate: null, departureDate: null, mealPeriod: 'Dinner', reservationDate: date, reservationTime: time, bookingNumber: randomUUID(), covers, bookingStatus: status, bookingSource: 'manual', bookedBy: 'Test', guestNotes: '', tableNumber: '', waiterId: null, waiter: null })
const saveWithMembers = async (record: BookingRecord, birthDates: Array<string | null>) => { await bookings.save(record); for (const [index, birthDate] of birthDates.entries()) await db.query('insert into booking_guest_members(id,booking_id,guest_name,birth_date,source_row_order) values($1,$2,$3,$4,$5)', [randomUUID(), record.id, `Guest ${index + 1}`, birthDate, index]) }

await saveWithMembers(makeBooking('2026-09-08', '18:00', 'confirmed', 3), ['2014-09-08', '1990-01-01', null])
await saveWithMembers(makeBooking('2026-09-08', '18:30', 'arrived', 2), ['2014-09-09', '1988-01-01'])
await saveWithMembers(makeBooking('2026-09-08', '19:00', 'no_show', 4), ['2018-01-01'])
await saveWithMembers(makeBooking('2026-09-01', '18:00', 'confirmed', 2), ['1980-01-01', '1981-01-01'])

const explicitInfant = makeBooking('2026-09-08', '20:00', 'confirmed', 7)
await saveWithMembers(explicitInfant, Array.from({ length: 6 }, () => null))
await db.query('update bookings set raw_import_payload=$2 where id=$1', [explicitInfant.id, JSON.stringify({ coverResolution: { totalCovers: 7, kids: 1, adults: 6, source: 'arithmetic_expression' } })])

const reporting = new ReportingRepository(db)
const week = await reporting.report('week', '2026-09-07', '2026-09-13')
assert.deepEqual({ covers: week.bookings.expectedCovers, adults: week.bookings.adults, kids: week.bookings.kids, noShowCovers: week.bookings.noShowCovers, arrivalPercent: week.bookings.arrivalPercent }, { covers: 12, adults: 9, kids: 3, noShowCovers: 4, arrivalPercent: 16.67 })
assert.equal(week.bookings.adults + week.bookings.kids, week.bookings.expectedCovers)
assert.deepEqual({ covers: week.bookings.totalCovers, adults: week.bookings.totalAdults, kids: week.bookings.totalKids }, { covers: 16, adults: 12, kids: 4 })
assert.equal(week.bookings.totalAdults + week.bookings.totalKids, week.bookings.totalCovers)
assert.equal(week.bookings.arrivedCovers + week.bookings.remainingCovers + week.bookings.noShowCovers, week.bookings.totalCovers)
assert.equal(week.bookings.byDate.length, 7)
for (const row of week.bookings.byDate) { assert.equal(row.adults + row.kids, row.expectedCovers); assert.equal(row.totalAdults + row.totalKids, row.totalCovers); assert.equal(row.arrivedCovers + row.remainingCovers + row.noShowCovers, row.totalCovers) }
assert.deepEqual(week.comparison.map(item => [item.key, item.current, item.previous]), [['covers', 16, 2], ['adults', 12, 2], ['kids', 4, 0], ['no_show_covers', 4, 0]])

const month = await reporting.report('month', '2026-09-01', '2026-09-30')
assert.equal(month.bookings.adults + month.bookings.kids, month.bookings.expectedCovers)
assert.equal(month.bookings.byWeek.length, 5)
for (const row of month.bookings.byWeek) assert.equal(row.adults + row.kids, row.expectedCovers)
for (const row of month.bookings.byWeek) assert.equal(row.totalAdults + row.totalKids, row.totalCovers)
assert.equal(month.bookings.byWeek[0].weekStart, '2026-09-01')
assert.equal(month.bookings.byWeek.at(-1)?.weekEnd, '2026-09-30')
assert.deepEqual(month.comparison.map(item => [item.key, item.current, item.previous, item.changePercent]), [['covers', 18, 0, null], ['adults', 14, 0, null], ['kids', 4, 0, null], ['no_show_covers', 4, 0, null]])

const custom = await reporting.report('custom', '2026-09-08', '2026-09-08')
assert.deepEqual({ covers: custom.bookings.expectedCovers, adults: custom.bookings.adults, kids: custom.bookings.kids, noShowCovers: custom.bookings.noShowCovers }, { covers: 12, adults: 9, kids: 3, noShowCovers: 4 })
assert.deepEqual({ covers: custom.bookings.totalCovers, adults: custom.bookings.totalAdults, kids: custom.bookings.totalKids, noShowCovers: custom.bookings.noShowCovers }, { covers: 16, adults: 12, kids: 4, noShowCovers: 4 })
console.log(JSON.stringify({ week: week.bookings, monthWeeks: month.bookings.byWeek, comparison: week.comparison }, null, 2))
