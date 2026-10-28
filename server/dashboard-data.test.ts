import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { BookingRepository } from './booking-repository.js'
import { ChargeableRepository } from './chargeable-repository.js'
import { GuestOccasionRepository } from './guest-occasion-repository.js'
import { MaintenanceRepository } from './maintenance-repository.js'
import { ReportingRepository } from './reporting-repository.js'
import { buildDailyTraining, buildDashboardData, buildHostessServiceBoard, buildTeamToday, dashboardOccasionStyle } from '../src/dashboard-data.js'
import { config, type BookingRecord, type ChargeableRecord, type GuestOccasionRecord, type MaintenanceRecord, type RosterEntry, type Staff, type TrainingSession } from '../src/domain.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const date = '2026-08-31'
const fixture = await createDisposableDevelopmentStore('dashboard-data')
const db = fixture.db
await db.query("insert into outlet_scopes(id,scope_key,display_name,active,outlet_type) values($1,'andalucia','Andalucía',true,'restaurant') on conflict (id) do nothing", [ANDALUCIA_SCOPE_ID])
// The Dashboard fixture uses the post-Migration-013 charged-record contract.
await db.exec("alter table chargeable_item_records add column if not exists check_invoice_number text not null default ''")
const bookings = new BookingRepository(db); const chargeables = new ChargeableRepository(db); const occasions = new GuestOccasionRepository(db); const maintenance = new MaintenanceRepository(db)
await bookings.initialize(); await chargeables.initialize(); await occasions.initialize(); await maintenance.initialize()
const waiterId = randomUUID()
await db.query('insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,$2,$3,$4,$5,$6)', [waiterId, 'W-1', 'Waiter One', 'Waiter', 'active', '2026-01-01'])

const booking = (covers: number, status: string, time: string, index: number, assigned = true): BookingRecord => ({ id: randomUUID(), guestName: `Guest ${index}`, roomNumber: String(700 + index), birthDate: null, arrivalDate: date, departureDate: '2026-09-01', mealPeriod: 'Dinner', reservationDate: date, reservationTime: time, bookingNumber: `DASH-${index}`, covers, bookingStatus: status, bookingSource: 'manual', bookedBy: 'Test', guestNotes: '', tableNumber: '', waiterId: assigned ? waiterId : null, waiter: null })
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
await chargeables.save(charge, { outletScopeId: ANDALUCIA_SCOPE_ID, actor: 'Dashboard fixture' })
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
assert.deepEqual(dashboard.occasions.categories.map(item => [item.label, item.count]), [['Honeymoon', 1], ['Birthday', 1], ['Anniversary', 1], ['See You Soon', 1], ['VIP', 3], ['Siyam Family', 1], ['Famtrip', 1], ['Presstrip', 1]])
for (const option of config.occasionTypes) {
  const key = option.metadata?.occasionCategory
  if (!key || key === 'other') continue
  assert.deepEqual(dashboardOccasionStyle(key, config.occasionTypes), { backgroundColor: option.color, borderColor: option.color, color: '#ffffff' }, `${option.label} must reuse its Guest Occasions source color`)
}
assert.deepEqual(dashboardOccasionStyle('vip', config.occasionTypes), { backgroundColor: '#6c63a8', borderColor: '#6c63a8', color: '#ffffff' })
assert.deepEqual(dashboardOccasionStyle('tlc', config.occasionTypes), { backgroundColor: '#e4eff4', borderColor: '#e4eff4', color: '#23678c' })
const withZeroOccasion = buildDashboardData({ ...report, occasions: { ...report.occasions, byCategory: [...report.occasions.byCategory, { key: 'zero', label: 'Zero category', count: 0 }] } }, bookingSummary, maintenanceSummary)
assert.equal(withZeroOccasion.occasions.categories.some(item => item.key === 'zero'), false)
assert.deepEqual(dashboard.chargeables, { realizedRevenue: 170, itemsSold: 2, topItem: 'Lobster Paella' })
assert.deepEqual(dashboard.attention.categories.map(item => [item.key, item.count]), [['maintenance', 2]])
assert.equal(dashboard.attention.total, 2)
const withOccasionAttention = buildDashboardData({ ...report, occasions: { ...report.occasions, requiringAttention: 1 } }, bookingSummary, maintenanceSummary)
assert.equal(withOccasionAttention.attention.total, 2)
assert.equal(withOccasionAttention.attention.categories.some(item => item.key === 'occasions'), false)

const statusOptions = (await bookings.configuration()).statuses
const boardDate = '2026-09-08'
const boardBooking = (covers: number, status: string, time: string, index: number): BookingRecord => ({ ...booking(covers, status, time, index), reservationDate: boardDate })
const groupResolution = (baseCovers: number, covers: number, groupId: string, groupTotal: number) => ({ baseCovers, totalCovers: covers, adults: covers, kids: 0, structuredKids: 0, explicitKids: 0, source: 'linked_room_group_total' as const, evidence: `${groupId} ${groupTotal}pax`, groupId, groupTotal, diagnostics: [] })
const boardBookings: BookingRecord[] = [
  boardBooking(2, 'confirmed', '19:15', 201),
  boardBooking(4, 'confirmed', '19:20', 202),
  boardBooking(4, 'confirmed', '19:30', 203),
  { ...boardBooking(4, 'confirmed', '19:35', 204), coverResolution: { baseCovers: 4, totalCovers: 4, adults: 4, kids: 0, structuredKids: 0, explicitKids: 0, source: 'joining_family_total', evidence: 'JOINING WITH 10 PAX', groupTotal: 10, diagnostics: [] } },
  boardBooking(6, 'arrived', '19:50', 205),
  { ...boardBooking(6, 'confirmed', '20:00', 206), coverResolution: groupResolution(6, 6, 'rooms:374|375|376|426', 12) },
  { ...boardBooking(5, 'confirmed', '20:00', 207), coverResolution: groupResolution(5, 5, 'rooms:374|375|376|426', 12) },
  { ...boardBooking(14, 'confirmed', '20:30', 208), coverResolution: groupResolution(14, 14, 'rooms:325|710|712|713|720', 20) },
  { ...boardBooking(5, 'confirmed', '20:30', 209), coverResolution: groupResolution(5, 5, 'rooms:325|710|712|713|720', 20) },
  { ...boardBooking(3, 'confirmed', '21:00', 210), sourceBookingStatus: 'Pending' },
  boardBooking(5, 'no_show', '21:30', 211),
  boardBooking(2, 'cancelled', '21:30', 212)
]
const serviceBoard = buildHostessServiceBoard(boardBookings, statusOptions, boardDate, new Date('2026-09-08T14:10:00Z'))
assert.deepEqual(serviceBoard.partySizes, [2, 3, 4, 5, 6, 14])
assert.equal(serviceBoard.rows.find(row => row.time === '19:15')?.label, '19:15 – 19:45')
assert.equal(serviceBoard.rows.reduce((sum, row) => sum + Object.values(row.counts).reduce((total, count) => total + count, 0), 0), 9)
assert.deepEqual(serviceBoard.summary, { upcomingParties: 9, upcomingCovers: 47, arrivedParties: 1, arrivedCovers: 6, noShowParties: 1, noShowCovers: 5 })
assert.deepEqual(serviceBoard.next.groups, [{ size: 2, count: 1 }, { size: 4, count: 3 }])
assert.equal(serviceBoard.next.mode, 'next30')
assert.equal(serviceBoard.rows.some(row => row.time === '19:50' || row.time === '21:30'), false)
const nextSlot = buildHostessServiceBoard(boardBookings.filter(item => item.reservationTime === '20:30'), statusOptions, boardDate, new Date('2026-09-08T14:40:00Z'))
assert.deepEqual({ mode: nextSlot.next.mode, label: nextSlot.next.label, groups: nextSlot.next.groups }, { mode: 'nextSlot', label: '20:30 – 21:00', groups: [{ size: 5, count: 1 }, { size: 14, count: 1 }] })
const scheduled = buildHostessServiceBoard(boardBookings, statusOptions, boardDate, new Date('2026-09-09T14:10:00Z'))
assert.equal(scheduled.next.eyebrow, 'UPCOMING BY TIME')
assert.equal(scheduled.rows.some(row => row.active), false)
const activeBoard = buildHostessServiceBoard(boardBookings, statusOptions, boardDate, new Date('2026-09-08T14:16:00Z'))
assert.equal(activeBoard.rows.find(row => row.time === '19:15')?.active, true)
assert.equal(activeBoard.rows.find(row => row.time === '19:20')?.active, false)
const allArrived = buildHostessServiceBoard([boardBooking(6, 'arrived', '19:50', 213)], statusOptions, boardDate, new Date('2026-09-08T14:10:00Z'))
assert.equal(allArrived.zeroMessage, 'All expected guests have arrived.')

const teamStaff = Array.from({ length: 11 }, (_, index): Staff => ({ id: randomUUID(), name: `Staff ${index}`, number: `S${index}`, position: 'Waiter', joinDate: '2026-01-01', nationality: '', division: 'Food & Beverage', department: 'F&B Service', outlet: 'Andalucía', identityDocumentNumber: '', employmentStatus: 'active', assignmentEligible: true }))
const workingDuty = config.dutyCodes.find(option => option.metadata?.countsAsWorking)!
const offDuty = config.dutyCodes.find(option => option.metadata?.dutyClassification === 'off')!
const leaveDuty = config.dutyCodes.find(option => option.metadata?.dutyClassification === 'annualLeave')!
const teamRoster: RosterEntry[] = teamStaff.slice(0, 10).map((person, index) => ({ staffId: person.id, date, dutyCode: index < 8 ? workingDuty.value : index === 8 ? offDuty.value : leaveDuty.value, updatedAt: '', updatedBy: 'Test' }))
const team = buildTeamToday(teamStaff, teamRoster, config.dutyCodes)
assert.deepEqual({ working: team.working.length, off: team.off.length, leave: team.leave.length, unassigned: team.unassigned.length, total: team.totalStaff }, { working: 8, off: 1, leave: 1, unassigned: 1, total: 11 })

const trainingSession = (overrides: Partial<TrainingSession>): TrainingSession => ({ id: randomUUID(), title: 'Service Standards', category: 'service', date, time: '15:00', startTime: '15:00', endTime: '16:00', trainer: 'Training Manager', status: 'scheduled', operationalStatus: 'scheduled', notes: '', active: true, attendees: [], ...overrides })
const dailyTraining = buildDailyTraining([
  trainingSession({ title: 'Cancelled today', operationalStatus: 'cancelled' }),
  trainingSession({ title: 'Today later', startTime: '16:00', time: '16:00' }),
  trainingSession({ title: 'Today first', startTime: '14:00', time: '14:00' }),
  trainingSession({ title: 'Next session', date: '2026-09-01' })
], date)
assert.deepEqual({ mode: dailyTraining.mode, title: dailyTraining.session?.title }, { mode: 'today', title: 'Today first' })
const upcomingTraining = buildDailyTraining([trainingSession({ title: 'Past', date: '2026-08-30' }), trainingSession({ title: 'Upcoming', date: '2026-09-02' })], date)
assert.deepEqual({ mode: upcomingTraining.mode, title: upcomingTraining.session?.title }, { mode: 'upcoming', title: 'Upcoming' })
assert.equal(buildDailyTraining([trainingSession({ active: false })], date).session, null)

const zeroSummary = { totalBookings: 0, expectedCovers: 0, arrived: 0, arrivedCovers: 0, remainingBookings: 0, remainingCovers: 0, noShows: 0, noShowCovers: 0, unassignedTables: 0, unassignedWaiters: 0 }
assert.equal(buildDashboardData(null, zeroSummary, { openIssues: 0, inProgress: 0, completedToday: 0 }).attention.total, 0)
const [appSource, stylesSource] = await Promise.all([readFile('src/App.tsx', 'utf8'), readFile('src/styles.css', 'utf8')])
assert.match(appSource, /useState\(\(\) => serviceDate\(\)\)/, 'Dashboard service date must be stateful')
assert.match(appSource, /setInterval\(\(\) => setDashboardDate/, 'Dashboard must detect a Maldives service-date rollover while open')
assert.match(appSource, /Dashboard data could not be refreshed\./, 'Dashboard load failures must be visible instead of presenting false zero counts')
assert.match(appSource, /hasCurrentData && <section className="dashboard-grid">/, 'Dashboard must not present stale or unverified metrics as current')
assert.match(appSource, /dashboardGeometryStorageKey/, 'Dashboard must preserve stable loading geometry for the active responsive width')
assert.match(appSource, /style=\{!hasCurrentData && loadingMinHeight \? \{ minHeight: loadingMinHeight \} : undefined\}/, 'Dashboard must retain its last verified height while current data loads')
assert.match(appSource, /new ResizeObserver/, 'Dashboard must refresh its stored stable height when responsive content geometry changes')
assert.match(appSource, /className="dashboard-card-action" onClick=\{onOccasions\}>View occasions<\/ActionButton>/, 'Guest Occasions must link to its operational source through the shared action system')
assert.match(appSource, /trainingApi\.list\(\)/, 'Dashboard must use the existing Training API')
assert.match(appSource, /<p className="eyebrow">DAILY TRAINING<\/p>/, 'Dashboard must present Daily Training')
assert.match(appSource, /className="dashboard-card-action" onClick=\{onTraining\}>View training<\/ActionButton>/, 'Daily Training must link to the existing Training module through the shared action system')
assert.match(appSource, /UNASSIGNED · \{unassigned\.length\}/, 'Team Today must expose unassigned staff separately')
assert.match(stylesSource, /\.dashboard-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'Dashboard must retain its desktop two-column layout')
assert.match(stylesSource, /\.dashboard-grid\{align-items:start\}/, 'Dashboard rows must use content-led card heights')
assert.match(stylesSource, /\.dashboard-page\{min-width:0;overflow-anchor:none\}/, 'Dashboard async rendering must not trigger browser scroll anchoring')
assert.match(stylesSource, /\.dashboard-column\{display:grid;align-content:start;gap:16px/, 'Desktop Dashboard cards must pack into balanced content-led columns')
assert.match(stylesSource, /@media\(max-width:700px\)[\s\S]*?\.dashboard-grid\{grid-template-columns:1fr/, 'Dashboard must collapse to one column on mobile')
assert.match(stylesSource, /@media\(max-width:700px\)[\s\S]*?\.dashboard-order-team\{order:1\}[\s\S]*?\.dashboard-order-tonight\{order:7\}/, 'Mobile Dashboard must preserve its operational reading order')
assert.match(stylesSource, /@media\(max-width:700px\)[\s\S]*?\.dashboard-training-details\{grid-template-columns:minmax\(0,.85fr\) minmax\(0,1.35fr\) minmax\(0,.8fr\);gap:6px\}/, 'Daily Training details must retain three compact mobile columns')
assert.match(stylesSource, /\.tonight-scroll\{max-width:100%;overflow-x:auto/, 'Wide service-board content must scroll inside its own panel')
await fixture.cleanup()
console.log(JSON.stringify({ team: { working: team.working.length, off: team.off.length, leave: team.leave.length }, bookings: dashboard.bookings, service: dashboard.serviceProgress, occasions: dashboard.occasions, chargeables: dashboard.chargeables, attention: dashboard.attention, hostessBoard: { partySizes: serviceBoard.partySizes, summary: serviceBoard.summary, next: serviceBoard.next, nextSlot: nextSlot.next } }, null, 2))
