import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'
import { StaffRepository } from './staff-repository.js'
import { OperationsRepository } from './operations-repository.js'
import { ANDALUCIA_SCOPE_ID, OutletMembershipRepository } from './outlet-membership-repository.js'

const fixture = await createDisposableDevelopmentStore('leave-history-grouped-ui')
const profile = join(fixture.root, 'edge-profile')
const output = resolve('artifacts', 'leave-history-grouped-ui')
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

const screenshot = async (cdp: Cdp, name: string) => { const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); const target = join(output, name); await mkdir(dirname(target), { recursive: true }); await writeFile(target, Buffer.from(capture.data, 'base64')) }
const clickText = (cdp: Cdp, selector: string, value: string) => cdp.evaluate<boolean>(`(()=>{const node=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(node=>node.textContent?.trim()===${JSON.stringify(value)});if(!node)return false;node.click();return true})()`)

try {
  const repository = new StaffRepository(fixture.store, fixture.db); await repository.initialize()
  const operations = new OperationsRepository(fixture.db); await operations.initialize()
  const staff = (await repository.list()).filter(person => person.employmentStatus === 'active').slice(0, 2); assert.equal(staff.length, 2)
  const membership = new OutletMembershipRepository(fixture.db); await membership.initialize()
  for (const person of staff) await membership.createMembership({ id: randomUUID(), staffId: person.id, outletScopeId: ANDALUCIA_SCOPE_ID, membershipDimension: 'regular_outlet', effectiveFrom: '2026-09-01', effectiveTo: null, source: 'baseline_manager_review', reason: 'Leave History isolated visual validation', reviewStatus: 'approved' })
  const dutyCodes = (await repository.configuration()).dutyCodes
  const annual = dutyCodes.find(option => option.metadata?.dutyClassification === 'annualLeave')
  const off = dutyCodes.find(option => option.metadata?.dutyClassification === 'off')
  const sick = dutyCodes.find(option => option.metadata?.dutyClassification === 'sickLeave')
  const publicHoliday = dutyCodes.find(option => option.metadata?.dutyClassification === 'publicHoliday')
  assert.ok(annual && off && sick && publicHoliday)
  for (const [id, color] of [[annual.id, '#245c73'], [off.id, '#d2a24c'], [sick.id, '#8a4d72'], [publicHoliday.id, '#4f7e96']]) await fixture.db.query('update configuration_options set color=$2 where id=$1', [id, color])
  for (const [staffId, date, code] of [
    [staff[0].id, '2026-10-21', annual.value], [staff[0].id, '2026-10-22', annual.value], [staff[0].id, '2026-10-24', off.value],
    [staff[1].id, '2026-10-20', sick.value], [staff[1].id, '2026-10-21', sick.value], [staff[1].id, '2026-10-23', publicHoliday.value],
  ]) await operations.updateRoster(staffId, date, code)
  const owner = (await fixture.db.query<any>("select u.id from user_accounts u join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.active=true where u.status='active' and r.role_key='owner' limit 1")).rows[0]; assert.ok(owner)
  await fixture.db.query("insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval '1 hour')", [randomUUID(), createHash('sha256').update(token).digest('hex'), owner.id]); await fixture.db.close()

  const node = process.execPath
  processes.push(spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', API_PORT: '3016', APP_ORIGIN: 'http://127.0.0.1:5186' }, stdio: 'ignore' }))
  processes.push(spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5186', '--strictPort'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3016' }, stdio: 'ignore' }))
  await Promise.all([waitFor('http://127.0.0.1:3016/api/health'), waitFor('http://127.0.0.1:5186/')])
  const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--edge-skip-compat-layer-relaunch', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' }); processes.push(edge)
  let debugPort = 0; const activePort = join(profile, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 200; attempt++) { try { const [line] = (await readFile(activePort, 'utf8')).trim().split(/\r?\n/); debugPort = Number(line); if (debugPort > 0 && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) break } catch {} await sleep(100) }
  assert.ok(debugPort)
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json() as any[]; const page = pages.find(item => item.type === 'page'); assert.ok(page)
  socket = new WebSocket(page.webSocketDebuggerUrl); await new Promise<void>((done, fail) => { socket!.onopen = () => done(); socket!.onerror = () => fail(new Error('CDP connection failed')) })
  const cdp = new Cdp(socket); await cdp.send('Runtime.enable'); await cdp.send('Page.enable')
  assert.equal((await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5186/', path: '/', httpOnly: true, sameSite: 'Strict' })).success, true)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false }); await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5186/' })
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Staff Management"]')`)) break; await sleep(100) }
  const planned = await cdp.evaluate<any>(`fetch('/api/workforce/planned-leave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({staffId:${JSON.stringify(staff[0].id)},startDate:'2026-10-28',endDate:'2026-10-29',leaveType:'annual_leave',managerNote:'Grouped history isolation check'})}).then(async response=>({status:response.status,body:await response.text()}))`); assert.equal(planned.status, 201, planned.body)
  await cdp.evaluate(`document.querySelector('button[aria-label="Staff Management"]')?.click()`)
  for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-section-tabs')`)) break; await sleep(100) }
  assert.equal(await clickText(cdp, '.staff-section-tabs button', 'Leave Planner'), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.leave-planner-tabs')`)) break; await sleep(80) }
  assert.equal(await clickText(cdp, '.leave-planner-tabs button', 'Leave History'), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`document.querySelectorAll('.leave-employee-history').length===2`)) break; await sleep(80) }
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`document.querySelectorAll('.planned-leave-table tbody tr').length===1`)) break; await sleep(50) }

  const expectedNames = staff.map(person => person.name).sort()
  const baseline = await cdp.evaluate<any>(`(()=>({employees:Array.from(document.querySelectorAll('.leave-history-employee b')).map(n=>n.textContent.trim()).sort(),sourceDates:Number((document.querySelector('.confirmed-leave-history>header>small')?.textContent||'0').match(/[0-9]+/)?.[0]),totals:Array.from(document.querySelectorAll('.leave-employee-history')).map(row=>({name:row.querySelector('.leave-history-employee b').textContent.trim(),totals:Array.from(row.querySelectorAll('.leave-history-totals span')).map(n=>n.textContent.trim())})),bookedText:document.querySelector('.planned-leave-history')?.textContent||'',pageOverflow:document.documentElement.scrollWidth>innerWidth+1}))()`)
  assert.deepEqual(baseline.employees, expectedNames); assert.equal(baseline.sourceDates, 6); assert.equal(baseline.pageOverflow, false)
  const firstTotals = baseline.totals.find((item: any) => item.name === staff[0].name).totals.join(' '); assert.match(firstTotals, /AL\s*2/); assert.match(firstTotals, /OFF\s*1/)
  const secondTotals = baseline.totals.find((item: any) => item.name === staff[1].name).totals.join(' '); assert.match(secondTotals, /(SL|SK)\s*2/); assert.match(secondTotals, /PH\s*1/)
  assert.match(baseline.bookedText, /Separate from confirmed leave/); assert.match(baseline.bookedText, /Off Days/); assert.match(baseline.bookedText, /Total Calendar Days/); assert.doesNotMatch(baseline.bookedText, /Roster reconciliation|No confirmed collision/)

  const widths = [1440, 1280, 1024, 768, 430, 390, 360]
  const measurements: Record<string, unknown> = {}
  for (const width of widths) {
    const mobile = width <= 700
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: mobile ? 1000 : 1100, deviceScaleFactor: 1, mobile }); await cdp.evaluate(`window.scrollTo(0,0);document.querySelectorAll('.leave-employee-history').forEach((n,i)=>n.open=i===0)`); await sleep(100)
    const layout = await cdp.evaluate<any>(`(()=>{const groups=Array.from(document.querySelectorAll('.leave-employee-history'));const toolbar=document.querySelector('.leave-record-filters');const first=groups[0];const leaveRows=Array.from(first.querySelectorAll('.leave-employee-history-body>section'));const pillColor=code=>{const pill=Array.from(document.querySelectorAll('.leave-history-duty-pill')).find(n=>n.textContent.trim()===code);return pill?getComputedStyle(pill).backgroundColor:null};const type=node=>{const s=getComputedStyle(node);return{color:s.color,fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight}};return{pageOverflow:document.documentElement.scrollWidth>innerWidth+1,toolbarOverflow:toolbar.scrollWidth>toolbar.clientWidth+1,groups:groups.length,repeatedNames:Array.from(document.querySelectorAll('.leave-history-employee b')).length,expandedDates:first.querySelectorAll('.leave-history-dates button').length,rowGaps:leaveRows.map(row=>{const h=row.querySelector(':scope>header').getBoundingClientRect();const d=row.querySelector('.leave-history-dates').getBoundingClientRect();return Math.round(d.left-h.right)}),pillColors:{AL:pillColor('AL'),OFF:pillColor('OFF'),SL:pillColor('SL'),PH:pillColor('PH')},identityTypography:{historyName:type(document.querySelector('.leave-history-employee b')),historySecondary:type(document.querySelector('.leave-history-employee small')),tableName:type(document.querySelector('.planned-leave-table tbody td:first-child>b')),tableId:type(document.querySelector('.planned-leave-table tbody td:first-child>small')),cardName:type(document.querySelector('.planned-leave-cards article header b')),cardId:type(document.querySelector('.planned-leave-cards article header small'))},plannedHeaders:Array.from(document.querySelectorAll('.planned-leave-table th')).map(n=>n.textContent.trim()),plannedCells:document.querySelectorAll('.planned-leave-table tbody tr:first-child td').length,plannedVisibleText:document.querySelector('.planned-leave-history')?.textContent||'',plannedTable:getComputedStyle(document.querySelector('.planned-leave-history .leave-table-wrap')).display,plannedCards:getComputedStyle(document.querySelector('.planned-leave-cards')).display,shortTargets:${mobile}?Array.from(document.querySelectorAll('.leave-records-panel button,.leave-records-panel input,.leave-records-panel select')).filter(n=>n.offsetParent&&n.getBoundingClientRect().height<43.5).map(n=>({name:n.textContent?.trim()||n.getAttribute('aria-label'),height:n.getBoundingClientRect().height})):[]}})()`)
    assert.equal(layout.pageOverflow, false, `${width}px page overflow`); assert.equal(layout.toolbarOverflow, false, `${width}px toolbar overflow`); assert.equal(layout.groups, 2); assert.equal(layout.repeatedNames, 2); assert.ok(layout.expandedDates >= 2)
    assert.deepEqual(layout.plannedHeaders, ['Staff', 'Start Date', 'End Date', 'Off Days', 'Total Calendar Days']); assert.equal(layout.plannedCells, 5); assert.doesNotMatch(layout.plannedVisibleText, /Roster reconciliation|Created by|Updated by|AUDIT/i)
    assert.deepEqual(layout.identityTypography.tableName, layout.identityTypography.historyName, `${width}px booked table name typography mismatch`); assert.deepEqual(layout.identityTypography.tableId, layout.identityTypography.historySecondary, `${width}px booked table ID typography mismatch`); assert.deepEqual(layout.identityTypography.cardName, layout.identityTypography.historyName, `${width}px booked mobile name typography mismatch`); assert.deepEqual(layout.identityTypography.cardId, layout.identityTypography.historySecondary, `${width}px booked mobile ID typography mismatch`)
    assert.deepEqual(layout.pillColors, { AL: 'rgb(36, 92, 115)', OFF: 'rgb(210, 162, 76)', SL: 'rgb(138, 77, 114)', PH: 'rgb(79, 126, 150)' })
    if (!mobile) assert.ok(layout.rowGaps.every((gap: number) => gap >= 0 && gap <= 13), `${width}px excessive leave row gap: ${JSON.stringify(layout.rowGaps)}`)
    if (mobile) { assert.equal(layout.plannedTable, 'none'); assert.notEqual(layout.plannedCards, 'none'); assert.equal(layout.shortTargets.length, 0, `${width}px short controls: ${JSON.stringify(layout.shortTargets)}`) }
    else { assert.notEqual(layout.plannedTable, 'none'); assert.equal(layout.plannedCards, 'none') }
    if (width === 1440 || width === 390) await screenshot(cdp, `after-history-expanded-${width}.png`)

    await cdp.evaluate(`(()=>{const button=document.querySelector('.leave-employee-history[open] .leave-history-dates button');button?.focus();button?.click()})()`); await sleep(60)
    const modal = await cdp.evaluate<any>(`(()=>{const overlay=document.querySelector('.leave-record-modal-overlay');const dialog=document.querySelector('.leave-record-modal');const scroll=document.querySelector('.leave-record-modal-scroll');const r=dialog.getBoundingClientRect();return{width:r.width,height:r.height,contentSized:r.height<innerHeight-10,pageOverflow:document.documentElement.scrollWidth>innerWidth+1,dialogOverflowX:dialog.scrollWidth>dialog.clientWidth+1,dialogOverflow:getComputedStyle(dialog).overflow,scrollOverflow:getComputedStyle(scroll).overflowY,bodyLocked:document.body.style.overflow==='hidden',sourceDays:dialog.querySelectorAll('.leave-record-source-days>div').length,footerCount:dialog.querySelectorAll('footer').length,shortTargets:${mobile}?Array.from(dialog.querySelectorAll('button')).filter(n=>n.getBoundingClientRect().height<43.5).map(n=>n.getBoundingClientRect().height):[]}})()`)
    assert.deepEqual({ contentSized: modal.contentSized, pageOverflow: modal.pageOverflow, dialogOverflowX: modal.dialogOverflowX, dialogOverflow: modal.dialogOverflow, scrollOverflow: modal.scrollOverflow, bodyLocked: modal.bodyLocked, sourceDays: modal.sourceDays }, { contentSized: true, pageOverflow: false, dialogOverflowX: false, dialogOverflow: 'hidden', scrollOverflow: 'auto', bodyLocked: true, sourceDays: 2 }, `${width}px modal ${JSON.stringify(modal)}`)
    assert.equal(modal.shortTargets.length, 0)
    if (width === 1440 || width === 390) await screenshot(cdp, `after-evidence-${width}.png`)
    await cdp.evaluate(`document.querySelector('.leave-record-modal')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`); assert.equal(await cdp.evaluate(`!!document.querySelector('.leave-record-modal')`), true)
    await cdp.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await sleep(30); assert.equal(await cdp.evaluate(`!!document.querySelector('.leave-record-modal')`), false); assert.equal(await cdp.evaluate(`document.activeElement?.matches('.leave-history-dates button')`), true)
    await cdp.evaluate(`document.activeElement?.click()`); await sleep(30); await cdp.evaluate(`document.querySelector('.leave-record-modal-overlay')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`); await sleep(30); assert.equal(await cdp.evaluate(`!!document.querySelector('.leave-record-modal')`), false)
    measurements[String(width)] = { layout, modal }
  }

  const filterResult = await cdp.evaluate<any>(`(()=>{const input=document.querySelector('input[aria-label="Search leave history"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(staff[1].name)});input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`); assert.equal(filterResult, true); await sleep(50); assert.equal(await cdp.evaluate(`document.querySelectorAll('.leave-employee-history').length`), 1)
  assert.deepEqual(cdp.errors, [])
  await mkdir(output, { recursive: true }); await writeFile(join(output, 'measurements.json'), JSON.stringify({ baseline, measurements, runtimeErrors: cdp.errors.length }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', widths, employeeGroups: 2, confirmedSourceDates: 6, runtimeErrors: cdp.errors.length, screenshots: ['after-history-expanded-1440.png', 'after-evidence-1440.png', 'after-history-expanded-390.png', 'after-evidence-390.png'].map(name => `artifacts/leave-history-grouped-ui/${name}`) }, null, 2))
} finally {
  socket?.close(); for (const child of processes.reverse()) { child.kill(); if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); child.removeAllListeners(); child.unref() }
  await sleep(800); await Promise.race([rm(fixture.root, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(() => undefined), sleep(4000)])
}
process.exit(0)
