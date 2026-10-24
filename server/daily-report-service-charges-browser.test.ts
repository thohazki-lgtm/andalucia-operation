import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'
import { addCalendarDays, serviceDate } from '../src/service-date.js'

const fixture = await createDisposableDevelopmentStore('daily-report-service-charges-browser')
const profile = join(fixture.root, 'edge-profile')
const screenshots = resolve('artifacts', 'daily-report-service-charges')
const token = `daily-service-charges-${randomUUID()}`
const reportDate = addCalendarDays(serviceDate(), -1)
const children: ChildProcess[] = []
const sleep = (ms: number) => new Promise(resolvePromise => setTimeout(resolvePromise, ms))
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
  errors: string[] = []
  constructor(private ws: WebSocket) {
    ws.onmessage = event => {
      const message = JSON.parse(String(event.data))
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result)
      } else if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || 'Runtime exception')
    }
  }
  send(method: string, params: Record<string, unknown> = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise<any>((resolvePromise, reject) => this.pending.set(id, { resolve: resolvePromise, reject }))
  }
  evaluate<T>(expression: string) {
    return this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then(result => result.result.value as T)
  }
}

try {
  await mkdir(screenshots, { recursive: true })
  await fixture.db.query("insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval '1 hour')", [randomUUID(), createHash('sha256').update(token).digest('hex'), fixture.ownerId])
  await fixture.db.close()
  const node = process.execPath
  children.push(spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', API_PORT: '3022', APP_ORIGIN: 'http://127.0.0.1:5192' }, stdio: 'ignore' }))
  children.push(spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5192', '--strictPort'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3022' }, stdio: 'ignore' }))
  await Promise.all([waitFor('http://127.0.0.1:3022/api/health'), waitFor('http://127.0.0.1:5192/')])
  children.push(spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' }))
  let port = 0
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)[0])
      if (port && (await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break
    } catch {}
    await sleep(100)
  }
  assert.ok(port)
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as any[]
  const page = pages.find(item => item.type === 'page')
  assert.ok(page)
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise<void>((done, fail) => { socket!.onopen = () => done(); socket!.onerror = () => fail(new Error('CDP connection failed')) })
  const cdp = new Cdp(socket)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  assert.equal((await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5192/', path: '/', httpOnly: true, sameSite: 'Strict' })).success, true)
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5192/' })
  for (let attempt = 0; attempt < 120; attempt += 1) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Reports"]')`)) break; await sleep(100) }
  await cdp.evaluate(`document.querySelector('button[aria-label="Reports"]')?.click()`)
  for (let attempt = 0; attempt < 160; attempt += 1) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.daily-report-header input[type="date"]')&&!document.querySelector('.inline-state')`)) break; await sleep(100) }
  await cdp.evaluate(`(()=>{const input=document.querySelector('.daily-report-header input[type="date"]'),setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(reportDate)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  for (let attempt = 0; attempt < 160; attempt += 1) { if (await cdp.evaluate<boolean>(`!!document.querySelector('#daily-verification input[aria-label="Daily Service Charges USD"]')`)) break; await sleep(100) }
  await cdp.evaluate(`(()=>{const inputSetter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set,textSetter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set,charge=document.querySelector('[aria-label="Daily Service Charges USD"]'),remarks=document.querySelector('[aria-label="Service Charges Remarks"]');inputSetter.call(charge,'68.25');charge.dispatchEvent(new Event('input',{bubbles:true}));textSetter.call(remarks,'Separate outlet service charge.');remarks.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.double-dine-add')?.click()})()`)
  await sleep(100)
  await cdp.evaluate(`(()=>{const values=['719','2','Main Restaurant'],setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;document.querySelectorAll('.double-dine-editor-row input').forEach((node,index)=>{setter.call(node,values[index]);node.dispatchEvent(new Event('input',{bubbles:true}))});Array.from(document.querySelectorAll('.daily-header-actions button')).find(button=>button.textContent?.includes('Save Draft'))?.click()})()`)
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const saved = await cdp.evaluate<any>(`fetch('/api/reports/daily?date=${reportDate}').then(response=>response.json())`)
    if (saved?.report?.manualPayload?.serviceCharges?.amount === '68.25' && saved?.report?.manualPayload?.serviceCharges?.remarks === 'Separate outlet service charge.') break
    await sleep(100)
  }
  const persisted = await cdp.evaluate<any>(`fetch('/api/reports/daily?date=${reportDate}').then(response=>response.json())`)
  assert.deepEqual(persisted.report.manualPayload.serviceCharges, { amount: '68.25', remarks: 'Separate outlet service charge.' })
  assert.equal(persisted.report.manualPayload.serviceVerification.doubleDinePax, 2)

  const results = []
  for (const viewport of [{ name: 'desktop-1440', width: 1440, height: 900, mobile: false }, { name: 'desktop-1280', width: 1280, height: 800, mobile: false }, { name: 'desktop-1024', width: 1024, height: 768, mobile: false }, { name: 'tablet-768', width: 768, height: 1024, mobile: false }, { name: 'mobile-430', width: 430, height: 932, mobile: true }, { name: 'mobile-390', width: 390, height: 844, mobile: true }, { name: 'mobile-360', width: 360, height: 800, mobile: true }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile })
    await sleep(100)
    await cdp.evaluate(`document.querySelector('.service-verification-details')?.setAttribute('open','')`)
    const layout = await cdp.evaluate<any>(`(()=>{const section=document.querySelector('#daily-verification'),grid=section.querySelector('.service-verification-charge-grid'),cards=Array.from(grid.children),details=section.querySelector('.service-verification-details'),charge=section.querySelector('[aria-label="Daily Service Charges USD"]'),remarks=section.querySelector('[aria-label="Service Charges Remarks"]'),total=section.querySelector('.double-dine-total-summary b'),financialPlaceholder=document.querySelector('#daily-symphony input[placeholder="Not entered"]');return{title:section.querySelector(':scope>header h3')?.textContent?.trim(),columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,widths:cards.map(card=>card.getBoundingClientRect().width),borders:cards.map(card=>getComputedStyle(card).borderTopColor),radii:cards.map(card=>getComputedStyle(card).borderRadius),amount:charge?.value,remarks:remarks?.value,total:total?.textContent?.trim(),manualPaxInput:!!section.querySelector('[aria-label="Double Dine Pax"]'),enteredWeight:Number(getComputedStyle(charge).fontWeight),enteredFont:getComputedStyle(charge).fontFamily,placeholderWeight:Number(getComputedStyle(financialPlaceholder,'::placeholder').fontWeight),placeholderSize:parseFloat(getComputedStyle(financialPlaceholder,'::placeholder').fontSize),placeholderColor:getComputedStyle(financialPlaceholder,'::placeholder').color,detailsOpen:details?.open===true,detailsRows:details?.querySelectorAll('.double-dine-editor-row').length,controlHeights:[charge,remarks].map(node=>node.getBoundingClientRect().height),sectionOverflow:section.scrollWidth>section.clientWidth+1,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
    assert.equal(layout.title, 'Service Verification & Charges')
    assert.equal(layout.columns, viewport.width > 800 ? 2 : 1)
    if (viewport.width > 800) assert.ok(Math.abs(layout.widths[0] - layout.widths[1]) < 1)
    assert.deepEqual(layout.borders, ['rgb(222, 197, 143)', 'rgb(222, 197, 143)'])
    assert.deepEqual(layout.radii, ['12px', '12px'])
    assert.equal(layout.amount, '68.25')
    assert.equal(layout.remarks, 'Separate outlet service charge.')
    assert.equal(layout.total, '2')
    assert.equal(layout.manualPaxInput, false)
    assert.equal(layout.enteredWeight, 500)
    assert.equal(layout.enteredFont.toLowerCase().includes('monospace'), false)
    assert.equal(layout.placeholderWeight, 400)
    assert.ok(layout.placeholderSize >= 14 && layout.placeholderSize <= 15)
    assert.equal(layout.placeholderColor, 'rgb(120, 137, 148)')
    assert.equal(layout.detailsOpen, true)
    assert.equal(layout.detailsRows, 1)
    if (viewport.width <= 430) assert.ok(layout.controlHeights.every((height: number) => height >= 44))
    assert.equal(layout.sectionOverflow, false)
    assert.equal(layout.pageOverflow, false)
    const bounds = await cdp.evaluate<any>(`(()=>{const node=document.querySelector('#daily-verification').getBoundingClientRect();return{x:Math.max(0,node.left+scrollX),y:node.top+scrollY,width:node.width,height:node.height}})()`)
    const image = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { ...bounds, scale: 1 } })
    await writeFile(join(screenshots, `service-verification-charges-${viewport.name}.png`), Buffer.from(image.data, 'base64'))
    results.push({ viewport: viewport.name, ...layout })
  }
  await cdp.evaluate(`document.querySelector('.whatsapp-export-trigger')?.click()`)
  await sleep(80)
  assert.equal(await cdp.evaluate<boolean>(`document.querySelector('.whatsapp-export-dialog textarea')?.value.includes('Service Charges: $68.25')===true`), true)
  await cdp.evaluate(`Array.from(document.querySelectorAll('.whatsapp-format-selector .ao-action')).find(button=>button.textContent?.includes('Full Daily Report'))?.click()`)
  await sleep(80)
  assert.equal(await cdp.evaluate<boolean>(`document.querySelector('.whatsapp-export-dialog textarea')?.value.includes('Daily Service Charges: $68.25')===true&&document.querySelector('.whatsapp-export-dialog textarea')?.value.includes('Remarks: Separate outlet service charge.')===true`), true)
  assert.deepEqual(cdp.errors, [])
  console.log(JSON.stringify({ status: 'PASS', schema: '027', serviceChargesPersisted: true, explicitAmount: '68.25', responsive: results.map(item => ({ viewport: item.viewport, columns: item.columns, overflow: item.pageOverflow })), screenshots, canonicalDatabaseTouched: false }, null, 2))
} finally {
  socket?.close()
  for (const child of children.reverse()) if (child.exitCode === null) child.kill()
  await sleep(800)
  await rm(fixture.root, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(() => undefined)
}

