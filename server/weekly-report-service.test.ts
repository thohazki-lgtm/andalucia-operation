import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { WeeklyReportService } from './weekly-report-service.js'
import { addCalendarDays, calendarDates, weekRange } from '../src/service-date.js'

const outlet = { id: '11111111-1111-4111-8111-111111111111', scopeKey: 'andalucia', displayName: 'Andalucía' }
const payload = (date: string, value: number) => ({
  servicePerformance: { totalCovers: value, adults: value - 1, kids: 1, totalBookings: 2, arrivedCovers: value - 2, noShowCovers: 1, noShowRooms: ['101'], walkIns: 1, bookingByTimeSlot: [] },
  symphony: { foodRevenue: '100.10', beverageRevenue: '50.20', wineRevenue: '20.00', liquorRevenue: '10.00', totalSale: '150.30', totalDiscount: '5.00', totalVoid: '1.00', netSale: '144.30', totalRevenue: '150.30', voidDetails: [] },
  serviceVerification: { doubleDinePax: 2, details: [] },
  upselling: { chargeables: [], wineSpirits: [], details: [{ item: 'Lobster Paella', quantity: 1, soldBy: 'LAKSHIT SHARMA', amount: '85.00', source: 'Chargeable' }, { item: 'Wine', quantity: 2, soldBy: 'AHMED', amount: '40.00', source: 'Wine / Spirits' }], totalUpsellRevenue: '125.00', itemsSold: 3, topItem: 'Wine', topSeller: 'LAKSHIT SHARMA' },
  guestOccasions: { categories: [{ key: 'birthday', label: 'Birthday', count: 1, covers: 2 }], roomDetails: [] }, manager: { operationSummary: '' },
  revenueVerification: { acknowledged: true, netSale: '144.30', totalRevenue: '150.30', difference: '6.00', verifiedByName: 'Owner', verifiedAt: `${date}T20:00:00.000Z` },
  identity: { outletScopeId: outlet.id, serviceDate: date, revisionNumber: 1, status: 'approved', preparedBy: { userId: 'u', name: 'Owner', at: `${date}T18:00:00Z` }, reviewedBy: { userId: 'u', name: 'Owner', at: `${date}T19:00:00Z` }, approvedBy: { userId: 'u', name: 'Owner', at: `${date}T20:00:00Z` } }
})
const snapshot = (date: string, value: number) => ({ dailyReportId: `report-${date}`, serviceDate: date, frozenPayload: payload(date, value) })
let snapshots = [...calendarDates('2026-08-17','2026-08-30').map((date,index)=>snapshot(date,10+index))]
let reportRows: Array<{id:string;service_date:string;status:string}> = []
let saved: unknown = null
const db = { query: async () => ({ rows: reportRows }) }
const reporting = { getManagerSummary: async () => null, saveManagerSummary: async (input: unknown, actor: string) => { saved = { input, actor }; return input } }
const service = new WeeklyReportService(db as never, reporting as never, () => '2026-09-10')
;(service as unknown as { snapshots: { currentApprovedSnapshots: (_outlet:string,start:string,end:string)=>Promise<typeof snapshots> } }).snapshots = { currentApprovedSnapshots: async (_outlet,start,end) => snapshots.filter(item=>item.serviceDate>=start&&item.serviceDate<=end) }

const full = await service.view('2026-08-26', outlet)
assert.equal(full.weekStart, '2026-08-24'); assert.equal(full.weekEnd, '2026-08-30'); assert.equal(full.authority.approvedDays, 7); assert.equal(full.authority.state, 'complete')
assert.equal(full.totals.totalCovers, calendarDates('2026-08-24','2026-08-30').reduce((sum,date)=>sum+payload(date,10+calendarDates('2026-08-17','2026-08-30').indexOf(date)).servicePerformance.totalCovers,0))
assert.equal(full.revenue.foodRevenue, '700.70'); assert.equal(full.revenue.totalRevenue, '1052.10'); assert.equal(full.variances.length, 7)
assert.equal(full.upselling.chargeableRevenue, '595.00'); assert.equal(full.upselling.wineSpiritsRevenue, '280.00'); assert.equal(full.occasions.find(item=>item.key==='birthday')?.count, 7)
assert.equal(full.occasions.length, 9); assert.equal(full.occasions.find(item=>item.key==='presstrip')?.count, 0)
assert.equal(full.comparison.available, true); assert.equal(full.days.every(day=>day.status==='approved'), true)

snapshots = [snapshot('2026-09-07',20),snapshot('2026-09-08',21)]
reportRows = [{id:'draft',service_date:'2026-09-09',status:'draft'},{id:'reviewed',service_date:'2026-09-10',status:'reviewed'}]
const current = await service.view('2026-09-10', outlet)
assert.equal(current.authority.state, 'in-progress'); assert.equal(current.authority.approvedDays, 2); assert.equal(current.authority.expectedDays, 4)
assert.deepEqual(current.days.map(day=>day.status), ['approved','approved','draft','reviewed','not-yet-closed','not-yet-closed','not-yet-closed'])
assert.equal(current.totals.totalCovers, 41); assert.equal(current.comparison.available, false)
await service.saveCommentary('2026-09-07','Weekly context',outlet,'THOHA LI [owner-id]')
assert.deepEqual(saved,{input:{periodType:'week',startDate:'2026-09-07',endDate:'2026-09-13',managerNotes:'Weekly context'},actor:'THOHA LI [owner-id]'})
await assert.rejects(()=>service.saveCommentary('2026-09-08','No',outlet,'Owner'),/Monday week start/)
assert.deepEqual(weekRange('2027-01-01'),['2026-12-28','2027-01-03']); assert.equal(addCalendarDays('2028-02-28',1),'2028-02-29')

const ui = await readFile(new URL('../src/reports.tsx', import.meta.url),'utf8'); const css = await readFile(new URL('../src/reports.css', import.meta.url),'utf8')
for (const required of ['Weekly Performance','Service Performance by Day','Previous Week Comparison','Save Commentary','View Daily','Approved Daily snapshots']) assert.ok(ui.includes(required),`missing UI: ${required}`)
assert.ok(css.includes('@media(max-width:650px)')); assert.ok(css.includes('@media print')); assert.ok(!ui.includes('approveWeekly'))
assert.ok(ui.includes('const allOccasions=view?.occasions||[]'), 'Weekly must render zero-value occasion categories.')
for (const section of ['Weekly Performance','Service Performance by Day','Weekly Revenue','Chargeable Items / Upselling','Guest Experience','Service Attention','Previous Week Comparison','Weekly Commentary','Weekly Report Completeness']) assert.ok(ui.includes(`title="${section}"`),`missing aligned section: ${section}`)
assert.ok(ui.includes('aria-label="Previous week"'));assert.ok(ui.includes('aria-label="Next week"'));assert.ok(!ui.includes('>← Previous Week</button>'));assert.ok(!ui.includes('>Next Week →</button>'));assert.ok(css.includes('.report-header-nav'));assert.ok(css.includes('.weekly-commentary'))
console.log('Weekly R2 authority aggregation, comparison, numbered design alignment, compact navigation, responsive tables/commentary and print checks: PASS')
