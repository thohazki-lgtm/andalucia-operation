import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const fixture = await createDisposableDevelopmentStore('leave-types-ui-browser')
const profile = join(fixture.root, 'edge-profile')
const output = resolve('artifacts', 'visual-validation', 'leave-types')
const processes: ChildProcess[] = []
const token = `isolated-${randomUUID()}`
let socket: WebSocket | null = null
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))
const waitFor = async (url: string) => { for (let attempt = 0; attempt < 600; attempt++) { try { if ((await fetch(url)).ok) return } catch {} await sleep(200) } throw new Error(`Timed out waiting for ${url}`) }

class Cdp {
  private id = 0
  private pending = new Map<number, { resolve: (value: any) => void; reject: (reason: unknown) => void }>()
  readonly errors: string[] = []
  constructor(private ws: WebSocket) { ws.onmessage = event => { const message = JSON.parse(String(event.data)); if (message.id) { const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result) } else if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || 'Runtime exception') } }
  send(method: string, params: Record<string, unknown> = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise<any>((resolveCall, rejectCall) => this.pending.set(id, { resolve: resolveCall, reject: rejectCall })) }
  evaluate<T>(expression: string) { return this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then(result => { if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed'); return result.result.value as T }) }
}

try {
  const owner = (await fixture.db.query<any>("select u.id from user_accounts u join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.active=true where u.status='active' and r.role_key='owner' limit 1")).rows[0]
  assert.ok(owner)
  await fixture.db.query('insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval \'1 hour\')', [randomUUID(), createHash('sha256').update(token).digest('hex'), owner.id])
  const position = (await fixture.db.query<{ value: string }>("select value from configuration_options where group_key='staff_positions' and active=true order by sort_order limit 1")).rows[0]?.value || 'F&B Attendant'
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'ENT-001','Aisha Ibrahim',$2,'active','2024-01-01'),($3,'ENT-002','Mohamed Rasheed',$2,'active','2025-02-01')", [randomUUID(), position, randomUUID()])
  await fixture.db.close()

  const node = process.execPath
  processes.push(spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', API_PORT: '3017', APP_ORIGIN: 'http://127.0.0.1:5187' }, stdio: 'ignore' }))
  processes.push(spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5187', '--strictPort'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3017' }, stdio: 'ignore' }))
  await Promise.all([waitFor('http://127.0.0.1:3017/api/health'), waitFor('http://127.0.0.1:5187/')])

  const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--edge-skip-compat-layer-relaunch', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  processes.push(edge)
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
  assert.equal((await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5187/', path: '/', httpOnly: true, sameSite: 'Strict' })).success, true)
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5187/' })
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Customization Center"]')`)) break; await sleep(100) }
  await cdp.evaluate(`document.querySelector('button[aria-label="Customization Center"]')?.click()`)
  for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.leave-types-panel')`)) break; await sleep(100) }
  await sleep(1200)
  const baselineState = await cdp.evaluate<{ configured: number; activationButtons: number }>(`({configured:document.querySelectorAll('.leave-type-state.active').length,activationButtons:document.querySelectorAll('.activate-duty-code').length})`)
  assert.equal(baselineState.configured + baselineState.activationButtons, 10, 'Every protected Duty Code must retain one configured or activation state.')

  const results: Record<string, unknown> = {}
  const policyResults: Record<string, unknown> = {}
  const employeeResults: Record<string, unknown> = {}
  const offSummaryResults: Record<string, unknown> = {}
  for (const width of [1440, 1024, 768, 430, 390, 360]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width <= 430 ? 900 : 1000, deviceScaleFactor: 1, mobile: false })
    await sleep(200)
    const result = await cdp.evaluate<any>(`(()=>{const panel=document.querySelector('.leave-types-panel');const heading=document.querySelector('.leave-entitlements-heading');const tabs=document.querySelector('.leave-entitlement-tabs');const cards=Array.from(document.querySelectorAll('.leave-type-card'));const first=cards[0];const code=first.querySelector('.leave-type-code');const status=first.querySelector('.leave-type-state.active');const tab=tabs.querySelector('button');return{overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,cards:cards.length,configured:document.querySelectorAll('.leave-type-state.active').length,activationButtons:document.querySelectorAll('.activate-duty-code').length,columns:getComputedStyle(panel.querySelector('.leave-type-grid')).gridTemplateColumns.split(' ').length,duplicateSubtitles:cards.filter(card=>card.querySelector('small')).length,panelBorder:getComputedStyle(panel).borderColor,panelBackground:getComputedStyle(panel).backgroundColor,cardBorder:getComputedStyle(first).borderColor,cardHeight:Math.round(first.getBoundingClientRect().height),headingHeight:Math.round(heading.getBoundingClientRect().height),tabColumns:getComputedStyle(tabs).gridTemplateColumns.split(' ').length,tabHeight:Math.round(tab.getBoundingClientRect().height),configuredHeight:status?Math.round(status.getBoundingClientRect().height):null,codeColor:getComputedStyle(code).color,codeBorder:getComputedStyle(code).borderLeftColor}})()`)
    assert.equal(result.overflow, false, `Leave Types overflow at ${width}px.`)
    assert.equal(result.cards, 10)
    assert.deepEqual({ configured: result.configured, activationButtons: result.activationButtons }, baselineState, `Duty Code state changed while validating ${width}px.`)
    assert.equal(result.columns, width <= 700 ? 1 : 2)
    assert.equal(result.tabColumns, width <= 700 ? 2 : 4)
    assert.equal(result.duplicateSubtitles, 0)
    assert.equal(result.panelBorder, 'rgb(222, 197, 143)')
    assert.equal(result.panelBackground, 'rgb(255, 253, 248)')
    assert.equal(result.cardBorder, 'rgb(222, 197, 143)')
    assert.ok(result.cardHeight >= 58 && result.cardHeight <= 78)
    assert.ok(result.headingHeight <= (width <= 1024 ? 105 : 82), `Header height ${result.headingHeight}px exceeds the compact limit at ${width}px.`)
    assert.ok(result.tabHeight >= (width <= 700 ? 44 : 38))
    assert.equal(result.codeColor, result.codeBorder, 'Configured Duty Roster color must remain authoritative.')
    results[String(width)] = result
    const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const target = join(output, `after-${width}.png`)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, Buffer.from(capture.data, 'base64'))

    await cdp.evaluate(`Array.from(document.querySelectorAll('.leave-entitlement-tabs button')).find(button=>button.textContent?.trim()==='Entitlement Policies')?.click()`)
    for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.entitlement-policy-row')`)) break; await sleep(100) }
    const policyResult = await cdp.evaluate<any>(`(()=>{const panel=document.querySelector('.entitlement-policies-panel');const grid=panel.querySelector('.entitlement-policy-list');const cards=Array.from(panel.querySelectorAll('.entitlement-policy-row'));const first=cards[0];const code=first.querySelector('.policy-code');const allowance=first.querySelector('.policy-allowance b');const edit=first.querySelector('.secondary');return{overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,cards:cards.length,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,duplicateSubtitles:cards.filter(card=>card.querySelector('.policy-identity small')?.textContent.trim()===card.querySelector('.policy-identity strong')?.textContent.trim()).length,statuses:panel.querySelectorAll('.policy-source').length,editActions:Array.from(panel.querySelectorAll('.secondary')).filter(button=>button.textContent.trim()==='Edit').length,panelBorder:getComputedStyle(panel).borderColor,panelBackground:getComputedStyle(panel).backgroundColor,cardBorder:getComputedStyle(first).borderColor,cardHeight:Math.round(first.getBoundingClientRect().height),buttonHeight:Math.round(edit.getBoundingClientRect().height),allowanceWeight:getComputedStyle(allowance).fontWeight,codeColor:getComputedStyle(code).color,codeBorder:getComputedStyle(code).borderLeftColor}})()`)
    assert.equal(policyResult.overflow, false, `Entitlement Policies overflow at ${width}px.`)
    assert.equal(policyResult.cards, 10)
    assert.equal(policyResult.columns, width <= 700 ? 1 : 2)
    assert.equal(policyResult.duplicateSubtitles, 0)
    assert.equal(policyResult.statuses, 10)
    assert.equal(policyResult.editActions, 10)
    assert.equal(policyResult.panelBorder, 'rgb(222, 197, 143)')
    assert.equal(policyResult.panelBackground, 'rgb(255, 253, 248)')
    assert.equal(policyResult.cardBorder, 'rgb(222, 197, 143)')
    assert.ok(policyResult.cardHeight >= 104 && policyResult.cardHeight <= 140)
    assert.ok(policyResult.buttonHeight >= 34)
    assert.equal(policyResult.allowanceWeight, '500')
    assert.equal(policyResult.codeColor, policyResult.codeBorder, 'Entitlement Policy leave-code colors must remain authoritative.')
    policyResults[String(width)] = policyResult
    const policyCapture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(join(output, `entitlement-policies-${width}.png`), Buffer.from(policyCapture.data, 'base64'))

    await cdp.evaluate(`Array.from(document.querySelectorAll('.leave-entitlement-tabs button')).find(button=>button.textContent?.trim()==='Employee Entitlements')?.click()`)
    for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.employee-entitlement-row')`)) break; await sleep(100) }
    const employeeResult = await cdp.evaluate<any>(`(()=>{const panel=document.querySelector('.staff-entitlements-panel');const rows=Array.from(panel.querySelectorAll('.employee-entitlement-row'));const first=rows[0];const header=first.querySelector('.employee-entitlement-header');const metrics=Array.from(first.querySelectorAll('.employee-entitlement-metrics>div'));const manage=first.querySelector('.entitlement-manage');manage.open=true;const menu=manage.querySelector('.entitlement-manage-menu');return{overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,rows:rows.length,headerColumns:getComputedStyle(header).gridTemplateColumns.split(' ').length,rowHeight:Math.round(first.getBoundingClientRect().height),headerLabels:Array.from(header.querySelectorAll('.employee-entitlement-date span')).map(label=>label.textContent.trim()),labels:metrics.map(metric=>metric.querySelector('dt').textContent.trim()),visibleValues:metrics.every(metric=>metric.querySelector('dd').getBoundingClientRect().height>0),metricColumns:getComputedStyle(first.querySelector('.employee-entitlement-metrics')).gridTemplateColumns.split(' ').length,panelBorder:getComputedStyle(panel).borderColor,panelBackground:getComputedStyle(panel).backgroundColor,rowBorder:getComputedStyle(first).borderColor,rowBackground:getComputedStyle(first).backgroundColor,manageHeight:Math.round(manage.querySelector('summary').getBoundingClientRect().height),menuActions:Array.from(menu.querySelectorAll('button')).map(button=>button.textContent.trim()),menuVisible:getComputedStyle(menu).display!=='none'}})()`)
    assert.equal(employeeResult.overflow, false, `Employee Entitlements overflow at ${width}px.`)
    assert.ok(employeeResult.rows > 0)
    assert.equal(employeeResult.headerColumns, width <= 700 ? 2 : 4)
    assert.equal(employeeResult.metricColumns, width <= 700 ? 2 : width <= 1050 ? 3 : 6)
    assert.deepEqual(employeeResult.headerLabels, ['Service Year', 'Next Availability'])
    assert.deepEqual(employeeResult.labels, ['Available', 'Used', 'Remaining', 'Accruing Next Year', 'Future Booked', 'Available After Booked'])
    assert.equal(employeeResult.visibleValues, true)
    assert.equal(employeeResult.panelBorder, 'rgb(222, 197, 143)')
    assert.equal(employeeResult.panelBackground, 'rgb(255, 253, 248)')
    assert.equal(employeeResult.rowBorder, 'rgb(222, 197, 143)')
    assert.equal(employeeResult.rowBackground, 'rgb(255, 253, 248)')
    assert.ok(employeeResult.rowHeight <= (width <= 700 ? 265 : width <= 1050 ? 185 : 135), `Employee row height ${employeeResult.rowHeight}px is not compact at ${width}px.`)
    assert.ok(employeeResult.manageHeight >= (width <= 700 ? 44 : 36))
    assert.deepEqual(employeeResult.menuActions, ['Balance', 'Carry Forward', 'Edit Year', 'Settings'])
    assert.equal(employeeResult.menuVisible, true)
    employeeResults[String(width)] = employeeResult
    const employeeCapture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(join(output, `employee-entitlements-${width}.png`), Buffer.from(employeeCapture.data, 'base64'))
    await cdp.evaluate(`document.querySelector('.entitlement-manage-menu button')?.click()`)
    for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.off-days-summary')`)) break; await sleep(100) }
    const offSummaryResult = await cdp.evaluate<any>(`(()=>{const modal=document.querySelector('.entitlement-balance-modal');const summary=modal.querySelector('.off-days-summary');const yearly=modal.querySelector('.additional-entitlement-balances');const metrics=Array.from(summary.querySelectorAll('.off-days-metrics>div'));const weekly=summary.querySelector('.off-days-weekly-review');const actions=Array.from(summary.querySelectorAll('.balance-week-actions button'));return{overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,modalOverflow:modal.scrollWidth>modal.clientWidth+1,summaryBeforeAnnual:summary.compareDocumentPosition(yearly)===Node.DOCUMENT_POSITION_FOLLOWING,metricLabels:metrics.map(metric=>metric.querySelector('dt').textContent.trim()),metricColumns:getComputedStyle(summary.querySelector('.off-days-metrics')).gridTemplateColumns.split(' ').length,weeklyLabels:Array.from(weekly.querySelectorAll('dt')).map(label=>label.textContent.trim()),weeklyColumns:getComputedStyle(weekly.querySelector('dl')).gridTemplateColumns.split(' ').length,border:getComputedStyle(summary).borderColor,background:getComputedStyle(summary).backgroundColor,actions:actions.map(button=>button.textContent.trim()),actionHeights:actions.map(button=>Math.round(button.getBoundingClientRect().height))}})()`)
    assert.equal(offSummaryResult.overflow, false, `OFF summary page overflow at ${width}px.`)
    assert.equal(offSummaryResult.modalOverflow, false, `OFF summary modal overflow at ${width}px.`)
    assert.equal(offSummaryResult.summaryBeforeAnnual, true)
    assert.deepEqual(offSummaryResult.metricLabels, ['OFF Taken', 'Accumulated OFF', 'Available Balance'])
    assert.equal(offSummaryResult.metricColumns, 3)
    assert.deepEqual(offSummaryResult.weeklyLabels, ['Required', 'Assigned', 'Difference', 'Status'])
    assert.equal(offSummaryResult.weeklyColumns, width <= 700 ? 2 : 4)
    assert.equal(offSummaryResult.border, 'rgb(222, 197, 143)')
    assert.equal(offSummaryResult.background, 'rgb(255, 253, 248)')
    assert.deepEqual(offSummaryResult.actions, ['← Previous Week', 'Current Week', 'Next Week →'])
    if (width <= 700) assert.equal(offSummaryResult.actionHeights.every((height:number)=>height>=38), true)
    offSummaryResults[String(width)] = offSummaryResult
    const offSummaryCapture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(join(output, `off-days-summary-${width}.png`), Buffer.from(offSummaryCapture.data, 'base64'))
    await cdp.evaluate(`document.querySelector('.entitlement-balance-modal .close')?.click()`)
    await cdp.evaluate(`Array.from(document.querySelectorAll('.leave-entitlement-tabs button')).find(button=>button.textContent?.trim()==='Leave Types')?.click()`)
    for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.leave-type-card')`)) break; await sleep(100) }
  }
  assert.deepEqual(cdp.errors, [])
  console.log(JSON.stringify({ responsiveWidths: Object.keys(results), policyResponsiveWidths: Object.keys(policyResults), employeeResponsiveWidths: Object.keys(employeeResults), offSummaryResponsiveWidths: Object.keys(offSummaryResults), dutyColorsPreserved: true, runtimeErrors: cdp.errors.length, screenshots: Object.keys(results).flatMap(width => [`artifacts/visual-validation/leave-types/after-${width}.png`, `artifacts/visual-validation/leave-types/entitlement-policies-${width}.png`, `artifacts/visual-validation/leave-types/employee-entitlements-${width}.png`, `artifacts/visual-validation/leave-types/off-days-summary-${width}.png`]) }, null, 2))
} finally {
  socket?.close()
  for (const child of processes.reverse()) { if (child.exitCode === null) child.kill(); child.removeAllListeners(); child.unref() }
  await sleep(500)
  await rm(fixture.root, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }).catch(() => undefined)
}
