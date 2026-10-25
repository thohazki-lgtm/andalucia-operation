import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { clearLegacyDailyReportDate, clearPersistedDailyReportDate, currentMaldivesReportDate, dailyReportDateStorageKey, dailyReportUrlForDate, dailyReportUrlWithoutDate, initialDailyReportDate, legacyDailyReportDateKey, persistDailyReportDate, storedDailyReportDate } from '../src/report-date-selection.js'
import { hydrateDailyReportManualPayload } from '../src/daily-report-manual.js'
import { addCalendarDays, addCalendarMonths, monthRange, weekRange } from '../src/service-date.js'

assert.equal(currentMaldivesReportDate(new Date('2026-10-16T18:59:59.000Z')), '2026-10-16')
assert.equal(currentMaldivesReportDate(new Date('2026-10-16T19:00:00.000Z')), '2026-10-17')

const removedKeys: string[] = []
clearLegacyDailyReportDate({ removeItem: key => { removedKeys.push(key) } })
assert.deepEqual(removedKeys, [legacyDailyReportDateKey])

const values = new Map<string, string>()
const localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
assert.equal(initialDailyReportDate('', new Date('2026-10-25T12:00:00Z'), localStorage), '2026-10-25')
assert.equal(persistDailyReportDate('2026-10-16', localStorage), true)
assert.equal(values.get(dailyReportDateStorageKey), '2026-10-16')
assert.equal(storedDailyReportDate(localStorage), '2026-10-16')
assert.equal(initialDailyReportDate('', new Date('2026-10-25T12:00:00Z'), localStorage), '2026-10-25')
assert.equal(initialDailyReportDate('?dailyReportDate=2026-10-24', new Date('2026-10-25T12:00:00Z'), localStorage), '2026-10-25')
clearPersistedDailyReportDate(localStorage)
assert.equal(values.has(dailyReportDateStorageKey), false)
values.set(dailyReportDateStorageKey, '2026-02-31')
assert.equal(initialDailyReportDate('', new Date('2026-10-25T12:00:00Z'), localStorage), '2026-10-25')
assert.equal(values.has(dailyReportDateStorageKey), false)

assert.equal(addCalendarDays('2026-10-17', -1), '2026-10-16')
assert.equal(addCalendarDays('2026-10-17', 1), '2026-10-18')
assert.deepEqual(weekRange('2026-10-17'), ['2026-10-12', '2026-10-18'])
assert.deepEqual(monthRange('2026-10-17'), ['2026-10-01', '2026-10-31'])
assert.equal(addCalendarMonths('2026-10-17', 1), '2026-11-17')
assert.equal(initialDailyReportDate('?dailyReportDate=2026-10-16', new Date('2026-10-25T12:00:00Z')), '2026-10-25')
assert.equal(initialDailyReportDate('?dailyReportDate=not-a-date', new Date('2026-10-25T12:00:00Z')), currentMaldivesReportDate(new Date('2026-10-25T12:00:00Z')))
assert.equal(dailyReportUrlForDate('http://localhost:5173/?leavePlannerR2=1', '2026-10-16'), '/?leavePlannerR2=1&dailyReportDate=2026-10-16')
assert.equal(dailyReportUrlWithoutDate('http://localhost:5173/?leavePlannerR2=1&dailyReportDate=2026-10-16'), '/?leavePlannerR2=1')

const hydratedHistorical = hydrateDailyReportManualPayload({
  symphony: { totalRevenue: '9250.00' },
  serviceVerification: { doubleDinePax: 4, details: [{ roomNumber: '716', pax: 4, sourceOutlet: 'Main Restaurant', note: '' }] },
  manager: { operationSummary: 'Preserved historical report.' },
})
assert.deepEqual(hydratedHistorical.serviceCharges, { amount: '', remarks: '' })
assert.equal(hydratedHistorical.symphony.totalRevenue, '9250.00')
assert.equal(hydratedHistorical.symphony.voidDetails.length, 0)
assert.equal(hydratedHistorical.serviceVerification.details.length, 1)
assert.equal(hydratedHistorical.manager.operationSummary, 'Preserved historical report.')

const reportsSource = await readFile(resolve('src/reports.tsx'), 'utf8')
const appSource = await readFile(resolve('src/App.tsx'), 'utf8')
assert.match(reportsSource, /useState\(initialDailyReportDate\)/)
assert.match(reportsSource, /clearLegacyDailyReportDate\(\)/)
assert.match(reportsSource, /clearPersistedDailyReportDate\(\)/)
assert.doesNotMatch(reportsSource, /persistDailyReportDate\(/)
assert.match(reportsSource, /hydrateDailyReportManualPayload\(next\.report\?\.manualPayload\)/)
assert.match(reportsSource, /dailyReportUrlWithoutDate\(window\.location\.href\)/)
assert.match(reportsSource, /selectDailyDate = useCallback\(\(value: string\) => \{ setDailyDate\(value\) \}/)
assert.match(reportsSource, /unsaved Daily Report changes\. Change the date and discard them/)
assert.match(reportsSource, /beforeunload/)
assert.match(reportsSource, /setUnsaved\(false\); onToast\('Daily Report draft saved\.'/)
assert.match(appSource, /page === 'Reports' && reportsUnsaved/)

console.log(JSON.stringify({
  maldivesTodayBoundary: true,
  staleSessionDateRemoved: true,
  historicalDateNavigationPreserved: true,
  refreshDefaultsToMaldivesToday: true,
  staleLocalDateCleared: true,
  invalidStoredDateRejected: true,
  legacyManualPayloadHydrated: true,
  weeklyMonthlyBoundariesPreserved: true,
  unsavedDailyEditsProtected: true,
  canonicalDataTouched: false
}, null, 2))
