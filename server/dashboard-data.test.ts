import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { BookingRepository } from './booking-repository.js'
import { ChargeableRepository } from './chargeable-repository.js'
import { GuestOccasionRepository } from './guest-occasion-repository.js'
import { MaintenanceRepository } from './maintenance-repository.js'
import { ReportingRepository } from './reporting-repository.js'
import { buildDashboardData, buildHostessServiceBoard, buildTeamToday } from '../src/dashboard-data.js'
import { config, type BookingRecord, type ChargeableRecord, type GuestOccasionRecord, type MaintenanceRecord, type RosterEntry, type Staff } from '../src/domain.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'

const date = '2026-08-31'
const db = new PGlite()
await db.exec(await readFile('database/schema.sql', 'utf8'))
await db.query("insert into outlet_scopes(id,scope_key,display_name,active,outlet_type) values($1,'andalucia','Andalucía',true,'restaurant')", [ANDALUCIA_SCOPE_ID])
// The Dashboard fixture uses the post-Migration-013 charged-record contract.
await db.exec("alter table chargeable_item_records add column if not exists check_invoice_number text not null default ''")
const bookings = new BookingRepository(db); const chargeables = new ChargeableRepository(db); const occasions = new GuestOccasionRepository(db); const maintenance = new MaintenanceRepository(db)
await bookings.initialize(); await chargeables.initialize(); await occasions.initialize(); await maintenance.initialize()
const waiterId = randomUUID()
await db.query('insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,$2,$3,$4,$5,$6)', [waiterId, 'W-1', 'Waiter One', 'Waiter', 'active', '2026-01-01'])

const booking = (covers: number, status: string, time: string, index: number, assigned = true): BookingRecord => ({ id: randomUUID(), guestName: `Guest ${index}`, roomNumber: String(700 + index), birthDate: null, arrivalDate: date, departureDate: '2026-09-01', mealPeriod: 'Dinner', reservationDate: date, reservationTime: time, bookingNumber: `DASH-${index}`, covers, bookingStatus: status, bookingSource: 'manual', bookedBy: 'Test', guestNotes: '', tableNumber: `T${index}`, waiterId: assigned ? waiterId : null, waiter: null })
const plan = [
  ...[12, 12, 12, 12, 12, 6].map((covers, index) => ({ covers, status: 'arrived', time: index < 3 ? '18:00' : '18:30', assigned: true })),
  ...[12, 12, 12, 4, 1].map((covers, index) => ({ covers, status: 'confirmed', time: index === 4 ? '18:15' : '19:00', assigned: index !== 0 })),
  { covers: 8, status: 'no_show', time: '19:30', assigned: true },
  { covers: 2, status: 'no_show', time: '19:30', assigned: true }
]
let childrenRemaining = 18
const liveBookings: BookingRecord[] = []
for (let index = 0; index < plan.length; index++) {
  const item = plan[index]
  const saved = await bookings.save(booking(item.covers, item.status, item.time, index + 1, item.assigned))
  liveBookings.push(saved)
  for (let member = 0; member < item.covers; member++) {
    const child = childrenRemaining > 0; if (child) childrenRemaining--
    await db.query('insert into booking_guest_members(id,booking_id,guest_name,room_number,birth_date,source_row_order) values($1,$2,$3,$4,$5,$6)', [randomUUID(), saved.id, `Member ${index}-${member}`, saved.roomNumber, child ? '2016-01-01' : '1980-01-01', member])
  }
}
const cancelled = await bookings.save(booking(12, 'cancelled', '20:00', 99, false))

const occasionTypes = (await occasions.configuration()).types
for (const [index, type] of occasionTypes.filter(option => option.metadata?.occasionCategory && option.metadata.occasionCategory !== 'other').entries()) {
  const record: GuestOccasionRecord = { id: randomUUID(), occasionType: type.value, bookingId: null, guestName: `Occasion ${index}`, roomNumber: String(800 + index), reservationDate: date, reservationTime: '19:00', tableNumber: 'T1', waiterId, waiter: null, status: 'completed', source: 'manual', sourceText: '', notes: '', active: true }
  await occasions.save(record)
}

const lobster = (await chargeables.configuration()).items.find(option => option.value === 'lobster_paella')!
const charge: ChargeableRecord = { id: randomUUID(), date, bookingId: liveBookings[0].id, guestName: liveBookings[0].guestName, roomNumber: liveBookings[0].roomNumber, checkInvoiceNumber: 'DASHBOARD-FIXTURE-001', tableNumber: liveBookings[0].tableNumber, itemValue: lobster.value, itemLabel: lobster.label, itemCategory: lobster.metadata?.category || '', quantity: 2, unitPrice: 0, totalAmount: 0, waiterId, waiter: null, status: 'charged', notes: '', active: true }
await chargeables.save(charge)
const maintenanceArea = (await maintenance.configuration()).areas[0].value
for (const [issue, status, priority] of [['Open issue', 'open', 'urgent'], ['Progress issue', 'in_progress', 'normal']] as const) {
  const record: MaintenanceRecord = { id: randomUUID(), issue, dateReported: date, area: maintenanceArea, priority, status: 'open', referenceFollowUp: '', notes: '', reportedByStaffId: null, reportedBy: null, revision: 1 }
  const saved = await maintenance.save(record)
  if (status === 'in_progress') await maintenance.save({ ...saved, status })
}

const report = await new ReportingRepository(db).report('today', date, date)
const bookingSummary = await bookings.summary(date)
const maintenanceSummary = await maintenance.summary(date)
const dashboard = buildDashboardData(report, bookingSummary, maintenanceSummary)
assert.deepEqual(dashboard.bookings, { totalCovers: 117, adults: 99, kids: 18 })
assert.deepEqual(dashboard.serviceProgress, { arrivedCovers: 66, remainingCovers: 41, noShowCovers: 10 })
assert.equal(dashboard.bookings.totalCovers, dashboard.bookings.adults + dashboard.bookings.kids)
assert.equal(dashboard.bookings.totalCovers, dashboard.serviceProgress.arrivedCovers + dashboard.serviceProgress.remainingCovers + dashboard.serviceProgress.noShowCovers)
assert.deepEqual(dashboard.occasions.categories.map(item => [item.label, item.count]), [['Honeymoon', 1], ['Birthday', 1], ['Anniversary', 1], ['See You Soon', 1], ['Siyam Family', 1], ['Famtrip', 1], ['Presstrip', 1]])
assert.deepEqual(dashboard.chargeables, { realizedRevenue: 170, itemsSold: 2, topItem: 'Lobster Paella' })
assert.deepEqual(dashboard.attention.categories.map(item => [item.key, item.count]), [['maintenance', 1], ['waiters', 1]])
assert.equal(dashboard.attention.total, 2)
const withOccasionAttention = buildDashboardData({ ...report, occasions: { ...report.occasions, requiringAttention: 1 } }, bookingSummary, maintenanceSummary)
assert.equal(withOccasionAttention.attention.total, 3)
assert.deepEqual(withOccasionAttention.attention.categories.find(item => item.key === 'occasions'), { key: 'occasions', label: 'Guest occasions', count: 1 })

const statusOptions = (await bookings.configuration()).statuses
const boardDate = '2026-09-08'
const boardBooking = (covers: number, status: string, time: string, index: number): BookingRecord => ({ ...booking(covers, status, time, index), reservationDate: boardDate })
const groupResolution = (baseCovers: number, covers: number, groupId: string, groupTotal: number) => ({ baseCovers, totalCovers: covers, adults: covers, kids: 0, structuredKids: 0, explicitKids: 0, source: 'linked_room_group_total' as const, evidence: `${groupId} ${groupTotal}pax`, groupId, groupTotal, diagnostics: [] })
const boardBookings: BookingRecord[] = [
  boardBooking(2, 'confirmed', '19:15', 201),
  boardBooking(4, 'confirmed', '19:20', 202),
  boardBooking(4, 'confirmed', '19:30', 203),
  { ...boardBooking(10, 'confirmed', '19:35', 204), coverResolution: { baseCovers: 4, totalCovers: 10, adults: 10, kids: 0, structuredKids: 0, explicitKids: 0, source: 'joining_family_total', evidence: 'JOINING WITH 10 PAX', groupTotal: 10, diagnostics: [] } },
  boardBooking(6, 'arrived', '19:50', 205),
  { ...boardBooking(7, 'confirmed', '20:00', 206), coverResolution: groupResolution(6, 7, 'rooms:374|375|376|426', 12) },
  { ...boardBooking(5, 'confirmed', '20:00', 207), coverResolution: groupResolution(5, 5, 'rooms:374|375|376|426', 12) },
  { ...boardBooking(15, 'confirmed', '20:30', 208), coverResolution: groupResolution(14, 15, 'rooms:325|710|712|713|720', 20) },
  { ...boardBooking(5, 'confirmed', '20:30', 209), coverResolution: groupResolution(5, 5, 'rooms:325|710|712|713|720', 20) },
  { ...boardBooking(3, 'confirmed', '21:00', 210), sourceBookingStatus: 'Pending' },
  boardBooking(5, 'no_show', '21:30', 211),
  boardBooking(2, 'cancelled', '21:30', 212)
]
const serviceBoard = buildHostessServiceBoard(boardBookings, statusOptions, boardDate, new Date('2026-09-08T14:10:00Z'))
assert.deepEqual(serviceBoard.partySizes, [2, 3, 4, 10, 12, 20])
assert.equal(serviceBoard.rows.find(row => row.time === '19:15')?.label, '19:15 – 19:45')
assert.equal(serviceBoard.rows.reduce((sum, row) => sum + Object.values(row.counts).reduce((total, count) => total + count, 0), 0), 7)
assert.deepEqual(serviceBoard.summary, { upcomingParties: 7, upcomingCovers: 55, arrivedParties: 1, arrivedCovers: 6, noShowParties: 1, noShowCovers: 5 })
assert.deepEqual(serviceBoard.next.groups, [{ size: 2, count: 1 }, { size: 4, count: 2 }, { size: 10, count: 1 }])
assert.equal(serviceBoard.next.mode, 'next30')
assert.equal(serviceBoard.rows.some(row => row.time === '19:50' || row.time === '21:30'), false)
const nextSlot = buildHostessServiceBoard(boardBookings.filter(item => item.reservationTime === '20:30'), statusOptions, boardDate, new Date('2026-09-08T14:40:00Z'))
assert.deepEqual({ mode: nextSlot.next.mode, label: nextSlot.next.label, groups: nextSlot.next.groups }, { mode: 'nextSlot', label: '20:30 – 21:00', groups: [{ size: 20, count: 1 }] })
const scheduled = buildHostessServiceBoard(boardBookings, statusOptions, boardDate, new Date('2026-09-09T14:10:00Z'))
assert.equal(scheduled.next.eyebrow, 'UPCOMING BY TIME')
const allArrived = buildHostessServiceBoard([boardBooking(6, 'arrived', '19:50', 213)], statusOptions, boardDate, new Date('2026-09-08T14:10:00Z'))
assert.equal(allArrived.zeroMessage, 'All expected guests have arrived.')

const teamStaff = Array.from({ length: 10 }, (_, index): Staff => ({ id: randomUUID(), name: `Staff ${index}`, number: `S${index}`, position: 'Waiter', joinDate: '2026-01-01', nationality: '', division: 'Food & Beverage', department: 'F&B Service', outlet: 'Andalucía', identityDocumentNumber: '', employmentStatus: 'active', assignmentEligible: true }))
const workingDuty = config.dutyCodes.find(option => option.metadata?.countsAsWorking)!
const offDuty = config.dutyCodes.find(option => option.metadata?.dutyClassification === 'off')!
const leaveDuty = config.dutyCodes.find(option => option.metadata?.dutyClassification === 'annualLeave')!
const teamRoster: RosterEntry[] = teamStaff.map((person, index) => ({ staffId: person.id, date, dutyCode: index < 8 ? workingDuty.value : index === 8 ? offDuty.value : leaveDuty.value, updatedAt: '', updatedBy: 'Test' }))
const team = buildTeamToday(teamStaff, teamRoster, config.dutyCodes)
assert.deepEqual({ working: team.working.length, off: team.off.length, leave: team.leave.length, total: team.totalStaff }, { working: 8, off: 1, leave: 1, total: 10 })

const zeroSummary = { totalBookings: 0, expectedCovers: 0, arrived: 0, arrivedCovers: 0, remainingBookings: 0, remainingCovers: 0, noShows: 0, noShowCovers: 0, unassignedTables: 0, unassignedWaiters: 0 }
assert.equal(buildDashboardData(null, zeroSummary, { openIssues: 0, inProgress: 0, completedToday: 0 }).attention.total, 0)
console.log(JSON.stringify({ team: { working: team.working.length, off: team.off.length, leave: team.leave.length }, bookings: dashboard.bookings, service: dashboard.serviceProgress, occasions: dashboard.occasions, chargeables: dashboard.chargeables, attention: dashboard.attention, hostessBoard: { partySizes: serviceBoard.partySizes, summary: serviceBoard.summary, next: serviceBoard.next, nextSlot: nextSlot.next } }, null, 2))
