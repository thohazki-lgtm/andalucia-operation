import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'
import { ChargeableRepository } from './chargeable-repository.js'

const fixture = await createDisposableDevelopmentStore('chargeable-customization-ui')
const profile = join(fixture.root, 'edge-profile')
const output = resolve('artifacts', 'visual-validation', 'chargeable-customization')
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
  await new ChargeableRepository(fixture.db).initialize()
  await fixture.db.close()

  const node = process.execPath
  let runtimeOutput = ''
  const api = spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', API_PORT: '3018', APP_ORIGIN: 'http://127.0.0.1:5188' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const vite = spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5188', '--strictPort'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3018' }, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const child of [api, vite]) { child.stdout?.on('data', chunk => { runtimeOutput += String(chunk) }); child.stderr?.on('data', chunk => { runtimeOutput += String(chunk) }) }
  processes.push(api, vite)
  try { await Promise.all([waitFor('http://127.0.0.1:3018/api/health'), waitFor('http://127.0.0.1:5188/')]) } catch (error) { throw new Error(`${error instanceof Error ? error.message : error}\n${runtimeOutput}`) }

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
  assert.equal((await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5188/', path: '/', httpOnly: true, sameSite: 'Strict' })).success, true)
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5188/' })
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Customization Center"]')`)) break; await sleep(100) }
  await cdp.evaluate(`document.querySelector('button[aria-label="Customization Center"]')?.click()`)
  for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.customization-category-nav')`)) break; await sleep(100) }
  await cdp.evaluate(`Array.from(document.querySelectorAll('.customization-category-nav button')).find(button=>button.textContent?.trim()==='Chargeable')?.click()`)
  for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.chargeable-config')`)) break; await sleep(100) }

  const baseline = await cdp.evaluate<any>(`({items:document.querySelectorAll('.chargeable-item-config-row').length,statuses:document.querySelectorAll('.chargeable-status-config-row').length,protectionNotes:document.querySelectorAll('.chargeable-protection-note').length,emptyCatalog:!!document.querySelector('.chargeable-catalog-empty'),title:document.querySelector('.chargeable-config h3')?.textContent?.trim()})`)
  assert.ok(baseline.items >= 5)
  assert.equal(baseline.statuses, 3)
  assert.equal(baseline.protectionNotes, 1)
  assert.equal(baseline.emptyCatalog, true)
  assert.equal(baseline.title, 'Chargeable Settings')

  const responsive: Record<string, unknown> = {}
  for (const width of [1440, 1024, 768, 430, 390, 360]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width <= 430 ? 940 : 1000, deviceScaleFactor: 1, mobile: false })
    await sleep(180)
    const result = await cdp.evaluate<any>(`(()=>{const root=document.querySelector('.chargeable-config');const grid=root.querySelector('.chargeable-config-grid');const cards=Array.from(root.querySelectorAll('.chargeable-config-card'));const itemRows=Array.from(root.querySelectorAll('.chargeable-item-config-row'));const statusRows=Array.from(root.querySelectorAll('.chargeable-status-config-row'));const actions=Array.from(root.querySelectorAll('button'));const firstTwo=cards.slice(0,2);return{overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,rootOverflow:root.scrollWidth>root.clientWidth+1,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,borders:cards.map(card=>getComputedStyle(card).borderColor),radii:cards.map(card=>getComputedStyle(card).borderRadius),backgrounds:cards.map(card=>getComputedStyle(card).backgroundColor),balanced:Math.abs(firstTwo[0].getBoundingClientRect().width-firstTwo[1].getBoundingClientRect().width)<2,itemRows:itemRows.length,statusRows:statusRows.length,protectedBadges:Array.from(root.querySelectorAll('*')).filter(node=>node.textContent?.trim()==='Protected').length,wineFullWidth:Math.abs(cards[2].getBoundingClientRect().width-root.getBoundingClientRect().width+parseFloat(getComputedStyle(root).paddingLeft)+parseFloat(getComputedStyle(root).paddingRight))<3,actionHeights:actions.map(button=>Math.round(button.getBoundingClientRect().height)),smallTargets:${width}>700||actions.filter(button=>button.getBoundingClientRect().height<44).map(button=>button.textContent?.trim()||button.getAttribute('aria-label')),itemRowOverflow:itemRows.some(row=>row.scrollWidth>row.clientWidth+1),statusRowOverflow:statusRows.some(row=>row.scrollWidth>row.clientWidth+1)}})()`)
    assert.equal(result.overflow, false, `Page overflow at ${width}px.`)
    assert.equal(result.rootOverflow, false, `Chargeable configuration overflow at ${width}px.`)
    assert.equal(result.columns, width <= 820 ? 1 : 2)
    if (width > 820) assert.equal(result.balanced, true)
    assert.equal(result.borders.every((value: string) => value === 'rgb(222, 197, 143)'), true)
    assert.equal(result.radii.every((value: string) => value === '11px'), true)
    assert.equal(result.backgrounds.every((value: string) => value === 'rgb(255, 253, 248)'), true)
    assert.deepEqual({ itemRows: result.itemRows, statusRows: result.statusRows }, { itemRows: baseline.items, statusRows: baseline.statuses })
    assert.equal(result.protectedBadges, 0)
    assert.equal(result.wineFullWidth, true)
    assert.deepEqual(result.smallTargets, width <= 700 ? [] : true)
    assert.equal(result.itemRowOverflow, false)
    assert.equal(result.statusRowOverflow, false)
    responsive[String(width)] = result
    await cdp.evaluate(`document.querySelector('.chargeable-config')?.scrollIntoView({block:'start'})`)
    const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const target = join(output, `chargeable-customization-${width}.png`)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, Buffer.from(capture.data, 'base64'))
  }

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.evaluate(`Array.from(document.querySelectorAll('.chargeable-config-card button')).find(button=>button.textContent?.includes('Add item'))?.click()`)
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.chargeable-config-modal')`), true)
  const modal = await cdp.evaluate<any>(`(()=>{const modal=document.querySelector('.chargeable-config-modal'),form=modal.querySelector('.chargeable-config-form'),active=form.querySelector('.chargeable-config-active');return{overflow:modal.scrollWidth>modal.clientWidth+1,columns:getComputedStyle(form).gridTemplateColumns.split(' ').length,closeSize:Math.round(modal.querySelector('.close').getBoundingClientRect().width),activeHeight:Math.round(active.getBoundingClientRect().height),buttons:Array.from(form.querySelectorAll('.form-actions button')).map(button=>button.textContent.trim())}})()`)
  assert.deepEqual({ overflow: modal.overflow, columns: modal.columns, buttons: modal.buttons }, { overflow: false, columns: 1, buttons: ['Cancel', 'Save configuration'] })
  assert.ok(modal.closeSize <= 36)
  assert.ok(modal.activeHeight <= 44)
  await cdp.evaluate(`(()=>{const input=document.querySelector('.chargeable-config-form input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Unsaved Chargeable');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await sleep(80)
  await cdp.evaluate(`window.confirm=()=>false;document.querySelector('.modal-backdrop').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`)
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.chargeable-config-modal')`), true, 'Backdrop must not discard unsaved chargeable changes without confirmation.')
  await cdp.evaluate(`window.confirm=()=>true;document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
  await sleep(80)
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.chargeable-config-modal')`), false, 'Escape must dismiss after discard confirmation.')
  assert.deepEqual(cdp.errors, [])
  console.log(JSON.stringify({ responsiveWidths: Object.keys(responsive), navigationRenamed: true, balancedDesktopPanels: true, compactMobileRows: true, singleProtectionNote: true, emptyCatalogVerified: true, unsavedChangesProtected: true, screenshots: Object.keys(responsive).map(width => `artifacts/visual-validation/chargeable-customization/chargeable-customization-${width}.png`), runtimeErrors: cdp.errors.length }, null, 2))
} finally {
  socket?.close()
  for (const child of processes.reverse()) { if (child.exitCode === null) child.kill(); child.removeAllListeners(); child.unref() }
  await sleep(500)
  await rm(fixture.root, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }).catch(() => undefined)
}
