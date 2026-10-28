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
const processOutput: string[] = []
const captureProcess = (child: ChildProcess, label: string) => { child.stdout?.on('data', chunk => processOutput.push(`${label}: ${String(chunk)}`)); child.stderr?.on('data', chunk => processOutput.push(`${label}: ${String(chunk)}`)); return child }
let socket: WebSocket | null = null
const token = `maintenance-browser-${randomUUID()}`
const screenshotDirectory = resolve('artifacts', 'global-action-maintenance')
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))
const waitFor = async (url: string) => { let lastResponse = ''; for (let attempt = 0; attempt < 100; attempt++) { try { const response = await fetch(url); if (response.ok) return; lastResponse = `${response.status} ${await response.text()}` } catch (error) { lastResponse = error instanceof Error ? error.message : String(error) } await sleep(200) } throw new Error(`Timed out waiting for ${url}${lastResponse ? ` (${lastResponse})` : ''}`) }

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
  const sharedNodeModules = resolve('node_modules')
  processes.push(captureProcess(spawn(node, [join(sharedNodeModules, 'tsx/dist/cli.mjs'), 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', API_PORT: '3016', APP_ORIGIN: 'http://127.0.0.1:5186' }, stdio: ['ignore', 'pipe', 'pipe'] }), 'api'))
  processes.push(captureProcess(spawn(node, [join(sharedNodeModules, 'vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5186', '--strictPort'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3016' }, stdio: ['ignore', 'pipe', 'pipe'] }), 'vite'))
  await Promise.all([waitFor('http://127.0.0.1:3016/api/health'), waitFor('http://127.0.0.1:5186/')]).catch(error => { throw new Error(`${error instanceof Error ? error.message : String(error)}\n${processOutput.join('')}`) })

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
  for (let attempt = 0; attempt < 80; attempt++) { if ((await cdp.evaluate<number>(`document.querySelectorAll('.maintenance-card').length`)) === 2) break; await sleep(100) }

  const results: any[] = []
  await mkdir(screenshotDirectory, { recursive: true })
  for (const viewport of [{ name: 'desktop-1440', width: 1440, height: 900, mobile: false }, { name: 'desktop-1280', width: 1280, height: 900, mobile: false }, { name: 'tablet-1024', width: 1024, height: 900, mobile: false }, { name: 'tablet-768', width: 768, height: 900, mobile: false }, { name: 'mobile-430', width: 430, height: 900, mobile: true }, { name: 'mobile-390', width: 390, height: 844, mobile: true }, { name: 'mobile-360', width: 360, height: 800, mobile: true }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile }); await sleep(180)
    const result = await cdp.evaluate<any>(`(()=>{const visible=node=>!!node&&getComputedStyle(node).display!=='none'&&node.getBoundingClientRect().width>0;const table=document.querySelector('.maintenance-table-wrap');const cards=Array.from(document.querySelectorAll('.maintenance-card')).filter(visible);const grid=document.querySelector('.maintenance-cards');const panel=document.querySelector('.maintenance-panel');const controls=Array.from(document.querySelectorAll('.maintenance-card button,.maintenance-card select,.maintenance-filters input,.maintenance-filters select,.maintenance-toolbar button')).filter(visible);const filterControls=Array.from(document.querySelectorAll('.maintenance-filters input,.maintenance-filters select')).filter(visible);const filterStyles=filterControls.map(node=>{const style=getComputedStyle(node);return{height:Math.round(node.getBoundingClientRect().height),fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,borderColor:style.borderTopColor}});const interactive=Array.from(document.querySelectorAll('.maintenance-toolbar button,.maintenance-card button,.maintenance-card select')).filter(visible);const statusSelects=Array.from(document.querySelectorAll('select.maintenance-status-select')).filter(visible);const summary=document.querySelector('.maintenance-summary');const summaryCards=Array.from(document.querySelectorAll('.maintenance-summary article')).filter(visible);const summaryWidths=summaryCards.map(node=>Math.round(node.getBoundingClientRect().width));const summaryParent=summary?.parentElement;const summaryContentRight=summaryParent?summaryParent.getBoundingClientRect().right-parseFloat(getComputedStyle(summaryParent).paddingRight):null;const footer=document.querySelector('.maintenance-card-footer');const footerControls=footer?Array.from(footer.querySelectorAll('select,button')).map(node=>node.getBoundingClientRect().toJSON()):[];const add=document.querySelector('.maintenance-toolbar .ao-action');const completedPills=Array.from(document.querySelectorAll('.maintenance-status-pill')).filter(visible);const cardWidths=cards.map(node=>node.getBoundingClientRect().width);return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,tableVisible:visible(table),cards:cards.length,gridColumns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,cardWidthDelta:Math.max(...cardWidths)-Math.min(...cardWidths),goldPanel:getComputedStyle(panel).borderTopColor==='rgb(222, 197, 143)',goldCards:cards.every(node=>getComputedStyle(node).borderTopColor==='rgb(222, 197, 143)'),filterStyles,titleTriggers:Array.from(document.querySelectorAll('.maintenance-issue-trigger')).filter(visible).length,statusControls:Array.from(document.querySelectorAll('.maintenance-status-select,.maintenance-status-pill')).filter(visible).length,statusSelects:statusSelects.length,minStatusSelectWidth:statusSelects.length?Math.min(...statusSelects.map(node=>node.getBoundingClientRect().width)):null,statusPillButtons:completedPills.filter(node=>node.matches('button')).length,viewButtons:Array.from(document.querySelectorAll('button')).filter(node=>visible(node)&&node.textContent?.trim()==='View').length,clippedControls:controls.filter(node=>{const rect=node.getBoundingClientRect();return rect.left<0||rect.right>innerWidth+1}).length,minInteractiveHeight:interactive.length?Math.min(...interactive.map(node=>node.getBoundingClientRect().height)):null,addVisible:Boolean(add&&visible(add)),addLabel:add?.textContent?.trim(),summaryWidths,summaryUnusedRight:summary&&summaryContentRight!==null?Math.round(summaryContentRight-summary.getBoundingClientRect().right):null,footerControlBottoms:footerControls.map(rect=>Math.round(rect.bottom)),footerGap:footer?parseFloat(getComputedStyle(footer).gap):null}})()`)
    assert.equal(result.pageOverflow, false, `page overflow at ${viewport.width}px`)
    if (result.clippedControls) result.clippedControlLabels = await cdp.evaluate(`Array.from(document.querySelectorAll('.maintenance-card button,.maintenance-card select,.maintenance-filters input,.maintenance-filters select,.maintenance-toolbar button')).filter(node=>getComputedStyle(node).display!=='none'&&node.getBoundingClientRect().width>0).filter(node=>{const rect=node.getBoundingClientRect();return rect.left<0||rect.right>innerWidth+1}).map(node=>node.getAttribute('aria-label')||node.textContent?.trim()||node.tagName)`)
    assert.equal(result.clippedControls, 0, `control clipping at ${viewport.width}px: ${JSON.stringify(result.clippedControlLabels || [])}`)
    assert.equal(result.viewButtons, 0)
    assert.equal(result.titleTriggers, 2)
    assert.equal(result.statusControls, 2)
    assert.equal(result.statusSelects, 2)
    assert.equal(result.statusPillButtons, 0)
    assert.equal(result.addVisible, true)
    assert.equal(result.addLabel, 'Add Maintenance Issue')
    assert.equal(result.tableVisible, false)
    assert.equal(result.cards, 2)
    assert.equal(result.gridColumns, viewport.width > 900 ? 2 : 1)
    assert.ok(result.cardWidthDelta <= 1)
    assert.equal(result.goldCards, true)
    assert.equal(result.goldPanel, true)
    assert.ok(result.filterStyles.length >= 3)
    assert.ok(result.filterStyles.every((style: any) => style.height === 44), `filter heights must match at ${viewport.width}px`)
    assert.ok(result.filterStyles.every((style: any) => style.fontSize === '13px' && style.borderColor === 'rgb(222, 197, 143)'), `filter typography and borders must match at ${viewport.width}px`)
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
  const desktopModal = await cdp.evaluate<any>(`(()=>{const modal=document.querySelector('.maintenance-modal'),body=document.querySelector('.maintenance-form-body'),footer=document.querySelector('.maintenance-modal .form-actions');const box=modal.getBoundingClientRect(),footerBox=footer.getBoundingClientRect();return{width:box.width,maxWidth:750,sections:Array.from(modal.querySelectorAll('.maintenance-form-section h4')).map(node=>node.textContent),hasCloseIcon:!!modal.querySelector('.maintenance-modal-close'),bodyScroll:getComputedStyle(body).overflowY,footerVisible:footerBox.bottom<=innerHeight+1,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}})()`)
  assert.ok(desktopModal.width <= desktopModal.maxWidth)
  assert.deepEqual(desktopModal.sections, ['Issue Information', 'Follow-up & Notes'])
  assert.equal(desktopModal.hasCloseIcon, false)
  assert.equal(desktopModal.bodyScroll, 'auto')
  assert.equal(desktopModal.footerVisible, true)
  const desktopModalImage = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true }); await writeFile(join(screenshotDirectory, 'maintenance-modal-desktop.png'), Buffer.from(desktopModalImage.data, 'base64'))
  await cdp.evaluate(`(()=>{const input=document.querySelector('.maintenance-form input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Unsaved test issue');input.dispatchEvent(new Event('input',{bubbles:true}));window.confirm=()=>false})()`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(60)
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.maintenance-modal')`), true, 'Unsaved changes must prevent accidental Escape dismissal')
  await cdp.evaluate(`window.confirm=()=>true`); await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(60)
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
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(60)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(100)
  const touchActivated = await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('.maintenance-toolbar .ao-action');if(!button)return false;button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}));button.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'touch'}));button.click();return true})()`)
  assert.equal(touchActivated, true)
  assert.equal(await cdp.evaluate<boolean>(`document.querySelector('[role="dialog"]')?.textContent?.includes('Add Maintenance Issue')`), true, 'touch activation must open Add Maintenance Issue')
  const mobileModal = await cdp.evaluate<any>(`(()=>{const modal=document.querySelector('.maintenance-modal'),body=document.querySelector('.maintenance-form-body'),fields=Array.from(document.querySelectorAll('.maintenance-form-grid label'));const box=modal.getBoundingClientRect();return{width:box.width,insideViewport:box.left>=0&&box.right<=innerWidth,oneColumn:fields.every((node,index,array)=>index===0||Math.abs(node.getBoundingClientRect().left-array[0].getBoundingClientRect().left)<=1),bodyScroll:getComputedStyle(body).overflowY,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}})()`)
  assert.equal(mobileModal.insideViewport, true)
  assert.equal(mobileModal.oneColumn, true)
  assert.equal(mobileModal.bodyScroll, 'auto')
  assert.equal(mobileModal.pageOverflow, false)
  const mobileModalImage = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true }); await writeFile(join(screenshotDirectory, 'maintenance-modal-mobile-390.png'), Buffer.from(mobileModalImage.data, 'base64'))
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(60)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.evaluate(`document.querySelector('.maintenance-issue-trigger')?.click()`); await sleep(100)
  assert.equal(await cdp.evaluate<boolean>(`document.querySelector('[role="dialog"]')?.textContent?.includes('Ice machine compressor requires inspection')`), true)
  const detailsDesktop = await cdp.evaluate<any>(`(()=>{const modal=document.querySelector('.maintenance-details-modal');const box=modal.getBoundingClientRect();const hero=modal.querySelector('.maintenance-detail-hero');const sections=Array.from(modal.querySelectorAll('.maintenance-detail-section'));const blocks=[hero,...sections].map(node=>node.getBoundingClientRect());const labels=Array.from(modal.querySelectorAll('dt')).map(node=>node.textContent);return{width:box.width,insideViewport:box.left>=0&&box.right<=innerWidth,sections:sections.map(node=>node.querySelector('h4')?.textContent),labels,duplicateLabels:labels.filter((label,index)=>labels.indexOf(label)!==index),fullWidthBlocks:Math.max(...blocks.map(rect=>rect.width))-Math.min(...blocks.map(rect=>rect.width))<=1,verticalStack:blocks.every((rect,index)=>index===0||rect.top>blocks[index-1].top),goldModal:getComputedStyle(modal).borderLeftColor==='rgb(222, 197, 143)',goldSections:sections.every(node=>getComputedStyle(node).borderTopColor==='rgb(222, 197, 143)'),pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}})()`)
  assert.ok(detailsDesktop.width <= 660)
  assert.equal(detailsDesktop.insideViewport, true)
  assert.deepEqual(detailsDesktop.sections, ['Issue Information', 'Follow-up & Notes'])
  assert.deepEqual(detailsDesktop.duplicateLabels, [])
  assert.equal(detailsDesktop.fullWidthBlocks, true)
  assert.equal(detailsDesktop.verticalStack, true)
  assert.equal(detailsDesktop.goldModal, true)
  assert.equal(detailsDesktop.goldSections, true)
  assert.equal(detailsDesktop.pageOverflow, false)
  const detailsDesktopImage = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true }); await writeFile(join(screenshotDirectory, 'maintenance-details-desktop.png'), Buffer.from(detailsDesktopImage.data, 'base64'))
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(60)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(100)
  await cdp.evaluate(`document.querySelector('.maintenance-issue-trigger')?.click()`); await sleep(100)
  const detailsMobile = await cdp.evaluate<any>(`(()=>{const modal=document.querySelector('.maintenance-details-modal');const box=modal.getBoundingClientRect();return{insideViewport:box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight+1,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,heroDirection:getComputedStyle(document.querySelector('.maintenance-detail-hero')).flexDirection,sections:Array.from(modal.querySelectorAll('.maintenance-detail-section')).length}})()`)
  assert.equal(detailsMobile.insideViewport, true)
  assert.equal(detailsMobile.pageOverflow, false)
  assert.equal(detailsMobile.heroDirection, 'column')
  assert.equal(detailsMobile.sections, 2)
  const detailsMobileImage = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true }); await writeFile(join(screenshotDirectory, 'maintenance-details-mobile-390.png'), Buffer.from(detailsMobileImage.data, 'base64'))
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(60)
  await cdp.evaluate(`document.querySelector('button[aria-label="Customization Center"]')?.click()`)
  for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.customization-category-nav')`)) break; await sleep(100) }
  await cdp.evaluate(`Array.from(document.querySelectorAll('.customization-category-nav button')).find(button=>button.textContent?.trim()==='Maintenance')?.click()`)
  for (let attempt = 0; attempt < 60; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.maintenance-config')`)) break; await sleep(100) }
  const customizationBaseline = await cdp.evaluate<any>(`({title:document.querySelector('.maintenance-config h3')?.textContent?.trim(),categories:document.querySelectorAll('.maintenance-category-row').length,workflow:document.querySelectorAll('.maintenance-workflow-row').length,protectionNotes:document.querySelectorAll('.maintenance-protection-note').length,protectedBadges:Array.from(document.querySelectorAll('.maintenance-config *')).filter(node=>node.textContent?.trim()==='Protected').length})`)
  assert.deepEqual(customizationBaseline, { title: 'Maintenance Settings', categories: 8, workflow: 3, protectionNotes: 1, protectedBadges: 0 })
  const customizationResponsive: Record<string, unknown> = {}
  for (const width of [1440, 1024, 768, 430, 390, 360]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width <= 430 ? 940 : 1000, deviceScaleFactor: 1, mobile: width <= 430 }); await sleep(150)
    const result = await cdp.evaluate<any>(`(()=>{const root=document.querySelector('.maintenance-config');const grid=root.querySelector('.maintenance-config-grid');const cards=Array.from(root.querySelectorAll('.maintenance-config-card'));const categoryRows=Array.from(root.querySelectorAll('.maintenance-category-row'));const workflowRows=Array.from(root.querySelectorAll('.maintenance-workflow-row'));const actions=Array.from(root.querySelectorAll('button'));return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,rootOverflow:root.scrollWidth>root.clientWidth+1,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,balanced:Math.abs(cards[0].getBoundingClientRect().width-cards[1].getBoundingClientRect().width)<2,goldCards:cards.every(card=>getComputedStyle(card).borderColor==='rgb(222, 197, 143)'),categoryOverflow:categoryRows.some(row=>row.scrollWidth>row.clientWidth+1),workflowOverflow:workflowRows.some(row=>row.scrollWidth>row.clientWidth+1),smallTargets:${width}>700||actions.filter(button=>button.getBoundingClientRect().height<44).map(button=>button.textContent?.trim()||button.getAttribute('aria-label'))}})()`)
    assert.equal(result.pageOverflow, false, `Maintenance customization page overflow at ${width}px.`)
    assert.equal(result.rootOverflow, false, `Maintenance customization root overflow at ${width}px.`)
    assert.equal(result.columns, width <= 820 ? 1 : 2)
    if (width > 820) assert.equal(result.balanced, true)
    assert.equal(result.goldCards, true)
    assert.equal(result.categoryOverflow, false)
    assert.equal(result.workflowOverflow, false)
    assert.deepEqual(result.smallTargets, width <= 700 ? [] : true)
    customizationResponsive[String(width)] = result
    const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(join(screenshotDirectory, `maintenance-customization-${width}.png`), Buffer.from(image.data, 'base64'))
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true }); await sleep(100)
  await cdp.evaluate(`document.querySelector('.maintenance-category-row .ao-action')?.click()`); await sleep(80)
  const categoryModal = await cdp.evaluate<any>(`(()=>{const modal=document.querySelector('.maintenance-config-modal'),form=modal.querySelector('.maintenance-config-form'),input=form.querySelector('input');const box=modal.getBoundingClientRect();return{insideViewport:box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight+1,width:Math.round(box.width),inputVisible:input.getBoundingClientRect().height>=42,buttons:Array.from(form.querySelectorAll('.form-actions button')).map(button=>button.textContent.trim()),pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
  assert.deepEqual({ insideViewport: categoryModal.insideViewport, inputVisible: categoryModal.inputVisible, buttons: categoryModal.buttons, pageOverflow: categoryModal.pageOverflow }, { insideViewport: true, inputVisible: true, buttons: ['Cancel', 'Save'], pageOverflow: false })
  await cdp.evaluate(`(()=>{const input=document.querySelector('.maintenance-config-form input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Unsaved Maintenance');input.dispatchEvent(new Event('input',{bubbles:true}));window.confirm=()=>false})()`)
  await cdp.evaluate(`document.querySelector('.maintenance-modal-backdrop').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await sleep(60)
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.maintenance-config-modal')`), true, 'Backdrop must protect unsaved maintenance configuration changes.')
  await cdp.evaluate(`window.confirm=()=>true`); await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(60)
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.maintenance-config-modal')`), false)
  await cdp.evaluate(`document.querySelector('.maintenance-workflow-row .ao-action')?.click()`); await sleep(80)
  const workflowModal = await cdp.evaluate<any>(`(()=>{const modal=document.querySelector('.maintenance-config-modal'),color=modal.querySelector('input[type=color]'),box=modal.getBoundingClientRect();return{insideViewport:box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight+1,colorVisible:color.getBoundingClientRect().height>=42,title:modal.querySelector('h3')?.textContent?.trim()}})()`)
  assert.equal(workflowModal.insideViewport, true)
  assert.equal(workflowModal.colorVisible, true)
  assert.match(workflowModal.title, /^Edit .+ Color$/)
  assert.deepEqual(cdp.errors, [])
  console.log(JSON.stringify({ authenticatedManagerView: true, sharedActionSystem: true, primaryAddAlwaysVisible: true, pointerActivation: true, touchActivation: true, keyboardActivation: true, focusIndicator: focusState, titleAndChevronOpenDetails: true, redundantViewRemoved: true, equalSummaryCards: true, compactStatusEditFooter: true, desktopTabletAndMobile: true, mobileTargets44: true, statusSelectInteractive: true, statusPillNonInteractive: true, unsavedDismissalProtected: true, noPageOverflow: true, noClippedControls: true, maintenanceCustomization: { baseline: customizationBaseline, responsive: customizationResponsive, categoryModal, workflowModal }, desktopModal, mobileModal, detailsDesktop, detailsMobile, screenshots: ['artifacts/global-action-maintenance/maintenance-after-desktop-1440.png', 'artifacts/global-action-maintenance/maintenance-after-tablet-768.png', 'artifacts/global-action-maintenance/maintenance-after-mobile-430.png', 'artifacts/global-action-maintenance/maintenance-after-mobile-390.png', 'artifacts/global-action-maintenance/maintenance-after-mobile-360.png', 'artifacts/global-action-maintenance/maintenance-modal-desktop.png', 'artifacts/global-action-maintenance/maintenance-modal-mobile-390.png', 'artifacts/global-action-maintenance/maintenance-details-desktop.png', 'artifacts/global-action-maintenance/maintenance-details-mobile-390.png', ...Object.keys(customizationResponsive).map(width => `artifacts/global-action-maintenance/maintenance-customization-${width}.png`)], isolatedSchema027: true, canonicalDatabaseTouched: false, results }, null, 2))
} finally {
  socket?.close()
  for (const child of processes.reverse()) { if (child.exitCode === null) child.kill(); child.removeAllListeners(); child.unref() }
  await sleep(1000)
  await rm(fixture.root, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(() => undefined)
}
