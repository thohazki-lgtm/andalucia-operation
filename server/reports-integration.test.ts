import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('src/reports.tsx', 'utf8')
for (const binding of [
  'report.bookings.totalCovers',
  'report.bookings.totalAdults',
  'report.bookings.totalKids',
  'item.totalCovers',
  'item.totalAdults',
  'item.totalKids',
  'report.occasions.byCategory',
  'report.chargeables.realizedRevenue',
  "report.chargeables.topItem?.item",
  "report.chargeables.topWaiter?.waiter",
  'report.maintenance.completedToday',
  'report.maintenance.completedDuringPeriod',
  'bookingTimeWindow(item.time)',
  'window.print()'
]) assert.ok(source.includes(binding), `Reports UI is missing authoritative binding: ${binding}`)

for (const legacy of [
  'report.bookings.expectedCovers',
  'report.chargeables.totalRevenue',
  'report.chargeables.mostSoldItem',
  'report.chargeables.topSeller',
  'report.occasions.byType.find',
  'value={report.maintenance.completed}'
]) assert.equal(source.includes(legacy), false, `Reports UI still uses legacy binding: ${legacy}`)

console.log(JSON.stringify({ authoritativeBindings: true, legacyBindingsRemoved: true, printPreserved: true }, null, 2))
