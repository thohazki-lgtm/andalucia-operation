import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const fixture = await createDisposableDevelopmentStore('bookings-customization-ui')
const profile = join(fixture.root, 'edge-profile')
const output = resolve('artifacts', 'visual-validation', 'bookings-customization')
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
  await fixture.db.close()

  const node = process.execPath
  let runtimeOutput = ''
  const api = spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', API_PORT: '3017', APP_ORIGIN: 'http://127.0.0.1:5187' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const vite = spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5187', '--strictPort'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3017' }, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const child of [api, vite]) { child.stdout?.on('data', chunk => { runtimeOutput += String(chunk) }); child.stderr?.on('data', chunk => { runtimeOutput += String(chunk) }) }
  processes.push(api, vite)
  try { await Promise.all([waitFor('http://127.0.0.1:3017/api/health'), waitFor('http://127.0.0.1:5187/')]) } catch (error) { throw new Error(`${error instanceof Error ? error.message : error}\n${runtimeOutput}`) }

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
  await cdp.evaluate(`Array.from(document.querySelectorAll('.customization-category-nav button')).find(button=>button.textContent?.trim()==='Bookings')?.click()`)
  for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.booking-config-r2')`)) break; await sleep(100) }
  await sleep(500)

  const baseline = await cdp.evaluate<any>(`({statuses:document.querySelectorAll('.booking-status-config-row').length,protected:document.querySelectorAll('.booking-status-config-row .protected-config').length,ranges:document.querySelectorAll('.table-range-row').length,walkInFields:document.querySelectorAll('.walk-in-field-row').length})`)
  assert.ok(baseline.statuses >= 5)
  assert.ok(baseline.protected >= 1)
  assert.ok(baseline.ranges >= 1)
  assert.ok(baseline.walkInFields >= 5)

  const responsive: Record<string, unknown> = {}
  for (const width of [1440, 1024, 768, 430, 390, 360]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width <= 430 ? 940 : 1000, deviceScaleFactor: 1, mobile: false })
    await sleep(180)
    const result = await cdp.evaluate<any>(`(()=>{const root=document.querySelector('.booking-config-r2');const panels=Array.from(root.querySelectorAll('.booking-config-section'));const status=panels[0],ranges=panels[1],walkIn=panels[2];const statusRows=Array.from(status.querySelectorAll('.booking-status-config-row'));const rangeRows=Array.from(ranges.querySelectorAll('.table-range-row'));const fieldRows=Array.from(walkIn.querySelectorAll('.walk-in-field-row'));const modes=Array.from(walkIn.querySelectorAll('.field-mode-control'));const actionButtons=Array.from(root.querySelectorAll('.compact-config-action'));return{overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,rootOverflow:root.scrollWidth>root.clientWidth+1,columns:getComputedStyle(root).gridTemplateColumns.split(' ').length,panelBorders:panels.map(panel=>getComputedStyle(panel).borderColor),panelBackgrounds:panels.map(panel=>getComputedStyle(panel).backgroundColor),panelRadii:panels.map(panel=>getComputedStyle(panel).borderRadius),balanced:Math.abs(status.getBoundingClientRect().width-ranges.getBoundingClientRect().width)<2,statuses:statusRows.length,protected:status.querySelectorAll('.protected-config').length,ranges:rangeRows.length,walkInFields:fieldRows.length,statusHeights:statusRows.map(row=>Math.round(row.getBoundingClientRect().height)),rangeHeights:rangeRows.map(row=>Math.round(row.getBoundingClientRect().height)),walkInColumns:getComputedStyle(walkIn.querySelector('.walk-in-field-list')).gridTemplateColumns.split(' ').length,fieldHeights:fieldRows.map(row=>Math.round(row.getBoundingClientRect().height)),modeContained:modes.every(mode=>mode.scrollWidth<=mode.clientWidth+1),modeButtonHeights:Array.from(walkIn.querySelectorAll('.field-mode-control button')).map(button=>Math.round(button.getBoundingClientRect().height)),actionHeights:actionButtons.map(button=>Math.round(button.getBoundingClientRect().height)),swatchesPreserved:Array.from(status.querySelectorAll('.booking-config-swatch')).every(swatch=>getComputedStyle(swatch).backgroundColor!=='rgba(0, 0, 0, 0)')}})()`)
    assert.equal(result.overflow, false, `Page overflow at ${width}px.`)
    assert.equal(result.rootOverflow, false, `Bookings customization overflow at ${width}px.`)
    assert.equal(result.columns, width <= 900 ? 1 : 2)
    if (width > 900) assert.equal(result.balanced, true)
    assert.equal(result.panelBorders.every((value: string) => value === 'rgb(222, 197, 143)'), true, `${width}px panel borders: ${result.panelBorders.join(', ')}`)
    assert.equal(result.panelBackgrounds.every((value: string) => value === 'rgb(255, 253, 248)'), true)
    assert.equal(result.panelRadii.every((value: string) => value === '12px'), true)
    assert.deepEqual({ statuses: result.statuses, protected: result.protected, ranges: result.ranges, walkInFields: result.walkInFields }, baseline)
    assert.equal(result.statusHeights.every((height: number) => height <= (width <= 700 ? 82 : 56)), true, `${width}px status heights: ${result.statusHeights.join(', ')}`)
    assert.equal(result.rangeHeights.every((height: number) => height <= (width <= 390 ? 100 : width <= 700 ? 66 : 58)), true, `${width}px range heights: ${result.rangeHeights.join(', ')}`)
    assert.equal(result.walkInColumns, width <= 1024 ? 1 : 2)
    assert.equal(result.fieldHeights.every((height: number) => height <= (width <= 700 ? 104 : 62)), true, `${width}px field heights: ${result.fieldHeights.join(', ')}`)
    assert.equal(result.modeContained, true)
    assert.equal(result.modeButtonHeights.every((height: number) => height >= (width <= 700 ? 40 : 30)), true)
    assert.equal(result.actionHeights.every((height: number) => height >= (width <= 700 ? 44 : 36)), true, `${width}px action heights: ${result.actionHeights.join(', ')}`)
    assert.equal(result.swatchesPreserved, true)
    responsive[String(width)] = result
    await cdp.evaluate(`document.querySelector('.booking-config-r2')?.scrollIntoView({block:'start'})`)
    await sleep(80)
    const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const target = join(output, `bookings-customization-${width}.png`)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, Buffer.from(capture.data, 'base64'))
  }

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await cdp.evaluate(`Array.from(document.querySelectorAll('.table-range-section button')).find(button=>button.textContent?.includes('Add Range'))?.click()`)
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.booking-config-modal .table-range-form')`), true)
  const rangeModal = await cdp.evaluate<any>(`(()=>{const modal=document.querySelector('.booking-config-modal');const form=modal.querySelector('.table-range-form');return{columns:getComputedStyle(form).gridTemplateColumns.split(' ').length,border:getComputedStyle(modal).borderColor,background:getComputedStyle(modal).backgroundColor,closeIcon:!!modal.querySelector('.close'),overflow:modal.scrollWidth>modal.clientWidth+1,buttons:Array.from(modal.querySelectorAll('.form-actions button')).map(button=>button.textContent.trim())}})()`)
  assert.equal(rangeModal.columns, 2)
  assert.equal(rangeModal.border, 'rgb(222, 197, 143)')
  assert.equal(rangeModal.background, 'rgb(255, 253, 248)')
  assert.equal(rangeModal.closeIcon, false)
  assert.equal(rangeModal.overflow, false)
  assert.deepEqual(rangeModal.buttons, ['Cancel', 'Save'])
  await cdp.evaluate(`document.querySelector('.booking-config-modal .form-actions button')?.click()`)

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.evaluate(`Array.from(document.querySelectorAll('.status-config-section button')).find(button=>button.textContent?.includes('Add Status'))?.click()`)
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.booking-config-modal .booking-status-form-grid')`), true)
  await cdp.evaluate(`(()=>{const input=document.querySelector('.booking-status-form-grid input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Unsaved Status');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await sleep(80)
  await cdp.evaluate(`window.confirm=()=>false;document.querySelector('.modal-backdrop').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`)
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.booking-config-modal')`), true, 'Backdrop must not discard unsaved status changes without confirmation.')
  await cdp.evaluate(`window.confirm=()=>true;document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
  await sleep(80)
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.booking-config-modal')`), false, 'Escape must dismiss after discard confirmation.')
  assert.deepEqual(cdp.errors, [])
  console.log(JSON.stringify({ responsiveWidths: Object.keys(responsive), protectedStatusesPreserved: baseline.protected, screenshots: Object.keys(responsive).map(width => `artifacts/visual-validation/bookings-customization/bookings-customization-${width}.png`), runtimeErrors: cdp.errors.length }, null, 2))
} finally {
  socket?.close()
  for (const child of processes.reverse()) { if (child.exitCode === null) child.kill(); child.removeAllListeners(); child.unref() }
  await sleep(500)
  await rm(fixture.root, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }).catch(() => undefined)
}
