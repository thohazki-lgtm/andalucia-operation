import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { BookingRepository } from './booking-repository.js'
import { ChargeableRepository } from './chargeable-repository.js'
import { GuestOccasionRepository } from './guest-occasion-repository.js'
import { OperationsRepository } from './operations-repository.js'
import { ReportingRepository } from './reporting-repository.js'
import { TrainingRepository } from './training-repository.js'
import type { BookingRecord, ChargeableRecord, GuestOccasionRecord, TrainingSession } from '../src/domain.js'

const db = new PGlite()
await db.exec(await readFile('database/schema.sql', 'utf8'))
const activeId = randomUUID(); const inactiveId = randomUUID()
await db.query('insert into staff (id,staff_number,full_name,position_key,employment_status_key,join_date) values ($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12)', [activeId, 'P2-A', 'Phase Two Active', 'Waiter', 'active', '2026-01-01', inactiveId, 'P2-I', 'Phase Two Inactive', 'Waiter', 'inactive', '2026-01-01'])

const operations = new OperationsRepository(db); const training = new TrainingRepository(db); const bookings = new BookingRepository(db); const chargeables = new ChargeableRepository(db); const occasions = new GuestOccasionRepository(db)
await operations.initialize(); await training.initialize(); await bookings.initialize(); await chargeables.initialize(); await occasions.initialize()
await db.query("insert into configuration_options(id,group_key,value,label,metadata,active,sort_order) values ($1,'duty_codes','WORK_X','Renamed Work', $2,true,1),($3,'duty_codes','REST_X','Renamed Rest',$4,true,2),($5,'duty_codes','LEAVE_X','Renamed Leave',$6,true,3)", [randomUUID(), JSON.stringify({ countsAsWorking: true, dutyClassification: 'working' }), randomUUID(), JSON.stringify({ countsAsWorking: false, dutyClassification: 'off' }), randomUUID(), JSON.stringify({ countsAsWorking: false, dutyClassification: 'annualLeave' })])

await assert.rejects(() => operations.updateRoster(inactiveId, '2026-09-03', 'WORK_X'), /not eligible for new duty assignments/)
await db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values ($1,$2,$3,$4)', [randomUUID(), inactiveId, '2026-09-02', 'WORK_X'])
await operations.updateRoster(inactiveId, '2026-09-02', 'WORK_X')

const session: TrainingSession = { id: randomUUID(), title: 'Guard', category: 'safety', date: '2026-09-03', time: '10:00', trainer: 'Manager', status: 'planned', notes: '', active: true, attendees: [{ staffId: inactiveId, attendanceStatus: null, staff: { name: 'Phase Two Inactive', number: 'P2-I', position: 'Waiter', employmentStatus: 'inactive' } }] }
await assert.rejects(() => training.save(session), /Inactive staff|not eligible/)

const booking = (status: string, covers: number, time: string): BookingRecord => ({ id: randomUUID(), guestName: `${status} guest`, roomNumber: '100', birthDate: null, arrivalDate: null, departureDate: null, mealPeriod: 'Dinner', reservationDate: '2026-09-03', reservationTime: time, bookingNumber: randomUUID(), covers, bookingStatus: status, bookingSource: 'manual', bookedBy: 'Test', guestNotes: '', tableNumber: '', waiterId: null, waiter: null, importSource: 'manual' })
for (const [status, covers, time] of [['confirmed', 4, '18:00'], ['arrived', 3, '18:30'], ['completed', 2, '19:00'], ['no_show', 5, '19:30'], ['cancelled', 6, '20:00']] as Array<[string, number, string]>) await bookings.save(booking(status, covers, time))
await assert.rejects(() => bookings.save({ ...booking('confirmed', 1, '20:30'), waiterId: inactiveId }), /Inactive staff|not eligible/)
const bookingSummary = await bookings.summary('2026-09-03')
assert.deepEqual({ expected: bookingSummary.expectedCovers, arrived: bookingSummary.arrivedCovers, remaining: bookingSummary.remainingCovers, noShow: bookingSummary.noShowCovers }, { expected: 9, arrived: 5, remaining: 4, noShow: 5 })

const item = (await chargeables.configuration()).items.find(option => option.active)!
const charge: ChargeableRecord = { id: randomUUID(), date: '2026-09-03', bookingId: null, guestName: 'Guest', roomNumber: '100', tableNumber: '', itemValue: item.value, itemLabel: item.label, itemCategory: item.metadata?.category || '', quantity: 1, unitPrice: Number(item.metadata?.price), totalAmount: 0, waiterId: inactiveId, waiter: null, status: 'pending', notes: '', active: true }
await assert.rejects(() => chargeables.save(charge), /Inactive staff|not eligible/)

const activeOccasionType = (await occasions.configuration()).types.find(option => option.active)!.value
const occasion: GuestOccasionRecord = { id: randomUUID(), occasionType: activeOccasionType, bookingId: null, guestName: 'Guest', roomNumber: '100', reservationDate: '2026-09-03', reservationTime: '18:00', tableNumber: '', waiterId: inactiveId, waiter: null, status: 'pending', source: 'manual', sourceText: '', notes: '', active: true }
await assert.rejects(() => occasions.save(occasion), /Inactive staff|not eligible/)

await operations.updateRoster(activeId, '2026-09-03', 'REST_X')
await operations.updateRoster(activeId, '2026-09-04', 'LEAVE_X')
await operations.updateRoster(activeId, '2026-09-05', 'WORK_X')
const trainingConfiguration = await training.configuration()
const attended = trainingConfiguration['attendance-statuses'].find(option => option.value === 'attended')!
const completedTraining = trainingConfiguration.statuses.find(option => option.value === 'completed')!
await training.save({ ...session, id: randomUUID(), status: completedTraining.value, attendees: [{ staffId: activeId, attendanceStatus: attended.value, staff: { name: 'Phase Two Active', number: 'P2-A', position: 'Waiter', employmentStatus: 'active' } }] })
await training.saveConfiguration('attendance-statuses', { ...attended, label: 'Participated' })
await training.saveConfiguration('statuses', { ...completedTraining, label: 'Finished' })
const occasionConfiguration = await occasions.configuration()
const completedOccasion = occasionConfiguration.statuses.find(option => option.value === 'completed')!
await occasions.save({ ...occasion, id: randomUUID(), waiterId: null, status: completedOccasion.value })
await occasions.saveConfiguration('statuses', { ...completedOccasion, label: 'Done' })
const report = await new ReportingRepository(db).report('custom', '2026-09-03', '2026-09-05')
assert.deepEqual({ off: report.attendance.off, annualLeave: report.attendance.annualLeave, actualWorking: report.attendance.actualWorking }, { off: 1, annualLeave: 1, actualWorking: 0 })
assert.deepEqual({ expected: report.bookings.expectedCovers, arrived: report.bookings.arrivedCovers, remaining: report.bookings.remainingCovers, noShow: report.bookings.noShowCovers }, { expected: 9, arrived: 5, remaining: 4, noShow: 5 })
assert.equal(report.training.attended, 1)
assert.equal(report.occasions.completed, 1)

const renamedAttended = (await training.configuration())['attendance-statuses'].find(option => option.value === 'attended')!
assert.equal(renamedAttended.label, 'Participated')
assert.equal(attended.metadata?.trainingAttendanceOutcome, 'attended')
const completed = (await occasions.configuration()).statuses.find(option => option.value === 'completed')!
assert.equal(completed.label, 'Done')
assert.equal(completed.metadata?.occasionStage, 'completed')

console.log(JSON.stringify({ inactiveRosterRejected: true, inactiveTrainingRejected: true, inactiveBookingWaiterRejected: true, inactiveChargeableWaiterRejected: true, inactiveOccasionWaiterRejected: true, historicalRosterRetained: true, bookingSummary, dutySemantics: report.attendance, trainingMetadata: attended.metadata, occasionMetadata: completed.metadata }, null, 2))
