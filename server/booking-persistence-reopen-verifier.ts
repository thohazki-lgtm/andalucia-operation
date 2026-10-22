import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { buildDashboardData, buildHostessServiceBoard } from '../src/dashboard-data.js'
import { BookingRepository } from './booking-repository.js'
import { ReportingRepository } from './reporting-repository.js'

const [snapshotPath, reservationDate] = process.argv.slice(2)
assert(snapshotPath, 'Disposable database snapshot is required')
assert.match(reservationDate || '', /^\d{4}-\d{2}-\d{2}$/, 'Reservation date is required')

const snapshot = new Uint8Array(await readFile(snapshotPath))
const db = new PGlite({ loadDataDir: new Blob([snapshot]) })
try {
  const repository = new BookingRepository(db)
  await repository.initialize()
  const live = await repository.list(reservationDate)
  assert.equal(live.length, 46)
  assert.equal(live.reduce((sum, booking) => sum + booking.covers, 0), 123)

  const summary = await repository.summary(reservationDate)
  assert.equal(summary.totalBookings, 46)
  assert.equal(summary.expectedCovers, 123)
  const report = await new ReportingRepository(db).report('today', reservationDate, reservationDate)
  const dashboard = buildDashboardData(report, summary, { openIssues: 0, inProgress: 0, completedToday: 0 })
  assert.equal(dashboard.bookings.totalCovers, 123)

  const board = buildHostessServiceBoard(live, (await repository.configuration()).statuses, reservationDate, new Date(`${reservationDate}T12:00:00.000Z`))
  assert.equal(board.summary.upcomingParties, 46)
  assert.equal(board.summary.upcomingCovers, 123)
  assert.equal(live.every(booking => booking.reservationDate === reservationDate), true)
  process.stdout.write(JSON.stringify({ freshRead: live.length, dashboardCovers: dashboard.bookings.totalCovers, hostessCovers: board.summary.upcomingCovers }))
} finally {
  await db.close().catch(() => undefined)
}
