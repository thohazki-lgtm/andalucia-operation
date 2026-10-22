import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'
import { StaffRepository } from './staff-repository.js'
import { OperationsRepository } from './operations-repository.js'
import { ANDALUCIA_SCOPE_ID, OutletMembershipRepository } from './outlet-membership-repository.js'

const fixture = await createDisposableDevelopmentStore('leave-planner-l1-visual')
const profile = join(fixture.root, 'edge-profile')
const output = resolve('artifacts', 'leave-planner-l1')
const processes: ChildProcess[] = []
let socket: WebSocket | null = null
const token = `isolated-${randomUUID()}`
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))
const waitFor = async (url: string) => { for (let attempt = 0; attempt < 100; attempt++) { try { if ((await fetch(url)).ok) return } catch {} await sleep(200) } throw new Error(`Timed out waiting for ${url}`) }

class Cdp {
  private id = 0
  private pending = new Map<number, { resolve: (value: any) => void; reject: (reason: unknown) => void }>()
  readonly errors: string[] = []
  constructor(private ws: WebSocket) { ws.onmessage = event => { const message = JSON.parse(String(event.data)); if (message.id) { const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result) } else if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || 'Runtime exception') } }
  send(method: string, params: Record<string, unknown> = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise<any>((resolveCall, rejectCall) => this.pending.set(id, { resolve: resolveCall, reject: rejectCall })) }
  evaluate<T>(expression: string) { return this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then(result => { if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed'); return result.result.value as T }) }
}

const screenshot = async (cdp: Cdp, name: string) => {
  const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const target = join(output, name)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, Buffer.from(capture.data, 'base64'))
}

try {
  const repository = new StaffRepository(fixture.store, fixture.db)
  await repository.initialize()
  const operations = new OperationsRepository(fixture.db)
  await operations.initialize()
  const owner = (await fixture.db.query<any>("select u.id from user_accounts u join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.active=true where u.status='active' and r.role_key='owner' limit 1")).rows[0]
  assert.ok(owner)
  const staff = (await repository.list()).filter(person => person.employmentStatus === 'active').slice(0, 3)
  assert.equal(staff.length, 3)
  const membership = new OutletMembershipRepository(fixture.db)
  await membership.initialize()
  for (const person of staff) await membership.createMembership({ id: randomUUID(), staffId: person.id, outletScopeId: ANDALUCIA_SCOPE_ID, membershipDimension: 'regular_outlet', effectiveFrom: '2026-09-01', effectiveTo: null, source: 'baseline_manager_review', reason: 'Leave Planner L1 isolated visual validation', reviewStatus: 'approved' })
  await fixture.db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes','DUTY_EL_L1','Emergency Leave','#d08a45',$2,true,99)", [randomUUID(), JSON.stringify({ displayCode: 'EL', dutyClassification: 'emergencyLeave', countsAsWorking: false, protected: true, systemControlled: true })])
  const dutyCodes = (await repository.configuration()).dutyCodes
  const code = (classification: string) => dutyCodes.find(option => option.metadata?.dutyClassification === classification)!
  assert.ok(code('annualLeave') && code('off') && code('emergencyLeave'))
  await operations.updateRoster(staff[0].id, '2026-10-20', code('annualLeave').value)
  await operations.updateRoster(staff[0].id, '2026-10-21', code('off').value)
  await operations.updateRoster(staff[1].id, '2026-10-22', code('emergencyLeave').value)
  await fixture.db.query("insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval '1 hour')", [randomUUID(), createHash('sha256').update(token).digest('hex'), owner.id])
  await fixture.db.close()

  const node = process.execPath
  processes.push(spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '026', API_PORT: '3012', APP_ORIGIN: 'http://127.0.0.1:5182' }, stdio: 'inherit' }))
  processes.push(spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5182', '--strictPort'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3012' }, stdio: 'ignore' }))
  await Promise.all([waitFor('http://127.0.0.1:3012/api/health'), waitFor('http://127.0.0.1:5182/')])

  const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--edge-skip-compat-layer-relaunch', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' }); processes.push(edge)
  let debugPort = 0
  const activePort = join(profile, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 200; attempt++) { try { const [line] = (await readFile(activePort, 'utf8')).trim().split(/\r?\n/); debugPort = Number(line); if (debugPort > 0 && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) break } catch {} await sleep(100) }
  assert.ok(debugPort)
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json() as any[]
  const page = pages.find(item => item.type === 'page'); assert.ok(page)
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise<void>((done, fail) => { socket!.onopen = () => done(); socket!.onerror = () => fail(new Error('CDP connection failed')) })
  const cdp = new Cdp(socket)
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable')
  assert.equal((await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5182/', path: '/', httpOnly: true, sameSite: 'Strict' })).success, true)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5182/' })
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Staff Management"]')`)) break; await sleep(100) }
  const planned = await cdp.evaluate<any>(`fetch('/api/workforce/planned-leave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({staffId:${JSON.stringify(staff[0].id)},startDate:'2026-10-28',endDate:'2026-10-29',leaveType:'annual_leave',managerNote:'Isolated L1 visual validation'})}).then(async response=>({status:response.status,body:await response.text()}))`)
  assert.equal(planned.status, 201, planned.body)
  await cdp.evaluate(`document.querySelector('button[aria-label="Staff Management"]')?.click()`)
  for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-section-tabs')`)) break; await sleep(100) }
  await cdp.evaluate(`Array.from(document.querySelectorAll('.staff-section-tabs button')).find(button=>button.textContent?.trim()==='Leave Planner')?.click()`)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.leave-summary-section')&&!/Loading confirmed roster/i.test(document.querySelector('.leave-planner-panel')?.textContent||'')`)) break; await sleep(100) }

  const widths = [1440, 1280, 1024, 768, 430, 390, 360]
  const results: Record<string, unknown> = {}
  for (const width of widths) {
    const mobile = width <= 700
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: mobile ? 1000 : 1100, deviceScaleFactor: 1, mobile })
    await cdp.evaluate(`document.querySelector('.app-sidebar.mobile-open .drawer-close')?.click();window.scrollTo({top:0,left:0,behavior:'instant'})`)
    await sleep(80)
    const layout = await cdp.evaluate<any>(`(async()=>{const root=document.querySelector('.leave-planner-panel');const wrap=root?.querySelector('.leave-planner-grid-wrap');const table=root?.querySelector('.leave-planner-grid');const staffCell=table?.querySelector('tbody th.staff');if(!root||!wrap||!table||!staffCell)return{diagnostic:{root:!!root,wrap:!!wrap,table:!!table,rows:table?.querySelectorAll('tbody tr').length||0,text:root?.textContent||''}};const headers=Array.from(table.querySelectorAll('thead th:not(.identity)'));const cells=Array.from(table.querySelectorAll('tbody tr:first-child td:not(.identity)'));const cards=Array.from(root.querySelectorAll('.leave-summary-grid>.leave-summary-card'));const details=Array.from(root.querySelectorAll('.leave-category-details button'));const confirmed=Array.from(table.querySelectorAll('.leave-day-code:not(.booked)'));const booked=Array.from(table.querySelectorAll('.leave-day-code.booked'));const config=await fetch('/api/config/staff').then(response=>response.json());const colors=Object.fromEntries(config.dutyCodes.map(option=>[option.metadata?.displayCode||option.value,option.color]));const colorParity=confirmed.every(node=>{const value=colors[node.textContent.trim()];if(!value)return false;const hex=value.replace('#','');const expected='rgb('+[0,2,4].map(index=>parseInt(hex.slice(index,index+2),16)).join(', ')+')';return getComputedStyle(node).backgroundColor===expected});wrap.scrollLeft=220;const wrapRect=wrap.getBoundingClientRect();const staffRect=staffCell.getBoundingClientRect();const controls=Array.from(root.querySelectorAll('button,select,input')).filter(node=>{const rect=node.getBoundingClientRect();return rect.width>0&&rect.height>0});const smallTargets=controls.filter(node=>node.getBoundingClientRect().height<43.5).map(node=>({text:node.textContent?.trim()||node.getAttribute('aria-label'),className:node.className,height:node.getBoundingClientRect().height}));return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,rootOverflow:root.scrollWidth>root.clientWidth+1,summaryLabels:cards.map(card=>card.querySelector('span').textContent.trim()),summaryValues:Object.fromEntries(cards.map(card=>[card.querySelector('span').textContent.trim(),Number(card.querySelector('b').textContent)])),detailValues:Object.fromEntries(details.map(button=>[button.querySelector('span').textContent.trim(),Number(button.querySelector('b').textContent)])),details:details.length,gridVisible:getComputedStyle(wrap).display!=='none',containedScroll:wrap.scrollWidth>wrap.clientWidth,stickyStaff:getComputedStyle(staffCell).position,stickyDrift:Math.round(staffRect.left-wrapRect.left),staffMetaVisible:getComputedStyle(staffCell.querySelector('.leave-staff-meta')).display!=='none',dateColumns:headers.length,columnDrift:headers.map((header,index)=>cells[index]?Math.max(Math.abs(header.getBoundingClientRect().left-cells[index].getBoundingClientRect().left),Math.abs(header.getBoundingClientRect().width-cells[index].getBoundingClientRect().width)):999),confirmed:confirmed.length,booked:booked.length,bookedDashed:booked.every(node=>getComputedStyle(node).borderStyle==='dashed'),colorParity,today:!!table.querySelector('thead th.today'),availability:table.querySelectorAll('tfoot td:not(.identity)').length,calendar:root.querySelector('.leave-month-navigation input')?.type,calendarIcon:!!root.querySelector('.leave-month-navigation .ao-date-control__icon'),smallTargets,mobileTargets:!${mobile}||smallTargets.length===0}})()`)
    assert.equal(layout.diagnostic, undefined, `Leave Planner did not render rows at ${width}px: ${JSON.stringify(layout.diagnostic)}`)
    const otherTotal = Object.values(layout.detailValues).reduce((sum: number, value) => sum + Number(value), 0)
    assert.deepEqual(layout.summaryLabels, ['Annual Leave', 'Day Off', 'Booked / Future Leave', 'Other Leave'])
    assert.deepEqual({ annual: layout.summaryValues['Annual Leave'], off: layout.summaryValues['Day Off'], booked: layout.summaryValues['Booked / Future Leave'], other: layout.summaryValues['Other Leave'], otherTotal }, { annual: 1, off: 1, booked: 2, other: 1, otherTotal: 1 })
    assert.deepEqual({ details: layout.details, gridVisible: layout.gridVisible, stickyStaff: layout.stickyStaff, confirmed: layout.confirmed, booked: layout.booked, bookedDashed: layout.bookedDashed, colorParity: layout.colorParity, today: layout.today, availability: layout.availability, calendar: layout.calendar, calendarIcon: layout.calendarIcon, pageOverflow: layout.pageOverflow, rootOverflow: layout.rootOverflow, mobileTargets: layout.mobileTargets }, { details: 8, gridVisible: true, stickyStaff: 'sticky', confirmed: 3, booked: 2, bookedDashed: true, colorParity: true, today: true, availability: 31, calendar: 'month', calendarIcon: true, pageOverflow: false, rootOverflow: false, mobileTargets: true }, `Leave Planner layout failed at ${width}px; small targets: ${JSON.stringify(layout.smallTargets)}`)
    assert.equal(layout.dateColumns, 31)
    assert.ok(layout.columnDrift.every((drift: number) => drift <= .1), `Calendar column drift at ${width}px: ${layout.columnDrift}`)
    assert.equal(layout.staffMetaVisible, mobile)
    assert.ok(Math.abs(layout.stickyDrift) <= 1)
    if (mobile) assert.equal(layout.containedScroll, true)
    results[String(width)] = layout
    await cdp.evaluate(`document.querySelector('.leave-planner-grid-wrap').scrollLeft=0`)
    await screenshot(cdp, `after-${width}.png`)
    if (mobile) { await cdp.evaluate(`document.querySelector('.leave-planner-grid-wrap').scrollIntoView({block:'start'});document.querySelector('.leave-planner-grid-wrap').scrollLeft=180`); await sleep(50); await screenshot(cdp, `after-${width}-calendar.png`); await cdp.evaluate(`window.scrollTo(0,0)`) }
  }

  const navigation = await cdp.evaluate<any>(`(async()=>{const input=document.querySelector('.leave-month-navigation input');const initial=input.value;document.querySelector('button[aria-label="Next month"]').click();for(let i=0;i<100&&input.value===initial;i++)await new Promise(done=>setTimeout(done,50));const next=input.value;document.querySelector('button[aria-label="Previous month"]').click();for(let i=0;i<100&&input.value!==initial;i++)await new Promise(done=>setTimeout(done,50));const restored=input.value;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'2026-09');input.dispatchEvent(new Event('input',{bubbles:true}));for(let i=0;i<100&&input.value!=='2026-09';i++)await new Promise(done=>setTimeout(done,50));const direct=input.value;setter.call(input,initial);input.dispatchEvent(new Event('input',{bubbles:true}));for(let i=0;i<100&&input.value!==initial;i++)await new Promise(done=>setTimeout(done,50));return{initial,next,restored,direct,final:input.value}})()`)
  assert.deepEqual(navigation, { initial: '2026-10', next: '2026-11', restored: '2026-10', direct: '2026-09', final: '2026-10' })
  assert.deepEqual(cdp.errors, [])
  await writeFile(join(output, 'measurements.json'), JSON.stringify({ results, navigation, runtimeErrors: cdp.errors.length }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', widths, navigation, runtimeErrors: cdp.errors.length, screenshots: widths.flatMap(width => [`artifacts/leave-planner-l1/after-${width}.png`, ...(width <= 700 ? [`artifacts/leave-planner-l1/after-${width}-calendar.png`] : [])]) }, null, 2))
} finally {
  socket?.close()
  for (const child of processes.reverse()) { if (child.exitCode === null) child.kill(); child.removeAllListeners(); child.unref() }
  await sleep(1000)
  await rm(fixture.root, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(() => undefined)
}
