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
  const screenshotPaths: string[] = []
  for (const viewport of viewports) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width <= 430 })
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5214/' })
    for (let attempt = 0; attempt < 120; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Dashboard"]')`)) break; await sleep(100) }
    assert.equal(await cdp.evaluate<boolean>(`Promise.all([document.fonts.load('400 16px "AO Good Sans"'),document.fonts.load('500 28px "AO Dahlia"')]).then(()=>document.fonts.check('400 16px "AO Good Sans"')&&document.fonts.check('500 28px "AO Dahlia"'))`), true, 'official local brand fonts did not load')
    const palette = await cdp.evaluate<Record<string, string>>(`(()=>{const s=getComputedStyle(document.documentElement);return{black:s.getPropertyValue('--ao-moonlight-black').trim(),violet:s.getPropertyValue('--ao-violet-hour').trim(),turquoise:s.getPropertyValue('--ao-turquoise-coral').trim(),lilac:s.getPropertyValue('--ao-lilac-calm').trim(),teal:s.getPropertyValue('--ao-lagoon-teal').trim(),sunset:s.getPropertyValue('--ao-sunset-orange').trim(),linen:s.getPropertyValue('--ao-linen-grey').trim(),orange:s.getPropertyValue('--ao-orange-glow').trim()}})()`)
    assert.deepEqual(palette, { black: '#000000', violet: '#45176b', turquoise: '#b1e4dc', lilac: '#c0b7f0', teal: '#0c675c', sunset: '#ce6233', linen: '#fff6e4', orange: '#fca851' })
    const moduleResults = []
    for (const [label, className] of modules) {
      assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('nav button[aria-label=${JSON.stringify(label)}]');button?.click();return !!button})()`), true, `${label} navigation unavailable`)
      for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`document.querySelector('.page-header h1')?.textContent===${JSON.stringify(label)}`)) break; await sleep(75) }
      const result = await cdp.evaluate<any>(`(()=>{const main=document.querySelector('main'),mainStyle=getComputedStyle(main),header=main.querySelector(':scope > .page-header'),pageTitle=header.querySelector('h1'),headerStyle=getComputedStyle(header),bar=getComputedStyle(header,'::before'),eyebrow=header.querySelector('.eyebrow'),selected=document.querySelector('.app-sidebar nav .selected'),selectedStyle=getComputedStyle(selected),selectedIcon=selected.querySelector('.nav-icon'),sectionHeading=main.querySelector('.panel-title,.section-heading,.workforce-section-title,.config-heading,.monthly-dashboard-section>header'),sectionStyle=sectionHeading?getComputedStyle(sectionHeading):null,panel=main.querySelector('.panel'),panelStyle=panel?getComputedStyle(panel):null,tableCell=main.querySelector('table th,table td'),tableCellStyle=tableCell?getComputedStyle(tableCell):null,control=[...main.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="color"]),select,textarea')].find(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0}),controlStyle=control?getComputedStyle(control):null,primary=[...main.querySelectorAll('.ao-action--primary,.primary')].find(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0}),primaryStyle=primary?getComputedStyle(primary):null,structural=[...main.querySelectorAll('.panel,section,article,.staff-tools,.training-tools,.booking-tools,.service-tools,.occasion-filters,.chargeable-filters,.maintenance-filters,.attendance-toolbar,.report-controls,input:not([type="checkbox"]):not([type="radio"]):not([type="color"]),select,textarea,.field-mode-control,.ao-icon-action,[class$="-row"],[class*="-row "],[class$="-rows"],[class*="-rows "],[class$="-list"],[class*="-list "],[class$="-cards"],[class*="-cards "],table th,table td')].filter(node=>{const s=getComputedStyle(node),r=node.getBoundingClientRect();return r.width>0&&r.height>0&&s.borderTopStyle!=='none'&&!node.matches('.error-state,.exception,.attention,.attention-card,.urgent,.danger,.open,.progress,.complete,.achieved,.cancelled,.badge,.status-dot,.ao-status-pill,.compact-state,.protected-config,.field-control-state,[style]')});const goldStructural=structural.filter(node=>getComputedStyle(node).borderTopColor==='rgb(222, 197, 143)'),goldStructuralBorders=goldStructural.length,goldStructuralDetails=goldStructural.map(node=>({tag:node.tagName.toLowerCase(),className:node.className})),logo=document.querySelector('.sidebar-wordmark .andalucia-wordmark-image');const box=logo.getBoundingClientRect();return{page:pageTitle?.textContent,titleFont:getComputedStyle(pageTitle).fontFamily,className:main.classList.contains(${JSON.stringify(className)}),barWidth:parseFloat(bar.width),barColor:bar.backgroundColor,headerBackground:headerStyle.backgroundImage,headerBackgroundColor:headerStyle.backgroundColor,headerBorder:headerStyle.borderTopWidth,headerBorderColor:headerStyle.borderTopColor,headerRadius:headerStyle.borderTopLeftRadius,eyebrowColor:getComputedStyle(eyebrow).color,selectedBackground:selectedStyle.backgroundImage,selectedBackgroundColor:selectedStyle.backgroundColor,selectedBorderColor:selectedStyle.borderTopColor,selectedShadow:selectedStyle.boxShadow,selectedIconColor:getComputedStyle(selectedIcon).color,sectionBackground:sectionStyle?.backgroundImage||null,sectionBackgroundColor:sectionStyle?.backgroundColor||null,sectionShadow:sectionStyle?.boxShadow||null,panelBorderColor:panelStyle?.borderTopColor||null,panelBackgroundColor:panelStyle?.backgroundColor||null,tableBorderColor:tableCellStyle?.borderBottomColor||null,controlBorderColor:controlStyle?.borderTopColor||null,controlRadius:controlStyle?.borderTopLeftRadius||null,controlHeight:control?control.getBoundingClientRect().height:null,controlFont:controlStyle?.fontFamily||null,primaryBackground:primaryStyle?.backgroundColor||null,goldStructuralBorders,goldStructuralDetails,overflow:document.documentElement.scrollWidth-innerWidth,logoRatio:box.width/box.height,canvas:mainStyle.backgroundColor,canvasImage:mainStyle.backgroundImage}})()`)
      assert.equal(result.page, label)
      assert.match(result.titleFont, /AO Dahlia|Dahlia/, `${label} title does not use Dahlia`)
      assert.equal(result.className, true, `${label} has no module theme class`)
      assert.ok(!['rgba(0, 0, 0, 0)', 'transparent'].includes(result.eyebrowColor), `${label} heading accent is invisible`)
      assert.equal(result.headerBackground, 'none', `${label} page header still uses a decorative gradient`)
      if (label === 'Dashboard') {
        assert.equal(result.headerBackgroundColor, 'rgba(0, 0, 0, 0)', 'Dashboard editorial header should remain transparent')
        assert.equal(result.headerBorder, '0px', 'Dashboard editorial header should remain borderless')
        assert.equal(result.headerRadius, '0px', 'Dashboard editorial header should not look like a card')
      } else {
        assert.ok(result.barWidth >= 2 && result.barWidth <= 3, `${label} accent is not restrained`)
        assert.ok(!['rgba(0, 0, 0, 0)', 'transparent'].includes(result.barColor), `${label} accent is invisible`)
        assert.notEqual(result.headerBackgroundColor, 'rgba(0, 0, 0, 0)', `${label} page header has no corporate surface`)
        assert.equal(result.headerBorder, '1px', `${label} page header lost its fine border`)
        assert.notEqual(result.headerBorderColor, 'rgb(222, 197, 143)', `${label} page header is still gold-dominated`)
        assert.equal(result.headerRadius, '10px', `${label} page header radius is inconsistent`)
      }
      assert.equal(result.selectedBackground, 'none', `${label} selected navigation still uses a decorative gradient`)
      assert.notEqual(result.selectedBackgroundColor, 'rgba(0, 0, 0, 0)', `${label} selected navigation has no module treatment`)
      assert.notEqual(result.selectedBorderColor, 'rgb(222, 197, 143)', `${label} selected navigation is still gold-outlined`)
      assert.match(result.selectedShadow, /inset/, `${label} selected navigation lost its authority markers`)
      assert.ok(!['rgb(255, 255, 255)', 'rgb(23, 60, 87)'].includes(result.selectedIconColor), `${label} selected navigation icon has no corporate highlight`)
      if (result.sectionBackground) {
        assert.equal(result.sectionBackground, 'none', `${label} section heading still uses a decorative gradient`)
        assert.notEqual(result.sectionBackgroundColor, 'rgba(0, 0, 0, 0)', `${label} section heading has no corporate surface`)
        assert.match(result.sectionShadow, /inset/, `${label} section heading has no module ribbon`)
      }
      if (result.panelBorderColor) assert.notEqual(result.panelBorderColor, 'rgb(222, 197, 143)', `${label} panels are still gold-dominated`)
      if (result.tableBorderColor) assert.notEqual(result.tableBorderColor, 'rgb(222, 197, 143)', `${label} table dividers are still gold-dominated`)
      if (result.controlBorderColor) {
        assert.notEqual(result.controlBorderColor, 'rgb(222, 197, 143)', `${label} form controls are still gold-dominated`)
        assert.equal(result.controlRadius, '8px', `${label} form control radius is inconsistent`)
        assert.ok(result.controlHeight >= (viewport.width <= 430 ? 44 : 40), `${label} form control height is inconsistent`)
        assert.match(result.controlFont, /AO Good Sans|Good Sans/, `${label} form controls do not use Good Sans`)
      }
      if (result.primaryBackground) assert.notEqual(result.primaryBackground, 'rgb(189, 152, 84)', `${label} primary actions still use decorative gold`)
      assert.equal(result.goldStructuralBorders, 0, `${label} still has decorative gold structural borders: ${JSON.stringify(result.goldStructuralDetails || [])}`)
      assert.ok(result.overflow <= 1, `${label} overflows at ${viewport.width}px`)
      assert.ok(result.logoRatio > 2.98 && result.logoRatio < 3.02, `${label} logo proportions changed`)
      assert.notEqual(result.canvas, 'rgb(255, 251, 243)', `${label} canvas does not show its module family`)
      assert.equal(result.canvasImage, 'none', `${label} canvas still uses decorative gradients`)
      const moduleSlug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      const moduleScreenshot = join(screenshots, `corporate-palette-${viewport.name}-${moduleSlug}.png`)
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true })
      await writeFile(moduleScreenshot, Buffer.from(shot.data, 'base64'))
      screenshotPaths.push(moduleScreenshot.replaceAll('\\', '/'))
      moduleResults.push({ label, ...result })
    }
    results.push({ viewport: viewport.name, modules: moduleResults })
  }
  assert.deepEqual(cdp.errors, [])
  console.log(JSON.stringify({ status: 'PASS', isolated: true, canonicalDatabaseTouched: false, viewports: viewports.map(item => item.name), modules: modules.map(item => item[0]), screenshots: screenshotPaths, results }, null, 2))
} finally {
  socket?.close(); for (const child of children.reverse()) { if (child.exitCode === null) child.kill(); child.removeAllListeners(); child.unref() } await sleep(800); await rm(fixture.root, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(() => undefined)
}
