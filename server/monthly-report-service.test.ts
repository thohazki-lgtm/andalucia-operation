import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { calendarDates, monthRange } from '../src/service-date.js'
import { MonthlyReportService } from './monthly-report-service.js'

const outlet={id:'11111111-1111-4111-8111-111111111111',scopeKey:'andalucia',displayName:'Andalucía'}
const payload=(date:string,covers:number)=>({servicePerformance:{totalCovers:covers,adults:covers-2,kids:2,totalBookings:3,arrivedCovers:covers-1,noShowCovers:1,noShowRooms:['101'],walkIns:1,bookingByTimeSlot:[]},symphony:{foodRevenue:'100.10',beverageRevenue:'50.20',wineRevenue:'20',liquorRevenue:'10',totalSale:'150.30',totalDiscount:'5',totalVoid:'1',netSale:'144.30',totalRevenue:'150.30',voidDetails:[]},serviceVerification:{doubleDinePax:2,details:[]},upselling:{chargeables:[],wineSpirits:[],details:[{item:'Paella',quantity:1,soldBy:'Lakshit',amount:'85.00',source:'Chargeable'}],totalUpsellRevenue:'85',itemsSold:1,topItem:'Paella',topSeller:'Lakshit'},guestOccasions:{categories:[{key:'birthday',label:'Birthday',count:1,covers:2}],roomDetails:[]},manager:{operationSummary:''},revenueVerification:{acknowledged:true,netSale:'144.30',totalRevenue:'150.30',difference:'6',verifiedByName:'Owner',verifiedAt:`${date}T20:00:00Z`}})
const snapshot=(date:string,covers=10)=>({dailyReportId:`report-${date}`,serviceDate:date,frozenPayload:payload(date,covers)})
let snapshots=[...calendarDates('2026-08-01','2026-09-30').map((date,index)=>snapshot(date,10+index%3))],reportRows:any[]=[],financeInputs=new Map<string,any>()
const db={query:async(sql:string)=>sql.includes('from daily_reports')?{rows:reportRows}:sql.includes('from staff s')?{rows:[{count:12}]}:sql.includes('from duty_roster_entries')?{rows:[{classification:'working',count:60},{classification:'off',count:10},{classification:'annualLeave',count:2},{classification:'publicHoliday',count:1},{classification:'sickLeave',count:1}]}:{rows:[]}}
const support={training:{sessions:2,participants:6,attended:5},maintenance:{issuesReported:3,completedDuringPeriod:2,open:1,inProgress:1,unresolved:2}}
const reporting={report:async()=>support,getManagerSummary:async()=>null}
const service=new MonthlyReportService(db as never,reporting as never,()=> '2026-09-10')
;(service as any).snapshots={currentApprovedSnapshots:async(_outlet:string,start:string,end:string)=>snapshots.filter(row=>row.serviceDate>=start&&row.serviceDate<=end)}
;(service as any).inputs={get:async(_outlet:string,start:string)=>financeInputs.get(start)||null,save:async()=>null,verify:async()=>null}

let view=await service.view('2026-08',outlet)
assert.equal(view.authority.state,'complete');assert.equal(view.authority.approvedDays,31);assert.equal(view.totals.totalBookings,93);assert.equal(view.revenue.foodRevenue,'3103.10');assert.equal(view.upselling.totalRevenue,'2635.00');assert.equal(view.occasions.find(row=>row.key==='birthday')?.count,31);assert.equal(view.comparison.available,false)
assert.equal(view.occasions.length,9);assert.equal(view.occasions.find(row=>row.key==='famtrip')?.count,0)
snapshots=snapshots.filter(row=>row.serviceDate<'2026-09-05'||row.serviceDate>'2026-09-10');reportRows=[{id:'draft',service_date:'2026-09-05',status:'draft'},{id:'reviewed',service_date:'2026-09-06',status:'reviewed'}]
snapshots.find(row=>row.serviceDate==='2026-09-04')!.frozenPayload.revenueVerification.difference='0.00'
view=await service.view('2026-09',outlet)
assert.equal(view.authority.state,'in-progress');assert.equal(view.authority.expectedDays,10);assert.equal(view.authority.approvedDays,4);assert.deepEqual(view.days.slice(4,11).map(row=>row.status),['draft','reviewed','missing-report','missing-report','missing-report','in-progress','not-yet-closed']);assert.equal(view.overallStatus,'FINANCE PENDING');assert.equal(view.staffing.currentTeamSize,12);assert.equal(view.training.hours,null)
assert.equal(view.comparison.available,true);assert.equal(view.comparison.metrics.find(item=>item.key==='bookings')?.current,12);assert.equal(view.comparison.metrics.find(item=>item.key==='occasion:birthday')?.current,4);assert.equal(view.comparison.metrics.find(item=>item.key==='occasion:famtrip')?.changePercent,0)
assert.equal(view.variances.length,3);assert.equal(view.variances.some(item=>Number(item.difference)===0),false)
snapshots=[];view=await service.view('2028-02',outlet);assert.equal(view.days.length,29);assert.equal(view.authority.expectedDays,0);assert.equal(view.days.every(row=>row.status==='not-yet-closed'),true)
assert.deepEqual(monthRange('2026-02-01'),['2026-02-01','2026-02-28']);assert.deepEqual(monthRange('2028-02-01'),['2028-02-01','2028-02-29'])
const ui=await readFile(new URL('../src/reports.tsx',import.meta.url),'utf8'),css=await readFile(new URL('../src/reports.css',import.meta.url),'utf8')
for(const text of ['Performance Overview','Revenue Performance','Chargeable Items / Upselling','Guest Experience & Guest Mix','Team & Development','Maintenance & Follow-up','Cost Control & Finance','Previous Month Comparison',"Manager's Monthly Review",'Monthly Report Readiness','Total Food Request','Total Beverage Request'])assert.ok(ui.includes(text),`Missing redesigned R3 UI ${text}`)
assert.ok(css.includes('.monthly-cost-grid'));assert.ok(css.includes('@media(max-width:650px)'));assert.ok(css.includes('@media print'))
assert.ok(ui.includes('occasions=view?.occasions||[]'),'Monthly must render zero-value occasion categories.');assert.ok(ui.includes('Previous month unavailable'));assert.ok(ui.includes("favorable=\"down\""));assert.ok(ui.includes("metric.changePercent===null?'New'"));assert.ok(!ui.includes("<summary>Finance Details</summary>"));assert.ok(!ui.includes("headers={['Date','Covers','Bookings','Kids','No-show Covers','Double Dine','Daily Report Status']}"));assert.ok(ui.includes('<summary>Loss & Control</summary>'))
assert.ok(ui.includes('aria-label="Previous month"'));assert.ok(ui.includes('aria-label="Next month"'));assert.ok(!ui.includes('>← Previous Month</button>'));assert.ok(!ui.includes('>Next Month →</button>'));assert.ok(!ui.includes('>Current Month</button>'));assert.ok(!ui.includes('<article><b>Guest Experience</b>'));assert.ok(!ui.includes('<article><b>People & Operations</b>'))
assert.ok(css.includes('.monthly-dashboard-grid'));assert.ok(css.includes('@media(min-width:901px)'));assert.ok(css.includes('@media(min-width:1180px)'))
console.log('Monthly R3 final mobile/tablet polish, non-zero Symphony evidence, navigation, authoritative trends, review simplification and responsive/print checks: PASS')
