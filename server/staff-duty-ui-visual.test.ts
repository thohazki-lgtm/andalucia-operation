import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'
import { StaffRepository } from './staff-repository.js'
import { StaffMembershipBaselineService } from './staff-membership-baseline-service.js'
import { ANDALUCIA_SCOPE_KEY } from './outlet-membership-repository.js'

const fixture = await createDisposableDevelopmentStore('staff-duty-ui-visual')
const profile = join(fixture.root, 'edge-profile')
const output = resolve('artifacts', 'visual-validation')
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
  const owner = (await fixture.db.query<any>("select u.id from user_accounts u join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.active=true where u.status='active' and r.role_key='owner' limit 1")).rows[0]
  assert.ok(owner)
  await new StaffRepository(fixture.store, fixture.db).initialize()
  await fixture.db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes','DUTY_EL_VISUAL','Emergency Leave','#d08a45',$2,true,99)", [randomUUID(), JSON.stringify({ displayCode: 'EL', dutyClassification: 'emergencyLeave', countsAsWorking: false, billTipEligible: true, billTipWorkedDayUnits: 1, protected: true, systemControlled: true })])
  await fixture.db.query("insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval '1 hour')", [randomUUID(), createHash('sha256').update(token).digest('hex'), owner.id])
  const position = (await fixture.db.query<{ value: string }>("select value from configuration_options where group_key='staff_positions' and active=true order by sort_order limit 1")).rows[0]?.value || 'F&B Attendant'
  const visualNames = ['DODON', 'GURI', ...Array.from({ length: 10 }, (_, index) => `Visual Staff ${String(index + 1).padStart(2, '0')}`)]
  for (let index = 0; index < visualNames.length; index++) await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,$2,$3,$4,'active','2024-01-01')", [randomUUID(), index === 0 ? 'SW2268' : `VIS-${String(index + 1).padStart(3, '0')}`, visualNames[index], position])
  const membershipService = new StaffMembershipBaselineService(fixture.db)
  const membershipReview = await membershipService.beginReview('2026-10', ANDALUCIA_SCOPE_KEY)
  const visualStaff = (await fixture.db.query<{ id: string }>("select id from staff where staff_number='SW2268' or staff_number like 'VIS-%' order by staff_number")).rows
  for (const person of visualStaff) await membershipService.saveSelection(membershipReview.id, { staffId: person.id, included: true, effectiveFrom: '2026-10-01', effectiveTo: null })
  await membershipService.approve(membershipReview.id)
  await fixture.db.close()

  const node = process.execPath
  processes.push(spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', API_PORT: '3011', APP_ORIGIN: 'http://127.0.0.1:5181' }, stdio: 'inherit' }))
  processes.push(spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5181', '--strictPort'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3011' }, stdio: 'ignore' }))
  await Promise.all([waitFor('http://127.0.0.1:3011/api/health'), waitFor('http://127.0.0.1:5181/')])

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
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Network.enable')
  assert.equal((await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5181/', path: '/', httpOnly: true, sameSite: 'Strict' })).success, true)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5181/' })
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Staff Management"]')`)) break; await sleep(150) }
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('button[aria-label="Staff Management"]');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-table .direct-staff-drag-handle')`)) break; await sleep(150) }
  const original = await cdp.evaluate<string[]>(`Array.from(document.querySelectorAll('.staff-table tbody tr .staff-name-cell b')).map(node=>node.textContent.trim())`)
  assert.ok(original.length >= 3)
  const directReorder = await cdp.evaluate<any>(`(()=>{const handles=Array.from(document.querySelectorAll('.staff-table .direct-staff-drag-handle'));const spacings=handles.map(handle=>{const row=handle.closest('[data-staff-row-id]');return Math.round(row.querySelector('.staff-name-cell b').getBoundingClientRect().left-handle.getBoundingClientRect().right)});return{handleCount:handles.length,handlesVisible:handles.every(handle=>{const r=handle.getBoundingClientRect();return r.width>=30&&r.height>=30}),spacings,modeButton:!!document.querySelector('.staff-reorder-trigger'),modeEditor:!!document.querySelector('.staff-order-editor'),pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
  assert.deepEqual({ handlesVisible: directReorder.handlesVisible, modeButton: directReorder.modeButton, modeEditor: directReorder.modeEditor, pageOverflow: directReorder.pageOverflow }, { handlesVisible: true, modeButton: false, modeEditor: false, pageOverflow: false })
  assert.equal(directReorder.handleCount, original.length)
  if (process.env.ANDALUCIA_ROSTER_VISUAL_ONLY !== '1') {
    if (!directReorder.spacings.every((gap: number) => gap >= 12 && gap <= 16)) console.error(JSON.stringify({ handleNameSpacings: directReorder.spacings }))
    assert.ok(directReorder.spacings.every((gap: number) => gap >= 12 && gap <= 16))
  }
  await screenshot(cdp, 'staff-direct-reorder-desktop.png')
  await cdp.evaluate(`(()=>{window.__staffReorderRequests=[];const originalFetch=window.fetch.bind(window);window.fetch=(input,init)=>{if(String(input).includes('/api/staff/reorder'))window.__staffReorderRequests.push({input:String(input),method:init?.method||'GET'});return originalFetch(input,init)}})()`)

  const dragByName = async (sourceName: string, targetName: string, after: boolean) => {
    const points = await cdp.evaluate<any>(`(()=>{const rows=Array.from(document.querySelectorAll('.staff-table tbody tr'));const sourceRow=rows.find(row=>row.querySelector('.staff-name-cell b')?.textContent?.trim()===${JSON.stringify(sourceName)});const targetRow=rows.find(row=>row.querySelector('.staff-name-cell b')?.textContent?.trim()===${JSON.stringify(targetName)});if(!sourceRow||!targetRow)return null;const source=sourceRow.querySelector('.direct-staff-drag-handle').getBoundingClientRect();const target=targetRow.getBoundingClientRect();return{sx:source.left+source.width/2,sy:source.top+source.height/2,tx:target.left+target.width/2,ty:${after ? 'target.bottom-5' : 'target.top+5'}}})()`)
    assert.ok(points, `Expected ${sourceName} and ${targetName} in Team Directory.`)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.sx, y: points.sy })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: points.sx, y: points.sy, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.tx, y: points.ty, button: 'left', buttons: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: points.tx, y: points.ty, button: 'left', clickCount: 1 })
    await sleep(120)
  }
  await dragByName('GURI', 'DODON', false)
  const requested = await cdp.evaluate<string[]>(`Array.from(document.querySelectorAll('.staff-table tbody tr .staff-name-cell b')).map(node=>node.textContent.trim())`)
  assert.notDeepEqual(requested, original)
  assert.equal(requested.indexOf('GURI') + 1, requested.indexOf('DODON'))
  for (let attempt = 0; attempt < 80; attempt++) { const persisted = await cdp.evaluate<string[]>(`fetch('/api/staff').then(response=>response.json()).then(staff=>staff.map(person=>person.name))`); if (JSON.stringify(persisted) === JSON.stringify(requested)) break; await sleep(100) }
  const directorySaved = await cdp.evaluate<string[]>(`fetch('/api/staff').then(response=>response.json()).then(staff=>staff.map(person=>person.name))`)
  if (JSON.stringify(directorySaved) !== JSON.stringify(requested)) console.error(JSON.stringify({ requested, directorySaved, reorderRequests: await cdp.evaluate<any[]>(`window.__staffReorderRequests||[]`), toast: await cdp.evaluate<string>(`document.querySelector('.toast')?.textContent||''`), visibleOrder: await cdp.evaluate<string[]>(`Array.from(document.querySelectorAll('.staff-table tbody tr .staff-name-cell b')).map(node=>node.textContent.trim())`) }, null, 2))
  assert.deepEqual(directorySaved, requested)
  assert.deepEqual(await cdp.evaluate<any[]>(`window.__staffReorderRequests||[]`), [{ input: '/api/staff/reorder', method: 'POST' }])
  const consecutiveRequested = requested
  await cdp.send('Page.reload')
  await sleep(400)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Staff Management"]')`)) break; await sleep(100) }
  await cdp.evaluate(`document.querySelector('button[aria-label="Staff Management"]')?.click()`)
  for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-table tbody tr')`)) break; await sleep(100) }
  assert.deepEqual(await cdp.evaluate<string[]>(`Array.from(document.querySelectorAll('.staff-table tbody tr .staff-name-cell b')).map(node=>node.textContent.trim())`), consecutiveRequested)
  await screenshot(cdp, 'staff-direct-reorder-desktop.png')
  for (let attempt = 0; attempt < 30; attempt++) { if (await cdp.evaluate<boolean>(`Array.from(document.querySelectorAll('.staff-table .direct-staff-drag-handle')).every(button=>!button.disabled)`)) break; await sleep(100) }
  await cdp.evaluate(`(()=>{window.__confirmedFetch=window.fetch.bind(window);window.fetch=(input,init)=>String(input).includes('/api/staff/reorder')?Promise.resolve(new Response(JSON.stringify({error:'Simulated reorder failure'}),{status:500,headers:{'Content-Type':'application/json'}})):window.__confirmedFetch(input,init)})()`)
  await dragByName('Visual Staff 04', 'Visual Staff 01', false)
  for (let attempt = 0; attempt < 40; attempt++) { const restored = await cdp.evaluate<string[]>(`Array.from(document.querySelectorAll('.staff-table tbody tr .staff-name-cell b')).map(node=>node.textContent.trim())`); if (JSON.stringify(restored) === JSON.stringify(consecutiveRequested)) break; await sleep(100) }
  assert.deepEqual(await cdp.evaluate<string[]>(`Array.from(document.querySelectorAll('.staff-table tbody tr .staff-name-cell b')).map(node=>node.textContent.trim())`), consecutiveRequested)
  assert.match(await readFile(resolve('src', 'App.tsx'), 'utf8'), /The previous staff order was restored\./, 'Failed saves must retain the explicit manager-facing rollback message.')
  await cdp.evaluate(`window.fetch=window.__confirmedFetch`)
  const rosterExpected = await cdp.evaluate<string[]>(`fetch('/api/staff').then(response=>response.json()).then(staff=>staff.filter(person=>person.assignmentEligible).map(person=>person.name))`)

  await cdp.evaluate(`document.querySelector('button[aria-label="Duty Roster"]')?.click()`)
  for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.roster tbody tr')`)) break; await sleep(100) }
  const rosterSaved = await cdp.evaluate<string[]>(`Array.from(document.querySelectorAll('.roster tbody tr td:first-child b')).map(node=>node.textContent.trim())`)
  assert.deepEqual(rosterSaved, rosterExpected)
  await cdp.send('Page.reload')
  await sleep(400)
  for (let attempt = 0; attempt < 100; attempt++) { const ready = await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('button[aria-label="Duty Roster"]');if(!button)return false;if(!document.querySelector('.roster tbody tr'))button.click();return !!document.querySelector('.roster tbody tr')})()`); if (ready) break; await sleep(100) }
  assert.deepEqual(await cdp.evaluate<string[]>(`Array.from(document.querySelectorAll('.roster tbody tr td:first-child b')).map(node=>node.textContent.trim())`), rosterExpected)

  await cdp.evaluate(`(()=>{window.__rosterBatchRequests=[];window.__rosterFetch=window.fetch.bind(window);window.fetch=(input,init)=>{if(String(input).includes('/api/roster/batch'))window.__rosterBatchRequests.push({url:String(input),method:init?.method||'GET',body:init?.body});return window.__rosterFetch(input,init)}})()`)
  const drafted: Array<{ label: string; value: string }> = []
  for (let index = 0; index < 2; index++) {
    const trigger = await cdp.evaluate<any>(`(()=>{const button=Array.from(document.querySelectorAll('.roster tbody .duty-code-trigger:not(:disabled)'))[${index}];if(!button)return null;const label=button.getAttribute('aria-label');button.click();return{label}})()`)
    assert.ok(trigger?.label)
    for (let attempt = 0; attempt < 30; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.duty-code-menu [role="option"]')`)) break; await sleep(50) }
    const selected = await cdp.evaluate<string>(`(()=>{const option=Array.from(document.querySelectorAll('.duty-code-menu [role="option"]')).find(item=>item.getAttribute('aria-selected')!=='true');if(!option)return '';const value=option.querySelector('.duty-code-option-pill')?.textContent?.trim()||'';option.click();return value})()`)
    assert.ok(selected)
    drafted.push({ label: trigger.label, value: selected })
  }
  await sleep(100)
  assert.equal((await cdp.evaluate<any[]>(`window.__rosterBatchRequests`)).length, 0, 'selecting duties must not save individual assignments')
  assert.match(await cdp.evaluate<string>(`document.querySelector('.unsaved-count')?.textContent||''`), /2 unsaved/)
  assert.equal(await cdp.evaluate<boolean>(`!document.querySelector('.roster-save')?.disabled`), true)
  await cdp.evaluate(`document.querySelector('.roster-save')?.click()`)
  for (let attempt = 0; attempt < 80; attempt++) { if ((await cdp.evaluate<any[]>(`window.__rosterBatchRequests`)).length === 1 && /changes saved/i.test(await cdp.evaluate<string>(`document.querySelector('.toast')?.textContent||''`))) break; await sleep(100) }
  assert.equal((await cdp.evaluate<any[]>(`window.__rosterBatchRequests`)).length, 1)
  assert.deepEqual((await cdp.evaluate<any[]>(`window.__rosterBatchRequests`))[0].method, 'POST')
  assert.match(await cdp.evaluate<string>(`document.querySelector('.unsaved-count')?.textContent||''`), /All changes saved/)
  await cdp.send('Page.reload'); await sleep(400)
  for (let attempt = 0; attempt < 80; attempt++) { const ready = await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('button[aria-label="Duty Roster"]');if(!button)return false;if(!document.querySelector('.roster tbody .duty-code-trigger'))button.click();return !!document.querySelector('.roster tbody .duty-code-trigger')})()`); if (ready) break; await sleep(100) }
  assert.deepEqual(await cdp.evaluate<any>(`(${JSON.stringify(drafted)}).map(expected=>({label:expected.label,value:Array.from(document.querySelectorAll('.roster tbody .duty-code-trigger')).find(button=>button.getAttribute('aria-label')===expected.label)?.querySelector('span')?.textContent?.trim()}))`), drafted)
  const rosterDesktop = await cdp.evaluate<any>(`(()=>{const panel=document.querySelector('.roster-panel');const wrap=document.querySelector('.roster-scroll');const table=document.querySelector('.roster');const allHeaders=[...document.querySelectorAll('.roster thead th')];const headers=allHeaders.slice(1,-1);const cells=[...document.querySelectorAll('.roster tbody tr:first-child td')];const panelRect=panel.getBoundingClientRect();const wrapRect=wrap.getBoundingClientRect();const tableRect=table.getBoundingClientRect();return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,edgeGaps:{left:tableRect.left-panelRect.left,right:panelRect.right-tableRect.right},geometry:{panel:{left:panelRect.left,right:panelRect.right,width:panelRect.width,clientWidth:panel.clientWidth},wrap:{left:wrapRect.left,right:wrapRect.right,width:wrapRect.width,clientWidth:wrap.clientWidth,scrollWidth:wrap.scrollWidth},table:{left:tableRect.left,right:tableRect.right,width:tableRect.width}},pillCount:document.querySelectorAll('.roster .duty-code-trigger').length,actions:[...document.querySelectorAll('.roster-actions button')].map(button=>button.textContent.trim()),today:!!document.querySelector('.roster th.today'),weekdayFontSizes:headers.map(header=>parseFloat(getComputedStyle(header.querySelector('.roster-compact-weekday')).fontSize)),dateFontSizes:headers.map(header=>parseFloat(getComputedStyle(header.querySelector('.roster-compact-day')).fontSize)),monthFontSizes:headers.map(header=>parseFloat(getComputedStyle(header.querySelector('.roster-compact-month')).fontSize)),compactLines:headers.map(header=>[header.querySelector('.roster-compact-weekday').textContent.trim(),header.querySelector('.roster-compact-day').textContent.trim(),header.querySelector('.roster-compact-month').textContent.trim()]),weekdayOverflow:headers.map(header=>header.querySelector('.roster-compact-date')).some(label=>label.scrollWidth>label.clientWidth+1),columnDrift:allHeaders.map((header,index)=>Math.max(Math.abs(header.getBoundingClientRect().left-cells[index].getBoundingClientRect().left),Math.abs(header.getBoundingClientRect().width-cells[index].getBoundingClientRect().width)))}})()`)
  assert.deepEqual({ pageOverflow: rosterDesktop.pageOverflow, actions: rosterDesktop.actions, today: rosterDesktop.today }, { pageOverflow: false, actions: ['Export PDF','Save Changes'], today: true })
  assert.ok(rosterDesktop.pillCount >= rosterExpected.length * 7)
  assert.ok(rosterDesktop.weekdayFontSizes.every((size: number) => size === 21))
  assert.ok(rosterDesktop.dateFontSizes.every((size: number) => size === 13))
  assert.ok(rosterDesktop.monthFontSizes.every((size: number) => size === 12))
  assert.deepEqual(rosterDesktop.compactLines.map((lines: string[]) => lines[0]), ['SUN','MON','TUE','WED','THU','FRI','SAT'])
  assert.ok(rosterDesktop.compactLines.every((lines: string[]) => lines.length === 3 && /^\d{1,2}$/.test(lines[1]) && /^[A-Z]{3}$/.test(lines[2])))
  assert.equal(rosterDesktop.weekdayOverflow, false)
  assert.ok(rosterDesktop.edgeGaps.left <= 1.1 && rosterDesktop.edgeGaps.right <= 1.1, `weekly table edges must align with its panel: ${JSON.stringify(rosterDesktop)}`)
  assert.ok(rosterDesktop.columnDrift.every((drift: number) => drift <= 0.1))
  await screenshot(cdp, 'duty-roster-batch-desktop.png')
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const trigger=document.querySelector('.roster .duty-code-trigger:not(:disabled)');if(!trigger)return false;trigger.click();return true})()`), true)
  for (let attempt = 0; attempt < 30; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.duty-code-menu [role="option"]')`)) break; await sleep(50) }
  const desktopDropdown = await cdp.evaluate<any>(`(()=>{const menu=document.querySelector('.duty-code-menu'),options=[...document.querySelectorAll('.duty-code-menu [role="option"]')],pills=[...document.querySelectorAll('.duty-code-option-pill')];return{visible:!!menu&&menu.getBoundingClientRect().height>0,position:menu?getComputedStyle(menu).position:null,scrollable:menu?['auto','scroll'].includes(getComputedStyle(menu).overflowY):false,optionCount:options.length,unassigned:options.some(option=>/unassigned/i.test(option.textContent||'')),configuredColors:pills.every(pill=>getComputedStyle(pill).backgroundColor!=='rgba(0, 0, 0, 0)'),rounded:pills.every(pill=>parseFloat(getComputedStyle(pill).borderRadius)>=12)}})()`)
  assert.deepEqual({ visible: desktopDropdown.visible, position: desktopDropdown.position, scrollable: desktopDropdown.scrollable, unassigned: desktopDropdown.unassigned, configuredColors: desktopDropdown.configuredColors, rounded: desktopDropdown.rounded }, { visible: true, position: 'fixed', scrollable: true, unassigned: false, configuredColors: true, rounded: true })
  assert.ok(desktopDropdown.optionCount > 0)
  await screenshot(cdp, 'duty-roster-dropdown-desktop.png')
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })

  await cdp.evaluate(`Array.from(document.querySelectorAll('.duty-roster-tabs button')).find(button=>button.textContent?.trim()==='Duty Code Settings')?.click()`); await sleep(150)
  const dutyLayout = await cdp.evaluate<any>(`(()=>{const table=document.querySelector('.duty-code-table');const rows=Array.from(table.querySelectorAll('tbody tr'));const previews=Array.from(table.querySelectorAll('.duty-code-preview'));const headerCells=Array.from(table.querySelectorAll('thead th'));const cells=headerCells.map(cell=>Math.round(cell.getBoundingClientRect().width));return{headers:headerCells.map(cell=>cell.textContent.trim()),requiredRules:Array.from(table.querySelectorAll('.duty-financial-rule.required')).map(node=>node.textContent.trim()),ruleByCode:Object.fromEntries(rows.map(row=>[row.querySelector('td:nth-child(2) b')?.textContent?.trim(),row.querySelector('.duty-financial-rule')?.textContent?.trim()])),previewWidths:previews.map(node=>Math.round(node.getBoundingClientRect().width)),rowHeights:rows.map(row=>Math.round(row.getBoundingClientRect().height)),columns:cells,columnDividers:headerCells.slice(0,-1).map(cell=>getComputedStyle(cell).borderRightWidth),alternatingRows:rows.length>1&&getComputedStyle(rows[0].children[0]).backgroundColor!==getComputedStyle(rows[1].children[0]).backgroundColor,tableWidth:Math.round(table.getBoundingClientRect().width),pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
  assert.ok(dutyLayout.previewWidths.length > 0)
  assert.equal(new Set(dutyLayout.previewWidths).size, 1)
  assert.ok(dutyLayout.previewWidths.every((width: number) => width >= 90))
  assert.equal(new Set(dutyLayout.rowHeights).size, 1)
  assert.ok(dutyLayout.columns[4] >= 90, 'The compact preview column must remain readable after adding Availability.')
  assert.equal(dutyLayout.pageOverflow, false)
  assert.ok(dutyLayout.headers.includes('Bill Tip Rule'))
  assert.ok(dutyLayout.headers.includes('Availability'))
  assert.ok(dutyLayout.columnDividers.every((width: string) => width === '1px'))
  assert.equal(dutyLayout.alternatingRows, true)
  assert.ok(dutyLayout.requiredRules.includes('Decision required'))
  assert.equal(dutyLayout.ruleByCode.OFF, 'Decision required')
  assert.equal(dutyLayout.ruleByCode.EL, 'Eligible · 1 day')
  assert.equal(await cdp.evaluate<number>(`document.querySelectorAll('.duty-code-table .protected-config').length`), 0)
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const row=Array.from(document.querySelectorAll('.duty-code-table tbody tr')).find(row=>row.querySelector('td:nth-child(2) b')?.textContent?.trim()==='OFF');return !!row&&row.querySelectorAll('td:last-child button').length===1&&!!row.querySelector('button[aria-label="Edit OFF"]')&&!row.querySelector('button[aria-label="Remove OFF"]')})()`), true)
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const rows=Array.from(document.querySelectorAll('.duty-code-table tbody tr'));const off=rows.find(row=>row.querySelector('td:nth-child(2) b')?.textContent?.trim()==='OFF');const emergency=rows.find(row=>row.querySelector('td:nth-child(2) b')?.textContent?.trim()==='EL');return off?.querySelector('.duty-availability-fixed')?.textContent?.trim()==='Always enabled'&&emergency?.querySelector('.duty-availability-toggle.active')?.textContent?.trim()==='Active'})()`), true)
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const row=Array.from(document.querySelectorAll('.duty-code-table tbody tr')).find(row=>row.querySelector('td:nth-child(2) b')?.textContent?.trim()==='EL');const toggle=row?.querySelector('.duty-availability-toggle');if(!toggle)return false;toggle.click();return true})()`), true)
  for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`(()=>{const row=Array.from(document.querySelectorAll('.duty-code-table tbody tr')).find(row=>row.querySelector('td:nth-child(2) b')?.textContent?.trim()==='EL');return row?.classList.contains('is-disabled')&&row.querySelector('.duty-availability-toggle')?.textContent?.trim()==='Disabled'})()`)) break; await sleep(100) }
  assert.equal(await cdp.evaluate<boolean>(`fetch('/api/config/staff').then(response=>response.json()).then(configuration=>configuration.dutyCodes.find(option=>option.metadata?.displayCode==='EL')?.active===false)`), true)
  await screenshot(cdp, 'duty-code-settings-desktop.png')

  assert.equal(await cdp.evaluate<boolean>(`(()=>{const edit=document.querySelector('.duty-code-table button[aria-label="Edit OFF"]');if(!edit)return false;edit.click();return true})()`), true)
  for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.duty-code-form')`)) break; await sleep(100) }
  const financialEditor = await cdp.evaluate<any>(`(()=>{const form=document.querySelector('.duty-code-form');const modal=document.querySelector('.duty-code-modal');const fields=form.querySelector('.duty-code-form-fields');const labels=Array.from(form.querySelectorAll('label')).map(label=>label.firstChild?.textContent?.trim());const selects=Array.from(form.querySelectorAll('select'));const inputs=Array.from(form.querySelectorAll('input'));const style=getComputedStyle(modal);const fieldsStyle=getComputedStyle(fields);return{labels,identity:document.querySelector('.duty-code-modal-identity')?.textContent?.replace(/\s+/g,' ').trim(),identityLocked:inputs[0]?.disabled&&inputs[1]?.disabled,availabilityValue:selects[1]?.value,availabilityDisabled:selects[1]?.disabled,eligibilityValue:selects[3]?.value,workedDayValue:selects[4]?.value,workedDayDisabled:selects[4]?.disabled,actions:Array.from(form.querySelectorAll('.form-actions button')).map(button=>button.textContent?.trim()),closeButtons:modal.querySelectorAll('.close').length,bodyOverflow:document.body.style.overflow,modalOverflowX:style.overflowX,modalOverflowY:style.overflowY,fieldsOverflowX:fieldsStyle.overflowX,fieldsOverflowY:fieldsStyle.overflowY,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
  assert.ok(financialEditor.labels.includes('Bill Tip Eligibility'))
  assert.ok(financialEditor.labels.includes('Worked-Day Credit'))
  assert.ok(financialEditor.labels.includes('Roster Availability'))
  assert.deepEqual({ availabilityValue: financialEditor.availabilityValue, availabilityDisabled: financialEditor.availabilityDisabled, eligibilityValue: financialEditor.eligibilityValue, workedDayValue: financialEditor.workedDayValue, workedDayDisabled: financialEditor.workedDayDisabled, pageOverflow: financialEditor.pageOverflow }, { availabilityValue: 'active', availabilityDisabled: true, eligibilityValue: '', workedDayValue: '', workedDayDisabled: true, pageOverflow: false })
  assert.match(financialEditor.identity || '', /ProtectedOFFDay Off/i)
  assert.equal(financialEditor.identityLocked, true)
  assert.deepEqual(financialEditor.actions, ['Cancel', 'Save Duty Code'])
  assert.deepEqual({ closeButtons: financialEditor.closeButtons, bodyOverflow: financialEditor.bodyOverflow, modalOverflowX: financialEditor.modalOverflowX, modalOverflowY: financialEditor.modalOverflowY, fieldsOverflowX: financialEditor.fieldsOverflowX, fieldsOverflowY: financialEditor.fieldsOverflowY }, { closeButtons: 0, bodyOverflow: 'hidden', modalOverflowX: 'hidden', modalOverflowY: 'hidden', fieldsOverflowX: 'hidden', fieldsOverflowY: 'auto' })
  await screenshot(cdp, 'duty-code-settings-protected-modal-1440.png')
  await cdp.evaluate(`document.querySelector('.duty-code-form')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`)
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.duty-code-form')`), true)
  await cdp.evaluate(`document.querySelector('.modal-backdrop')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`)
  for (let attempt = 0; attempt < 20; attempt++) { if (!await cdp.evaluate<boolean>(`!!document.querySelector('.duty-code-form')`)) break; await sleep(50) }
  await sleep(50)
  assert.deepEqual(await cdp.evaluate<any>(`({open:!!document.querySelector('.duty-code-form'),bodyOverflow:document.body.style.overflow,focus:document.activeElement?.getAttribute('aria-label')})`), { open: false, bodyOverflow: '', focus: 'Edit OFF' })

  await cdp.evaluate(`document.querySelector('.duty-code-table button[aria-label="Edit OFF"]')?.click()`)
  for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.duty-code-form')`)) break; await sleep(50) }
  await cdp.evaluate(`(()=>{const input=document.querySelector('input[aria-label="Color hex value"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'#123456');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
  assert.deepEqual(await cdp.evaluate<any>(`({open:!!document.querySelector('.duty-code-form'),confirmOpen:!!document.querySelector('.duty-discard-confirmation'),actions:Array.from(document.querySelectorAll('.duty-discard-confirmation button')).map(button=>button.textContent?.trim()),bodyOverflow:document.body.style.overflow})`), { open: true, confirmOpen: true, actions: ['Keep Editing','Discard Changes'], bodyOverflow: 'hidden' })
  await screenshot(cdp, 'duty-code-unsaved-confirmation-desktop.png')
  await cdp.evaluate(`Array.from(document.querySelectorAll('.duty-discard-confirmation button')).find(button=>button.textContent?.trim()==='Keep Editing')?.click()`)
  assert.deepEqual(await cdp.evaluate<any>(`({open:!!document.querySelector('.duty-code-form'),confirmOpen:!!document.querySelector('.duty-discard-confirmation')})`), { open: true, confirmOpen: false })
  await cdp.evaluate(`Array.from(document.querySelectorAll('.duty-code-form .form-actions button')).find(button=>button.textContent?.trim()==='Cancel')?.click()`)
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.duty-discard-confirmation')`), true)
  await cdp.evaluate(`Array.from(document.querySelectorAll('.duty-discard-confirmation button')).find(button=>button.textContent?.trim()==='Discard Changes')?.click()`)
  for (let attempt = 0; attempt < 20; attempt++) { if (!await cdp.evaluate<boolean>(`!!document.querySelector('.duty-code-form')`)) break; await sleep(50) }
  await sleep(50)
  assert.deepEqual(await cdp.evaluate<any>(`({open:!!document.querySelector('.duty-code-form'),bodyOverflow:document.body.style.overflow,focus:document.activeElement?.getAttribute('aria-label')})`), { open: false, bodyOverflow: '', focus: 'Edit OFF' })

  const dutyCodeWidths = [1440, 1280, 1024, 768, 430, 390, 360]
  const dutyCodeResponsiveResults: Record<string, unknown> = {}
  for (const width of dutyCodeWidths) {
    const cardsExpected = width <= 800
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: cardsExpected ? 844 : 1000, deviceScaleFactor: 1, mobile: cardsExpected })
    await sleep(100)
    const layout = await cdp.evaluate<any>(`(()=>{const tableWrap=document.querySelector('.duty-code-table-wrap');const table=document.querySelector('.duty-code-table');const cards=Array.from(document.querySelectorAll('.duty-code-card'));const headers=table?Array.from(table.querySelectorAll('thead th')):[];const firstRow=table?.querySelector('tbody tr');const bodyCells=firstRow?Array.from(firstRow.querySelectorAll('td')):[];return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,tableVisible:!!tableWrap&&getComputedStyle(tableWrap).display!=='none',cardsVisible:!!document.querySelector('.duty-code-card-list')&&getComputedStyle(document.querySelector('.duty-code-card-list')).display!=='none',tableOverflow:!!tableWrap&&tableWrap.scrollWidth>tableWrap.clientWidth+1,cardOverflow:cards.some(card=>card.scrollWidth>card.clientWidth+1),columnDrift:headers.map((cell,index)=>bodyCells[index]?Math.abs(cell.getBoundingClientRect().width-bodyCells[index].getBoundingClientRect().width):0),mobileTargets:Array.from(document.querySelectorAll('.duty-code-card button')).every(button=>button.getBoundingClientRect().width>=44&&button.getBoundingClientRect().height>=44)}})()`)
    assert.equal(layout.pageOverflow, false, `Duty Code Settings overflowed the page at ${width}px.`)
    assert.equal(layout.tableVisible, !cardsExpected)
    assert.equal(layout.cardsVisible, cardsExpected)
    assert.equal(layout.cardOverflow, false)
    assert.ok(layout.columnDrift.every((drift: number) => drift <= 0.1), `Duty Code header/body drift at ${width}px: ${layout.columnDrift}`)
    if (width >= 1280) assert.equal(layout.tableOverflow, false, `Duty Code table should fit at ${width}px.`)
    if (cardsExpected) assert.equal(layout.mobileTargets, true)
    await screenshot(cdp, `duty-code-settings-premium-${width}.png`)
    assert.equal(await cdp.evaluate<boolean>(`(()=>{const edit=document.querySelector('${cardsExpected ? '.duty-code-card' : '.duty-code-table'} button[aria-label="Edit OFF"]');if(!edit)return false;edit.click();return true})()`), true)
    for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.duty-code-form')`)) break; await sleep(50) }
    const modalLayout = await cdp.evaluate<any>(`(()=>{const backdrop=document.querySelector('.modal-backdrop');const modal=document.querySelector('.duty-code-modal');const form=document.querySelector('.duty-code-form');const rect=modal.getBoundingClientRect();const footer=form.querySelector('.form-actions').getBoundingClientRect();const visibleScrollable=Array.from(backdrop.querySelectorAll('*')).filter(node=>{const style=getComputedStyle(node);return ['auto','scroll'].includes(style.overflowY)&&node.scrollHeight>node.clientHeight+1}).map(node=>node.className);return{bodyOverflow:document.body.style.overflow,closeButtons:modal.querySelectorAll('.close').length,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,modalOverflow:modal.scrollWidth>modal.clientWidth+1,modalWithinViewport:rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight+1,footerVisible:footer.left>=rect.left&&footer.right<=rect.right&&footer.bottom<=rect.bottom+1,scrollRegions:visibleScrollable}})()`)
    assert.deepEqual({ bodyOverflow: modalLayout.bodyOverflow, closeButtons: modalLayout.closeButtons, pageOverflow: modalLayout.pageOverflow, modalOverflow: modalLayout.modalOverflow, modalWithinViewport: modalLayout.modalWithinViewport, footerVisible: modalLayout.footerVisible }, { bodyOverflow: 'hidden', closeButtons: 0, pageOverflow: false, modalOverflow: false, modalWithinViewport: true, footerVisible: true }, `Duty Code modal layout failed at ${width}px.`)
    assert.ok(modalLayout.scrollRegions.filter((name: string) => String(name).includes('duty-code-form-fields')).length <= 1)
    dutyCodeResponsiveResults[String(width)] = { layout, modal: modalLayout }
    await screenshot(cdp, `duty-code-modal-responsive-${width}.png`)
    if (width <= 430) {
      await cdp.evaluate(`(()=>{const fields=document.querySelector('.duty-code-form-fields');fields.scrollTop=fields.scrollHeight})()`)
      await sleep(50)
      await screenshot(cdp, `duty-code-modal-responsive-${width}-bottom.png`)
    }
    if (width === 390) await screenshot(cdp, 'duty-code-settings-protected-modal-390.png')
    await cdp.evaluate(`document.querySelector('.modal-backdrop')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`)
    for (let attempt = 0; attempt < 20; attempt++) { if (!await cdp.evaluate<boolean>(`!!document.querySelector('.duty-code-form')`)) break; await sleep(50) }
    assert.equal(await cdp.evaluate<string>(`document.body.style.overflow`), '')
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await screenshot(cdp, 'duty-code-settings-mobile-390.png')
  await cdp.evaluate(`Array.from(document.querySelectorAll('.duty-roster-tabs button')).find(button=>button.textContent?.trim()==='Roster')?.click()`)
  for (let attempt = 0; attempt < 50; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.mobile-roster-card')`)) break; await sleep(100) }
  const rosterMobile = await cdp.evaluate<any>(`(()=>{const toolbar=document.querySelector('.roster-controls');const save=document.querySelector('.roster-save');const saveStyle=getComputedStyle(save);const period=toolbar.querySelector('.roster-period-tools');const actions=toolbar.querySelector('.roster-actions');const view=toolbar.querySelector('.roster-view-switch');const navigation=toolbar.querySelector('.roster-period-navigation');const status=toolbar.querySelector('.unsaved-count');return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,cardCount:document.querySelectorAll('.mobile-roster-card').length,pills:[...document.querySelectorAll('.mobile-roster-card .duty-code-trigger')].every(trigger=>trigger.getBoundingClientRect().width<=trigger.closest('.mobile-roster-card').getBoundingClientRect().width),actionWidths:[...document.querySelectorAll('.roster-actions button')].map(button=>Math.round(button.getBoundingClientRect().width)),toolbarWidth:Math.round(toolbar.getBoundingClientRect().width),toolbarHeight:Math.round(toolbar.getBoundingClientRect().height),childHeights:{period:Math.round(period.getBoundingClientRect().height),actions:Math.round(actions.getBoundingClientRect().height),view:Math.round(view.getBoundingClientRect().height),navigation:Math.round(navigation.getBoundingClientRect().height),status:Math.round(status.getBoundingClientRect().height)},toolbarOverflow:toolbar.scrollWidth>toolbar.clientWidth+1,saveDisabled:save.disabled,saveOpacity:saveStyle.opacity,saveBackground:saveStyle.backgroundColor}})()`)
  assert.equal(rosterMobile.pageOverflow, false)
  assert.ok(rosterMobile.cardCount >= 12)
  assert.equal(rosterMobile.pills, true)
  assert.ok(rosterMobile.actionWidths.every((width: number) => width > 100 && width < rosterMobile.toolbarWidth))
  assert.equal(new Set(rosterMobile.actionWidths).size, 1)
  assert.ok(rosterMobile.actionWidths.reduce((sum: number, width: number) => sum + width, 0) >= rosterMobile.toolbarWidth - 30)
  assert.equal(rosterMobile.toolbarOverflow, false)
  assert.equal(rosterMobile.saveDisabled, true)
  assert.equal(rosterMobile.saveOpacity, '1')
  if (rosterMobile.toolbarHeight >= 175) console.error(JSON.stringify({ rosterMobileToolbar: rosterMobile }))
  assert.ok(rosterMobile.toolbarHeight < 175)
  await screenshot(cdp, 'duty-roster-batch-mobile-390.png')
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const trigger=document.querySelector('.mobile-roster-card .duty-code-trigger:not(:disabled)');if(!trigger)return false;trigger.click();return true})()`), true)
  for (let attempt = 0; attempt < 30; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.duty-code-menu [role="option"]')`)) break; await sleep(50) }
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const menu=document.querySelector('.duty-code-menu');const options=[...menu.querySelectorAll('[role="option"]')];return !!menu&&menu.getBoundingClientRect().left>=0&&menu.getBoundingClientRect().right<=innerWidth&&!options.some(option=>/unassigned/i.test(option.textContent||''))&&!options.some(option=>option.querySelector('.duty-code-option-pill')?.textContent?.trim()==='EL')})()`), true)
  await screenshot(cdp, 'duty-roster-dropdown-mobile-390.png')
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })

  const rosterResponsiveWidths = [1440, 1280, 1024, 768, 430, 390, 360]
  const rosterResponsiveResults: Record<string, unknown> = {}
  for (const width of rosterResponsiveWidths) {
    const mobileViewport = width <= 700
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: mobileViewport ? 844 : 1000, deviceScaleFactor: 1, mobile: mobileViewport })
    await sleep(100)
    await cdp.evaluate(`(()=>{const button=Array.from(document.querySelectorAll('.roster-view-switch button')).find(button=>button.textContent?.trim()==='Weekly');button?.click()})()`)
    for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.roster-weekly')`)) break; await sleep(100) }
    await cdp.evaluate(`window.scrollTo(0,0)`)
    const weeklyResult = await cdp.evaluate<any>(`(()=>{const tabs=Array.from(document.querySelectorAll('.duty-roster-tabs button'));const activeTab=tabs.find(button=>button.classList.contains('selected'));const inactiveTab=tabs.find(button=>button!==activeTab);const toolbar=document.querySelector('.roster-controls');const controls=Array.from(toolbar.querySelectorAll('button'));const panel=document.querySelector('.roster-panel');const table=document.querySelector('.roster-weekly');const panelRect=panel?.getBoundingClientRect();const tableRect=table?.getBoundingClientRect();const cards=Array.from(document.querySelectorAll('.mobile-roster-card'));return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,tabCount:tabs.length,tabWidths:tabs.map(button=>Math.round(button.getBoundingClientRect().width)),activeTabBackground:getComputedStyle(activeTab).backgroundColor,activeTabColor:getComputedStyle(activeTab).color,inactiveTabColor:getComputedStyle(inactiveTab).color,toolbarOverflow:toolbar.scrollWidth>toolbar.clientWidth+1,allMobileTargets:!${mobileViewport}||controls.every(button=>button.getBoundingClientRect().height>=44),weekdayHeaders:table?.querySelectorAll('.roster-compact-date').length||0,edgeGaps:panelRect&&tableRect?{left:tableRect.left-panelRect.left,right:panelRect.right-tableRect.right}:null,tableContained:!table||table.closest('.roster-scroll').scrollWidth>=table.closest('.roster-scroll').clientWidth,cardCount:cards.length,cardOverflow:cards.some(card=>card.scrollWidth>card.clientWidth+1),actionWidths:Array.from(document.querySelectorAll('.roster-actions button')).map(button=>Math.round(button.getBoundingClientRect().width))}})()`)
    assert.equal(weeklyResult.pageOverflow, false, `Weekly roster overflowed the page at ${width}px.`)
    assert.equal(weeklyResult.tabCount, 2)
    assert.equal(weeklyResult.toolbarOverflow, false, `Roster command panel overflowed at ${width}px.`)
    assert.equal(weeklyResult.allMobileTargets, true)
    assert.equal(weeklyResult.activeTabBackground, 'rgb(206, 98, 51)')
    assert.equal(weeklyResult.activeTabColor, 'rgb(255, 255, 255)')
    assert.equal(weeklyResult.inactiveTabColor, 'rgb(23, 62, 84)')
    if (mobileViewport) {
      assert.equal(new Set(weeklyResult.tabWidths).size, 1, `Mobile roster navigation blocks are not equal at ${width}px.`)
      assert.ok(weeklyResult.cardCount >= 12)
      assert.equal(weeklyResult.cardOverflow, false)
      assert.equal(new Set(weeklyResult.actionWidths).size, 1, `Mobile roster actions are not equal at ${width}px.`)
    } else {
      assert.equal(weeklyResult.weekdayHeaders, 7)
      assert.ok(weeklyResult.edgeGaps.left <= 1.1 && weeklyResult.edgeGaps.right <= 1.1, `Weekly roster edges drifted at ${width}px: ${JSON.stringify(weeklyResult.edgeGaps)}`)
    }
    await screenshot(cdp, `duty-roster-premium-weekly-${width}.png`)

    const monthlyClicked = await cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('.roster-view-switch button')).find(button=>button.textContent?.trim()==='Monthly');if(!button)return false;button.click();return true})()`)
    assert.equal(monthlyClicked, true)
    for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<boolean>(`document.querySelectorAll('.roster-monthly .roster-weekday').length>=28&&!document.querySelector('.roster-controls+section.inline-state')`)) break; await sleep(100) }
    const monthlyResult = await cdp.evaluate<any>(`(()=>{const table=document.querySelector('.roster-monthly');const wrap=table?.closest('.roster-scroll');const cards=Array.from(document.querySelectorAll('.mobile-roster-card'));return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,dateHeaders:table?.querySelectorAll('.roster-weekday').length||0,containedScroll:!!wrap&&wrap.scrollWidth>wrap.clientWidth,mobileCards:cards.length,mobileCardOverflow:cards.some(card=>card.scrollWidth>card.clientWidth+1),toolbarOverflow:document.querySelector('.roster-controls').scrollWidth>document.querySelector('.roster-controls').clientWidth+1}})()`)
    assert.equal(monthlyResult.pageOverflow, false, `Monthly roster overflowed the page at ${width}px.`)
    assert.ok(monthlyResult.dateHeaders >= 28 && monthlyResult.dateHeaders <= 31, `Monthly roster did not render the full month at ${width}px.`)
    if (mobileViewport) {
      assert.ok(monthlyResult.mobileCards >= 12)
      assert.equal(monthlyResult.mobileCardOverflow, false)
    } else {
      assert.equal(monthlyResult.containedScroll, true, `Monthly roster scrolling was not contained at ${width}px.`)
    }
    assert.equal(monthlyResult.toolbarOverflow, false)
    await screenshot(cdp, `duty-roster-premium-monthly-${width}.png`)

    const weeklyClicked = await cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('.roster-view-switch button')).find(button=>button.textContent?.trim()==='Weekly');if(!button)return false;button.click();return true})()`)
    assert.equal(weeklyClicked, true)
    for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.roster-weekly')`)) break; await sleep(100) }
    if (width === 1440 || width === 390) {
      const originalPeriod = await cdp.evaluate<string>(`document.querySelector('.roster-period-label .ao-action__label')?.textContent||''`)
      await cdp.evaluate(`document.querySelector('button[aria-label="Previous Weekly"]')?.click()`)
      for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<string>(`document.querySelector('.roster-period-label .ao-action__label')?.textContent||''`) !== originalPeriod) break; await sleep(100) }
      const previousPeriod = await cdp.evaluate<string>(`document.querySelector('.roster-period-label .ao-action__label')?.textContent||''`)
      assert.notEqual(previousPeriod, originalPeriod)
      await cdp.evaluate(`document.querySelector('button[aria-label="Next Weekly"]')?.click()`)
      for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<string>(`document.querySelector('.roster-period-label .ao-action__label')?.textContent||''`) === originalPeriod) break; await sleep(100) }
      assert.equal(await cdp.evaluate<string>(`document.querySelector('.roster-period-label .ao-action__label')?.textContent||''`), originalPeriod)
    }
    rosterResponsiveResults[String(width)] = { weekly: weeklyResult, monthly: monthlyResult }
  }

  if (process.env.ANDALUCIA_ROSTER_VISUAL_ONLY !== '1') {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
    const originalBoundaryPeriod = await cdp.evaluate<string>(`document.querySelector('.roster-period-label .ao-action__label')?.textContent||''`)
    for (let week = 0; week < 10; week++) { await cdp.evaluate(`document.querySelector('button[aria-label="Next Weekly"]')?.click()`); await sleep(120) }
    const yearBoundaryHeaders = await cdp.evaluate<string[][]>(`[...document.querySelectorAll('.roster-weekly .roster-compact-date')].map(header=>[header.querySelector('.roster-compact-weekday').textContent.trim(),header.querySelector('.roster-compact-day').textContent.trim(),header.querySelector('.roster-compact-month').textContent.trim()])`)
    assert.deepEqual(yearBoundaryHeaders.map(header => header[0]), ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'])
    assert.ok(yearBoundaryHeaders.every(([, day, month]) => /^\d{1,2}$/.test(day) && /^[A-Z]{3}$/.test(month)))
    for (let week = 0; week < 10; week++) { await cdp.evaluate(`document.querySelector('button[aria-label="Previous Weekly"]')?.click()`); await sleep(120) }
    assert.equal(await cdp.evaluate<string>(`document.querySelector('.roster-period-label .ao-action__label')?.textContent||''`), originalBoundaryPeriod)
  }

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  if (process.env.ANDALUCIA_ROSTER_VISUAL_ONLY === '1') {
    assert.deepEqual(cdp.errors, [])
    console.log(JSON.stringify({ rosterOnly: true, rosterBatchRequests: 1, rosterBatchRefreshPersisted: true, rosterDesktop, rosterMobile, rosterResponsiveResults, runtimeErrors: cdp.errors.length }, null, 2))
  } else {
  await cdp.evaluate(`document.querySelector('button[aria-label="Staff Management"]')?.click()`)
  for (let attempt = 0; attempt < 50; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-mobile-card .direct-staff-drag-handle')`)) break; await sleep(100) }
  const mobile = await cdp.evaluate<any>(`(()=>{const cards=Array.from(document.querySelectorAll('.staff-mobile-card'));const handles=Array.from(document.querySelectorAll('.staff-mobile-card .direct-staff-drag-handle'));const spacings=handles.map(handle=>Math.round(handle.parentElement.querySelector('span b').getBoundingClientRect().left-handle.getBoundingClientRect().right));return{cards:cards.length,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,handles:handles.length===cards.length&&handles.every(handle=>handle.getBoundingClientRect().width>=36),spacings,modeButton:!!document.querySelector('.staff-reorder-trigger')}})()`)
  assert.deepEqual({ pageOverflow: mobile.pageOverflow, handles: mobile.handles, modeButton: mobile.modeButton }, { pageOverflow: false, handles: true, modeButton: false })
  assert.ok(mobile.spacings.every((gap: number) => gap >= 12 && gap <= 16))
  await screenshot(cdp, 'staff-direct-reorder-mobile-390.png')

  const staffCorrectionWidths = [1440, 1280, 1024, 768, 430, 390, 360]
  const staffCorrectionResults: Record<string, unknown> = {}
  const staffEditWidthMeasurements: Record<string, unknown> = {}
  for (const width of staffCorrectionWidths) {
    const mobileViewport = width <= 700
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: mobileViewport ? 844 : 1000, deviceScaleFactor: 1, mobile: mobileViewport })
    await sleep(100)
    const expanded = await cdp.evaluate<boolean>(`document.querySelector('.staff-filter-toggle')?.getAttribute('aria-expanded')==='true'`)
    if (expanded) await cdp.evaluate(`document.querySelector('.staff-filter-toggle')?.click()`)
    const result = await cdp.evaluate<any>(`(()=>{const cards=Array.from(document.querySelectorAll('.staff-mobile-card'));const visibleActions=Array.from(document.querySelectorAll('[data-staff-action]')).filter(button=>{const style=getComputedStyle(button);const rect=button.getBoundingClientRect();return style.display!=='none'&&rect.width>0&&rect.height>0});const tabs=Array.from(document.querySelectorAll('.staff-section-bar .staff-section-tabs button'));const visibleName=document.querySelector(${mobileViewport ? "'.staff-directory-page .staff-mobile-card>header b'" : "'.staff-directory-page .staff-name-cell b'"});const nameStyle=getComputedStyle(visibleName);return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,legacyActionText:visibleActions.filter(button=>/View Profile|^Edit$|^Archive$/.test(button.textContent.trim())).length,iconActions:visibleActions.length,allActionsLabelled:visibleActions.every(button=>button.getAttribute('aria-label')&&button.getAttribute('title')),allMobileTargets:!${mobileViewport}||visibleActions.every(button=>button.getBoundingClientRect().width>=44&&button.getBoundingClientRect().height>=44),filterToggleVisible:!!document.querySelector('.staff-filter-toggle')&&getComputedStyle(document.querySelector('.staff-filter-toggle')).display!=='none',filterFieldsVisible:getComputedStyle(document.querySelector('.staff-filter-fields')).display!=='none',cardHeights:cards.filter(card=>getComputedStyle(card).display!=='none').map(card=>Math.round(card.getBoundingClientRect().height)),searchHeight:Math.round(document.querySelector('[aria-label="Search staff"]').getBoundingClientRect().height),tabCount:tabs.length,tabFontSizes:tabs.map(tab=>getComputedStyle(tab).fontSize),tabFontWeights:tabs.map(tab=>getComputedStyle(tab).fontWeight),tabLabelsFit:tabs.every(tab=>tab.scrollWidth<=tab.clientWidth+1&&getComputedStyle(tab).whiteSpace==='nowrap'),nameFontSize:nameStyle.fontSize,nameFontWeight:nameStyle.fontWeight,nameColor:nameStyle.color,nameWrapped:visibleName.getClientRects().length>1}})()`)
    assert.equal(result.pageOverflow, false, `Team Directory overflowed at ${width}px.`)
    assert.equal(result.legacyActionText, 0, `Legacy text actions remain visible at ${width}px.`)
    assert.ok(result.iconActions >= 3, `Expected SVG row actions at ${width}px.`)
    assert.equal(result.allActionsLabelled, true)
    assert.equal(result.allMobileTargets, true)
    assert.equal(result.filterToggleVisible, mobileViewport)
    assert.equal(result.filterFieldsVisible, !mobileViewport)
    assert.equal(result.tabCount, 5)
    assert.deepEqual([...new Set(result.tabFontSizes)], ['12px'])
    assert.deepEqual([...new Set(result.tabFontWeights)], ['600'])
    assert.equal(result.tabLabelsFit, true)
    assert.equal(result.nameFontSize, mobileViewport ? '13.5px' : '12.6px')
    assert.equal(result.nameFontWeight, '600')
    assert.equal(result.nameColor, 'rgb(23, 61, 86)')
    assert.equal(result.nameWrapped, false)
    await screenshot(cdp, `../staff-management-typography/team-directory-after-${width}.png`)
    if (mobileViewport) {
      assert.ok(result.cardHeights.every((height: number) => height <= 205), `Staff cards remain oversized at ${width}px: ${result.cardHeights.join(', ')}`)
      assert.ok(result.searchHeight >= 44)
      await cdp.evaluate(`document.querySelector('.staff-filter-toggle')?.click()`)
      const openFilters = await cdp.evaluate<any>(`(()=>{const fields=document.querySelector('.staff-filter-fields');const controls=Array.from(fields.querySelectorAll('select'));return{expanded:document.querySelector('.staff-filter-toggle')?.getAttribute('aria-expanded')==='true',display:getComputedStyle(fields).display,controls:controls.length,allTargets:controls.every(control=>control.getBoundingClientRect().height>=44),pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
      assert.deepEqual(openFilters, { expanded: true, display: 'grid', controls: 3, allTargets: true, pageOverflow: false })
      await cdp.evaluate(`document.querySelector('.staff-filter-toggle')?.click()`)
    }
    assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('[data-staff-action="view"]')).find(node=>node.getBoundingClientRect().width>0);if(!button)return false;button.click();return true})()`), true)
    for (let attempt = 0; attempt < 30; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-profile-drawer')`)) break; await sleep(50) }
    assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.staff-profile-drawer')`), true)
    for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-profile-drawer .leave-summary-cards')&&!!document.querySelector('.staff-profile-drawer .staff-training-empty, .staff-profile-drawer .staff-training-table-wrap')`)) break; await sleep(50) }
    const profileResult = await cdp.evaluate<any>(`(()=>{const drawer=document.querySelector('.staff-profile-drawer');const scroll=document.querySelector('.staff-profile-scroll');const status=document.querySelector('.staff-profile-header .staff-status');const grid=document.querySelector('.staff-profile-grid');const leaveCards=Array.from(document.querySelectorAll('.staff-profile-drawer .leave-summary-cards article'));const period=document.querySelector('.staff-profile-drawer .leave-period-controls select');const actions=Array.from(document.querySelectorAll('.staff-profile-drawer>footer .ao-action'));const trainingTable=document.querySelector('.staff-training-table-wrap');const trainingCards=document.querySelector('.staff-training-mobile-cards');return{drawerWidth:Math.round(drawer.getBoundingClientRect().width),drawerOverflowX:getComputedStyle(drawer).overflowX,drawerOverflowY:getComputedStyle(drawer).overflowY,scrollOverflowX:getComputedStyle(scroll).overflowX,scrollOverflowY:getComputedStyle(scroll).overflowY,scrollTop:Math.round(scroll.scrollTop),internalOverflow:drawer.scrollWidth>drawer.clientWidth+1||scroll.scrollWidth>scroll.clientWidth+1,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,statusWidth:Math.round(status.getBoundingClientRect().width),statusText:status.textContent.trim(),employeeIdVisible:/AND-001/.test(document.querySelector('.staff-profile-meta').textContent),employmentColumns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,leaveCardHeightDrift:Math.max(...leaveCards.map(card=>Math.round(card.getBoundingClientRect().height)))-Math.min(...leaveCards.map(card=>Math.round(card.getBoundingClientRect().height))),periodHeight:Math.round(period.getBoundingClientRect().height),trainingTableVisible:!!trainingTable&&getComputedStyle(trainingTable).display!=='none',trainingCardsVisible:!!trainingCards&&getComputedStyle(trainingCards).display!=='none',trainingEmpty:!!document.querySelector('.staff-profile-drawer .staff-training-empty'),actions:actions.map(action=>({text:action.textContent.trim(),width:Math.round(action.getBoundingClientRect().width),height:Math.round(action.getBoundingClientRect().height)})),closeLabel:document.querySelector('.staff-profile-header .close')?.getAttribute('aria-label')}})()`)
    assert.equal(profileResult.pageOverflow, false, `Staff Profile caused page overflow at ${width}px.`)
    assert.equal(profileResult.internalOverflow, false, `Staff Profile caused internal horizontal overflow at ${width}px.`)
    assert.equal(profileResult.drawerOverflowX, 'hidden')
    assert.equal(profileResult.drawerOverflowY, 'hidden')
    assert.equal(profileResult.scrollOverflowX, 'hidden')
    assert.equal(profileResult.scrollOverflowY, 'auto')
    assert.equal(profileResult.scrollTop, 0)
    assert.ok(profileResult.drawerWidth <= Math.min(width, 660))
    if (mobileViewport) assert.equal(profileResult.drawerWidth, width)
    assert.ok(profileResult.statusWidth < 170)
    assert.equal(profileResult.statusText, 'Active')
    assert.equal(profileResult.employeeIdVisible, true)
    assert.equal(profileResult.employmentColumns, mobileViewport ? 1 : 2)
    assert.ok(profileResult.leaveCardHeightDrift <= 1)
    assert.ok(!mobileViewport || profileResult.periodHeight >= 44)
    assert.ok(profileResult.trainingEmpty || (mobileViewport ? profileResult.trainingCardsVisible : profileResult.trainingTableVisible))
    assert.deepEqual(profileResult.actions.map((action: any) => action.text), ['Edit Staff', 'Archive Staff'])
    assert.ok(!mobileViewport || profileResult.actions.every((action: any) => action.height >= 44))
    assert.equal(profileResult.closeLabel, undefined)
    await screenshot(cdp, `../staff-profile-premium/staff-profile-${width}.png`)
    await cdp.evaluate(`document.querySelector('.staff-profile-drawer')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`)
    assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.staff-profile-drawer')`), true, 'Inside profile interactions must not dismiss the drawer.')
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    for (let attempt = 0; attempt < 20; attempt++) { if (!await cdp.evaluate<boolean>(`!!document.querySelector('.staff-profile-drawer')`)) break; await sleep(50) }
    assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.staff-profile-drawer')`), false)
    assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('[data-staff-action="edit"]')).find(node=>node.getBoundingClientRect().width>0);if(!button)return false;button.click();return true})()`), true)
    for (let attempt = 0; attempt < 30; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-profile-form')`)) break; await sleep(50) }
    assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.staff-profile-form')`), true)
    const editSpacingMeasure = `(()=>{const modal=document.querySelector('.staff-edit-modal');const scroll=document.querySelector('.staff-edit-scroll');const form=document.querySelector('.staff-profile-form');const section=document.querySelector('.staff-edit-section');const grid=document.querySelector('.staff-edit-grid');const input=document.querySelector('.staff-edit-grid input');const footer=form.querySelector('.form-actions');const rect=modal.getBoundingClientRect();const actions=Array.from(form.querySelectorAll('.form-actions .ao-action'));const scrollStyle=getComputedStyle(scroll);const sectionStyle=getComputedStyle(section);const gridStyle=getComputedStyle(grid);const inputStyle=getComputedStyle(input);const fieldWidths=Array.from(grid.querySelectorAll('input,select,.ao-date-control')).map(field=>Math.round(field.getBoundingClientRect().width));return{modalWidth:Math.round(rect.width),modalLeft:Math.round(rect.left),modalRight:Math.round(rect.right),fieldWidths,gridColumns:gridStyle.gridTemplateColumns,modalHeight:Math.round(rect.height),formHeight:Math.round(form.getBoundingClientRect().height),scrollHeight:scroll.scrollHeight,scrollClientHeight:scroll.clientHeight,sectionHeights:Array.from(document.querySelectorAll('.staff-edit-section')).map(item=>Math.round(item.getBoundingClientRect().height)),scrollPadding:scrollStyle.padding,sectionPadding:sectionStyle.padding,sectionMarginBottom:sectionStyle.marginBottom,rowGap:gridStyle.rowGap,labelInputGap:inputStyle.marginTop,inputHeight:Math.round(input.getBoundingClientRect().height),footerHeight:Math.round(footer.getBoundingClientRect().height),closeButtons:modal.querySelectorAll('.close').length,bodyOverflow:document.body.style.overflow,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,internalOverflow:modal.scrollWidth>modal.clientWidth+1||scroll.scrollWidth>scroll.clientWidth+1,modalWithinViewport:rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight+1,scrollOverflowY:scrollStyle.overflowY,scrollRegions:Array.from(modal.querySelectorAll('*')).filter(node=>['auto','scroll'].includes(getComputedStyle(node).overflowY)&&node.scrollHeight>node.clientHeight+1).length,columns:gridStyle.gridTemplateColumns.split(' ').length,actions:actions.map(action=>({text:action.textContent.trim(),height:Math.round(action.getBoundingClientRect().height)}))}})()`
    await cdp.evaluate(`(()=>{const style=document.createElement('style');style.id='staff-edit-spacing-baseline';style.textContent='.staff-edit-scroll{padding:16px 20px}.staff-edit-section{margin-bottom:12px;padding:14px}.staff-edit-section>.eyebrow{margin-bottom:11px}.staff-edit-grid{row-gap:11px}.staff-edit-grid :is(input,select){margin-top:5px}.staff-edit-grid .ao-date-control{margin-top:5px}.staff-edit-modal .form-actions{padding:12px 20px}@media(max-width:700px){.staff-edit-scroll{padding:11px}.staff-edit-section{margin-bottom:10px;padding:11px}.staff-edit-section>.eyebrow{margin-bottom:11px}.staff-edit-grid{row-gap:9px}.staff-edit-modal .form-actions{padding:10px 11px}}';document.head.append(style)})()`)
    const editBeforeSpacing = await cdp.evaluate<any>(editSpacingMeasure)
    await screenshot(cdp, `../staff-profile-premium/staff-edit-spacing-before-${width}.png`)
    await cdp.evaluate(`document.querySelector('#staff-edit-spacing-baseline')?.remove()`)
    await sleep(50)
    const editResult = await cdp.evaluate<any>(editSpacingMeasure)
    assert.deepEqual({ closeButtons: editResult.closeButtons, bodyOverflow: editResult.bodyOverflow, pageOverflow: editResult.pageOverflow, internalOverflow: editResult.internalOverflow, modalWithinViewport: editResult.modalWithinViewport, scrollOverflowY: editResult.scrollOverflowY }, { closeButtons: 0, bodyOverflow: 'hidden', pageOverflow: false, internalOverflow: false, modalWithinViewport: true, scrollOverflowY: 'auto' })
    assert.ok(editResult.scrollRegions <= 1)
    assert.equal(editResult.columns, mobileViewport ? 1 : 2)
    assert.ok(editResult.scrollHeight < editBeforeSpacing.scrollHeight, `Edit Staff content did not become more compact at ${width}px.`)
    assert.deepEqual(editResult.actions.map((action: any) => action.text), ['Cancel', 'Save staff member'])
    assert.ok(!mobileViewport || editResult.actions.every((action: any) => action.height >= 44))
    let editBeforeWidth: any = null
    if (width === 1440 || width === 1280) {
      await cdp.evaluate(`(()=>{const style=document.createElement('style');style.id='staff-edit-width-baseline';style.textContent='@media(min-width:701px){.staff-edit-modal{width:min(800px,calc(100vw - 32px))}}';document.head.append(style)})()`)
      await sleep(50)
      editBeforeWidth = await cdp.evaluate<any>(editSpacingMeasure)
      await screenshot(cdp, `../staff-profile-premium/staff-edit-width-before-${width}.png`)
      await cdp.evaluate(`document.querySelector('#staff-edit-width-baseline')?.remove()`)
      await sleep(50)
      const editAfterWidth = await cdp.evaluate<any>(editSpacingMeasure)
      assert.equal(editBeforeWidth.modalWidth, 800)
      assert.equal(editAfterWidth.modalWidth, 740)
      assert.ok(editAfterWidth.fieldWidths.every((fieldWidth: number) => fieldWidth > 0))
      assert.ok(editAfterWidth.fieldWidths.every((fieldWidth: number, index: number) => fieldWidth <= editBeforeWidth.fieldWidths[index]))
      assert.equal(Math.abs(editAfterWidth.modalLeft - (width - editAfterWidth.modalRight)), 0)
      assert.deepEqual({ modalHeight: editAfterWidth.modalHeight, formHeight: editAfterWidth.formHeight, scrollHeight: editAfterWidth.scrollHeight, scrollClientHeight: editAfterWidth.scrollClientHeight, sectionHeights: editAfterWidth.sectionHeights, scrollPadding: editAfterWidth.scrollPadding, sectionPadding: editAfterWidth.sectionPadding, sectionMarginBottom: editAfterWidth.sectionMarginBottom, rowGap: editAfterWidth.rowGap, labelInputGap: editAfterWidth.labelInputGap, inputHeight: editAfterWidth.inputHeight, footerHeight: editAfterWidth.footerHeight }, { modalHeight: editBeforeWidth.modalHeight, formHeight: editBeforeWidth.formHeight, scrollHeight: editBeforeWidth.scrollHeight, scrollClientHeight: editBeforeWidth.scrollClientHeight, sectionHeights: editBeforeWidth.sectionHeights, scrollPadding: editBeforeWidth.scrollPadding, sectionPadding: editBeforeWidth.sectionPadding, sectionMarginBottom: editBeforeWidth.sectionMarginBottom, rowGap: editBeforeWidth.rowGap, labelInputGap: editBeforeWidth.labelInputGap, inputHeight: editBeforeWidth.inputHeight, footerHeight: editBeforeWidth.footerHeight })
      staffEditWidthMeasurements[String(width)] = { before: editBeforeWidth, after: editAfterWidth }
    }
    await screenshot(cdp, `../staff-profile-premium/staff-edit-${width}.png`)
    if (width === 390) {
      await cdp.evaluate(`(()=>{const input=document.querySelector('.staff-edit-modal input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,input.value+'X');input.dispatchEvent(new Event('input',{bubbles:true}));window.__staffConfirmCalls=0;window.confirm=()=>{window.__staffConfirmCalls+=1;return false}})()`)
      await cdp.evaluate(`document.querySelector('.modal-backdrop')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`)
      assert.deepEqual(await cdp.evaluate<any>(`({open:!!document.querySelector('.staff-edit-modal'),confirmCalls:window.__staffConfirmCalls})`), { open: true, confirmCalls: 1 })
      await cdp.evaluate(`Array.from(document.querySelectorAll('.staff-edit-modal .form-actions button')).find(button=>button.textContent?.trim()==='Cancel')?.click()`)
      assert.deepEqual(await cdp.evaluate<any>(`({open:!!document.querySelector('.staff-edit-modal'),confirmCalls:window.__staffConfirmCalls})`), { open: true, confirmCalls: 2 })
      await cdp.evaluate(`window.confirm=()=>true`)
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    } else await cdp.evaluate(`document.querySelector('.modal-backdrop')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`)
    for (let attempt = 0; attempt < 20; attempt++) { if (!await cdp.evaluate<boolean>(`!!document.querySelector('.staff-edit-modal')`)) break; await sleep(50) }
    assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.staff-edit-modal')`), false)
    staffCorrectionResults[String(width)] = { ...result, profile: profileResult, editBeforeSpacing, editBeforeWidth, edit: editResult, editHeightReduction: editBeforeSpacing.scrollHeight - editResult.scrollHeight }
    await screenshot(cdp, `../staff-management-final-polish/team-directory-after-${width}.png`)
    await screenshot(cdp, `../staff-management-navigation-polish/navigation-after-${width}.png`)
  }
  await mkdir(resolve('artifacts', 'staff-profile-premium'), { recursive: true })
  await writeFile(resolve('artifacts', 'staff-profile-premium', 'staff-edit-width-measurements.json'), JSON.stringify(staffEditWidthMeasurements, null, 2))

  const accountFixture = await cdp.evaluate<any>(`(async()=>{const staff=await fetch('/api/staff').then(response=>response.json());const person=staff.find(item=>item.name==='DODON');if(!person)throw new Error('DODON fixture staff missing');const response=await fetch('/api/staff-accounts/'+encodeURIComponent(person.id),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:'visual.active.account'})});return{status:response.status,ok:response.ok}})()`)
  assert.deepEqual(accountFixture, { status: 201, ok: true })
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.staff-section-add')`), true, 'Add Staff Member must remain visible in Team Directory.')

  const leavePlannerFixture = await cdp.evaluate<any>(`(async()=>{const [staff,configuration,roster]=await Promise.all([fetch('/api/staff').then(response=>response.json()),fetch('/api/config/staff').then(response=>response.json()),fetch('/api/roster?start=2026-10-20&end=2026-10-29').then(response=>response.json())]);const people=['DODON','GURI'].map(name=>staff.find(person=>person.name===name)).filter(Boolean);const code=classification=>configuration.dutyCodes.find(option=>option.metadata?.dutyClassification===classification)?.value;if(people.length<2||!code('annualLeave')||!code('off')||!code('emergencyLeave'))throw new Error('Leave Planner visual fixture prerequisites missing');const changes=[{staffId:people[0].id,date:'2026-10-20',dutyCode:code('annualLeave')},{staffId:people[0].id,date:'2026-10-21',dutyCode:code('off')},{staffId:people[1].id,date:'2026-10-22',dutyCode:code('emergencyLeave')}].map(change=>({...change,expectedUpdatedAt:roster.find(entry=>entry.staffId===change.staffId&&entry.date===change.date)?.updatedAt||null}));const rosterResponse=await fetch('/api/roster/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({changes})});const plannedResponse=await fetch('/api/workforce/planned-leave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({staffId:people[0].id,startDate:'2026-10-28',endDate:'2026-10-29',leaveType:'annual_leave',managerNote:'Isolated visual validation'})});return{rosterStatus:rosterResponse.status,plannedStatus:plannedResponse.status,plannedError:plannedResponse.ok?null:await plannedResponse.text()}})()`)
  assert.deepEqual(leavePlannerFixture, { rosterStatus: 200, plannedStatus: 201, plannedError: null })

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  const keyboardBefore = await cdp.evaluate<string[]>(`Array.from(document.querySelectorAll('.staff-table tbody tr .staff-name-cell b')).map(node=>node.textContent.trim())`)
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const handle=document.querySelector('.staff-table .direct-staff-drag-handle');if(!handle)return false;handle.focus();handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));return document.activeElement===handle})()`), true)
  for (let attempt = 0; attempt < 80; attempt++) { const current = await cdp.evaluate<string[]>(`fetch('/api/staff').then(response=>response.json()).then(staff=>staff.map(person=>person.name))`); if (JSON.stringify(current) !== JSON.stringify(keyboardBefore)) break; await sleep(100) }
  const keyboardAfter = await cdp.evaluate<string[]>(`fetch('/api/staff').then(response=>response.json()).then(staff=>staff.map(person=>person.name))`)
  assert.notDeepEqual(keyboardAfter, keyboardBefore, 'Keyboard Arrow Down must persist a changed staff order.')

  const staffSubmodules = [
    { label: 'Leave Planner', selector: '.leave-planner-shell', slug: 'leave-planner' },
    { label: 'Timesheets', selector: '.manager-timesheets', slug: 'timesheets' },
    { label: 'Team Membership', selector: '.team-membership-page', slug: 'team-membership' },
    { label: 'Account Management', selector: '.staff-account-panel', slug: 'account-management' }
  ]
  const captureStaffSubmodules = async (width: number) => {
    const mobileViewport = width <= 390
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: mobileViewport ? 844 : 1000, deviceScaleFactor: 1, mobile: mobileViewport })
    await cdp.evaluate(`document.querySelector('.app-sidebar.mobile-open .drawer-close')?.click();window.scrollTo({top:0,left:0,behavior:'instant'})`)
    await cdp.evaluate(`document.querySelector('.toast [aria-label="Dismiss notification"]')?.click()`)
    const measurements: Record<string, unknown> = {}
    for (const module of staffSubmodules) {
      const accountModule = module.slug === 'account-management'
      const clicked = await cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('.staff-section-tabs button')).find(button=>button.textContent?.trim()===${JSON.stringify(module.label)});if(!button)return false;button.click();return true})()`)
      assert.equal(clicked, true, `${module.label} tab must remain directly accessible.`)
      for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(module.selector)})`)) break; await sleep(100) }
      for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`(()=>{const root=document.querySelector(${JSON.stringify(module.selector)});return !!root&&!/Loading (monthly timesheets|employee accounts|team membership|confirmed roster)/i.test(root.textContent||'')})()`)) break; await sleep(100) }
      if (module.slug === 'team-membership' && (width === 1440 || width === 390)) {
        await cdp.evaluate(`(()=>{const style=document.createElement('style');style.id='membership-before-spacing';style.textContent='.team-membership-page{gap:${width <= 700 ? 11 : 16}px}.team-membership-page>.panel,.team-membership-page>.staff-module-info{margin-bottom:20px}.membership-approved-banner{gap:15px;padding:${width <= 700 ? '14px' : '18px 20px'}}.membership-review-card>header{padding:${width <= 700 ? '15px' : '20px 22px'}}.membership-table.approved-table{min-width:1080px}';document.head.append(style)})()`)
        await screenshot(cdp, `../team-membership-spacing-polish/before-${width}.png`)
        await cdp.evaluate(`document.querySelector('#membership-before-spacing')?.remove();window.scrollTo(0,0)`)
        await sleep(50)
      }
      const result = await cdp.evaluate<any>(`(()=>{const root=document.querySelector(${JSON.stringify(module.selector)});const actions=Array.from(root?.querySelectorAll('button,.ao-date-control input')||[]).filter(node=>{const style=getComputedStyle(node);return style.display!=='none'&&style.visibility!=='hidden'});const table=root?.querySelector('table');const headerElements=table?Array.from(table.querySelectorAll('thead th')):[];const cellElements=table?Array.from(table.querySelectorAll('tbody tr:first-child td')):[];const headers=headerElements.map(node=>node.getBoundingClientRect());const cells=cellElements.map(node=>node.getBoundingClientRect());const columnDrift=headers.length===cells.length?headers.map((header,index)=>Math.max(Math.abs(header.left-cells[index].left),Math.abs(header.width-cells[index].width))):[];const date=root?.querySelector('.ao-date-control input');const dateStyle=date instanceof Element?getComputedStyle(date):null;const nav=document.querySelector('.staff-section-tabs');const tabs=nav?Array.from(nav.querySelectorAll('button')):[];const tabRects=tabs.map(tab=>tab.getBoundingClientRect());const tabGaps=tabRects.slice(1).map((rect,index)=>Math.round(rect.left-tabRects[index].right));const selectedTab=tabs.find(tab=>tab.classList.contains('selected'));const inactiveTab=tabs.find(tab=>tab!==selectedTab);const accountRows=${accountModule}?Array.from(root?.querySelectorAll('tbody tr')||[]):[];const accountActions=accountRows.map(row=>Array.from(row.querySelectorAll('.staff-account-actions button')).map(button=>button.getBoundingClientRect()));const membershipBanner=root?.querySelector('.membership-approved-banner');const membershipTableWrap=root?.querySelector('.membership-table-wrap');const overflowers=Array.from(document.querySelectorAll('body *')).map(node=>({node,rect:node.getBoundingClientRect()})).filter(item=>item.rect.right>innerWidth+1||item.rect.left<-1).slice(0,12).map(item=>({tag:item.node.tagName,class:String(item.node.className||''),right:Math.round(item.rect.right),left:Math.round(item.rect.left),width:Math.round(item.rect.width)}));return{rendered:!!root,loaded:!/Loading /i.test(root?.textContent||''),pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,overflowers,rootOverflow:root?root.scrollWidth>root.clientWidth+1:false,navOverflow:nav?nav.scrollWidth>nav.clientWidth+1:false,tabCount:tabs.length,tabLabels:tabs.map(tab=>tab.textContent.trim()),tabHeights:tabRects.map(rect=>Math.round(rect.height)),tabGaps,tabLabelsUnclipped:tabs.every(tab=>tab.scrollWidth<=tab.clientWidth+1),tabKeyboardFocusable:tabs.every(tab=>tab.tabIndex>=0),addStaffVisible:!!document.querySelector('.staff-section-add'),activeTabBackground:selectedTab instanceof Element?getComputedStyle(selectedTab).backgroundColor:null,inactiveTabBackground:inactiveTab instanceof Element?getComputedStyle(inactiveTab).backgroundColor:null,headerCount:headers.length,bodyCellCount:cells.length,maxColumnDrift:columnDrift.length?Math.max(...columnDrift):null,bodyFontSize:cellElements[0] instanceof Element?parseFloat(getComputedStyle(cellElements[0]).fontSize):null,datePaddingRight:dateStyle?parseFloat(dateStyle.paddingRight):null,dateIconWidth:root?.querySelector('.ao-date-control__icon')?.getBoundingClientRect().width||null,membershipSpacing:membershipBanner?{pageGap:parseFloat(getComputedStyle(root).rowGap),bannerPaddingTop:parseFloat(getComputedStyle(membershipBanner).paddingTop),tableOverflow:membershipTableWrap.scrollWidth>membershipTableWrap.clientWidth+1,guidanceLast:root.lastElementChild?.classList.contains('staff-module-info'),approved:!!root.querySelector('.membership-status.approved')}:null,accountStatuses:${accountModule}?accountRows.map(row=>row.textContent):[],accountActionsSingleLine:${!accountModule}||accountActions.every(rects=>rects.length<2||new Set(rects.map(rect=>Math.round(rect.top))).size===1),accountActionOverflow:${accountModule}&&Array.from(root?.querySelectorAll('.staff-account-actions')||[]).some(node=>node.scrollWidth>node.clientWidth+1),smallTargets:actions.filter(node=>node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height<44).map(node=>({text:node.textContent?.trim()||node.getAttribute('aria-label'),height:Math.round(node.getBoundingClientRect().height)}))}})()`)
      assert.equal(result.rendered, true)
      assert.equal(result.loaded, true, `${module.label} did not finish loading at ${width}px.`)
      assert.equal(result.pageOverflow, false, `${module.label} caused page-level overflow at ${width}px: ${JSON.stringify(result.overflowers)}`)
      if (result.maxColumnDrift !== null) assert.ok(result.maxColumnDrift <= 1, `${module.label} header/body column drift is ${result.maxColumnDrift}px at ${width}px.`)
      assert.equal(result.tabCount, 5)
      assert.deepEqual(result.tabLabels, ['Team Directory', 'Leave Planner', 'Timesheets', 'Team Membership', 'Account Management'])
      assert.ok(result.tabHeights.every((height: number) => height >= (width <= 700 ? 48 : 52)), `${module.label} has an undersized tab at ${width}px.`)
      assert.ok(result.tabGaps.every((gap: number) => gap >= 10), `${module.label} tabs are visually connected at ${width}px.`)
      assert.equal(result.tabLabelsUnclipped, true)
      assert.equal(result.tabKeyboardFocusable, true)
      assert.equal(result.addStaffVisible, false, `Add Staff Member must be hidden outside Team Directory at ${width}px.`)
      assert.equal(result.activeTabBackground, 'rgb(23, 61, 86)')
      assert.equal(result.inactiveTabBackground, 'rgb(255, 255, 255)')
      if (module.slug === 'team-membership') { assert.ok(result.datePaddingRight >= 44); assert.ok(result.dateIconWidth >= 18) }
      if (module.slug === 'team-membership') {
        assert.equal(result.membershipSpacing.approved, true)
        assert.equal(result.membershipSpacing.pageGap, width <= 700 ? 16 : 20)
        assert.equal(result.membershipSpacing.bannerPaddingTop, width <= 700 ? 13 : 16)
        assert.equal(result.membershipSpacing.tableOverflow, false)
        assert.equal(result.membershipSpacing.guidanceLast, true)
        const calendarHeader = await cdp.evaluate<any>(`(()=>{const root=document.querySelector('.team-membership-page');const header=root?.querySelector('.membership-intro');const actions=header?.querySelector('.membership-intro-actions');const month=actions?.querySelector('.membership-month-control');return{headerApprovedBadge:!!header?.querySelector('.membership-status.approved'),remainingApprovedBadges:root?.querySelectorAll('.membership-status.approved').length||0,rightGap:header&&actions?Math.round(header.getBoundingClientRect().right-actions.getBoundingClientRect().right):null,monthWidth:month?Math.round(month.getBoundingClientRect().width):null}})()`)
        assert.equal(calendarHeader.headerApprovedBadge, false)
        assert.ok(calendarHeader.remainingApprovedBadges > 0, 'Approved indicators outside the month header must remain visible.')
        assert.ok(calendarHeader.rightGap !== null && Math.abs(calendarHeader.rightGap) <= 1, `Membership month control is not right-aligned at ${width}px.`)
        assert.ok(calendarHeader.monthWidth >= 174 && calendarHeader.monthWidth <= (width <= 700 ? 270 : 300))
      }
      if (module.slug === 'account-management') {
        assert.equal(result.headerCount, 6)
        assert.equal(result.bodyCellCount, 6)
        assert.equal(result.maxColumnDrift, 0)
        assert.ok(result.bodyFontSize >= 15 && result.bodyFontSize <= 16)
        assert.equal(result.accountActionsSingleLine, true)
        assert.equal(result.accountActionOverflow, false)
        assert.ok(result.accountStatuses.some((text: string) => /visual\.active\.account/i.test(text) && /Reset Password/i.test(text) && /Disable/i.test(text)), 'Active account actions must render together.')
        assert.ok(result.accountStatuses.some((text: string) => /No account/i.test(text) && /Create Account/i.test(text)), 'No-account state must remain available.')
      }
      if (mobileViewport) { const undersized = result.smallTargets.filter((item: any) => !/Included|Excluded|Planner|Leave History|Team Directory|Timesheets|Team Membership|Account Management/.test(item.text || '')); assert.equal(undersized.length, 0, `${module.label} has undersized mobile action targets: ${JSON.stringify(undersized)}`) }
      if (module.slug === 'leave-planner') {
        const planner = await cdp.evaluate<any>(`(async()=>{const root=document.querySelector('.leave-planner-panel');const wrap=root.querySelector('.leave-planner-grid-wrap');const table=root.querySelector('.leave-planner-grid');const dayHeaders=Array.from(table.querySelectorAll('thead th:not(.identity)'));const firstDayCells=Array.from(table.querySelectorAll('tbody tr:first-child td:not(.identity)'));const summaryCards=Array.from(root.querySelectorAll('.leave-summary-grid>.leave-summary-card'));const detailButtons=Array.from(root.querySelectorAll('.leave-category-details button'));const controls=Array.from(root.querySelectorAll('button,select,input')).filter(node=>getComputedStyle(node).display!=='none');const staffCell=table.querySelector('tbody th.staff');const booked=Array.from(table.querySelectorAll('.leave-day-code.booked'));const confirmed=Array.from(table.querySelectorAll('.leave-day-code:not(.booked)'));const config=await fetch('/api/config/staff').then(response=>response.json());const colorByCode=Object.fromEntries(config.dutyCodes.map(option=>[option.metadata?.displayCode||option.value,option.color]));const colorParity=confirmed.every(node=>getComputedStyle(node).backgroundColor===(()=>{const value=colorByCode[node.textContent.trim()];if(!value)return getComputedStyle(node).backgroundColor;const hex=value.replace('#','');return 'rgb('+[0,2,4].map(index=>parseInt(hex.slice(index,index+2),16)).join(', ')+')'})());const primary=Object.fromEntries(summaryCards.map(card=>[card.querySelector('span').textContent.trim(),Number(card.querySelector('b').textContent)]));const details=Object.fromEntries(detailButtons.map(button=>[button.querySelector('span').textContent.trim(),Number(button.querySelector('b').textContent)]));const otherTotal=Object.values(details).reduce((sum,value)=>sum+value,0);const dateDrift=dayHeaders.map((header,index)=>firstDayCells[index]?Math.max(Math.abs(header.getBoundingClientRect().left-firstDayCells[index].getBoundingClientRect().left),Math.abs(header.getBoundingClientRect().width-firstDayCells[index].getBoundingClientRect().width)):999);return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,primaryLabels:summaryCards.map(card=>card.querySelector('span').textContent.trim()),primary,detailCount:detailButtons.length,otherTotal,gridVisible:getComputedStyle(wrap).display!=='none',mobileCardsVisible:getComputedStyle(root.querySelector('.leave-planner-mobile')).display!=='none',containedScroll:wrap.scrollWidth>wrap.clientWidth,wrapOverflowX:getComputedStyle(wrap).overflowX,stickyStaff:getComputedStyle(staffCell).position,staffMetaVisible:getComputedStyle(staffCell.querySelector('.leave-staff-meta')).display!=='none',dayColumns:dayHeaders.length,dateDrift,colorParity,confirmedCount:confirmed.length,bookedCount:booked.length,bookedDashed:booked.every(node=>getComputedStyle(node).borderStyle==='dashed'),todayOutlined:!!table.querySelector('thead th.today'),availabilityCells:table.querySelectorAll('tfoot td:not(.identity)').length,monthType:root.querySelector('.leave-month-navigation input')?.type,calendarIcon:!!root.querySelector('.leave-month-navigation .ao-date-control__icon'),allMobileTargets:!${width <= 700}||controls.every(node=>node.getBoundingClientRect().height>=44)}})()`)
        assert.deepEqual(planner.primaryLabels, ['Annual Leave', 'Day Off', 'Booked / Future Leave', 'Other Leave'])
        assert.equal(planner.detailCount, 8)
        assert.equal(planner.primary['Other Leave'], planner.otherTotal)
        assert.equal(planner.primary['Booked / Future Leave'], 2)
        assert.deepEqual({ gridVisible: planner.gridVisible, mobileCardsVisible: planner.mobileCardsVisible, colorParity: planner.colorParity, bookedDashed: planner.bookedDashed, todayOutlined: planner.todayOutlined, monthType: planner.monthType, calendarIcon: planner.calendarIcon, pageOverflow: planner.pageOverflow }, { gridVisible: true, mobileCardsVisible: false, colorParity: true, bookedDashed: true, todayOutlined: true, monthType: 'month', calendarIcon: true, pageOverflow: false })
        assert.ok(planner.confirmedCount >= 3)
        assert.ok(planner.bookedCount >= 2)
        assert.equal(planner.dayColumns, 31)
        assert.equal(planner.availabilityCells, 31)
        assert.ok(planner.dateDrift.every((drift: number) => drift <= 0.1), `Leave Planner calendar drift at ${width}px: ${planner.dateDrift}`)
        assert.equal(planner.stickyStaff, 'sticky')
        assert.equal(planner.staffMetaVisible, width <= 700)
        assert.equal(planner.allMobileTargets, true)
        if (width <= 700) assert.equal(planner.containedScroll, true)
        if (width === 1440) {
          const monthNavigation = await cdp.evaluate<any>(`(async()=>{const input=document.querySelector('.leave-month-navigation input');const initial=input.value;document.querySelector('button[aria-label="Next month"]').click();for(let attempt=0;attempt<80&&input.value===initial;attempt++)await new Promise(done=>setTimeout(done,50));const next=input.value;document.querySelector('button[aria-label="Previous month"]').click();for(let attempt=0;attempt<80&&input.value!==initial;attempt++)await new Promise(done=>setTimeout(done,50));const restored=input.value;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'2026-09');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));for(let attempt=0;attempt<80&&input.value!=='2026-09';attempt++)await new Promise(done=>setTimeout(done,50));const direct=input.value;setter.call(input,initial);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));for(let attempt=0;attempt<80&&(!document.querySelector('.leave-summary-section')||input.value!==initial);attempt++)await new Promise(done=>setTimeout(done,50));return{initial,next,restored,direct,final:input.value}})()`)
          assert.deepEqual(monthNavigation, { initial: '2026-10', next: '2026-11', restored: '2026-10', direct: '2026-09', final: '2026-10' })
        }
        measurements['leave-planner-l1'] = planner
        await screenshot(cdp, `../leave-planner-l1/after-${width}.png`)
      }
      measurements[module.slug] = result
      await screenshot(cdp, `../staff-management-final-polish/${module.slug}-after-${width}.png`)
      if (module.slug === 'team-membership') {
        await cdp.evaluate(`window.scrollTo({top:0,left:0,behavior:'instant'})`)
        await sleep(80)
        await screenshot(cdp, `../team-membership-spacing-polish/after-${width}.png`)
      }
      if (module.slug === 'account-management') await screenshot(cdp, `../staff-management-navigation-polish/account-after-${width}.png`)
      if (module.slug === 'account-management' && (width === 1440 || width === 390)) {
        await cdp.evaluate(`document.querySelector('.staff-account-guidance')?.scrollIntoView({block:'end'})`)
        await sleep(80)
        await screenshot(cdp, `../staff-management-final-polish/account-management-guidance-after-${width}.png`)
        await cdp.evaluate(`window.scrollTo(0,0)`)
      }
    }
    return measurements
  }
  const staffSubmoduleResponsive: Record<string, unknown> = {}
  for (const width of staffCorrectionWidths) staffSubmoduleResponsive[String(width)] = await captureStaffSubmodules(width)
  const staffSubmoduleMobile = staffSubmoduleResponsive['390']
  const staffSubmoduleDesktop = staffSubmoduleResponsive['1440']
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await cdp.evaluate(`document.querySelector('button[aria-label="Customization Center"]')?.click()`)
  for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.customization-category-nav')`)) break; await sleep(100) }
  const customizationDesktop = await cdp.evaluate<any>(`(()=>{const nav=document.querySelector('.customization-category-nav');const buttons=Array.from(nav.querySelectorAll('button'));return{categories:buttons.map(button=>button.textContent.trim()),pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,columns:getComputedStyle(nav).gridTemplateColumns.split(' ').length,workforceTabs:Array.from(document.querySelectorAll('.leave-entitlement-tabs button')).map(button=>button.textContent.trim())}})()`)
  assert.deepEqual(customizationDesktop.categories, ['Workforce','Bookings','Training','Guest Experience','Chargeable','Maintenance','Platform'])
  assert.deepEqual(customizationDesktop.workforceTabs, ['Leave Types','Entitlement Policies','Employee Entitlements','Public Holiday Calendar'])
  assert.equal(customizationDesktop.pageOverflow, false)
  assert.equal(customizationDesktop.columns, 7)
  const categoryPanels = await cdp.evaluate<any>(`(async()=>{const result={};for(const button of document.querySelectorAll('.customization-category-nav button')){if(button.textContent.trim()==='Platform')continue;button.click();await new Promise(done=>setTimeout(done,80));result[button.textContent.trim()]={selected:button.classList.contains('selected'),panel:document.querySelector('.customization-category-panel')?.innerText.trim().length>0};}return result})()`)
  assert.ok(Object.values(categoryPanels).every((value: any) => value.selected && value.panel))
  await cdp.evaluate(`Array.from(document.querySelectorAll('.customization-category-nav button')).find(button=>button.textContent?.trim()==='Workforce')?.click()`)
  await screenshot(cdp, 'customization-center-desktop.png')

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await sleep(120)
  const customizationMobile = await cdp.evaluate<any>(`(()=>{const nav=document.querySelector('.customization-category-nav');const buttons=Array.from(nav.querySelectorAll('button'));return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,columns:getComputedStyle(nav).gridTemplateColumns.split(' ').length,buttonsReadable:buttons.every(button=>button.getBoundingClientRect().width>100&&button.getBoundingClientRect().height>=44),panelWidth:Math.round(document.querySelector('.customization-category-panel').getBoundingClientRect().width),viewport:innerWidth}})()`)
  assert.deepEqual({ pageOverflow: customizationMobile.pageOverflow, columns: customizationMobile.columns, buttonsReadable: customizationMobile.buttonsReadable }, { pageOverflow: false, columns: 2, buttonsReadable: true })
  assert.ok(customizationMobile.panelWidth <= customizationMobile.viewport)
  await screenshot(cdp, 'customization-center-mobile-390.png')
  assert.deepEqual(cdp.errors, [])

  console.log(JSON.stringify({ renderedDesktop: true, billTipRuleColumn: true, managerDecisionEditor: financialEditor, directHandlesVisible: true, handleNameSpacing: directReorder.spacings[0], modeButtonRemoved: true, guriMovedImmediatelyAboveDodon: true, mouseDragChangedOrder: true, keyboardReorderPersisted: true, oneRequestPerDrop: true, automaticSavePersistedExactOrder: true, rejectedSaveRestoredPreviousOrder: true, rejectedSaveDisplayedError: true, directoryRefreshPersisted: true, rosterSynchronized: true, rosterRefreshPersisted: true, rosterBatchRequests: 1, rosterBatchRefreshPersisted: true, rosterDesktop, rosterMobile, rosterResponsiveResults, previewPills: `${dutyLayout.previewWidths.length} equal pills at ${dutyLayout.previewWidths[0]}px`, equalRowHeights: true, dutyCodeResponsiveResults, staffMobile390: mobile, staffCorrectionResults, staffSubmoduleDesktop, staffSubmoduleMobile, customizationDesktop, customizationMobile, categoryPanels, screenshots: ['artifacts/visual-validation/staff-direct-reorder-desktop.png', 'artifacts/visual-validation/duty-roster-batch-desktop.png', 'artifacts/visual-validation/duty-roster-batch-mobile-390.png', 'artifacts/visual-validation/duty-code-settings-desktop.png', 'artifacts/visual-validation/duty-code-settings-mobile-390.png', ...dutyCodeWidths.map(width => `artifacts/visual-validation/duty-code-settings-premium-${width}.png`), 'artifacts/visual-validation/duty-code-settings-protected-modal-1440.png', 'artifacts/visual-validation/duty-code-settings-protected-modal-390.png', 'artifacts/visual-validation/staff-direct-reorder-mobile-390.png', ...staffCorrectionWidths.map(width => `artifacts/visual-validation/staff-stage3-correction-${width}.png`), ...staffSubmodules.flatMap(module => [`artifacts/visual-validation/staff-${module.slug}-desktop-1440.png`, `artifacts/visual-validation/staff-${module.slug}-mobile-390.png`]), 'artifacts/visual-validation/customization-center-desktop.png', 'artifacts/visual-validation/customization-center-mobile-390.png'], runtimeErrors: cdp.errors.length }, null, 2))
  }
} finally {
  socket?.close()
  for (const child of processes.reverse()) { if (child.exitCode === null) child.kill(); child.removeAllListeners(); child.unref() }
  await sleep(1000)
  await rm(fixture.root, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(() => undefined)
}
