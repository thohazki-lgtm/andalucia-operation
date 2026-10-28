import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { join, resolve } from 'node:path'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { serviceDate, serviceTime } from '../src/service-date.js'
import { config } from '../src/domain.js'
import type { BookingRecord, GuestOccasionRecord, MaintenanceRecord } from '../src/domain.js'
import { BookingRepository } from './booking-repository.js'
import { GuestOccasionRepository } from './guest-occasion-repository.js'
import { MaintenanceRepository } from './maintenance-repository.js'

const fixture = await createDisposableDevelopmentStore('dashboard-browser')
const root = fixture.root
const store = fixture.store
const profile = join(root, 'edge-profile')
const output = resolve('artifacts')
const processes: ChildProcess[] = []
let socket: WebSocket | null = null
let debugPort: number | null = null
let completed = false
const token = `isolated-${randomUUID()}`
const visualPhase = process.env.ANDALUCIA_DASHBOARD_VISUAL_PHASE || 'current'
const today = serviceDate()
const currentMinutes = (() => { const [hour, minute] = serviceTime().split(':').map(Number); return hour * 60 + minute })()
const serviceSlot = (offset: number) => { const minutes = (Math.floor(currentMinutes / 30) * 30 + offset + 1440) % 1440; return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` }
const sleep = (ms: number) => new Promise(resolveWait => setTimeout(resolveWait, ms))
const waitFor = async (url: string) => { for (let attempt = 0; attempt < 100; attempt++) { try { if ((await fetch(url)).ok) return } catch {} await sleep(200) } throw new Error(`Timed out waiting for ${url}`) }
const waitForOwnedDevTools = async (edge: ChildProcess) => {
  const activePortFile = join(profile, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 200; attempt++) {
    if (edge.exitCode !== null) throw new Error(`Edge exited before DevTools readiness with code ${edge.exitCode}`)
    try {
      const [line] = (await readFile(activePortFile, 'utf8')).trim().split(/\r?\n/)
      const port = Number(line)
      if (Number.isInteger(port) && port > 0 && (await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return port
    } catch {}
    await sleep(100)
  }
  throw new Error('Timed out waiting for the isolated browser endpoint')
}

class Cdp {
  private id = 0
  private pending = new Map<number, { resolve: (value: any) => void; reject: (reason: unknown) => void }>()
  readonly errors: string[] = []
  constructor(private connection: WebSocket) {
    connection.onmessage = event => {
      const message = JSON.parse(String(event.data))
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result)
      } else if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || 'Runtime exception')
    }
  }
  send(method: string, params: Record<string, unknown> = {}) { const id = ++this.id; this.connection.send(JSON.stringify({ id, method, params })); return new Promise<any>((resolveCall, rejectCall) => this.pending.set(id, { resolve: resolveCall, reject: rejectCall })) }
  evaluate<T>(expression: string) { return this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then(result => result.result.value as T) }
}

try {
  const db = fixture.db
  const owner = (await db.query<{ id: string }>("select u.id from user_accounts u join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.role_key='owner' where u.status='active' limit 1")).rows[0]
  assert.ok(owner)
  await db.query("insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval '1 hour')", [randomUUID(), createHash('sha256').update(token).digest('hex'), owner.id])
  for (const [index, option] of config.dutyCodes.entries()) await db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes',$2,$3,$4,$5,$6,$7) on conflict(group_key,value) do nothing", [randomUUID(), option.value, option.label, option.color || null, JSON.stringify(option.metadata || {}), option.active, index])
  const dutyRows = (await db.query<{ value: string; color: string | null; metadata: any }>("select value,color,metadata from configuration_options where group_key='duty_codes' and active=true order by sort_order")).rows
  const working = dutyRows.find(row => row.metadata?.countsAsWorking)?.value
  const off = dutyRows.find(row => row.metadata?.dutyClassification === 'off')?.value
  const annual = dutyRows.find(row => row.metadata?.dutyClassification === 'annualLeave')?.value
  assert.ok(working && off && annual)
  await db.query("update configuration_options set color='#173d56' where group_key='duty_codes' and value=$1", [working])
  await db.query("update configuration_options set color='#f0d28d' where group_key='duty_codes' and value=$1", [off])
  await db.query("update configuration_options set color='#6f5b8f' where group_key='duty_codes' and value=$1", [annual])
  for (let index = 0; index < 12; index++) {
    const staffId = randomUUID()
    await db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,$2,$3,'Waiter','active','2024-01-01')", [staffId, `DASH-${String(index + 1).padStart(2, '0')}`, `Dashboard Staff ${index + 1}`])
    await db.query("insert into staff_membership_history(id,staff_id,outlet_scope_id,membership_dimension,effective_from,source,reason,review_status,reviewed_at,reviewed_by,is_current_baseline) values($1,$2,$3,'regular_outlet','2024-01-01','system','Dashboard visual fixture','approved',now(),'Dashboard visual fixture',true)", [randomUUID(), staffId, ANDALUCIA_SCOPE_ID])
    const code = index < 8 ? working : index === 8 ? off : index === 9 ? annual : null
    if (code) await db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), staffId, today, code])
  }
  const bookingRepository = new BookingRepository(db)
  await bookingRepository.initialize()
  const bookingFixture = (name: string, time: string, covers: number, status: string): BookingRecord => ({ id: randomUUID(), guestName: name, roomNumber: '501', birthDate: null, arrivalDate: null, departureDate: null, mealPeriod: 'Dinner', reservationDate: today, reservationTime: time, bookingNumber: `DASH-${time.replace(':', '')}-${covers}`, covers, bookingStatus: status, bookingSource: 'manual', bookedBy: 'Dashboard fixture', guestNotes: '', tableNumber: '', waiterId: null, waiter: null })
  await bookingRepository.save(bookingFixture('Dashboard Party Two', serviceSlot(0), 2, 'confirmed'), 'Dashboard visual fixture')
  await bookingRepository.save(bookingFixture('Dashboard Party Four Upcoming', serviceSlot(30), 4, 'confirmed'), 'Dashboard visual fixture')
  await bookingRepository.save(bookingFixture('Dashboard Party Two Later', serviceSlot(60), 2, 'confirmed'), 'Dashboard visual fixture')
  await bookingRepository.save(bookingFixture('Dashboard Party Four Later', serviceSlot(90), 4, 'confirmed'), 'Dashboard visual fixture')
  await bookingRepository.save(bookingFixture('Dashboard Party Three', serviceSlot(30), 3, 'confirmed'), 'Dashboard visual fixture')
  await bookingRepository.save(bookingFixture('Dashboard Party Five', serviceSlot(60), 5, 'confirmed'), 'Dashboard visual fixture')
  await bookingRepository.save(bookingFixture('Dashboard Party Six', serviceSlot(90), 6, 'confirmed'), 'Dashboard visual fixture')
  await bookingRepository.save(bookingFixture('Dashboard Party Seven Confirmed', serviceSlot(30), 7, 'confirmed'), 'Dashboard visual fixture')
  await bookingRepository.save(bookingFixture('Dashboard Party Eight', serviceSlot(60), 8, 'confirmed'), 'Dashboard visual fixture')
  await bookingRepository.save(bookingFixture('Dashboard Party Ten', serviceSlot(90), 10, 'confirmed'), 'Dashboard visual fixture')
  await bookingRepository.save(bookingFixture('Dashboard Party Four', serviceSlot(30), 4, 'arrived'), 'Dashboard visual fixture')
  await bookingRepository.save(bookingFixture('Dashboard Party Seven', serviceSlot(60), 7, 'no_show'), 'Dashboard visual fixture')
  const occasionRepository = new GuestOccasionRepository(db)
  await occasionRepository.initialize()
  for (const [index, occasionType] of ['birthday', 'anniversary'].entries()) {
    const occasion: GuestOccasionRecord = { id: randomUUID(), occasionType, bookingId: null, guestName: `Dashboard Occasion ${index + 1}`, roomNumber: String(601 + index), reservationDate: today, reservationTime: serviceSlot(30), tableNumber: '', waiterId: null, waiter: null, status: 'pending', source: 'manual', sourceText: 'Dashboard visual fixture', notes: '', active: true, covers: index + 2 }
    await occasionRepository.save(occasion, 'Dashboard visual fixture')
  }
  const maintenanceRepository = new MaintenanceRepository(db)
  await maintenanceRepository.initialize()
  const maintenanceConfiguration = await maintenanceRepository.configuration()
  const maintenanceArea = maintenanceConfiguration.areas[0].value
  const openStatus = maintenanceConfiguration.statuses.find(option => option.metadata?.maintenanceStage === 'open')!.value
  const completedStatus = maintenanceConfiguration.statuses.find(option => option.metadata?.maintenanceStage === 'completed')!.value
  for (const [issue, priority, status] of [['Dashboard Urgent Repair', 'urgent', openStatus], ['Dashboard Routine Follow-up', 'normal', openStatus], ['Dashboard Resolved Fixture', 'urgent', completedStatus]] as const) {
    const record: MaintenanceRecord = { id: randomUUID(), issue, dateReported: today, area: maintenanceArea, priority, status: openStatus, referenceFollowUp: '', notes: 'Dashboard visual fixture', reportedByStaffId: null, reportedBy: null, revision: 1 }
    const saved = await maintenanceRepository.save(record)
    if (status === completedStatus) await db.query('update maintenance_issues set status=$2 where id=$1', [saved.id, status])
  }
  await db.query("insert into training_sessions(id,title,category_value,training_date,training_time,end_time,trainer,location,status_value,notes,active,source,outlet_scope_id,created_by,updated_by) values($1,'Luxury Service Refresher','service_standards',$2,'10:00','10:30','Training Manager','Andalucía','planned','Dashboard visual fixture',true,'manual',$3,'Dashboard visual fixture','Dashboard visual fixture')", [randomUUID(), today, ANDALUCIA_SCOPE_ID])
  await db.close()

  const node = process.execPath
  processes.push(spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', API_PORT: '3002' }, stdio: 'inherit' }))
  processes.push(spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5174'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3002' }, stdio: 'inherit' }))
  await Promise.all([waitFor('http://127.0.0.1:3002/api/health'), waitFor('http://127.0.0.1:5174/')])

  const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--edge-skip-compat-layer-relaunch', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  processes.push(edge)
  debugPort = await waitForOwnedDevTools(edge)
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>
  const page = pages.find(item => item.type === 'page' && item.url === 'about:blank') || pages.find(item => item.type === 'page')
  assert.ok(page)
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise<void>((resolveOpen, rejectOpen) => { socket!.onopen = () => resolveOpen(); socket!.onerror = () => rejectOpen(new Error('CDP connection failed')) })
  const cdp = new Cdp(socket)
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Network.enable')
  const cookie = await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5174/', path: '/', httpOnly: true, sameSite: 'Strict' })
  assert.equal(cookie.success, true)
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
  for (let attempt = 0; attempt < 160; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.dashboard-page') && document.body.innerText.includes('DAILY TRAINING')`)) break; await sleep(200) }
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.dashboard-page') && document.body.innerText.includes('DAILY TRAINING')`), true, await cdp.evaluate<string>('document.body.innerText'))

  await mkdir(output, { recursive: true })
  const results: Array<Record<string, unknown>> = []
  const waitForDashboardReady = async () => {
    for (let attempt = 0; attempt < 160; attempt++) {
      try {
        if (await cdp.evaluate<boolean>(`!!document.querySelector('.dashboard-grid') && document.body.innerText.includes('DAILY TRAINING')`)) return
      } catch {
        // A refresh briefly replaces the execution context.
      }
      await sleep(100)
    }
    assert.fail('Dashboard did not finish loading')
  }
  const measureDashboard = () => cdp.evaluate<any>(`(()=>{const page=document.querySelector('.dashboard-page');if(!page)return null;const rect=page.getBoundingClientRect();return{scrollY:Math.round(scrollY),documentHeight:Math.round(document.documentElement.scrollHeight),pageHeight:Math.round(rect.height),pageMinHeight:getComputedStyle(page).minHeight,loading:!!page.querySelector('.inline-state'),ready:!!page.querySelector('.dashboard-grid')}})()`)
  const waitForDashboardLoading = async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const measurement = await measureDashboard()
        if (measurement?.loading) return measurement
      } catch {
        // A refresh briefly replaces the execution context.
      }
      await sleep(50)
    }
    assert.fail('Dashboard loading state was not observed')
  }
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const original=window.fetch.bind(window);const dashboardPaths=['/api/staff','/api/roster','/api/bookings','/api/guest-occasions','/api/chargeable-items','/api/maintenance','/api/training','/api/reports'];window.__dashboardFetches=[];window.fetch=(...args)=>{const target=String(args[0]?.url||args[0]);if(!dashboardPaths.some(path=>target.includes(path)))return original(...args);const started=performance.now();return new Promise((resolve,reject)=>setTimeout(()=>original(...args).then(response=>{window.__dashboardFetches.push({target,duration:Math.round(performance.now()-started),status:response.status});resolve(response)},error=>{window.__dashboardFetches.push({target,duration:Math.round(performance.now()-started),status:0});reject(error)}),650))}})()` })
  const viewports = [
    { name: 'desktop-1440', width: 1440, height: 1000, mobile: false },
    { name: 'desktop-1280', width: 1280, height: 920, mobile: false },
    { name: 'tablet-1024', width: 1024, height: 900, mobile: false },
    { name: 'tablet-768', width: 768, height: 900, mobile: false },
    { name: 'mobile-700', width: 700, height: 900, mobile: false },
    { name: 'mobile-430', width: 430, height: 900, mobile: true },
    { name: 'mobile-390', width: 390, height: 844, mobile: true },
    { name: 'mobile-360', width: 360, height: 800, mobile: true }
  ]
  for (const viewport of viewports) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile })
    await sleep(250)
    const result = await cdp.evaluate<any>(`(()=>{const cards=Array.from(document.querySelectorAll('.dashboard-card'));const columns=Array.from(document.querySelectorAll('.dashboard-column'));const hero=document.querySelector('.dashboard-hero');const training=document.querySelector('.training-dashboard-card');const trainingDetails=training.querySelector('.dashboard-training-details');const trainingCells=Array.from(trainingDetails.children);const occasions=Array.from(document.querySelectorAll('.dashboard-card')).find(card=>card.textContent?.includes('GUEST OCCASIONS'));const team=Array.from(document.querySelectorAll('.dashboard-card')).find(card=>card.textContent?.includes('TEAM TODAY'));const teamPanels=Array.from(team?.querySelectorAll('.team-secondary-panel')||[]);const teamMetrics=team?.querySelector('.team-metrics');const teamPills=Array.from(team?.querySelectorAll('.team-staff-pill')||[]);const workingPills=Array.from(team?.querySelectorAll('.team-name-grid .team-staff-pill')||[]);const firstTeamName=workingPills[0];const tonight=document.querySelector('.tonight-card');const tonightMetrics=Array.from(tonight?.querySelectorAll('.hostess-state-summary>div')||[]);const links=Array.from(document.querySelectorAll('.dashboard-card button.link'));const metricGrids=Array.from(document.querySelectorAll('.dashboard-metric-grid'));const metricCells=metricGrids.flatMap(grid=>Array.from(grid.children));const trainingBounds=training.getBoundingClientRect();const trainingDetailsBounds=trainingDetails.getBoundingClientRect();return{width:innerWidth,pageClientWidth:document.documentElement.clientWidth,pageScrollWidth:document.documentElement.scrollWidth,gridColumns:getComputedStyle(document.querySelector('.dashboard-grid')).gridTemplateColumns,cardHeights:cards.map(card=>Math.round(card.getBoundingClientRect().height)),cardWidths:cards.map(card=>Math.round(card.getBoundingClientRect().width)),columnHeights:columns.map(column=>Math.round(column.getBoundingClientRect().height)),mobileOrder:cards.map(card=>({label:card.querySelector('.eyebrow')?.textContent||'',top:Math.round(card.getBoundingClientRect().top)})).sort((a,b)=>a.top-b.top).map(item=>item.label),heroText:hero?.textContent||'',heroHeight:Math.round(hero?.getBoundingClientRect().height||0),heroDutyRosterButtons:hero?.querySelectorAll('button').length||0,metricWidths:metricCells.map(cell=>Math.round(cell.getBoundingClientRect().width)),metricOverflow:metricCells.filter(cell=>cell.scrollWidth>cell.clientWidth+1).length,teamNameGap:Math.round(firstTeamName.getBoundingClientRect().top-teamMetrics.getBoundingClientRect().bottom),teamPanelWidths:teamPanels.map(panel=>Math.round(panel.getBoundingClientRect().width)),teamPanelTops:teamPanels.map(panel=>Math.round(panel.getBoundingClientRect().top)),teamPanelOverflow:teamPanels.filter(panel=>panel.scrollWidth>panel.clientWidth+1).length,teamPillCount:teamPills.length,workingPillNames:workingPills.map(pill=>pill.textContent),teamPillStyles:teamPills.map(pill=>{const style=getComputedStyle(pill);return{background:style.backgroundColor,color:style.color,border:style.borderTopColor,text:pill.textContent}}),teamPillClipping:teamPills.filter(pill=>pill.scrollWidth>pill.clientWidth+1||pill.scrollHeight>pill.clientHeight+1).length,trainingText:training?.textContent||'',trainingHeight:Math.round(trainingBounds.height),trainingBottomGap:Math.round(trainingBounds.bottom-trainingDetailsBounds.bottom),trainingColumns:getComputedStyle(trainingDetails).gridTemplateColumns,trainingCellWidths:trainingCells.map(cell=>Math.round(cell.getBoundingClientRect().width)),trainingCellTops:trainingCells.map(cell=>Math.round(cell.getBoundingClientRect().top)),trainingCellOverflow:trainingCells.filter(cell=>cell.scrollWidth>cell.clientWidth+1).length,tonightMetricWidths:tonightMetrics.map(cell=>Math.round(cell.getBoundingClientRect().width)),tonightMetricTops:tonightMetrics.map(cell=>Math.round(cell.getBoundingClientRect().top)),tonightSummaryValues:tonightMetrics.map(cell=>cell.querySelector('strong')?.textContent),occasionText:occasions?.textContent||'',teamText:team?.textContent||'',tonightText:tonight?.textContent||'',linksVisible:links.every(link=>{const r=link.getBoundingClientRect();return r.width>0&&r.right<=innerWidth+1}),clippedCards:cards.filter(card=>card.scrollWidth>card.clientWidth+1).length}})()`)
    const typography = await cdp.evaluate<any>(`(()=>{const visible=node=>node&&getComputedStyle(node).display!=='none';const metricLabels=Array.from(document.querySelectorAll('.dashboard-metric-grid span')).filter(visible);const metricNumbers=Array.from(document.querySelectorAll('.dashboard-metric-grid strong')).filter(visible);const metricGaps=metricLabels.map(label=>{const number=label.nextElementSibling;return number?Math.round((number.getBoundingClientRect().top-label.getBoundingClientRect().bottom)*100)/100:0});const teamHeaders=Array.from(document.querySelectorAll('.team-secondary-panel header>b')).filter(visible);const teamNames=Array.from(document.querySelectorAll('.team-status-list strong')).filter(visible);const headers=Array.from(document.querySelectorAll('.tonight-table thead th')).filter(visible);const rows=Array.from(document.querySelectorAll('.tonight-table tbody tr')).filter(visible);const rowCells=Array.from(rows[0]?.children||[]).filter(visible);const boardCells=Array.from(document.querySelectorAll('.tonight-table tbody td:not(:first-child)')).filter(visible);const countBadges=Array.from(document.querySelectorAll('.tonight-count-badge')).filter(visible);const headerRects=headers.map(node=>node.getBoundingClientRect());const rowRects=rowCells.map(node=>node.getBoundingClientRect());const columnDrift=headers.length&&headers.length===rowCells.length?Math.max(...headerRects.map((rect,index)=>Math.max(Math.abs(rect.left-rowRects[index].left),Math.abs(rect.width-rowRects[index].width)))):0;const activeRows=rows.filter(row=>row.classList.contains('current-service-slot'));const normalRowBackgrounds=[...new Set(rows.filter(row=>!row.classList.contains('current-service-slot')).map(row=>getComputedStyle(row.children[1]||row.children[0]).backgroundColor))];const rowHeights=rows.map(row=>Math.round(row.getBoundingClientRect().height));const nextHeading=document.querySelector('.next-arrivals .eyebrow');const nextTime=document.querySelector('.next-arrivals strong');const nextChips=Array.from(document.querySelectorAll('.next-arrival-groups span')).filter(visible);const nextChip=nextChips[0];const font=node=>node?parseFloat(getComputedStyle(node).fontSize):0;return{metricLabelFonts:metricLabels.map(font),metricNumberFonts:metricNumbers.map(font),metricGaps,metricLabelClipping:metricLabels.filter(node=>node.scrollWidth>node.clientWidth+1||node.scrollHeight>node.clientHeight+1).length,teamHeaderFont:font(teamHeaders[0]),teamNameFont:font(teamNames[0]),tonightHeaderFont:font(headers[0]),tonightTimeFont:font(rowCells[0]),tonightValueFont:font(countBadges[0]),tonightColumnDrift:columnDrift,tonightCellClipping:[...headers,...rowCells].filter(node=>node.scrollWidth>node.clientWidth+1).length,blankBoardCells:boardCells.filter(node=>node.textContent==='').length,dashBoardCells:boardCells.filter(node=>node.textContent?.trim()==='—').length,countBadgeCount:countBadges.length,countBadgeWidths:countBadges.map(node=>Math.round(node.getBoundingClientRect().width)),countBadgeHeights:countBadges.map(node=>Math.round(node.getBoundingClientRect().height)),countBadgeBackgrounds:[...new Set(countBadges.map(node=>getComputedStyle(node).backgroundColor))],countBadgeColors:[...new Set(countBadges.map(node=>getComputedStyle(node).color))],countBadgeCenterDrift:countBadges.map(node=>{const badge=node.getBoundingClientRect();const cell=node.parentElement.getBoundingClientRect();return Math.abs((badge.left+badge.width/2)-(cell.left+cell.width/2))}),activeRowCount:activeRows.length,activeRowBackground:activeRows[0]?getComputedStyle(activeRows[0].children[1]||activeRows[0].children[0]).backgroundColor:'',normalRowBackgrounds,rowHeights,nextHeadingFont:font(nextHeading),nextTimeFont:font(nextTime),nextChipFont:font(nextChip),nextChipHeights:nextChips.map(node=>Math.round(node.getBoundingClientRect().height)),nextChipClipping:nextChips.filter(node=>node.scrollWidth>node.clientWidth+1||node.scrollHeight>node.clientHeight+1).length}})()`)
    const stageD2 = await cdp.evaluate<any>(`(()=>{const occasionPills=Array.from(document.querySelectorAll('.dashboard-badges span'));const maintenanceButtons=Array.from(document.querySelectorAll('.maintenance-followup-list button'));const table=document.querySelector('.tonight-table');const scroller=document.querySelector('.tonight-scroll');const headers=Array.from(document.querySelectorAll('.tonight-table thead th'));const rows=Array.from(document.querySelectorAll('.tonight-table tbody tr'));const firstHeader=headers[0]?.getBoundingClientRect();const partyHeader=headers[1]?.getBoundingClientRect();return{occasionPillCount:occasionPills.length,occasionPillText:occasionPills.map(node=>node.textContent?.trim()),occasionStyles:occasionPills.map(node=>{const style=getComputedStyle(node);return{background:style.backgroundColor,color:style.color,border:style.borderTopColor}}),occasionClipping:occasionPills.filter(node=>node.scrollWidth>node.clientWidth+1||node.scrollHeight>node.clientHeight+1).length,maintenanceCount:maintenanceButtons.length,maintenanceText:maintenanceButtons.map(node=>node.textContent?.trim()),maintenanceTouchHeights:maintenanceButtons.map(node=>Math.round(node.getBoundingClientRect().height)),urgentCount:maintenanceButtons.filter(node=>node.classList.contains('urgent')).length,normalCount:maintenanceButtons.filter(node=>node.classList.contains('normal')).length,timeColumnWidth:Math.round(firstHeader?.width||0),partyColumnWidth:Math.round(partyHeader?.width||0),tableWidth:Math.round(table?.getBoundingClientRect().width||0),scrollerWidth:Math.round(scroller?.getBoundingClientRect().width||0),verticalDivider:headers[1]?getComputedStyle(headers[1]).borderLeftWidth:'',horizontalDivider:rows[1]?.children[0]?getComputedStyle(rows[1].children[0]).borderTopWidth:''}})()`)
    Object.assign(result, { typography, stageD2 })
    assert.ok(result.pageScrollWidth <= result.pageClientWidth + 1, `page overflow at ${viewport.width}px`)
    assert.equal(result.clippedCards, 0, `card content clipped at ${viewport.width}px`)
    assert.equal(result.linksVisible, true, `Dashboard navigation clipped at ${viewport.width}px`)
    assert.match(result.heroText, /Good (morning|afternoon|evening)\./)
    assert.match(result.heroText, /VENUE MANAGER/)
    assert.doesNotMatch(result.heroText, /Open Duty Roster|Here is today/)
    assert.equal(result.heroDutyRosterButtons, 0)
    assert.equal(result.metricOverflow, 0, `summary metric content clips at ${viewport.width}px`)
    assert.equal(typography.metricLabelClipping, 0, `summary metric labels clip at ${viewport.width}px`)
    assert.ok(typography.metricLabelFonts.every((size: number) => size === 10), `summary metric labels are inconsistent at ${viewport.width}px`)
    assert.ok(typography.metricNumberFonts.every((size: number) => size === (viewport.width <= 700 ? 19 : 20)), `summary metric values are oversized or inconsistent at ${viewport.width}px`)
    assert.ok(typography.metricGaps.every((gap: number) => Math.abs(gap - 4) <= 0.5), `summary metric spacing is inconsistent at ${viewport.width}px`)
    assert.ok(typography.teamHeaderFont >= 12, `Team Today secondary headings remain undersized at ${viewport.width}px`)
    assert.ok(typography.teamNameFont >= 11, `Team Today secondary staff details remain undersized at ${viewport.width}px`)
    assert.equal(result.teamPanelOverflow, 0, `Team Today status panels clip at ${viewport.width}px`)
    assert.equal(result.teamPillCount, 10, `Team Today must render working, OFF, and leave staff as individual pills at ${viewport.width}px`)
    assert.deepEqual(result.workingPillNames, Array.from({ length: 8 }, (_, index) => `Dashboard Staff ${index + 1}`), `Team Today working-staff order changed at ${viewport.width}px`)
    assert.ok(result.teamPillStyles.slice(0, 8).every((style: any) => style.background === 'rgb(23, 61, 86)' && style.border === 'rgb(23, 61, 86)' && style.color === 'rgb(255, 255, 255)'), `Working staff pills do not reflect their configured duty color at ${viewport.width}px`)
    assert.deepEqual(result.teamPillStyles[8], { background: 'rgb(240, 210, 141)', color: 'rgb(23, 50, 71)', border: 'rgb(240, 210, 141)', text: 'Dashboard Staff 9OFF' }, `OFF staff pill does not reflect its configured duty color at ${viewport.width}px`)
    assert.deepEqual(result.teamPillStyles[9], { background: 'rgb(111, 91, 143)', color: 'rgb(255, 255, 255)', border: 'rgb(111, 91, 143)', text: 'Dashboard Staff 10AL' }, `Leave staff pill does not reflect its configured duty color at ${viewport.width}px`)
    assert.equal(result.teamPillClipping, 0, `Team Today staff pill text clips at ${viewport.width}px`)
    assert.equal(stageD2.occasionPillCount, 2, `Guest Occasion pills do not match the authoritative fixture at ${viewport.width}px`)
    assert.deepEqual(stageD2.occasionPillText, ['Birthday 1', 'Anniversary 1'], `Guest Occasion pill labels or counts changed at ${viewport.width}px`)
    assert.deepEqual(stageD2.occasionStyles, [{ background: 'rgb(179, 139, 58)', color: 'rgb(255, 255, 255)', border: 'rgb(179, 139, 58)' }, { background: 'rgb(125, 99, 153)', color: 'rgb(255, 255, 255)', border: 'rgb(125, 99, 153)' }], `Dashboard Guest Occasion pills must match configured Guest Occasions colors at ${viewport.width}px`)
    assert.equal(stageD2.occasionClipping, 0, `Guest Occasion pills clip at ${viewport.width}px`)
    assert.equal(stageD2.maintenanceCount, 2, `Maintenance Follow-Up must exclude resolved issues at ${viewport.width}px`)
    assert.equal(stageD2.urgentCount, 1, `Maintenance Follow-Up urgent priority is missing at ${viewport.width}px`)
    assert.equal(stageD2.normalCount, 1, `Maintenance Follow-Up normal priority is missing at ${viewport.width}px`)
    assert.ok(stageD2.maintenanceText.every((text: string) => !/Unassigned|Guest occasions|Resolved Fixture/.test(text)), `Maintenance Follow-Up includes unrelated or resolved alerts at ${viewport.width}px`)
    assert.ok(stageD2.maintenanceTouchHeights.every((height: number) => height >= (viewport.width <= 700 ? 44 : 38)), `Maintenance Follow-Up targets are undersized at ${viewport.width}px`)
    assert.ok(stageD2.timeColumnWidth >= 108 && stageD2.timeColumnWidth <= (viewport.width <= 700 ? 114 : 160), `Tonight Time column is outside the readable proportional range at ${viewport.width}px`)
    assert.ok(stageD2.tableWidth >= stageD2.scrollerWidth - 2, `Tonight table is narrower than its responsive scroll container at ${viewport.width}px`)
    assert.ok(stageD2.partyColumnWidth >= 80, `Tonight Pax columns remain too narrow at ${viewport.width}px`)
    assert.equal(stageD2.verticalDivider, '1px', `Tonight vertical dividers are missing at ${viewport.width}px`)
    assert.equal(stageD2.horizontalDivider, '1px', `Tonight row dividers are missing at ${viewport.width}px`)
    assert.ok(result.teamNameGap <= 12, `Working names remain too far from the summary at ${viewport.width}px`)
    assert.equal(new Set(result.teamPanelWidths).size, 1, `Team Today OFF and Leave panels are not balanced at ${viewport.width}px`)
    assert.equal(new Set(result.teamPanelTops).size, 1, `Team Today OFF and Leave panels are not aligned at ${viewport.width}px`)
    assert.ok(result.trainingBottomGap <= 16, `Daily Training retains excessive bottom space at ${viewport.width}px`)
    assert.equal(new Set(result.trainingCellWidths).size, 1, `Daily Training details are not balanced at ${viewport.width}px`)
    assert.equal(new Set(result.tonightMetricWidths).size, 1, `Tonight summary metrics are not equal width at ${viewport.width}px`)
    assert.equal(new Set(result.tonightMetricTops).size, 1, `Tonight summary metrics are not aligned at ${viewport.width}px`)
    assert.equal(typography.tonightCellClipping, 0, `Tonight service-board text clips at ${viewport.width}px`)
    assert.equal(typography.dashBoardCells, 0, `Tonight service board still displays dash placeholders at ${viewport.width}px`)
    assert.ok(typography.blankBoardCells > 0, `Tonight service board fixture must exercise blank cells at ${viewport.width}px`)
    assert.ok(typography.countBadgeCount > 0, `Tonight nonzero party counts are not rendered as badges at ${viewport.width}px`)
    assert.ok(typography.countBadgeWidths.every((width: number) => width >= 32 && width <= 40), `Tonight count pill width is outside the approved range at ${viewport.width}px`)
    assert.ok(typography.countBadgeHeights.every((height: number) => height === 24), `Tonight count pills are not compact at ${viewport.width}px`)
    assert.ok(typography.countBadgeWidths.every((width: number, index: number) => width > typography.countBadgeHeights[index]), `Tonight counts must use rounded rectangular pills at ${viewport.width}px`)
    assert.deepEqual(typography.countBadgeBackgrounds, ['rgb(226, 245, 241)'], `Tonight count pills do not use the Dashboard accent surface at ${viewport.width}px`)
    assert.deepEqual(typography.countBadgeColors, ['rgb(23, 61, 86)'], `Tonight count badges do not use navy numbers at ${viewport.width}px`)
    assert.ok(typography.countBadgeCenterDrift.every((drift: number) => drift <= 1), `Tonight count badges are not centered at ${viewport.width}px`)
    assert.deepEqual(result.tonightSummaryValues, ['10', '1', '1'], `Tonight status calculations changed at ${viewport.width}px`)
    assert.equal(typography.activeRowCount, 1, `Tonight service board must highlight exactly one live slot at ${viewport.width}px`)
    assert.equal(typography.activeRowBackground, 'rgb(226, 245, 241)', `Tonight active slot must use the restrained Dashboard accent background at ${viewport.width}px`)
    assert.ok(typography.normalRowBackgrounds.includes('rgb(255, 255, 255)'), `Tonight board must retain white alternating rows at ${viewport.width}px`)
    assert.ok(typography.normalRowBackgrounds.includes('rgb(244, 248, 250)'), `Tonight board must include soft blue-grey alternating rows at ${viewport.width}px`)
    assert.ok(Math.max(...typography.rowHeights) - Math.min(...typography.rowHeights) <= 1, `Tonight board row heights are inconsistent at ${viewport.width}px`)
    assert.equal(typography.nextChipClipping, 0, `Next 30 Minutes indicators clip at ${viewport.width}px`)
    assert.ok(typography.nextChipHeights.every((height: number) => height >= 26 && height <= 28), `Next Service Slot indicators are not compact at ${viewport.width}px`)
    assert.ok(typography.tonightColumnDrift <= 1, `Tonight header/body column alignment drifted at ${viewport.width}px`)
    assert.ok(typography.tonightHeaderFont >= 11, `Tonight column headings remain undersized at ${viewport.width}px`)
    assert.ok(typography.tonightTimeFont >= 12, `Tonight time slots remain undersized at ${viewport.width}px`)
    assert.ok(typography.tonightValueFont >= 12, `Tonight party counts remain undersized at ${viewport.width}px`)
    if (typography.nextHeadingFont) assert.ok(typography.nextHeadingFont >= 11, `Next Service Slot heading remains undersized at ${viewport.width}px`)
    assert.match(result.trainingText, /Luxury Service Refresher/)
    assert.match(result.trainingText, /10:00\s*[–-]\s*10:30/)
    assert.match(result.trainingText, /Training Manager/)
    assert.match(result.occasionText, /Birthday\s*1/)
    assert.match(result.occasionText, /Anniversary\s*1/)
    assert.match(result.teamText, /Working\s*8/)
    assert.doesNotMatch(result.teamText, /ON DUTY/)
    assert.match(result.teamText, /OFF\s*1/)
    assert.match(result.teamText, /Leave\s*1/)
    assert.match(result.teamText, /UNASSIGNED\s*·\s*2/)
    assert.match(result.tonightText, /TONIGHT AT A GLANCE/)
    assert.ok((result.tonightText.match(/No bookings remaining for tonight\./g) || []).length <= 1, 'Tonight empty state must not be duplicated')
    const horizontalScroll = await cdp.evaluate<any>(`(()=>{const scroller=document.querySelector('.tonight-scroll');const firstHeader=document.querySelector('.tonight-table th:first-child');const firstCell=document.querySelector('.tonight-table td:first-child');const beforeHeaderLeft=firstHeader.getBoundingClientRect().left;const beforeCellLeft=firstCell.getBoundingClientRect().left;const overflow=scroller.scrollWidth-scroller.clientWidth;scroller.scrollLeft=overflow;const afterHeaderLeft=firstHeader.getBoundingClientRect().left;const afterCellLeft=firstCell.getBoundingClientRect().left;const style=getComputedStyle(scroller);return{overflow,scrollLeft:scroller.scrollLeft,headerDrift:Math.abs(afterHeaderLeft-beforeHeaderLeft),cellDrift:Math.abs(afterCellLeft-beforeCellLeft),scrollbarColor:style.scrollbarColor,focusable:scroller.tabIndex===0}})()`)
    assert.equal(horizontalScroll.focusable, true, `Tonight board scroll region is not keyboard focusable at ${viewport.width}px`)
    if (viewport.width <= 768) {
      assert.ok(horizontalScroll.overflow > 0, `Tonight board fixture must horizontally overflow inside its container at ${viewport.width}px`)
      assert.ok(horizontalScroll.scrollLeft > 0, `Tonight board did not scroll horizontally at ${viewport.width}px`)
      assert.ok(horizontalScroll.headerDrift <= 1 && horizontalScroll.cellDrift <= 1, `Sticky Time column moved during horizontal scroll at ${viewport.width}px`)
      assert.match(horizontalScroll.scrollbarColor, /12, 103, 92/, `Tonight board scrollbar is missing the Dashboard accent treatment at ${viewport.width}px`)
    }
    if (viewport.width <= 700) { assert.deepEqual(result.mobileOrder, ['TEAM TODAY','BOOKINGS','SERVICE PROGRESS','GUEST OCCASIONS','DAILY TRAINING','MAINTENANCE FOLLOW-UP','TONIGHT AT A GLANCE']); assert.equal(new Set(result.trainingCellTops).size, 1, `Training details are not horizontal at ${viewport.width}px`); assert.equal(result.trainingCellOverflow, 0, `Training detail text clips at ${viewport.width}px`); assert.ok(result.trainingHeight < 240, `Training card is not compact at ${viewport.width}px`) }
    else { assert.equal(String(result.gridColumns).trim().split(/\s+/).length, 2); assert.ok(new Set(result.cardHeights.slice(0, 6)).size > 1, 'Dashboard cards should use content-based heights'); assert.ok(Math.abs(result.columnHeights[0]-result.columnHeights[1]) <= 210, `Dashboard columns should remain visually balanced at ${viewport.width}px (${result.columnHeights.join(' / ')})`) }
    await cdp.evaluate(`document.querySelector('.tonight-scroll').scrollLeft=0`)
    const metrics = await cdp.send('Page.getLayoutMetrics')
    const content = metrics.cssContentSize || metrics.contentSize
    const capture = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { x: 0, y: 0, width: content.width, height: content.height, scale: 1 } })
    await writeFile(join(output, `dashboard-${visualPhase}-${viewport.name}.png`), Buffer.from(capture.data, 'base64'))

    await cdp.evaluate(`scrollTo(0, 0)`)
    await sleep(100)
    const beforeRefresh = await measureDashboard()
    await cdp.evaluate(`location.reload()`)
    const duringRefresh = await waitForDashboardLoading()
    await waitForDashboardReady()
    const afterRefresh = await measureDashboard()
    assert.ok(duringRefresh.loading, `slow refresh did not exercise Dashboard loading state at ${viewport.width}px`)
    assert.ok(duringRefresh.pageHeight >= beforeRefresh.pageHeight - 2, `Dashboard collapsed during refresh at ${viewport.width}px`)
    assert.ok(Math.abs(duringRefresh.scrollY - beforeRefresh.scrollY) <= 2, `Dashboard scroll moved during refresh at ${viewport.width}px: ${JSON.stringify({ beforeRefresh, duringRefresh })}`)
    assert.ok(Math.abs(afterRefresh.scrollY - beforeRefresh.scrollY) <= 2, `Dashboard scroll moved after refresh at ${viewport.width}px: ${JSON.stringify({ beforeRefresh, afterRefresh })}`)

    const reportsClicked = await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('nav button[aria-label="Reports"]');button?.click();return !!button})()`)
    assert.equal(reportsClicked, true, `Reports navigation is unavailable at ${viewport.width}px`)
    for (let attempt = 0; attempt < 120; attempt++) { if (await cdp.evaluate<boolean>(`document.querySelector('.page-header h1')?.textContent==='Reports'`)) break; await sleep(100) }
    for (let attempt = 0; attempt < 160; attempt++) { if (await cdp.evaluate<boolean>(`document.documentElement.scrollHeight>innerHeight+120`)) break; await sleep(100) }
    await cdp.evaluate(`scrollTo(0, Math.min(520, document.documentElement.scrollHeight-innerHeight))`)
    await sleep(100)
    const beforeReturnY = await cdp.evaluate<number>('Math.round(scrollY)')
    assert.ok(beforeReturnY > 0, `Reports fixture was not scrollable before returning to Dashboard at ${viewport.width}px`)
    await cdp.evaluate(`window.__dashboardFetches=[]`)
    const dashboardReturnStarted = performance.now()
    const dashboardClicked = await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('nav button[aria-label="Dashboard"]');button?.click();return !!button})()`)
    assert.equal(dashboardClicked, true, `Dashboard navigation is unavailable at ${viewport.width}px`)
    const duringReturn = await waitForDashboardLoading()
    await waitForDashboardReady()
    const dashboardReturnMs = Math.round(performance.now() - dashboardReturnStarted)
    const dashboardFetches = await cdp.evaluate<Array<{ target: string; duration: number; status: number }>>(`window.__dashboardFetches||[]`)
    const afterReturn = await measureDashboard()
    assert.ok(duringReturn.loading, `navigation return did not exercise Dashboard loading state at ${viewport.width}px`)
    assert.ok(duringReturn.pageHeight >= afterReturn.pageHeight - 2, `Dashboard collapsed while returning from Reports at ${viewport.width}px`)
    const expectedReturnY = Math.min(beforeReturnY, Math.max(0, afterReturn.documentHeight - viewport.height))
    assert.ok(Math.abs(duringReturn.scrollY - expectedReturnY) <= 8, `Dashboard scroll did not preserve the nearest valid position while returning from Reports at ${viewport.width}px: ${JSON.stringify({ beforeReturnY, expectedReturnY, duringReturn })}`)
    assert.ok(Math.abs(afterReturn.scrollY - expectedReturnY) <= 8, `Dashboard scroll did not preserve the nearest valid position after returning from Reports at ${viewport.width}px: ${JSON.stringify({ beforeReturnY, expectedReturnY, afterReturn })}`)
    results.push({ name: viewport.name, ...result, performance: { dashboardReturnMs, dashboardFetches }, stability: { beforeRefresh, duringRefresh, afterRefresh, beforeReturnY, duringReturn, afterReturn } })
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  for (const action of [
    { label: 'View roster', page: 'Duty Roster' },
    { label: 'View bookings', page: 'Bookings' },
    { label: 'View service', page: 'Bookings' },
    { label: 'View occasions', page: 'Guest Occasions' },
    { label: 'View training', page: 'Training' }
  ]) {
    for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<boolean>(`Array.from(document.querySelectorAll('.dashboard-card button')).some(node=>node.textContent?.trim()==='${action.label}')`)) break; await sleep(100) }
    const clicked = await cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('.dashboard-card button')).find(node=>node.textContent?.trim()==='${action.label}');button?.click();return !!button})()`)
    assert.equal(clicked, true, `${action.label} action is unavailable`)
    for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<boolean>(`document.querySelector('.page-header h1')?.textContent==='${action.page}'`)) break; await sleep(100) }
    assert.equal(await cdp.evaluate<string>(`document.querySelector('.page-header h1')?.textContent||''`), action.page, `${action.label} did not navigate to ${action.page}`)
    const returned = await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('nav button[aria-label="Dashboard"]');button?.click();return !!button})()`)
    assert.equal(returned, true, `Dashboard navigation is unavailable after ${action.label}`)
    for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.dashboard-page')`)) break; await sleep(100) }
    assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.dashboard-page')`), true, `Dashboard did not reopen after ${action.label}`)
  }
  for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.maintenance-followup-list button.urgent')`)) break; await sleep(100) }
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('.maintenance-followup-list button.urgent');button?.click();return !!button})()`), true, 'Urgent maintenance follow-up action is unavailable')
  for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.maintenance-modal[aria-label="Maintenance Issue Details"]')`)) break; await sleep(100) }
  assert.match(await cdp.evaluate<string>(`document.querySelector('.maintenance-modal[aria-label="Maintenance Issue Details"]')?.textContent||''`), /Dashboard Urgent Repair/, 'Dashboard maintenance issue did not open its corresponding Maintenance record')
  const performanceComparison = await cdp.evaluate<any>(`(async()=>{const date='${today}';const current=['/api/roster?start='+date+'&end='+date,'/api/bookings?date='+date,'/api/reports?periodType=today&start='+date+'&end='+date,'/api/maintenance','/api/training'];const legacy=[...current,'/api/bookings/summary?date='+date,'/api/maintenance/summary?date='+date,...current,'/api/bookings/summary?date='+date,'/api/maintenance/summary?date='+date];const run=async paths=>{const started=performance.now();await Promise.all(paths.map(path=>fetch(path).then(response=>{if(!response.ok)throw new Error(path)})));return Math.round(performance.now()-started)};const currentRuns=[],legacyRuns=[];for(let index=0;index<3;index++){currentRuns.push(await run(current));legacyRuns.push(await run(legacy))}const median=values=>[...values].sort((a,b)=>a-b)[1];return{currentRequestCount:current.length,legacyRequestCount:legacy.length,currentRuns,legacyRuns,currentMedianMs:median(currentRuns),legacyMedianMs:median(legacyRuns)}})()`)
  assert.deepEqual(cdp.errors, [])
  console.log(JSON.stringify({ status: 'PASS', isolated: true, date: today, performanceComparison, screenshots: viewports.map(viewport => `artifacts/dashboard-${visualPhase}-${viewport.name}.png`), results, consoleErrors: cdp.errors }, null, 2))
  completed = true
} finally {
  const deadline = completed ? setTimeout(() => process.exit(0), 10_000) : undefined
  socket?.close()
  for (const child of processes.reverse()) {
    child.kill()
    if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    child.removeAllListeners(); child.unref()
  }
  if (debugPort !== null) {
    for (let attempt = 0; attempt < 50; attempt++) { try { await fetch(`http://127.0.0.1:${debugPort}/json/version`); await sleep(100) } catch { break } }
  }
  await sleep(1200)
  await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 400 }).catch(() => undefined)
  if (deadline) clearTimeout(deadline)
}
process.exit(0)
