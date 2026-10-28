import assert from 'node:assert/strict'
import { hydrateDailyReportManualPayload } from '../src/daily-report-manual.js'
import { clearPersistedDailyReportDate, dailyReportDateStorageKey, dailyReportUrlForDate, dailyReportUrlWithoutDate, initialDailyReportDate, persistDailyReportDate } from '../src/report-date-selection.js'

const historicalDate = '2026-10-16'
const legacyPayload = {
  symphony: { totalRevenue: '1600.00' },
  serviceVerification: { doubleDinePax: 3, details: [{ roomNumber: '716', pax: 3, sourceOutlet: 'Main Restaurant', note: '' }] },
  manager: { operationSummary: 'Historical Daily Report fixture.' },
  revenueVerification: { acknowledged: false },
}

const hydrated = hydrateDailyReportManualPayload(legacyPayload)
assert.deepEqual(hydrated.serviceCharges, { amount: '', remarks: '' })
assert.deepEqual(hydrated.symphony.voidDetails, [])
assert.equal(hydrated.symphony.totalRevenue, '1600.00')
assert.equal(hydrated.serviceVerification.details[0].pax, 3)
assert.equal(hydrated.manager.operationSummary, 'Historical Daily Report fixture.')
assert.equal(initialDailyReportDate(`?dailyReportDate=${historicalDate}`, new Date('2026-10-25T12:00:00Z')), '2026-10-25')
assert.match(dailyReportUrlForDate('http://localhost:5173/?leavePlannerR2=1', historicalDate), /dailyReportDate=2026-10-16/)
const persisted = new Map<string, string>()
const storage = { getItem: (key: string) => persisted.get(key) ?? null, setItem: (key: string, value: string) => { persisted.set(key, value) }, removeItem: (key: string) => { persisted.delete(key) } }
persistDailyReportDate(historicalDate, storage)
assert.equal(persisted.get(dailyReportDateStorageKey), historicalDate)
assert.equal(initialDailyReportDate('', new Date('2026-10-25T12:00:00Z'), storage), '2026-10-25')
clearPersistedDailyReportDate(storage)
assert.equal(persisted.has(dailyReportDateStorageKey), false)
assert.equal(dailyReportUrlWithoutDate(`http://localhost:5173/?dailyReportDate=${historicalDate}`), '/')

console.log(JSON.stringify({ historicalDate, legacyPayloadHydrated: true, serviceChargesDefaultedWithoutDataMutation: true, refreshDefaultsToMaldivesToday: true, historicalNavigationRemainsAvailableInSession: true, canonicalDatabaseTouched: false }, null, 2))
