import assert from 'node:assert/strict'
import { addCalendarMonths, calendarDates, monthRange, serviceDate, weekRange } from '../src/service-date.js'

assert.equal(serviceDate(new Date('2026-09-01T20:30:00.000Z')), '2026-09-02')
assert.deepEqual(weekRange('2026-09-02'), ['2026-08-31', '2026-09-06'])
assert.deepEqual(monthRange('2024-02-15'), ['2024-02-01', '2024-02-29'])
assert.deepEqual(monthRange('2026-02-15'), ['2026-02-01', '2026-02-28'])
assert.deepEqual(monthRange('2026-04-15'), ['2026-04-01', '2026-04-30'])
assert.equal(calendarDates(...monthRange('2024-02-15')).length, 29)
assert.equal(addCalendarMonths('2026-01-31', 1), '2026-02-28')

console.log(JSON.stringify({ maldivesDateBoundary: true, weeklyRange: true, leapFebruary: true, standardFebruary: true, thirtyDayMonth: true, monthNavigationClamps: true }, null, 2))
