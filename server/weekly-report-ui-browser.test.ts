import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const fixture = await createDisposableDevelopmentStore('weekly-report-ui')
const profile = join(fixture.root, 'edge-profile')
const children: ChildProcess[] = []
const token = `weekly-ui-${randomUUID()}`
const screenshots = resolve('artifacts', 'weekly-report-ui-refinement')
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))
let socket: WebSocket | null = null

const waitFor = async (url: string) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(url)).ok) return } catch {}
    await sleep(150)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

class Cdp {
  private id = 0
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: unknown) => void }>()
  constructor(private readonly ws: WebSocket) {
    ws.onmessage = event => {
      const message = JSON.parse(String(event.data))
      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result)
    }
  }
  send(method: string, params: Record<string, unknown> = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise<any>((resolvePromise, reject) => this.pending.set(id, { resolve: resolvePromise, reject }))
  }
  evaluate<T>(expression: string) { return this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then(result => result.result.value as T) }
}

try {
  await fixture.db.query("insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval '1 hour')", [randomUUID(), createHash('sha256').update(token).digest('hex'), fixture.ownerId])
  await fixture.db.close()
  const node = process.execPath
  children.push(spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', API_PORT: '3028', APP_ORIGIN: 'http://127.0.0.1:5198' }, stdio: 'ignore' }))
  children.push(spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5198', '--strictPort'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3028' }, stdio: 'ignore' }))
  await Promise.all([waitFor('http://127.0.0.1:3028/api/health'), waitFor('http://127.0.0.1:5198/')])

  children.push(spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--edge-skip-compat-layer-relaunch', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' }))
  let port = 0
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)[0]); if (port) break } catch {}
    await sleep(100)
  }
  assert.ok(port, 'Headless Edge debugging port was not available.')
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{ type: string; webSocketDebuggerUrl: string }>
  const page = pages.find(item => item.type === 'page')
  assert.ok(page)
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise<void>((done, fail) => { socket!.onopen = () => done(); socket!.onerror = () => fail(new Error('CDP connection failed')) })
  const cdp = new Cdp(socket)
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Network.enable')
  assert.equal((await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5198/', path: '/', httpOnly: true, sameSite: 'Strict' })).success, true)
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5198/' })
  for (let attempt = 0; attempt < 100; attempt += 1) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Reports"]')`)) break; await sleep(120) }
  await cdp.evaluate(`document.querySelector('button[aria-label="Reports"]')?.click()`)
  for (let attempt = 0; attempt < 100; attempt += 1) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.report-mode-tabs')`)) break; await sleep(120) }
  await cdp.evaluate(`Array.from(document.querySelectorAll('.report-mode-tabs button')).find(button=>button.textContent?.trim()==='Weekly')?.click()`)
  for (let attempt = 0; attempt < 100; attempt += 1) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.weekly-service-charges')&&!document.querySelector('.inline-state')`)) break; await sleep(120) }
  await mkdir(screenshots, { recursive: true })

  const results: unknown[] = []
  for (const viewport of [{ name: 'desktop-1440', width: 1440, height: 900, mobile: false }, { name: 'desktop-1024', width: 1024, height: 768, mobile: false }, { name: 'tablet-768', width: 768, height: 1024, mobile: false }, { name: 'mobile-430', width: 430, height: 932, mobile: true }, { name: 'mobile-390', width: 390, height: 844, mobile: true }, { name: 'mobile-360', width: 360, height: 800, mobile: true }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile })
    await sleep(150)
    const state = await cdp.evaluate<any>(`(()=>{const gold='rgb(222, 197, 143)';const sections=Array.from(document.querySelectorAll('.weekly-report>.monthly-dashboard-section,.weekly-authority-grid>.monthly-dashboard-section'));const pair=document.querySelector('.weekly-authority-grid');const pairSections=Array.from(pair.children);const service=document.querySelector('.weekly-service-charges');const bounds=node=>{const rect=node.getBoundingClientRect();return{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width}};return{commentaryVisible:document.body.textContent.includes('Weekly Commentary')||!!document.querySelector('.weekly-commentary'),serviceVisible:!!service,serviceText:service?.textContent||'',sectionCount:sections.length,goldSections:sections.every(node=>getComputedStyle(node).borderColor===gold),goldTables:Array.from(document.querySelectorAll('.weekly-report .report-table-wrap')).every(node=>getComputedStyle(node).borderColor===gold),pairColumns:getComputedStyle(pair).gridTemplateColumns.split(' ').length,pairBounds:bounds(pair),first:bounds(pairSections[0]),second:bounds(pairSections[1]),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,clipped:sections.filter(node=>{const rect=node.getBoundingClientRect();return rect.left<-1||rect.right>innerWidth+1}).length}})()`)
    assert.equal(state.commentaryVisible, false)
    assert.equal(state.serviceVisible, true)
    assert.match(state.serviceText, /Approved service-charge total/)
    assert.match(state.serviceText, /0 \/ 7/)
    assert.equal(state.goldSections, true)
    assert.equal(state.goldTables, true)
    assert.equal(state.overflow, false)
    assert.equal(state.clipped, 0)
    const desktopPair = viewport.width > 900
    assert.equal(state.pairColumns, desktopPair ? 2 : 1)
    if (desktopPair) assert.ok(Math.abs(state.first.width - state.second.width) < 1, `Comparison and Service Charges widths differ at ${viewport.width}px.`)
    const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true })
    await writeFile(join(screenshots, `weekly-report-${viewport.name}.png`), Buffer.from(capture.data, 'base64'))
    results.push({ viewport: viewport.name, ...state })
  }
  console.log(JSON.stringify({ weeklyReportUi: true, schema: '027', canonicalDatabaseTouched: false, results }, null, 2))
} finally {
  socket?.close()
  for (const child of children.reverse()) { if (child.exitCode === null) child.kill(); child.removeAllListeners(); child.unref() }
  await sleep(600)
  await rm(fixture.root, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(() => undefined)
}
