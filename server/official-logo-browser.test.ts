import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const fixture = await createDisposableDevelopmentStore('official-logo-browser')
const profile = join(fixture.root, 'edge-profile')
const screenshots = resolve('artifacts', 'official-logo')
const children: ChildProcess[] = []
const token = `official-logo-${randomUUID()}`
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))
let socket: WebSocket | null = null
const waitFor = async (url: string) => { let lastResponse = ''; for (let attempt = 0; attempt < 120; attempt++) { try { const response = await fetch(url); if (response.ok) return; lastResponse = `${response.status} ${await response.text()}` } catch (error) { lastResponse = error instanceof Error ? error.message : String(error) } await sleep(200) } throw new Error(`Timed out waiting for ${url}: ${lastResponse}`) }
class Cdp { private id = 0; private pending = new Map<number, { resolve: (value: any) => void; reject: (error: unknown) => void }>(); errors: string[] = []; constructor(private ws: WebSocket) { ws.onmessage = event => { const message = JSON.parse(String(event.data)); if (message.id) { const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result) } else if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || 'Runtime exception') } } send(method: string, params: Record<string, unknown> = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise<any>((resolveCall, reject) => this.pending.set(id, { resolve: resolveCall, reject })) } evaluate<T>(expression: string) { return this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then(result => result.result.value as T) } }

try {
  await fixture.db.query('insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval \'1 hour\')', [randomUUID(), createHash('sha256').update(token).digest('hex'), fixture.ownerId])
  await fixture.db.close()
  const node = process.execPath
  children.push(spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', API_PORT: '3042', APP_ORIGIN: 'http://127.0.0.1:5212' }, stdio: 'ignore' }))
  children.push(spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5212', '--strictPort'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3042' }, stdio: 'ignore' }))
  await Promise.all([waitFor('http://127.0.0.1:3042/api/health'), waitFor('http://127.0.0.1:5212/')])
  children.push(spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' }))
  let port = 0
  for (let attempt = 0; attempt < 200; attempt++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)[0]); if (port && (await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break } catch {} await sleep(100) }
  assert.ok(port)
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as any[]
  const page = pages.find(item => item.type === 'page'); assert.ok(page)
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise<void>((done, fail) => { socket!.onopen = () => done(); socket!.onerror = () => fail(new Error('CDP connection failed')) })
  const cdp = new Cdp(socket); await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await mkdir(screenshots, { recursive: true })
  const results = []
  for (const viewport of [{ name: 'desktop-1440', width: 1440, height: 900, mobile: false }, { name: 'desktop-1024', width: 1024, height: 768, mobile: false }, { name: 'tablet-768', width: 768, height: 1024, mobile: false }, { name: 'mobile-430', width: 430, height: 932, mobile: true }, { name: 'mobile-390', width: 390, height: 844, mobile: true }, { name: 'mobile-360', width: 360, height: 800, mobile: true }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile })
    await cdp.send('Network.clearBrowserCookies'); await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5212/' })
    for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.auth-brand .andalucia-wordmark-image')&&!!document.querySelector('.auth-card')`)) break; await sleep(100) }
    const login = await cdp.evaluate<any>(`(()=>{const image=document.querySelector('.auth-brand .andalucia-wordmark-image'),box=image.getBoundingClientRect(),subtitle=document.querySelector('.auth-brand .brand-operation'),page=document.querySelector('.auth-page'),brand=document.querySelector('.auth-brand-panel'),access=document.querySelector('.auth-access-panel'),card=document.querySelector('.auth-card'),button=card.querySelector('.primary'),inputs=Array.from(card.querySelectorAll('input'));const pageColumns=getComputedStyle(page).gridTemplateColumns,pageBox=page.getBoundingClientRect();return{loaded:image.complete&&image.naturalWidth===2172&&image.naturalHeight===724,ratio:box.width/box.height,subtitle:subtitle?.textContent,overflow:document.documentElement.scrollWidth>innerWidth+1,pageEdgeToEdge:Math.abs(pageBox.left)<=1&&Math.abs(pageBox.right-innerWidth)<=1,brandBackground:getComputedStyle(brand).backgroundColor,accessBackground:getComputedStyle(access).backgroundColor,buttonBackground:getComputedStyle(button).backgroundColor,columns:pageColumns.trim().split(/\\s+/).length,brandAboveCard:brand.getBoundingClientRect().bottom<=card.getBoundingClientRect().top+1,cardVisible:card.getBoundingClientRect().left>=0&&card.getBoundingClientRect().right<=innerWidth+1,inputsVisible:inputs.every(input=>input.getBoundingClientRect().right<=innerWidth+1)}})()`)
    assert.equal(login.loaded, true); assert.ok(login.ratio > 2.98 && login.ratio < 3.02); assert.equal(login.subtitle, 'OPERATION'); assert.equal(login.overflow, false)
    assert.equal(login.pageEdgeToEdge, true); assert.equal(login.brandBackground, 'rgb(18, 59, 66)'); assert.equal(login.accessBackground, 'rgb(255, 246, 228)'); assert.equal(login.buttonBackground, 'rgb(12, 103, 92)')
    assert.equal(login.columns, viewport.width <= 820 ? 1 : 2); assert.equal(login.brandAboveCard, viewport.width <= 820); assert.equal(login.cardVisible, true); assert.equal(login.inputsVisible, true)
    const loginImage = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }); await writeFile(join(screenshots, `official-logo-login-${viewport.name}.png`), Buffer.from(loginImage.data, 'base64'))
    assert.equal((await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5212/', path: '/', httpOnly: true, sameSite: 'Strict' })).success, true)
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5212/' })
    for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Dashboard"]')`)) break; await sleep(100) }
    const mobileHeader = await cdp.evaluate<boolean>(`${viewport.mobile} ? (()=>{const node=document.querySelector('.mobile-wordmark .andalucia-wordmark-image'),box=node.getBoundingClientRect();return getComputedStyle(document.querySelector('.mobile-topbar')).display==='flex'&&box.width>0&&box.right<=innerWidth+1})() : getComputedStyle(document.querySelector('.mobile-topbar')).display==='none'`)
    assert.equal(mobileHeader, true)
    if (viewport.mobile) { const headerImage = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }); await writeFile(join(screenshots, `official-logo-header-${viewport.name}.png`), Buffer.from(headerImage.data, 'base64')) }
    if (viewport.mobile) await cdp.evaluate(`document.querySelector('.menu-button')?.click()`)
    await sleep(300)
    const shell = await cdp.evaluate<any>(`(()=>{const sidebar=document.querySelector('.sidebar-wordmark .andalucia-wordmark-image'),mobile=document.querySelector('.mobile-wordmark .andalucia-wordmark-image'),visible=node=>{const box=node.getBoundingClientRect(),style=getComputedStyle(node);return style.display!=='none'&&box.width>0&&box.height>0&&box.left>=-1&&box.right<=innerWidth+1};return{sidebar:visible(sidebar),mobile:${viewport.mobile}?visible(mobile):getComputedStyle(document.querySelector('.mobile-topbar')).display==='none',ratio:sidebar.getBoundingClientRect().width/sidebar.getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth+1}})()`)
    assert.equal(shell.sidebar, true, `${viewport.name} sidebar wordmark not visible`); assert.equal(shell.mobile, true, `${viewport.name} mobile header state invalid`); assert.ok(shell.ratio > 2.98 && shell.ratio < 3.02); assert.equal(shell.overflow, false)
    const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }); await writeFile(join(screenshots, `official-logo-${viewport.name}.png`), Buffer.from(image.data, 'base64'))
    results.push({ viewport: viewport.name, login, mobileHeader, shell })
  }
  assert.deepEqual(cdp.errors, [])
  console.log(JSON.stringify({ responsive: true, canonicalDatabaseTouched: false, screenshots: results.map(result => `artifacts/official-logo/official-logo-${result.viewport}.png`), results }, null, 2))
} finally {
  socket?.close(); for (const child of children.reverse()) { if (child.exitCode === null) child.kill(); child.removeAllListeners(); child.unref() } await sleep(700); await rm(fixture.root, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(() => undefined)
}
