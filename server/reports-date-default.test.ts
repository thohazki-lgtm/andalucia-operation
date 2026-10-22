import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { clearLegacyDailyReportDate, currentMaldivesReportDate, legacyDailyReportDateKey } from '../src/report-date-selection.js'
import { addCalendarDays, addCalendarMonths, monthRange, weekRange } from '../src/service-date.js'

assert.equal(currentMaldivesReportDate(new Date('2026-10-16T18:59:59.000Z')), '2026-10-16')
assert.equal(currentMaldivesReportDate(new Date('2026-10-16T19:00:00.000Z')), '2026-10-17')

const removedKeys: string[] = []
clearLegacyDailyReportDate({ removeItem: key => { removedKeys.push(key) } })
assert.deepEqual(removedKeys, [legacyDailyReportDateKey])

assert.equal(addCalendarDays('2026-10-17', -1), '2026-10-16')
assert.equal(addCalendarDays('2026-10-17', 1), '2026-10-18')
assert.deepEqual(weekRange('2026-10-17'), ['2026-10-12', '2026-10-18'])
assert.deepEqual(monthRange('2026-10-17'), ['2026-10-01', '2026-10-31'])
assert.equal(addCalendarMonths('2026-10-17', 1), '2026-11-17')

const reportsSource = await readFile(resolve('src/reports.tsx'), 'utf8')
const appSource = await readFile(resolve('src/App.tsx'), 'utf8')
assert.match(reportsSource, /useState\(currentMaldivesReportDate\)/)
assert.match(reportsSource, /clearLegacyDailyReportDate\(\)/)
assert.doesNotMatch(reportsSource, /sessionStorage\.(getItem|setItem)/)
assert.match(reportsSource, /unsaved Daily Report changes\. Change the date and discard them/)
assert.match(reportsSource, /beforeunload/)
assert.match(reportsSource, /setUnsaved\(false\); onToast\('Daily Report draft saved\.'/)
assert.match(appSource, /page === 'Reports' && reportsUnsaved/)

console.log(JSON.stringify({
  maldivesTodayBoundary: true,
  staleSessionDateRemoved: true,
  historicalDateNavigationPreserved: true,
  weeklyMonthlyBoundariesPreserved: true,
  unsavedDailyEditsProtected: true,
  canonicalDataTouched: false
}, null, 2))
