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
const waitFor = async (url: string, process?: ChildProcess, processLog?: () => string) => { let lastResponse = ''; for (let attempt = 0; attempt < 600; attempt++) { if (process?.exitCode !== null && process?.exitCode !== undefined) throw new Error(`Process exited before ${url} was ready (exit ${process.exitCode}).\n${processLog?.() || ''}\n${lastResponse}`); try { const response = await fetch(url); if (response.ok) return; if (attempt % 20 === 0) lastResponse = `Last response: ${response.status} ${await response.text()}` } catch (error) { if (attempt % 20 === 0) lastResponse = `Last request error: ${String(error)}` } await sleep(200) } throw new Error(`Timed out waiting for ${url}.\n${processLog?.() || ''}\n${lastResponse}`) }

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
  const firstStaffId = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'ENT-001','Aisha Ibrahim',$2,'active','2024-01-01'),($3,'ENT-002','Mohamed Rasheed',$2,'active','2025-02-01')", [firstStaffId, position, randomUUID()])
  const outletScopeId = (await fixture.db.query<{ id: string }>("select id from outlet_scopes where scope_key='andalucia' limit 1")).rows[0]?.id
  assert.ok(outletScopeId)
  await fixture.db.query("insert into staff_membership_history(id,staff_id,outlet_scope_id,membership_dimension,effective_from,effective_to,source,reason,review_status,reviewed_at,reviewed_by,created_by,updated_by) values($1,$2,$3,'regular_outlet','2024-01-01',null,'baseline_manager_review','Leave History staff-cell visual validation','approved',now(),'isolated-ui-test','isolated-ui-test','isolated-ui-test')", [randomUUID(), firstStaffId, outletScopeId])
  await fixture.db.query("insert into public_holidays(id,holiday_name,holiday_date,days,active,created_by,updated_by) values($1,'New Year Holiday','2026-01-01',1,true,'isolated-ui-test','isolated-ui-test'),($2,'National Celebration','2026-07-26',2,true,'isolated-ui-test','isolated-ui-test'),($3,'Archived Holiday','2026-12-01',1,false,'isolated-ui-test','isolated-ui-test')", [randomUUID(), randomUUID(), randomUUID()])
  await fixture.db.close()

  const node = process.execPath
  let apiLog = ''; let viteLog = ''
  const api = spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', API_PORT: '3017', APP_ORIGIN: 'http://127.0.0.1:5187' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const vite = spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5187', '--strictPort'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3017' }, stdio: ['ignore', 'pipe', 'pipe'] })
  api.stdout?.on('data', chunk => { apiLog += String(chunk) }); api.stderr?.on('data', chunk => { apiLog += String(chunk) })
  vite.stdout?.on('data', chunk => { viteLog += String(chunk) }); vite.stderr?.on('data', chunk => { viteLog += String(chunk) })
  processes.push(api, vite)
  await Promise.all([waitFor('http://127.0.0.1:3017/api/health', api, () => apiLog), waitFor('http://127.0.0.1:5187/', vite, () => viteLog)])

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
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Leave Planner"]')`)) break; await sleep(100) }
  const planned = await cdp.evaluate<any>(`fetch('/api/workforce/planned-leave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({staffId:${JSON.stringify(firstStaffId)},startDate:'2026-11-04',endDate:'2026-11-05',leaveType:'annual_leave',managerNote:'Leave History staff-cell visual validation'})}).then(async response=>({status:response.status,body:await response.text()}))`)
  assert.equal(planned.status, 201, planned.body)
  await cdp.evaluate(`document.querySelector('button[aria-label="Leave Planner"]')?.click()`)
  for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.leave-planner-module-tabs')`)) break; await sleep(100) }
  await cdp.evaluate(`Array.from(document.querySelectorAll('.leave-planner-module-tabs button')).find(button=>button.textContent?.trim()==='Leave Types')?.click()`)
  for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.leave-types-panel')`)) break; await sleep(100) }
  await sleep(1200)
  const baselineState = await cdp.evaluate<{ configured: number; activationButtons: number }>(`({configured:document.querySelectorAll('.leave-type-state.active').length,activationButtons:document.querySelectorAll('.activate-duty-code').length})`)
  assert.equal(baselineState.configured + baselineState.activationButtons, 10, 'Every protected Duty Code must retain one configured or activation state.')
  const leaveTheme = await cdp.evaluate<{ line: string; lineStrong: string; divider: string; surface: string; surfaceStrong: string; violet: string }>(`(()=>{const main=document.querySelector('main.module-leave-planner');const probe=document.createElement('i');probe.style.cssText='position:absolute;color:var(--ao-leave-line);border:1px solid var(--ao-leave-divider);background:var(--ao-leave-surface)';main.append(probe);const base=getComputedStyle(probe);const first={line:base.color,divider:base.borderColor,surface:base.backgroundColor};probe.style.color='var(--ao-leave-line-strong)';probe.style.background='var(--ao-leave-surface-strong)';const lineStrong=getComputedStyle(probe).color;const surfaceStrong=getComputedStyle(probe).backgroundColor;probe.style.color='var(--ao-violet-hour)';const violet=getComputedStyle(probe).color;probe.remove();return{...first,lineStrong,surfaceStrong,violet}})()`)
  assert.notEqual(leaveTheme.line, 'rgb(222, 197, 143)', 'Leave Planner must not retain the legacy decorative gold line.')

  const results: Record<string, unknown> = {}
  const policyResults: Record<string, unknown> = {}
  const employeeResults: Record<string, unknown> = {}
  const offSummaryResults: Record<string, unknown> = {}
  const holidayResults: Record<string, unknown> = {}
  const plannerResults: Record<string, unknown> = {}
  const historyResults: Record<string, unknown> = {}
  for (const width of [1440, 1024, 768, 430, 390, 360]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width <= 430 ? 900 : 1000, deviceScaleFactor: 1, mobile: false })
    await sleep(200)
    await cdp.evaluate(`window.scrollTo({top:0,left:0,behavior:'instant'})`)
    const result = await cdp.evaluate<any>(`(()=>{const panel=document.querySelector('.leave-types-panel');const tabs=document.querySelector('.leave-planner-module-tabs');const cards=Array.from(document.querySelectorAll('.leave-type-card'));const first=cards[0];const code=first.querySelector('.leave-type-code');const status=first.querySelector('.leave-type-state.active');const tab=tabs.querySelector('button');return{overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,cards:cards.length,configured:document.querySelectorAll('.leave-type-state.active').length,activationButtons:document.querySelectorAll('.activate-duty-code').length,columns:getComputedStyle(panel.querySelector('.leave-type-grid')).gridTemplateColumns.split(' ').length,duplicateSubtitles:cards.filter(card=>card.querySelector('small')).length,headerDescriptions:panel.querySelectorAll('.workforce-section-title p:not(.eyebrow)').length,sourceNotes:panel.querySelectorAll('.configuration-source-note').length,panelBorder:getComputedStyle(panel).borderColor,panelBackground:getComputedStyle(panel).backgroundColor,cardBorder:getComputedStyle(first).borderColor,cardHeight:Math.round(first.getBoundingClientRect().height),tabColumns:getComputedStyle(tabs).gridTemplateColumns.split(' ').length,tabHeight:Math.round(tab.getBoundingClientRect().height),configuredHeight:status?Math.round(status.getBoundingClientRect().height):null,codeColor:getComputedStyle(code).color,codeBorder:getComputedStyle(code).borderLeftColor}})()`)
    assert.equal(result.overflow, false, `Leave Types overflow at ${width}px.`)
    assert.equal(result.cards, 10)
    assert.deepEqual({ configured: result.configured, activationButtons: result.activationButtons }, baselineState, `Duty Code state changed while validating ${width}px.`)
    assert.equal(result.columns, width <= 700 ? 1 : 2)
    assert.equal(result.tabColumns, width <= 700 ? 2 : width <= 1100 ? 3 : 6)
    assert.equal(result.duplicateSubtitles, 0)
    assert.equal(result.headerDescriptions, 0, 'Leave Types must not retain the explanatory heading paragraph.')
    assert.equal(result.sourceNotes, 0, 'Leave Types must not retain the bottom source-information note.')
    assert.equal(result.panelBorder, leaveTheme.line)
    assert.equal(result.panelBackground, leaveTheme.surface)
    assert.equal(result.cardBorder, leaveTheme.line)
    assert.ok(result.cardHeight >= 58 && result.cardHeight <= 78)
    assert.ok(result.tabHeight >= (width <= 700 ? 44 : 38))
    assert.equal(result.codeColor, result.codeBorder, 'Configured Duty Roster color must remain authoritative.')
    results[String(width)] = result
    const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const target = join(output, `after-${width}.png`)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, Buffer.from(capture.data, 'base64'))

    await cdp.evaluate(`Array.from(document.querySelectorAll('.leave-planner-module-tabs button')).find(button=>button.textContent?.trim()==='Entitlement Policies')?.click()`)
    for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.entitlement-policy-row')`)) break; await sleep(100) }
    const policyResult = await cdp.evaluate<any>(`(()=>{const panel=document.querySelector('.entitlement-policies-panel');const grid=panel.querySelector('.entitlement-policy-list');const cards=Array.from(panel.querySelectorAll('.entitlement-policy-row'));const first=cards[0];const code=first.querySelector('.policy-code');const allowance=first.querySelector('.policy-allowance b');const edits=Array.from(panel.querySelectorAll('.entitlement-policy-row .secondary'));const badges=Array.from(panel.querySelectorAll('.policy-source'));const note=panel.querySelector('.policy-information-note');return{overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,cards:cards.length,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,duplicateSubtitles:cards.filter(card=>card.querySelector('.policy-identity small')?.textContent.trim()===card.querySelector('.policy-identity strong')?.textContent.trim()).length,topDescriptions:panel.querySelectorAll('.workforce-section-title p:not(.eyebrow)').length,informationNotes:panel.querySelectorAll('.policy-information-note').length,noteText:note?.textContent.trim(),noteAfterGrid:note?.previousElementSibling===grid,statuses:badges.length,editActions:edits.filter(button=>button.textContent.trim()==='Edit').length,panelBorder:getComputedStyle(panel).borderColor,panelBackground:getComputedStyle(panel).backgroundColor,cardBorder:getComputedStyle(first).borderColor,cardHeights:cards.map(card=>Math.round(card.getBoundingClientRect().height)),buttonHeights:edits.map(edit=>Math.round(edit.getBoundingClientRect().height)),buttonWidths:edits.map(edit=>Math.round(edit.getBoundingClientRect().width)),badgeHeights:badges.map(badge=>Math.round(badge.getBoundingClientRect().height)),badgeWidths:badges.map(badge=>Math.round(badge.getBoundingClientRect().width)),allowanceWeight:getComputedStyle(allowance).fontWeight,codeColor:getComputedStyle(code).color,codeBorder:getComputedStyle(code).borderLeftColor,noteBorder:note?getComputedStyle(note).borderTopColor:null,noteAccent:note?getComputedStyle(note).borderLeftColor:null,noteBackground:note?getComputedStyle(note).backgroundColor:null}})()`)
    assert.equal(policyResult.overflow, false, `Entitlement Policies overflow at ${width}px.`)
    assert.equal(policyResult.cards, 10)
    assert.equal(policyResult.columns, width <= 700 ? 1 : 2)
    assert.equal(policyResult.duplicateSubtitles, 0)
    assert.equal(policyResult.topDescriptions, 0, 'Entitlement Policies must keep the heading area clean.')
    assert.equal(policyResult.informationNotes, 1)
    assert.equal(policyResult.noteAfterGrid, true, 'The consolidated policy explanation must follow the cards.')
    assert.match(policyResult.noteText, /employee-specific override/i)
    assert.match(policyResult.noteText, /Duty Roster/i)
    assert.equal(policyResult.statuses, 10)
    assert.equal(policyResult.editActions, 10)
    assert.equal(policyResult.panelBorder, leaveTheme.line)
    assert.equal(policyResult.panelBackground, leaveTheme.surface)
    assert.equal(policyResult.cardBorder, leaveTheme.line)
    assert.ok(policyResult.cardHeights.every((height:number)=>height >= 104 && height <= 150))
    assert.ok(Math.max(...policyResult.cardHeights)-Math.min(...policyResult.cardHeights) <= 1, `Entitlement Policy cards must have equal heights at ${width}px.`)
    assert.ok(policyResult.buttonHeights.every((height:number)=>height >= 34))
    assert.equal(new Set(policyResult.buttonWidths).size, 1, `Entitlement Policy Edit buttons must have equal widths at ${width}px.`)
    assert.equal(new Set(policyResult.badgeHeights).size, 1, `Entitlement Policy badges must have equal heights at ${width}px.`)
    assert.equal(new Set(policyResult.badgeWidths).size, 1, `Entitlement Policy badges must align consistently at ${width}px.`)
    assert.equal(policyResult.allowanceWeight, '500')
    assert.equal(policyResult.codeColor, policyResult.codeBorder, 'Entitlement Policy leave-code colors must remain authoritative.')
    assert.equal(policyResult.noteBorder, leaveTheme.line)
    assert.equal(policyResult.noteAccent, leaveTheme.violet)
    assert.equal(policyResult.noteBackground, leaveTheme.surfaceStrong)
    policyResults[String(width)] = policyResult
    const policyCapture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(join(output, `entitlement-policies-${width}.png`), Buffer.from(policyCapture.data, 'base64'))
    await cdp.evaluate(`document.querySelector('.entitlement-policy-row .secondary')?.click()`)
    for (let attempt = 0; attempt < 30; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.entitlement-policy-modal')`)) break; await sleep(50) }
    const policyModal = await cdp.evaluate<any>(`(()=>{const modal=document.querySelector('.entitlement-policy-modal');const input=modal.querySelector('input');const actions=Array.from(modal.querySelectorAll('.form-actions button'));return{present:!!modal,overflow:modal.scrollWidth>modal.clientWidth+1,width:Math.round(modal.getBoundingClientRect().width),viewport:document.documentElement.clientWidth,inputHeight:Math.round(input.getBoundingClientRect().height),actionHeights:actions.map(button=>Math.round(button.getBoundingClientRect().height)),titleSize:getComputedStyle(modal.querySelector('h2')).fontSize}})()`)
    assert.equal(policyModal.present, true)
    assert.equal(policyModal.overflow, false)
    assert.ok(policyModal.width <= policyModal.viewport - 20, `Entitlement Policy modal width ${policyModal.width}px exceeds the ${policyModal.viewport}px viewport allowance at ${width}px.`)
    assert.ok(policyModal.inputHeight >= 44)
    assert.ok(policyModal.actionHeights.every((height:number)=>height >= 38))
    assert.ok(Number.parseFloat(policyModal.titleSize) <= 22)
    await cdp.evaluate(`document.querySelector('.entitlement-policy-modal .close')?.click()`)

    await cdp.evaluate(`Array.from(document.querySelectorAll('.leave-planner-module-tabs button')).find(button=>button.textContent?.trim()==='Employee Entitlements')?.click()`)
    for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.employee-entitlement-table tbody')`)) break; await sleep(100) }
    const employeeResult = await cdp.evaluate<any>(`(()=>{const panel=document.querySelector('.staff-entitlements-panel');const table=panel.querySelector('.employee-entitlement-table');const rows=Array.from(table.querySelectorAll('.employee-entitlement-row'));const first=rows[0];const cells=Array.from(first.querySelectorAll('td'));const toggle=first.querySelector('.entitlement-details-toggle');const headers=Array.from(table.querySelectorAll('thead th'));return{overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,rows:rows.length,rowHeight:Math.round(first.getBoundingClientRect().height),headers:headers.map(header=>header.textContent.trim()),labels:cells.slice(1).map(cell=>cell.dataset.label),visibleValues:cells.slice(1).every(cell=>cell.querySelector('b').getBoundingClientRect().height>0),mobileColumns:getComputedStyle(first).gridTemplateColumns.split(' ').length,panelBorder:getComputedStyle(panel).borderColor,panelBackground:getComputedStyle(panel).backgroundColor,tableBorder:getComputedStyle(table.parentElement).borderColor,rowBackground:getComputedStyle(cells[0]).backgroundColor,cellDividers:cells.filter(cell=>getComputedStyle(cell).borderRightWidth!=='0px').map(cell=>getComputedStyle(cell).borderRightColor),toggleHeight:Math.round(toggle.getBoundingClientRect().height),toggleLabel:toggle.textContent.trim(),detailsButtons:first.querySelectorAll('button.entitlement-details-toggle').length,inactiveControl:Array.from(panel.querySelectorAll('label')).some(label=>label.textContent.includes('Show inactive staff'))}})()`)
    const employeeTabWidths = await cdp.evaluate<number[]>(`Array.from(document.querySelectorAll('.leave-planner-module-tabs button')).map(button=>Math.round(button.getBoundingClientRect().width))`)
    assert.equal(employeeResult.overflow, false, `Employee Entitlements overflow at ${width}px.`)
    assert.ok(employeeResult.rows > 0)
    assert.deepEqual(employeeResult.headers, ['Employee', 'Available', 'Used', 'Booked', 'Balance'])
    assert.deepEqual(employeeResult.labels, ['Available', 'Used', 'Booked', 'Balance'])
    if (width <= 700) assert.equal(employeeResult.mobileColumns, 2)
    assert.equal(employeeResult.visibleValues, true)
    assert.equal(employeeResult.panelBorder, leaveTheme.line)
    assert.equal(employeeResult.panelBackground, leaveTheme.surface)
    assert.equal(employeeResult.rowBackground, 'rgb(255, 255, 255)')
    if (width > 700) assert.equal(employeeResult.tableBorder, leaveTheme.line)
    assert.equal(employeeResult.cellDividers.every((color:string)=>color===leaveTheme.divider), true)
    assert.ok(employeeResult.rowHeight <= (width <= 700 ? 250 : 75), `Employee row height ${employeeResult.rowHeight}px is not compact at ${width}px.`)
    assert.ok(employeeResult.toggleHeight >= (width <= 700 ? 40 : 32))
    assert.equal(employeeResult.toggleLabel, 'Details')
    assert.equal(employeeResult.detailsButtons, 1)
    assert.equal(employeeResult.inactiveControl, false)
    assert.ok(Math.max(...employeeTabWidths) - Math.min(...employeeTabWidths) <= 1, `Leave Planner tabs are not equal at ${width}px: ${employeeTabWidths.join(', ')}.`)
    employeeResults[String(width)] = employeeResult
    const employeeCapture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(join(output, `employee-entitlements-${width}.png`), Buffer.from(employeeCapture.data, 'base64'))
    await cdp.evaluate(`document.querySelector('button.entitlement-details-toggle')?.click()`)
    for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.off-days-summary')`)) break; await sleep(100) }
    const offSummaryResult = await cdp.evaluate<any>(`(()=>{const details=document.querySelector('.employee-entitlement-details');const summary=details.querySelector('.off-days-summary');const balances=details.querySelector('.additional-entitlement-balances');const metrics=Array.from(summary.querySelectorAll('.off-days-metrics>div'));const weekly=summary.querySelector('.off-days-weekly-review');const actions=Array.from(summary.querySelectorAll('.balance-week-actions button'));const cards=Array.from(balances.querySelectorAll('article'));const firstCard=cards[0];return{overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,detailsOverflow:details.scrollWidth>details.clientWidth+1,summaryBeforeBalances:summary.compareDocumentPosition(balances)===Node.DOCUMENT_POSITION_FOLLOWING,summaryHeight:Math.round(summary.getBoundingClientRect().height),metricLabels:metrics.map(metric=>metric.querySelector('dt').textContent.trim()),metricColumns:getComputedStyle(summary.querySelector('.off-days-metrics')).gridTemplateColumns.split(' ').length,metricBorders:metrics.map(metric=>getComputedStyle(metric).borderColor),weeklyLabels:Array.from(weekly.querySelectorAll('dt')).map(label=>label.textContent.trim()),weeklyColumns:getComputedStyle(weekly.querySelector('dl')).gridTemplateColumns.split(' ').length,weeklyTopBorder:getComputedStyle(weekly).borderTopColor,weeklyLeftBorder:getComputedStyle(weekly).borderLeftColor,border:getComputedStyle(summary).borderColor,background:getComputedStyle(summary).backgroundColor,actions:actions.map(button=>button.textContent.trim()),actionHeights:actions.map(button=>Math.round(button.getBoundingClientRect().height)),balanceCards:cards.length,balanceCardHeights:cards.map(card=>Math.round(card.getBoundingClientRect().height)),balanceCardPadding:getComputedStyle(firstCard).padding,balanceHeaderHeight:Math.round(firstCard.querySelector('header').getBoundingClientRect().height),balanceDlHeight:Math.round(firstCard.querySelector('dl').getBoundingClientRect().height),balanceCodes:cards.map(card=>card.querySelector('header b').textContent.trim()),balanceLabels:Array.from(firstCard.querySelectorAll('dt')).map(label=>label.textContent.trim()),balanceColumns:getComputedStyle(firstCard.querySelector('dl')).gridTemplateColumns.split(' ').length,balanceGridColumns:getComputedStyle(balances.firstElementChild).gridTemplateColumns.split(' ').length,balanceBorder:getComputedStyle(firstCard).borderColor,balanceBackground:getComputedStyle(firstCard).backgroundColor}})()`)
    const carryForwardResult = await cdp.evaluate<any>(`(()=>{const details=document.querySelector('.employee-entitlement-details');const summary=details.querySelector('.off-days-summary');const carryForward=details.querySelector('.balance-carry-forward');const balances=details.querySelector('.additional-entitlement-balances');return{summaryBeforeCarryForward:summary.compareDocumentPosition(carryForward)===Node.DOCUMENT_POSITION_FOLLOWING,carryForwardBeforeBalances:carryForward.compareDocumentPosition(balances)===Node.DOCUMENT_POSITION_FOLLOWING,border:getComputedStyle(carryForward).borderColor,button:carryForward.querySelector('button[type="submit"]').textContent.trim(),overflow:carryForward.scrollWidth>carryForward.clientWidth+1}})()`)
    assert.equal(offSummaryResult.overflow, false, `OFF summary page overflow at ${width}px.`)
    assert.equal(offSummaryResult.detailsOverflow, false, `Inline entitlement details overflow at ${width}px.`)
    assert.ok(offSummaryResult.summaryHeight <= (width <= 700 ? 500 : 310), `OFF summary height ${offSummaryResult.summaryHeight}px is not compact at ${width}px.`)
    assert.equal(offSummaryResult.summaryBeforeBalances, true)
    assert.equal(carryForwardResult.summaryBeforeCarryForward, true)
    assert.equal(carryForwardResult.carryForwardBeforeBalances, true)
    assert.equal(carryForwardResult.border, leaveTheme.line)
    assert.equal(carryForwardResult.button, 'Review Carry Forward')
    assert.equal(carryForwardResult.overflow, false)
    assert.deepEqual(offSummaryResult.metricLabels, ['OFF Taken', 'Accumulated OFF', 'Available Balance'])
    assert.equal(offSummaryResult.metricColumns, 3)
    assert.deepEqual(offSummaryResult.weeklyLabels, ['Required', 'Assigned', 'Difference', 'Status'])
    assert.equal(offSummaryResult.weeklyColumns, width <= 700 ? 2 : 4)
    assert.equal(offSummaryResult.border, leaveTheme.line)
    assert.equal(offSummaryResult.background, 'rgb(255, 255, 255)')
    assert.equal(offSummaryResult.metricBorders.every((color:string)=>color===leaveTheme.line), true)
    assert.equal(offSummaryResult.weeklyTopBorder, leaveTheme.line)
    assert.notEqual(offSummaryResult.weeklyLeftBorder, leaveTheme.line, 'Weekly OFF semantic state color must remain distinct from the decorative border.')
    assert.deepEqual(offSummaryResult.actions, ['← Previous Week', 'Current Week', 'Next Week →'])
    if (width <= 700) assert.equal(offSummaryResult.actionHeights.every((height:number)=>height>=38), true)
    assert.equal(offSummaryResult.balanceCards, 8)
    assert.equal(offSummaryResult.balanceCardHeights.every((height:number) => height <= 130), true, `Non-AL cards are not compact at ${width}px: ${offSummaryResult.balanceCardHeights.join(', ')}.`)
    assert.equal(offSummaryResult.balanceCodes.includes('AL'), false)
    assert.deepEqual(offSummaryResult.balanceLabels, ['Entitled', 'Used', 'Balance'])
    assert.equal(offSummaryResult.balanceColumns, 3)
    assert.equal(offSummaryResult.balanceGridColumns, width <= 700 ? 1 : 2)
    assert.equal(offSummaryResult.balanceBorder, leaveTheme.line)
    assert.equal(offSummaryResult.balanceBackground, 'rgb(255, 255, 255)')
    offSummaryResults[String(width)] = offSummaryResult
    const offSummaryCapture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(join(output, `off-days-summary-${width}.png`), Buffer.from(offSummaryCapture.data, 'base64'))
    await cdp.evaluate(`document.querySelector('.employee-entitlement-details-header button')?.click()`)
    await cdp.evaluate(`Array.from(document.querySelectorAll('.leave-planner-module-tabs button')).find(button=>button.textContent?.trim()==='Public Holiday Calendar')?.click()`)
    for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.holiday-record')`)) break; await sleep(100) }
    const holidayResult = await cdp.evaluate<any>(`(()=>{const panel=document.querySelector('.public-holidays-panel');const rows=Array.from(panel.querySelectorAll('.holiday-record'));const first=rows[0];const command=panel.querySelector('.holiday-command');const actions=Array.from(first.querySelectorAll('.holiday-record-actions button'));const dates=rows.map(row=>row.querySelector('time').dateTime);return{overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,panelOverflow:panel.scrollWidth>panel.clientWidth+1,rows:rows.length,panelBorder:getComputedStyle(panel).borderColor,panelBackground:getComputedStyle(panel).backgroundColor,commandColumns:getComputedStyle(command).gridTemplateColumns.split(' ').length,commandBorders:Array.from(command.children).map(child=>getComputedStyle(child).borderColor),rowBorder:getComputedStyle(first).borderColor,rowBackground:getComputedStyle(first).backgroundColor,rowColumns:getComputedStyle(first).gridTemplateColumns.split(' ').length,labels:Array.from(panel.querySelectorAll('.holiday-record-labels span')).map(label=>label.textContent.trim()),dates,actions:actions.map(button=>button.textContent.trim()),actionHeights:actions.map(button=>Math.round(button.getBoundingClientRect().height)),addHeight:Math.round(panel.querySelector('.holiday-add-action').getBoundingClientRect().height),activeDays:panel.querySelector('.holiday-active-summary strong').textContent.trim()}})()`)
    assert.equal(holidayResult.overflow, false, `Public Holiday Calendar page overflow at ${width}px.`)
    assert.equal(holidayResult.panelOverflow, false, `Public Holiday Calendar panel overflow at ${width}px.`)
    assert.equal(holidayResult.rows, 3)
    assert.equal(holidayResult.panelBorder, leaveTheme.line)
    assert.equal(holidayResult.panelBackground, leaveTheme.surface)
    assert.equal(holidayResult.commandColumns, width <= 700 ? 1 : 2)
    assert.equal(holidayResult.commandBorders.every((color:string)=>color===leaveTheme.divider), true)
    assert.equal(holidayResult.rowBorder, leaveTheme.line)
    assert.equal(holidayResult.rowBackground, 'rgb(255, 255, 255)')
    assert.equal(holidayResult.rowColumns, width <= 900 ? 2 : 5)
    assert.deepEqual(holidayResult.labels, ['Holiday', 'Date', 'Days', 'Status', 'Actions'])
    assert.deepEqual(holidayResult.dates, [...holidayResult.dates].sort(), 'Public holidays must remain chronological.')
    assert.deepEqual(holidayResult.actions, ['Edit', 'Delete'])
    assert.equal(holidayResult.activeDays, '3')
    assert.ok(holidayResult.addHeight >= (width <= 700 ? 44 : 36))
    if (width <= 700) assert.equal(holidayResult.actionHeights.every((height:number)=>height>=44), true)
    holidayResults[String(width)] = holidayResult
    await cdp.evaluate(`document.querySelector('.public-holidays-panel')?.scrollIntoView({block:'start'})`)
    await sleep(100)
    const holidayCapture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(join(output, `public-holiday-calendar-${width}.png`), Buffer.from(holidayCapture.data, 'base64'))
    if (width === 430) {
      await cdp.evaluate(`document.querySelector('.holiday-add-action')?.click()`)
      assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.public-holiday-modal')`), true)
      await cdp.evaluate(`(()=>{const input=document.querySelector('.public-holiday-form input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Unsaved Holiday');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
      await sleep(100)
      await cdp.evaluate(`window.confirm=()=>false;document.querySelector('.modal-backdrop').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`)
      await sleep(100)
      assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.public-holiday-modal')`), true, 'Unsafe backdrop dismissal must be blocked when edits are unsaved.')
      await cdp.evaluate(`window.confirm=()=>true;document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
      await sleep(100)
      assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.public-holiday-modal')`), false, 'Escape must dismiss after discard confirmation.')
    }
    await cdp.evaluate(`Array.from(document.querySelectorAll('.leave-planner-module-tabs button')).find(button=>button.textContent?.trim()==='Planner')?.click()`)
    for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.leave-planner-panel .leave-planner-grid-wrap')`)) break; await sleep(100) }
    const plannerResult = await cdp.evaluate<any>(`(()=>{const shell=document.querySelector('.app-shell');const panel=document.querySelector('.leave-planner-panel');const command=document.querySelector('.leave-command-panel');const grid=document.querySelector('.leave-planner-grid-wrap');const summaryValue=document.querySelector('.leave-summary-card>b');const controls=Array.from(document.querySelectorAll('.leave-month-navigation :is(input,button),.leave-planner-filters select'));return{overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,shellBackground:getComputedStyle(shell).backgroundImage,panelBorder:getComputedStyle(panel).borderColor,panelBackground:getComputedStyle(panel).backgroundColor,commandBorder:getComputedStyle(command).borderColor,commandBackground:getComputedStyle(command).backgroundColor,gridBorder:getComputedStyle(grid).borderColor,gridContained:grid.scrollWidth>grid.clientWidth,gridWithinPage:grid.getBoundingClientRect().right<=document.documentElement.clientWidth+1,summaryFont:getComputedStyle(summaryValue).fontFamily,summaryWeight:getComputedStyle(summaryValue).fontWeight,summarySize:parseFloat(getComputedStyle(summaryValue).fontSize),controlHeights:controls.map(control=>Math.round(control.getBoundingClientRect().height)),controlBorders:controls.map(control=>getComputedStyle(control).borderColor),controlBackgrounds:controls.map(control=>getComputedStyle(control).backgroundColor)}})()`)
    assert.equal(plannerResult.overflow, false, `Planner page overflow at ${width}px.`)
    assert.equal(plannerResult.panelBorder, leaveTheme.line)
    assert.equal(plannerResult.panelBackground, leaveTheme.surface)
    assert.equal(plannerResult.commandBorder, leaveTheme.line)
    assert.equal(plannerResult.commandBackground, leaveTheme.surfaceStrong)
    assert.ok(plannerResult.controlBorders.every((color:string)=>color === leaveTheme.lineStrong), `Planner controls must use the approved violet border at ${width}px.`)
    assert.ok(plannerResult.controlBackgrounds.every((color:string)=>color === 'rgb(255, 255, 255)'), `Planner controls must not retain cream surfaces at ${width}px.`)
    assert.equal(plannerResult.gridBorder, leaveTheme.line)
    assert.equal(plannerResult.gridWithinPage, true, `Planner calendar escaped its container at ${width}px.`)
    assert.match(plannerResult.shellBackground, /linear-gradient/)
    assert.match(plannerResult.shellBackground, /rgb\(216, 194, 232\)/, 'Leave Planner must use the richer approved lilac canvas depth.')
    assert.match(plannerResult.summaryFont, /Good Sans/)
    assert.equal(plannerResult.summaryWeight, '500')
    assert.ok(plannerResult.summarySize <= 20, `Summary value typography is too large at ${width}px.`)
    assert.ok(plannerResult.controlHeights.every((height:number)=>height >= (width <= 700 ? 44 : 40)), `Planner controls are misaligned at ${width}px: ${plannerResult.controlHeights.join(', ')}.`)
    if (width <= 430) assert.equal(plannerResult.gridContained, true, `Planner calendar must retain contained horizontal scrolling at ${width}px.`)
    const detailResult = await cdp.evaluate<any>(`(()=>{const probe=document.createElement('div');probe.className='leave-details-scroll';probe.style.cssText='position:fixed;left:-10000px;top:0;width:480px;display:block';probe.innerHTML='<dl class="staff-profile-grid"><div><dt>Available Leave</dt><dd>30</dd></div><div><dt>Booked / Future</dt><dd>4</dd></div></dl>';document.querySelector('main').append(probe);const cards=Array.from(probe.querySelectorAll('.staff-profile-grid>div'));const first=getComputedStyle(cards[0]);const value=getComputedStyle(cards[0].querySelector('dd'));const result={cards:cards.length,borders:cards.map(card=>getComputedStyle(card).borderTopWidth),padding:[first.paddingTop,first.paddingRight,first.paddingBottom,first.paddingLeft],valueFont:value.fontFamily,valueWeight:value.fontWeight};probe.remove();return result})()`)
    assert.equal(detailResult.cards, 2)
    assert.ok(detailResult.borders.every((border:string)=>border === '1px'), `Employee entitlement cards must have thin lilac borders at ${width}px.`)
    assert.equal(detailResult.padding[0], detailResult.padding[2])
    assert.equal(detailResult.padding[1], detailResult.padding[3])
    assert.match(detailResult.valueFont, /Good Sans/)
    assert.equal(detailResult.valueWeight, '500')
    plannerResults[String(width)] = plannerResult
    const plannerCapture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(join(output, `planner-${width}.png`), Buffer.from(plannerCapture.data, 'base64'))

    await cdp.evaluate(`Array.from(document.querySelectorAll('.leave-planner-module-tabs button')).find(button=>button.textContent?.trim()==='Leave History')?.click()`)
    for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.leave-records-panel')`)) break; await sleep(100) }
    for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.planned-leave-history,.leave-records-panel>.save-error')`)) break; await sleep(100) }
    assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.leave-records-panel>.save-error')`), false, `Leave History failed to load at ${width}px.`)
    const historyResult = await cdp.evaluate<any>(`(()=>{const panel=document.querySelector('.leave-records-panel');const filters=document.querySelector('.leave-record-filters');const planned=document.querySelector('.planned-leave-history');const confirmed=document.querySelector('.confirmed-leave-history');const filterControls=Array.from(filters.querySelectorAll('input,select'));const tableCell=document.querySelector('.leave-records-table th');const plannedRow=document.querySelector('.planned-leave-table tbody tr');const bookedChip=plannedRow?.querySelector('.leave-type-chip.booked');const employee=document.querySelector('.leave-employee-history');if(employee&&!employee.open)employee.querySelector('summary').click();const category=employee?.querySelector('.leave-employee-history-body>section');const categoryHeader=category?.querySelector('header>div');const dateRow=employee?.querySelector('.leave-history-dates');const dateButton=dateRow?.querySelector('button');return{overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,panelBorder:getComputedStyle(panel).borderColor,panelBackground:getComputedStyle(panel).backgroundColor,filterBorder:getComputedStyle(filters).borderColor,filterBackground:getComputedStyle(filters).backgroundColor,filterHeights:filterControls.map(control=>Math.round(control.getBoundingClientRect().height)),filterBorders:filterControls.map(control=>getComputedStyle(control).borderColor),filterBackgrounds:filterControls.map(control=>getComputedStyle(control).backgroundColor),plannedBorder:planned?getComputedStyle(planned).borderColor:null,plannedBackground:planned?getComputedStyle(planned).backgroundColor:null,plannedAlignments:plannedRow?Array.from(plannedRow.children).map(cell=>getComputedStyle(cell).textAlign):[],bookedChip:bookedChip?{border:getComputedStyle(bookedChip).borderColor,background:getComputedStyle(bookedChip).backgroundColor,color:getComputedStyle(bookedChip).color}:null,confirmedBorder:confirmed?getComputedStyle(confirmed).borderColor:null,confirmedBackground:confirmed?getComputedStyle(confirmed).backgroundColor:null,tableRightBorder:tableCell?getComputedStyle(tableCell).borderRightWidth:null,tableBottomBorder:tableCell?getComputedStyle(tableCell).borderBottomWidth:null,categoryColumns:category?getComputedStyle(category).gridTemplateColumns.split(' ').length:null,categoryDivider:categoryHeader?getComputedStyle(categoryHeader).borderLeftWidth:null,dateDivider:dateRow?getComputedStyle(dateRow).borderLeftWidth:null,dateGap:dateRow?getComputedStyle(dateRow).gap:null,dateHeight:dateButton?Math.round(dateButton.getBoundingClientRect().height):null}})()`)
    const plannedStaffResult = await cdp.evaluate<any>(`(()=>{const cell=document.querySelector('.planned-leave-table .planned-staff-cell');const identity=cell?.querySelector('.planned-staff-identity');const badge=cell?.querySelector('.leave-type-chip.booked');return cell?{display:getComputedStyle(cell).display,alignment:getComputedStyle(cell).alignItems,badgeMargin:getComputedStyle(badge).marginTop,identityPresent:!!identity,badgePresent:!!badge}:null})()`)
    assert.equal(historyResult.overflow, false, `Leave History page overflow at ${width}px.`)
    assert.equal(historyResult.panelBorder, leaveTheme.line)
    assert.equal(historyResult.panelBackground, leaveTheme.surface)
    assert.equal(historyResult.filterBorder, leaveTheme.divider)
    assert.equal(historyResult.filterBackground, leaveTheme.surfaceStrong)
    assert.ok(historyResult.filterBorders.every((color:string)=>[leaveTheme.line, leaveTheme.lineStrong].includes(color)), `Leave History controls must use the approved violet/lilac border at ${width}px: ${historyResult.filterBorders.join(', ')}.`)
    assert.ok(historyResult.filterBackgrounds.every((color:string)=>color === 'rgb(255, 255, 255)'), `Leave History controls must not retain cream surfaces at ${width}px.`)
    assert.ok(historyResult.filterHeights.every((height:number)=>height >= (width <= 700 ? 44 : 40)), `Leave History controls are misaligned at ${width}px: ${historyResult.filterHeights.join(', ')}.`)
    assert.equal(historyResult.tableRightBorder, '1px')
    assert.equal(historyResult.tableBottomBorder, '1px')
    if (historyResult.plannedBorder) {
      assert.equal(historyResult.plannedBorder, leaveTheme.line)
      assert.equal(historyResult.plannedBackground, leaveTheme.surface)
      if (historyResult.plannedAlignments.length) assert.deepEqual(historyResult.plannedAlignments, ['left', 'center', 'center', 'center', 'center'])
      if (historyResult.bookedChip) {
        assert.equal(historyResult.bookedChip.border, leaveTheme.lineStrong)
        assert.equal(historyResult.bookedChip.background, leaveTheme.surfaceStrong)
        assert.equal(historyResult.bookedChip.color, leaveTheme.violet)
      }
      if (plannedStaffResult) {
        assert.equal(plannedStaffResult.display, 'flex')
        assert.equal(plannedStaffResult.alignment, 'center')
        assert.equal(plannedStaffResult.badgeMargin, '0px')
        assert.equal(plannedStaffResult.identityPresent, true)
        assert.equal(plannedStaffResult.badgePresent, true)
      }
    }
    if (historyResult.confirmedBorder) {
      assert.equal(historyResult.confirmedBorder, leaveTheme.line)
      assert.equal(historyResult.confirmedBackground, leaveTheme.surface)
    }
    if (historyResult.categoryColumns !== null) assert.equal(historyResult.categoryColumns, width <= 700 ? 1 : 3)
    if (historyResult.categoryDivider !== null) assert.equal(historyResult.categoryDivider, '1px')
    if (historyResult.dateDivider !== null) assert.equal(historyResult.dateDivider, width <= 700 ? '0px' : '1px')
    if (historyResult.dateGap !== null) assert.equal(historyResult.dateGap, '6px')
    if (historyResult.dateHeight !== null) assert.ok(historyResult.dateHeight >= (width <= 700 ? 44 : 36))
    historyResults[String(width)] = historyResult
    const historyCapture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(join(output, `leave-history-${width}.png`), Buffer.from(historyCapture.data, 'base64'))

    await cdp.evaluate(`Array.from(document.querySelectorAll('.leave-planner-module-tabs button')).find(button=>button.textContent?.trim()==='Leave Types')?.click()`)
    for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.leave-type-card')`)) break; await sleep(100) }
  }
  assert.deepEqual(cdp.errors, [])
  console.log(JSON.stringify({ responsiveWidths: Object.keys(results), plannerResponsiveWidths: Object.keys(plannerResults), historyResponsiveWidths: Object.keys(historyResults), policyResponsiveWidths: Object.keys(policyResults), employeeResponsiveWidths: Object.keys(employeeResults), offSummaryResponsiveWidths: Object.keys(offSummaryResults), publicHolidayResponsiveWidths: Object.keys(holidayResults), dutyColorsPreserved: true, runtimeErrors: cdp.errors.length, screenshots: Object.keys(results).flatMap(width => [`artifacts/visual-validation/leave-types/planner-${width}.png`, `artifacts/visual-validation/leave-types/leave-history-${width}.png`, `artifacts/visual-validation/leave-types/after-${width}.png`, `artifacts/visual-validation/leave-types/entitlement-policies-${width}.png`, `artifacts/visual-validation/leave-types/employee-entitlements-${width}.png`, `artifacts/visual-validation/leave-types/off-days-summary-${width}.png`, `artifacts/visual-validation/leave-types/public-holiday-calendar-${width}.png`]) }, null, 2))
} finally {
  socket?.close()
  for (const child of processes.reverse()) { if (child.exitCode === null) child.kill(); child.removeAllListeners(); child.unref() }
  await sleep(500)
  await rm(fixture.root, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }).catch(() => undefined)
}
