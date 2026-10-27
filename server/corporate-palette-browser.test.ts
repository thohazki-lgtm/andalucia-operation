import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const fixture = await createDisposableDevelopmentStore('corporate-palette-browser')
const profile = join(fixture.root, 'edge-profile')
const screenshots = resolve('artifacts', 'corporate-palette')
const children: ChildProcess[] = []
const token = `corporate-palette-${randomUUID()}`
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))
let socket: WebSocket | null = null
const waitFor = async (url: string) => { let detail = ''; for (let attempt = 0; attempt < 120; attempt++) { try { const response = await fetch(url); if (response.ok) return; detail = `${response.status} ${await response.text()}` } catch (error) { detail = error instanceof Error ? error.message : String(error) } await sleep(200) } throw new Error(`Timed out waiting for ${url}: ${detail}`) }
class Cdp { private id = 0; private pending = new Map<number, { resolve: (value: any) => void; reject: (error: unknown) => void }>(); errors: string[] = []; constructor(private ws: WebSocket) { ws.onmessage = event => { const message = JSON.parse(String(event.data)); if (message.id) { const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result) } else if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || 'Runtime exception') } } send(method: string, params: Record<string, unknown> = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise<any>((resolveCall, reject) => this.pending.set(id, { resolve: resolveCall, reject })) } evaluate<T>(expression: string) { return this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then(result => result.result.value as T) } }

const modules = [
  ['Dashboard', 'module-dashboard'], ['Staff Management', 'module-staff-management'], ['Duty Roster', 'module-duty-roster'],
  ['Leave Planner', 'module-leave-planner'], ['Training', 'module-training'], ['Bookings', 'module-bookings'],
  ['Guest Occasions', 'module-guest-occasions'], ['Incentives & Bill Tips', 'module-incentives-and-bill-tips'],
  ['Maintenance', 'module-maintenance'], ['Reports', 'module-reports'], ['Customization Center', 'module-customization-center']
] as const
const viewports = [{ name: 'desktop-1440', width: 1440, height: 900 }, { name: 'desktop-1024', width: 1024, height: 768 }, { name: 'tablet-768', width: 768, height: 1024 }, { name: 'mobile-430', width: 430, height: 932 }, { name: 'mobile-390', width: 390, height: 844 }, { name: 'mobile-360', width: 360, height: 800 }]

try {
  await fixture.db.query('insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval \'1 hour\')', [randomUUID(), createHash('sha256').update(token).digest('hex'), fixture.ownerId])
  await fixture.db.close()
  const node = process.execPath
  children.push(spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', API_PORT: '3044', APP_ORIGIN: 'http://127.0.0.1:5214' }, stdio: 'ignore' }))
  children.push(spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5214', '--strictPort'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3044' }, stdio: 'ignore' }))
  await Promise.all([waitFor('http://127.0.0.1:3044/api/health'), waitFor('http://127.0.0.1:5214/')])
  children.push(spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' }))
  let port = 0
  for (let attempt = 0; attempt < 200; attempt++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)[0]); if (port && (await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break } catch {} await sleep(100) }
  assert.ok(port)
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as any[]
  const page = pages.find(item => item.type === 'page'); assert.ok(page)
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise<void>((done, fail) => { socket!.onopen = () => done(); socket!.onerror = () => fail(new Error('CDP connection failed')) })
  const cdp = new Cdp(socket); await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await mkdir(screenshots, { recursive: true })
  assert.equal((await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5214/', path: '/', httpOnly: true, sameSite: 'Strict' })).success, true)
  const results = []
  for (const viewport of viewports) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width <= 430 })
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5214/' })
    for (let attempt = 0; attempt < 120; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Dashboard"]')`)) break; await sleep(100) }
    const palette = await cdp.evaluate<Record<string, string>>(`(()=>{const s=getComputedStyle(document.documentElement);return{black:s.getPropertyValue('--ao-moonlight-black').trim(),violet:s.getPropertyValue('--ao-violet-hour').trim(),turquoise:s.getPropertyValue('--ao-turquoise-coral').trim(),lilac:s.getPropertyValue('--ao-lilac-calm').trim(),teal:s.getPropertyValue('--ao-lagoon-teal').trim(),sunset:s.getPropertyValue('--ao-sunset-orange').trim(),linen:s.getPropertyValue('--ao-linen-grey').trim(),orange:s.getPropertyValue('--ao-orange-glow').trim()}})()`)
    assert.deepEqual(palette, { black: '#000000', violet: '#45176b', turquoise: '#b1e4dc', lilac: '#c0b7f0', teal: '#0c675c', sunset: '#ce6233', linen: '#fff6e4', orange: '#fca851' })
    const moduleResults = []
    for (const [label, className] of modules) {
      assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('nav button[aria-label=${JSON.stringify(label)}]');button?.click();return !!button})()`), true, `${label} navigation unavailable`)
      for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`document.querySelector('.page-header h1')?.textContent===${JSON.stringify(label)}`)) break; await sleep(75) }
      const result = await cdp.evaluate<any>(`(()=>{const main=document.querySelector('main'),header=main.querySelector(':scope > .page-header'),bar=getComputedStyle(header,'::before'),eyebrow=header.querySelector('.eyebrow'),logo=document.querySelector('.sidebar-wordmark .andalucia-wordmark-image');const box=logo.getBoundingClientRect();return{page:header.querySelector('h1')?.textContent,className:main.classList.contains(${JSON.stringify(className)}),barWidth:parseFloat(bar.width),barColor:bar.backgroundColor,eyebrowColor:getComputedStyle(eyebrow).color,overflow:document.documentElement.scrollWidth-innerWidth,logoRatio:box.width/box.height,canvas:getComputedStyle(main).backgroundColor}})()`)
      assert.equal(result.page, label)
      assert.equal(result.className, true, `${label} has no module theme class`)
      assert.ok(result.barWidth >= 2 && result.barWidth <= 3, `${label} accent is not restrained`)
      assert.ok(!['rgba(0, 0, 0, 0)', 'transparent'].includes(result.barColor), `${label} accent is invisible`)
      assert.ok(!['rgba(0, 0, 0, 0)', 'transparent'].includes(result.eyebrowColor), `${label} heading accent is invisible`)
      assert.ok(result.overflow <= 1, `${label} overflows at ${viewport.width}px`)
      assert.ok(result.logoRatio > 2.98 && result.logoRatio < 3.02, `${label} logo proportions changed`)
      assert.equal(result.canvas, 'rgb(255, 251, 243)', `${label} does not use the warm corporate canvas`)
      moduleResults.push({ label, ...result })
    }
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true })
    await writeFile(join(screenshots, `corporate-palette-${viewport.name}.png`), Buffer.from(shot.data, 'base64'))
    results.push({ viewport: viewport.name, modules: moduleResults })
  }
  assert.deepEqual(cdp.errors, [])
  console.log(JSON.stringify({ status: 'PASS', isolated: true, canonicalDatabaseTouched: false, viewports: viewports.map(item => item.name), modules: modules.map(item => item[0]), screenshots: viewports.map(item => `artifacts/corporate-palette/corporate-palette-${item.name}.png`), results }, null, 2))
} finally {
  socket?.close(); for (const child of children.reverse()) { if (child.exitCode === null) child.kill(); child.removeAllListeners(); child.unref() } await sleep(800); await rm(fixture.root, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(() => undefined)
}
