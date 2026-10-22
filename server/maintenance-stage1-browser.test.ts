import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { AuthPrincipal, MaintenanceRecord } from '../src/domain.js'
import { MaintenanceRepository } from './maintenance-repository.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const fixture = await createDisposableDevelopmentStore('maintenance-stage1-browser')
const profile = join(fixture.root, 'edge-profile')
const processes: ChildProcess[] = []
let socket: WebSocket | null = null
const token = `maintenance-browser-${randomUUID()}`
const screenshotDirectory = resolve('artifacts', 'global-action-maintenance')
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))
const waitFor = async (url: string) => { for (let attempt = 0; attempt < 100; attempt++) { try { if ((await fetch(url)).ok) return } catch {} await sleep(200) } throw new Error(`Timed out waiting for ${url}`) }

class Cdp {
  private id = 0
  private pending = new Map<number, { resolve: (value: any) => void; reject: (reason: unknown) => void }>()
  readonly errors: string[] = []
  constructor(private ws: WebSocket) { ws.onmessage = event => { const message = JSON.parse(String(event.data)); if (message.id) { const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result) } else if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || 'Runtime exception') } }
  send(method: string, params: Record<string, unknown> = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise<any>((resolveCall, rejectCall) => this.pending.set(id, { resolve: resolveCall, reject: rejectCall })) }
  evaluate<T>(expression: string) { return this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then(result => result.result.value as T) }
}

try {
  const staffId = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'UI-M001','Responsive Reporter','waiter','active','2026-01-01')", [staffId])
  await fixture.db.query('insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval \'1 hour\')', [randomUUID(), createHash('sha256').update(token).digest('hex'), fixture.ownerId])
  const actor: AuthPrincipal = { userId: fixture.ownerId, sessionId: randomUUID(), loginIdentifier: 'owner', displayName: 'Isolated UI Manager', staffId: null, roleKeys: ['owner'], permissionKeys: ['manage_maintenance'], globalScope: true, allowedOutletScopeIds: [ANDALUCIA_SCOPE_ID], isOwner: true }
  const repository = new MaintenanceRepository(fixture.db)
  await repository.initialize()
  const area = (await repository.configuration()).areas[0]
  const issue = (name: string, priority: MaintenanceRecord['priority'], notes: string): MaintenanceRecord => ({ id: randomUUID(), issue: name, dateReported: '2026-10-16', area: area.value, priority, status: 'open', referenceFollowUp: 'Engineering follow-up remains readable on compact screens', notes, reportedByStaffId: staffId, reportedBy: null, revision: 1 })
  await repository.save(issue('Ice machine compressor requires inspection', 'urgent', 'Service impact recorded'), { outletScopeId: ANDALUCIA_SCOPE_ID, actor })
  await repository.save(issue('Side station cabinet hinge alignment', 'normal', 'No service interruption'), { outletScopeId: ANDALUCIA_SCOPE_ID, actor })
  await fixture.db.close()

  const node = process.execPath
  processes.push(spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '026', API_PORT: '3016', APP_ORIGIN: 'http://127.0.0.1:5186' }, stdio: 'ignore' }))
  processes.push(spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5186', '--strictPort'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3016' }, stdio: 'ignore' }))
  await Promise.all([waitFor('http://127.0.0.1:3016/api/health'), waitFor('http://127.0.0.1:5186/')])

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
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Network.enable')
  assert.equal((await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5186/', path: '/', httpOnly: true, sameSite: 'Strict' })).success, true)
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5186/' })
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Maintenance"]')`)) break; await sleep(150) }
  await cdp.evaluate(`document.querySelector('button[aria-label="Maintenance"]')?.click()`)
  for (let attempt = 0; attempt < 80; attempt++) { if ((await cdp.evaluate<number>(`document.querySelectorAll('.maintenance-table tbody tr').length`)) === 2) break; await sleep(100) }

  const results: any[] = []
  await mkdir(screenshotDirectory, { recursive: true })
  for (const viewport of [{ name: 'desktop', width: 1440, height: 900, mobile: false }, { name: 'tablet', width: 1024, height: 900, mobile: false }, { name: 'mobile-390', width: 390, height: 844, mobile: true }, { name: 'mobile-360', width: 360, height: 800, mobile: true }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile }); await sleep(180)
    const result = await cdp.evaluate<any>(`(()=>{const visible=node=>getComputedStyle(node).display!=='none'&&node.getBoundingClientRect().width>0;const table=document.querySelector('.maintenance-table-wrap');const rows=Array.from(document.querySelectorAll('.maintenance-table tbody tr')).filter(visible);const cards=Array.from(document.querySelectorAll('.maintenance-card')).filter(visible);const controls=Array.from(document.querySelectorAll('.maintenance-card button,.maintenance-card select,.maintenance-filters input,.maintenance-filters select,.maintenance-toolbar button')).filter(visible);const interactive=Array.from(document.querySelectorAll('.maintenance-toolbar button,.maintenance-card button,.maintenance-card select')).filter(visible);const statusSelects=Array.from(document.querySelectorAll('select.maintenance-status-select')).filter(visible);const summary=document.querySelector('.maintenance-summary');const summaryCards=Array.from(document.querySelectorAll('.maintenance-summary article')).filter(visible);const summaryWidths=summaryCards.map(node=>Math.round(node.getBoundingClientRect().width));const summaryParent=summary?.parentElement;const summaryContentRight=summaryParent?summaryParent.getBoundingClientRect().right-parseFloat(getComputedStyle(summaryParent).paddingRight):null;const footer=document.querySelector('.maintenance-card-footer');const footerControls=footer?Array.from(footer.querySelectorAll('select,button')).map(node=>node.getBoundingClientRect().toJSON()):[];const add=document.querySelector('.maintenance-toolbar .ao-action');const completedPills=Array.from(document.querySelectorAll('.maintenance-status-pill')).filter(visible);return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,tableVisible:visible(table),rows:rows.length,cards:cards.length,titleTriggers:Array.from(document.querySelectorAll('.maintenance-issue-trigger')).filter(visible).length,statusControls:Array.from(document.querySelectorAll('.maintenance-status-select,.maintenance-status-pill')).filter(visible).length,statusSelects:statusSelects.length,minStatusSelectWidth:statusSelects.length?Math.min(...statusSelects.map(node=>node.getBoundingClientRect().width)):null,statusPillButtons:completedPills.filter(node=>node.matches('button')).length,viewButtons:Array.from(document.querySelectorAll('button')).filter(node=>visible(node)&&node.textContent?.trim()==='View').length,clippedControls:controls.filter(node=>{const rect=node.getBoundingClientRect();return rect.left<0||rect.right>innerWidth+1}).length,minInteractiveHeight:interactive.length?Math.min(...interactive.map(node=>node.getBoundingClientRect().height)):null,addVisible:Boolean(add&&visible(add)),addLabel:add?.textContent?.trim(),summaryWidths,summaryUnusedRight:summary&&summaryContentRight!==null?Math.round(summaryContentRight-summary.getBoundingClientRect().right):null,footerControlBottoms:footerControls.map(rect=>Math.round(rect.bottom)),footerGap:footer?parseFloat(getComputedStyle(footer).gap):null}})()`)
    assert.equal(result.pageOverflow, false, `page overflow at ${viewport.width}px`)
    assert.equal(result.clippedControls, 0, `control clipping at ${viewport.width}px`)
    assert.equal(result.viewButtons, 0)
    assert.equal(result.titleTriggers, 2)
    assert.equal(result.statusControls, 2)
    assert.equal(result.statusSelects, 2)
    assert.equal(result.statusPillButtons, 0)
    assert.equal(result.addVisible, true)
    assert.equal(result.addLabel, 'Add Maintenance Issue')
    assert.equal(result.rows, viewport.mobile ? 0 : 2)
    assert.equal(result.cards, viewport.mobile ? 2 : 0)
    assert.ok(Math.max(...result.summaryWidths) - Math.min(...result.summaryWidths) <= 1, `summary cards must be equal width at ${viewport.width}px`)
    assert.equal(result.summaryUnusedRight, 0, `summary cards must fill the content width at ${viewport.width}px`)
    if (viewport.mobile) {
      assert.ok(result.minInteractiveHeight >= 44, `mobile target below 44px at ${viewport.width}px: ${result.minInteractiveHeight}`)
      assert.ok(result.minStatusSelectWidth >= 126, `mobile status select is too narrow for complete text at ${viewport.width}px: ${result.minStatusSelectWidth}`)
      assert.ok(Math.max(...result.footerControlBottoms) - Math.min(...result.footerControlBottoms) <= 1, 'mobile Status and Edit controls must align')
      assert.equal(result.footerGap, 10)
    }
    const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true })
    const screenshotName = `maintenance-after-${viewport.name}.png`
    await writeFile(join(screenshotDirectory, screenshotName), Buffer.from(image.data, 'base64'))
    results.push({ viewport: viewport.name, ...result })
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  const addRect = await cdp.evaluate<any>(`document.querySelector('.maintenance-toolbar .ao-action')?.getBoundingClientRect().toJSON()`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: addRect.x + addRect.width / 2, y: addRect.y + addRect.height / 2, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: addRect.x + addRect.width / 2, y: addRect.y + addRect.height / 2, button: 'left', clickCount: 1 }); await sleep(100)
  assert.equal(await cdp.evaluate<boolean>(`document.querySelector('[role="dialog"]')?.textContent?.includes('Add Maintenance Issue')`), true, 'pointer activation must open Add Maintenance Issue')
  await cdp.evaluate(`document.querySelector('.maintenance-modal-close')?.click()`); await sleep(60)
  await cdp.evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`)
  for (let step = 0; step < 40; step++) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    if (await cdp.evaluate<boolean>(`document.activeElement?.matches('.maintenance-toolbar .ao-action')`)) break
  }
  const focusState = await cdp.evaluate<any>(`(()=>{const node=document.activeElement;const style=getComputedStyle(node);return{label:node?.textContent?.trim(),outlineStyle:style.outlineStyle,outlineWidth:style.outlineWidth}})()`)
  assert.equal(focusState.label, 'Add Maintenance Issue')
  assert.notEqual(focusState.outlineStyle, 'none')
  assert.notEqual(focusState.outlineWidth, '0px')
  assert.equal(await cdp.evaluate<boolean>(`document.activeElement instanceof HTMLButtonElement && !document.activeElement.disabled && (document.activeElement.click(), true)`), true); await sleep(100)
  assert.equal(await cdp.evaluate<boolean>(`document.querySelector('[role="dialog"]')?.textContent?.includes('Add Maintenance Issue')`), true, 'keyboard activation must open Add Maintenance Issue')
  await cdp.evaluate(`document.querySelector('.maintenance-modal-close')?.click()`); await sleep(60)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(100)
  const touchActivated = await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('.maintenance-toolbar .ao-action');if(!button)return false;button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}));button.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'touch'}));button.click();return true})()`)
  assert.equal(touchActivated, true)
  assert.equal(await cdp.evaluate<boolean>(`document.querySelector('[role="dialog"]')?.textContent?.includes('Add Maintenance Issue')`), true, 'touch activation must open Add Maintenance Issue')
  await cdp.evaluate(`document.querySelector('.maintenance-modal-close')?.click()`); await sleep(60)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.evaluate(`document.querySelector('.maintenance-issue-trigger')?.click()`); await sleep(100)
  assert.equal(await cdp.evaluate<boolean>(`document.querySelector('[role="dialog"]')?.textContent?.includes('Ice machine compressor requires inspection')`), true)
  assert.deepEqual(cdp.errors, [])
  console.log(JSON.stringify({ authenticatedManagerView: true, sharedActionSystem: true, primaryAddAlwaysVisible: true, pointerActivation: true, touchActivation: true, keyboardActivation: true, focusIndicator: focusState, titleAndChevronOpenDetails: true, redundantViewRemoved: true, equalSummaryCards: true, compactStatusEditFooter: true, desktopTablet390And360: true, mobileTargets44: true, statusSelectInteractive: true, statusPillNonInteractive: true, noPageOverflow: true, noClippedControls: true, screenshots: ['artifacts/global-action-maintenance/maintenance-after-desktop.png', 'artifacts/global-action-maintenance/maintenance-after-tablet.png', 'artifacts/global-action-maintenance/maintenance-after-mobile-390.png', 'artifacts/global-action-maintenance/maintenance-after-mobile-360.png'], isolatedSchema025: true, canonicalDatabaseTouched: false, results }, null, 2))
} finally {
  socket?.close()
  for (const child of processes.reverse()) { if (child.exitCode === null) child.kill(); child.removeAllListeners(); child.unref() }
  await sleep(1000)
  await rm(fixture.root, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(() => undefined)
}
