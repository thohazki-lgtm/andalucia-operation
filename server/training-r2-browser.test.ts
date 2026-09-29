import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { TrainingRepository } from './training-repository.js'

const fixture = await createDisposableDevelopmentStore('training-r2-browser')
const root = fixture.root
const store = fixture.store
const profile = join(root, 'edge-profile')
const processes: ChildProcess[] = []
let socket: WebSocket | null = null
let completed = false
const token = `isolated-${randomUUID()}`
const sleep = (ms: number) => new Promise(resolveWait => setTimeout(resolveWait, ms))
const waitFor = async (url: string) => { for (let i=0;i<80;i++) { try { if ((await fetch(url)).ok) return } catch {} await sleep(250) } throw new Error(`Timed out waiting for ${url}`) }

class Cdp {
  private id = 0
  private pending = new Map<number, { resolve: (value: any) => void; reject: (reason: unknown) => void }>()
  readonly errors: string[] = []
  constructor(private socket: WebSocket) {
    socket.onmessage = event => { const message = JSON.parse(String(event.data)); if (message.id) { const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result) } else if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || 'Runtime exception') }
  }
  send(method: string, params: Record<string, unknown> = {}) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params })); return new Promise<any>((resolveCall, rejectCall) => this.pending.set(id, { resolve: resolveCall, reject: rejectCall })) }
  evaluate<T>(expression: string) { return this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then(result => result.result.value as T) }
}

try {
  const db = fixture.db
  const owner = (await db.query<any>("select u.id from user_accounts u join authorization_user_roles a on a.user_id=u.id and a.active=true join authorization_roles r on r.id=a.role_id and r.active=true where u.status='active' and r.role_key='owner' limit 1")).rows[0]
  assert.ok(owner)
  await db.query('insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval \'1 hour\')', [randomUUID(), createHash('sha256').update(token).digest('hex'), owner.id])
  const staffId = randomUUID()
  const sessionId = randomUUID()
  await new TrainingRepository(db).initialize()
  await db.query("update configuration_options set active=false,updated_at=now() where group_key='training_categories' and value in ('upselling','hygiene','safety','other')")
  assert.equal(Number((await db.query<{ count: number }>("select count(*)::int count from configuration_options where group_key='training_categories' and active=true")).rows[0].count), 4)
  await db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'SYN-001','Synthetic Training Staff','Waiter','active','2026-01-01')", [staffId])
  await db.query("insert into staff_membership_history(id,staff_id,outlet_scope_id,membership_dimension,effective_from,source,reason,review_status,reviewed_at,reviewed_by,is_current_baseline) values($1,$2,$3,'regular_outlet','2026-01-01','system','Synthetic browser fixture','approved',now(),'Synthetic fixture',true)", [randomUUID(), staffId, ANDALUCIA_SCOPE_ID])
  await db.query("insert into training_sessions(id,title,category_value,training_date,training_time,end_time,trainer,location,status_value,notes,active,source,outlet_scope_id,created_by,updated_by) values($1,'Grooming Standards and Personal Hygiene','service_standards','2026-09-10','10:00','10:30','Synthetic Trainer','Andalucía','planned','Synthetic test session',true,'manual',$2,'synthetic fixture','synthetic fixture')", [sessionId, ANDALUCIA_SCOPE_ID])
  await db.close()
  const node = process.execPath
  processes.push(spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '018', API_PORT: '3002' }, stdio: 'inherit' }))
  processes.push(spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5174'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3002' }, stdio: 'inherit' }))
  await Promise.all([waitFor('http://127.0.0.1:3002/api/health'), waitFor('http://127.0.0.1:5174/')])
  assert.equal((await fetch('http://127.0.0.1:3002/api/training/sharepoint/status')).status, 401)
  const directConfiguration = await fetch('http://127.0.0.1:3002/api/config/training', { headers: { Cookie: `andalucia_session=${token}` } }).then(response => response.json()) as { categories: Array<{ active: boolean }> }
  assert.equal(directConfiguration.categories.filter(category => category.active).length, 4)
  const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9224', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' }); processes.push(edge)
  await waitFor('http://127.0.0.1:9224/json/version')
  const pages = await (await fetch('http://127.0.0.1:9224/json/list')).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>
  const page = pages.find(item => item.type === 'page' && item.url === 'about:blank') || pages.find(item => item.type === 'page'); assert.ok(page)
  socket = new WebSocket(page.webSocketDebuggerUrl); await new Promise<void>((resolveOpen, rejectOpen) => { socket!.onopen = () => resolveOpen(); socket!.onerror = () => rejectOpen(new Error('CDP connection failed')) })
  const cdp = new Cdp(socket)
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Network.enable')
  const cookieResult = await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5174/', path: '/', httpOnly: true, sameSite: 'Strict' }); assert.equal(cookieResult.success, true)
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
  for (let i=0;i<160;i++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Training"]')`)) break; await sleep(250) }
  const shellReady = await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Training"]')`)
  if (!shellReady) console.error(JSON.stringify({ location: await cdp.evaluate<string>('location.href'), readyState: await cdp.evaluate<string>('document.readyState'), body: await cdp.evaluate<string>('document.body.innerText'), html: await cdp.evaluate<string>('document.documentElement.outerHTML.slice(0,1200)'), errors: cdp.errors }, null, 2))
  assert.equal(shellReady, true, await cdp.evaluate<string>('document.body.innerText'))
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('button[aria-label="Customization Center"]');if(!button)return false;button.click();return true})()`), true, await cdp.evaluate<string>('document.body.innerText'))
  for (let i=0;i<30;i++) { if (await cdp.evaluate<boolean>(`document.body.innerText.includes('Customization Center')`)) break; await sleep(150) }
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('.customization-category-nav button')).find(node=>node.textContent?.trim()==='Training');if(!button)return false;button.click();return true})()`), true)
  for (let i=0;i<30;i++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.training-customization-r1')`)) break; await sleep(150) }
  const customizationText = await cdp.evaluate<string>(`document.querySelector('.training-customization-r1')?.textContent || ''`)
  assert.equal(['Training Categories','Training Targets','Training Defaults','Training Workflow'].every(label => customizationText.includes(label)), true, customizationText)
  assert.equal(customizationText.includes('Training Statuses') || customizationText.includes('Training Attendance'), false, customizationText)
  assert.equal(await cdp.evaluate<boolean>(`!Array.from(document.querySelectorAll('.training-category-card button')).some(button=>['↑','↓'].includes(button.textContent?.trim()||''))`), true)
  assert.equal(await cdp.evaluate<boolean>(`!document.querySelector('.training-category-search')&&!document.querySelector('input[placeholder="Search categories"]')`), true)
  assert.equal(await cdp.evaluate<boolean>(`!document.querySelector('.training-category-disclosure')`), true)
  for (let i=0;i<80;i++) { if ((await cdp.evaluate<number>(`document.querySelectorAll('.training-category-row').length`)) === 4) break; await sleep(250) }
  const categoryCount = await cdp.evaluate<number>(`document.querySelectorAll('.training-category-row').length`)
  assert.equal(categoryCount, 4)
  assert.equal(await cdp.evaluate<boolean>(`Array.from(document.querySelectorAll('.training-category-row')).every(row=>row.querySelector('.badge')?.textContent==='Active')`), true)
  assert.equal(await cdp.evaluate<number>(`document.querySelectorAll('.training-category-row').length`), categoryCount)
  await cdp.evaluate(`document.querySelector('.training-category-row .training-row-actions .link')?.click()`); await sleep(120)
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.training-category-form')&&!document.querySelector('.training-category-form input[type="checkbox"]')&&document.querySelector('.training-category-form')?.textContent?.includes('Category name')&&document.querySelector('.training-category-form')?.textContent?.includes('Display color')`), true)
  await cdp.evaluate(`document.querySelector('.training-category-form')?.closest('.modal')?.querySelector('.close')?.click()`); await sleep(100)
  const customizationWidths: Array<Record<string, unknown>> = []
  for (const width of [360,390,430,768,820,1024,1280,1440]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width <= 430 ? 844 : width <= 1024 ? 900 : 1000, deviceScaleFactor: 1, mobile: width <= 430 }); await sleep(180)
    const result = await cdp.evaluate<any>(`(()=>{const root=document.querySelector('.training-customization-r1');const main=root.querySelector('.training-custom-main');const cards=Array.from(root.querySelectorAll('.training-custom-card'));const rootStyle=getComputedStyle(root);const mainStyle=getComputedStyle(main);const buttons=Array.from(root.querySelectorAll('button'));const rects=Object.fromEntries(cards.map(card=>[card.querySelector('h3')?.textContent,{top:Math.round(card.getBoundingClientRect().top),left:Math.round(card.getBoundingClientRect().left),height:Math.round(card.getBoundingClientRect().height)}]));return{width:innerWidth,display:rootStyle.display,columns:rootStyle.gridTemplateColumns,mainDisplay:mainStyle.display,mainColumns:mainStyle.gridTemplateColumns,cardCount:cards.length,pageClientWidth:document.documentElement.clientWidth,pageScrollWidth:document.documentElement.scrollWidth,rootClientWidth:root.clientWidth,rootScrollWidth:root.scrollWidth,minTouchHeight:Math.min(...buttons.filter(button=>!button.disabled).map(button=>Math.round(button.getBoundingClientRect().height))),cardHeights:cards.map(card=>Math.round(card.getBoundingClientRect().height)),rects,visualOrder:cards.map(card=>({name:card.querySelector('h3')?.textContent,top:Math.round(card.getBoundingClientRect().top)})).sort((a,b)=>a.top-b.top).map(item=>item.name)}})()`)
    assert.equal(result.cardCount, 4, `Training customization card count at ${width}px`)
    assert.ok(result.pageScrollWidth <= result.pageClientWidth + 1, `Training customization page overflow at ${width}px`)
    assert.ok(result.rootScrollWidth <= result.rootClientWidth + 1, `Training customization overflow at ${width}px`)
    if (width <= 430) { assert.equal(result.display, 'flex', `Training customization is not single-column at ${width}px`); assert.deepEqual(result.visualOrder, ['Training Targets','Training Defaults','Training Workflow','Training Categories']) }
    else { assert.equal(result.mainDisplay, 'grid', `Training customization main layout is not a grid at ${width}px`); assert.equal(String(result.mainColumns).split(' ').length, 2, `Training customization does not have two columns at ${width}px`); assert.equal(result.rects['Training Targets'].left, result.rects['Training Workflow'].left); assert.equal(result.rects['Training Defaults'].left, result.rects['Training Categories'].left); assert.ok(result.rects['Training Defaults'].left > result.rects['Training Targets'].left); }
    customizationWidths.push(result)
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); await cdp.evaluate(`document.querySelector('.training-category-card')?.scrollIntoView({block:'center'})`); await sleep(180)
  const persistedBefore = await cdp.evaluate<string[]>(`fetch('/api/config/training').then(response=>response.json()).then(value=>value.categories.filter(category=>category.active).map(category=>category.id))`)
  const dragBefore = await cdp.evaluate<string[]>(`Array.from(document.querySelectorAll('.training-category-row')).map(row=>row.dataset.trainingCategoryId)`)
  const dragPoints = await cdp.evaluate<any>(`(()=>{const rows=Array.from(document.querySelectorAll('.training-category-row'));const source=rows[1].querySelector('.training-drag-handle').getBoundingClientRect();const target=rows[0].getBoundingClientRect();return{sx:source.left+source.width/2,sy:source.top+source.height/2,tx:target.left+target.width/2,ty:target.top+target.height/2}})()`)
  await cdp.evaluate(`(()=>{const handle=document.querySelectorAll('.training-category-row')[1].querySelector('.training-drag-handle');window.__trainingMouseHandle=handle;handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:71,pointerType:'mouse',clientX:${dragPoints.sx},clientY:${dragPoints.sy},buttons:1}))})()`); await sleep(80)
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelectorAll('.training-category-row')[1].classList.contains('is-dragging')`), true)
  await cdp.evaluate(`window.__trainingMouseHandle.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:71,pointerType:'mouse',clientX:${dragPoints.tx},clientY:${dragPoints.ty},buttons:1}))`); await sleep(120)
  await cdp.evaluate(`(()=>{window.__trainingMouseHandle.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:71,pointerType:'mouse',clientX:${dragPoints.tx},clientY:${dragPoints.ty},buttons:0}));delete window.__trainingMouseHandle})()`); await sleep(500)
  const dragAfter = await cdp.evaluate<string[]>(`Array.from(document.querySelectorAll('.training-category-row')).map(row=>row.dataset.trainingCategoryId)`)
  assert.equal(dragAfter[0], dragBefore[1], 'desktop category drag did not reorder')
  const persistedOrder = await cdp.evaluate<string[]>(`fetch('/api/config/training').then(response=>response.json()).then(value=>value.categories.filter(category=>category.active).map(category=>category.id))`)
  assert.deepEqual(persistedOrder.slice(0, dragAfter.length), dragAfter)
  assert.deepEqual(persistedOrder.slice(dragAfter.length), persistedBefore.slice(dragAfter.length))
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await cdp.evaluate(`document.querySelector('.training-category-card')?.scrollIntoView()`); await sleep(180)
  const touchBefore = await cdp.evaluate<string[]>(`Array.from(document.querySelectorAll('.training-category-row')).map(row=>row.dataset.trainingCategoryId)`)
  const touchPoints = await cdp.evaluate<any>(`(()=>{const rows=Array.from(document.querySelectorAll('.training-category-row'));const source=rows[0].querySelector('.training-drag-handle').getBoundingClientRect();const target=rows[1].getBoundingClientRect();return{sx:source.left+source.width/2,sy:source.top+source.height/2,tx:target.left+target.width/2,ty:target.top+target.height/2}})()`)
  await cdp.evaluate(`(()=>{const handle=document.querySelectorAll('.training-category-row')[0].querySelector('.training-drag-handle');window.__trainingTouchHandle=handle;handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:72,pointerType:'touch',clientX:${touchPoints.sx},clientY:${touchPoints.sy},buttons:1}))})()`); await sleep(520)
  assert.equal(await cdp.evaluate<boolean>(`document.querySelectorAll('.training-category-row')[0].classList.contains('is-dragging')`), true, 'touch long-press did not activate')
  await cdp.evaluate(`window.__trainingTouchHandle.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:72,pointerType:'touch',clientX:${touchPoints.tx},clientY:${touchPoints.ty},buttons:1}))`); await sleep(120)
  await cdp.evaluate(`(()=>{const handle=window.__trainingTouchHandle;handle.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:72,pointerType:'touch',clientX:${touchPoints.tx},clientY:${touchPoints.ty},buttons:0}));delete window.__trainingTouchHandle})()`); await sleep(500)
  const touchAfter = await cdp.evaluate<string[]>(`Array.from(document.querySelectorAll('.training-category-row')).map(row=>row.dataset.trainingCategoryId)`)
  assert.equal(touchAfter[1], touchBefore[0], 'touch long-press category drag did not reorder')
  const persistedTouchOrder = await cdp.evaluate<string[]>(`fetch('/api/config/training').then(response=>response.json()).then(value=>value.categories.filter(category=>category.active).map(category=>category.id))`)
  assert.deepEqual(persistedTouchOrder.slice(0, touchAfter.length), touchAfter)
  assert.deepEqual(persistedTouchOrder.slice(touchAfter.length), persistedBefore.slice(touchAfter.length))
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('button[aria-label="Training"]');if(!button)return false;button.click();return true})()`), true)
  await cdp.evaluate(`document.querySelector('button[aria-label="Training"]')?.click()`)
  for (let i=0;i<30;i++) { if (await cdp.evaluate<boolean>(`document.body.innerText.includes('Sessions Scheduled') || document.body.innerText.includes('Unable to load Training')`)) break; await sleep(250) }
  const bodyText = await cdp.evaluate<string>('document.body.innerText')
  const sharePointStatus = await cdp.evaluate<any>(`fetch('/api/training/sharepoint/status').then(async response=>({status:response.status,body:await response.json()}))`)
  assert.equal(sharePointStatus.status, 200)
  assert.equal(sharePointStatus.body.configured, false)
  assert.equal(sharePointStatus.body.authenticationReady, false)
  assert.equal(Array.isArray(sharePointStatus.body.missingConfiguration), true)
  assert.deepEqual(Object.keys(sharePointStatus.body).sort(), ['authenticationReady', 'configured', 'missingConfiguration'])
  const normalizedBodyText = bodyText.toLowerCase()
  console.log(JSON.stringify({ renderedChecks: { performance: normalizedBodyText.includes('sessions scheduled'), coverage: bodyText.includes('Staff Training Coverage'), import: bodyText.includes('Import HR Calendar'), next: normalizedBodyText.includes('next training'), errors: cdp.errors } }))
  assert.equal(normalizedBodyText.includes('sessions scheduled') && normalizedBodyText.includes('mtd training hours') && normalizedBodyText.includes('staff covered'), true, bodyText.slice(0, 1200))
  assert.equal(bodyText.includes('Staff Training Coverage') && bodyText.includes('Import HR Calendar') && bodyText.toLowerCase().includes('next training'), true, bodyText.slice(0, 1800))
  const widths = [360,390,430,768,820,1024,1280,1440]
  const results: Array<Record<string, unknown>> = []
  for (const width of widths) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width <= 430 ? 844 : width <= 1024 ? 900 : 1000, deviceScaleFactor: 1, mobile: width <= 430 }); await sleep(180)
    const result = await cdp.evaluate<any>(`(()=>{const k=document.querySelector('.training-r2-kpis strong');const add=Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.includes('Add Training'));return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,kpi:parseFloat(getComputedStyle(k).fontSize),addVisible:!!add&&add.getBoundingClientRect().right<=innerWidth+1}})()`)
    assert.equal(result.overflow, false, `horizontal overflow at ${width}px`); assert.equal(result.addVisible, true, `Add Training clipped at ${width}px`)
    results.push(result)
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(150)
  await cdp.evaluate(`Array.from(document.querySelectorAll('.view-switch button')).find(b=>b.textContent?.trim()==='List')?.click()`); await sleep(200)
  assert.equal(await cdp.evaluate<boolean>(`getComputedStyle(document.querySelector('.training-r2-table')).display==='none' && getComputedStyle(document.querySelector('.training-r2-cards')).display!=='none'`), true)
  const managerSessionTitle = 'Grooming Standards and Personal Hygiene'
  const openedManagerSession = await cdp.evaluate<boolean>(`(()=>{const card=Array.from(document.querySelectorAll('.training-r2-cards>article')).find(node=>node.textContent?.includes(${JSON.stringify('Grooming Standards and Personal Hygiene')}));const button=card?.querySelector('button');if(!button)return false;button.click();return true})()`)
  assert.equal(openedManagerSession, true, `${managerSessionTitle} was not available in the rendered Training list`); await sleep(700)
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.training-r2-drawer') && document.body.innerText.includes('Eligibility preview')`), true)
  const drawerResults: Array<Record<string, unknown>> = []
  for (const width of widths) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width <= 430 ? 844 : width <= 1024 ? 900 : 1000, deviceScaleFactor: 1, mobile: width <= 430 }); await sleep(180)
    const result = await cdp.evaluate<any>(`(()=>{const drawer=document.querySelector('.training-r2-drawer');const sections=Array.from(drawer.querySelectorAll(':scope>section'));const session=document.querySelector('.training-detail-grid');const evidence=document.querySelector('.training-evidence-list');const names=Array.from(document.querySelectorAll('.training-evidence-list b'));const nameStyle=names[0]?getComputedStyle(names[0]):null;const lineHeight=nameStyle?parseFloat(nameStyle.lineHeight):0;const maxNameLines=Math.max(0,...names.map(node=>Math.round(node.getBoundingClientRect().height/lineHeight)));const drawerStyle=getComputedStyle(drawer);const sessionSection=session.closest('section');const eligibilitySection=evidence.closest('section');return{width:innerWidth,drawerWidth:Math.round(drawer.getBoundingClientRect().width),drawerDisplay:drawerStyle.display,drawerFlexDirection:drawerStyle.flexDirection,drawerScrollWidth:drawer.scrollWidth,drawerClientWidth:drawer.clientWidth,sessionWidth:Math.round(session.getBoundingClientRect().width),sessionScrollWidth:sessionSection.scrollWidth,sessionClientWidth:sessionSection.clientWidth,eligibilityWidth:Math.round(evidence.getBoundingClientRect().width),eligibilityScrollWidth:eligibilitySection.scrollWidth,eligibilityClientWidth:eligibilitySection.clientWidth,verticalSections:sections.every((node,index)=>index===0||node.getBoundingClientRect().top>=sections[index-1].getBoundingClientRect().bottom),staffNameFont:nameStyle?parseFloat(nameStyle.fontSize):0,maxNameLines,drawerOverflow:drawer.scrollWidth>drawer.clientWidth+1,pageScrollWidth:document.documentElement.scrollWidth,pageClientWidth:document.documentElement.clientWidth,pageOverflow:document.documentElement.scrollWidth>innerWidth+1,sessionColumns:getComputedStyle(session).gridTemplateColumns}})()`)
    assert.equal(result.drawerOverflow, false, `drawer overflow at ${width}px`)
    assert.equal(result.pageOverflow, false, `page overflow with drawer at ${width}px`)
    if (width <= 430) {
      assert.ok(result.drawerWidth <= width, `drawer exceeds viewport at ${width}px`)
      assert.equal(result.drawerFlexDirection, 'column', `drawer is not vertical at ${width}px`)
      assert.equal(result.verticalSections, true, `drawer sections are not vertically ordered at ${width}px`)
      assert.ok(result.sessionWidth >= width - 64, `Session is not full-width at ${width}px`)
      assert.ok(result.eligibilityWidth >= width - 64, `Eligibility is not full-width at ${width}px`)
      assert.equal(result.staffNameFont, 13, `staff-name size at ${width}px`)
      assert.ok(result.maxNameLines <= 2, `staff name exceeds two lines at ${width}px`)
    }
    drawerResults.push(result)
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(180)
  const performanceBefore = await cdp.evaluate<any>(`fetch('/api/training/performance?month=2026-09').then(response=>response.json())`)
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('.training-r2-drawer button')).find(node=>node.textContent?.trim()==='Confirm Training');if(!button)return false;button.click();return true})()`), true)
  for (let i=0;i<20;i++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.training-confirm-modal')`)) break; await sleep(100) }
  const confirmationWidths: Array<Record<string, unknown>> = []
  for (const width of widths) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width <= 430 ? 844 : width <= 1024 ? 900 : 1000, deviceScaleFactor: 1, mobile: width <= 430 }); await sleep(150)
    const result = await cdp.evaluate<any>(`(()=>{const modal=document.querySelector('.training-confirm-modal');const list=document.querySelector('.training-confirm-list');const articles=Array.from(document.querySelectorAll('.training-confirm-list>article'));const buttons=Array.from(document.querySelectorAll('.training-confirm-modal .form-actions button'));return{width:innerWidth,modalClientWidth:modal.clientWidth,modalScrollWidth:modal.scrollWidth,listClientWidth:list.clientWidth,listScrollWidth:list.scrollWidth,pageClientWidth:document.documentElement.clientWidth,pageScrollWidth:document.documentElement.scrollWidth,staffRows:articles.length,maxStaffRowWidth:Math.max(...articles.map(node=>Math.round(node.getBoundingClientRect().width))),buttonMinHeight:Math.min(...buttons.map(node=>Math.round(node.getBoundingClientRect().height))),headerDirection:articles[0]?getComputedStyle(articles[0].querySelector('header')).flexDirection:null}})()`)
    assert.ok(result.modalScrollWidth <= result.modalClientWidth + 1, `confirmation modal overflow at ${width}px`)
    assert.ok(result.listScrollWidth <= result.listClientWidth + 1, `confirmation list overflow at ${width}px`)
    assert.ok(result.pageScrollWidth <= result.pageClientWidth + 1, `confirmation page overflow at ${width}px`)
    if (width <= 430) { assert.equal(result.headerDirection, 'column'); assert.ok(result.buttonMinHeight >= 44, `confirmation action is not touch safe at ${width}px`) }
    confirmationWidths.push(result)
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(150)
  await cdp.evaluate(`(()=>{for(const select of document.querySelectorAll('.training-confirm-list select')){select.value='eligible';select.dispatchEvent(new Event('change',{bubbles:true}))}})()`); await sleep(100)
  await cdp.evaluate(`(()=>{for(const checkbox of document.querySelectorAll('.training-confirm-list input[type="checkbox"]')){if(!checkbox.checked)checkbox.click()}})()`)
  await cdp.evaluate(`(()=>{const input=document.querySelector('.training-duration input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'60');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(120)
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('.training-confirm-modal button')).find(node=>node.textContent?.trim()==='Confirm completion');if(!button||button.disabled)return false;button.click();return true})()`), true)
  for (let i=0;i<50;i++) { if (await cdp.evaluate<boolean>(`!document.querySelector('.training-confirm-modal')&&document.body.innerText.includes('Confirmed performance')`)) break; await sleep(150) }
  assert.equal(await cdp.evaluate<boolean>(`!document.querySelector('.training-confirm-modal')&&document.body.innerText.includes('Confirmed performance')&&document.body.innerText.includes('30 min credited')`), true)
  const performanceAfter = await cdp.evaluate<any>(`fetch('/api/training/performance?month=2026-09').then(response=>response.json())`)
  assert.equal(performanceAfter.sessionsCompleted, performanceBefore.sessionsCompleted + 1)
  assert.ok(performanceAfter.creditedMinutes > performanceBefore.creditedMinutes)
  assert.ok(performanceAfter.trainingHours > performanceBefore.trainingHours)
  assert.ok(performanceAfter.staffCovered >= performanceBefore.staffCovered)
  assert.deepEqual(cdp.errors, [])
  socket.close()
  console.log(JSON.stringify({ status: 'PASS', isolated: true, customizationWidths, widths: results, drawerWidths: drawerResults, confirmationWidths, sessionDetail: true, completionWorkflow: { sessionsCompletedBefore: performanceBefore.sessionsCompleted, sessionsCompletedAfter: performanceAfter.sessionsCompleted, creditedMinutesBefore: performanceBefore.creditedMinutes, creditedMinutesAfter: performanceAfter.creditedMinutes, trainingHoursBefore: performanceBefore.trainingHours, trainingHoursAfter: performanceAfter.trainingHours, staffCoveredBefore: performanceBefore.staffCovered, staffCoveredAfter: performanceAfter.staffCovered }, fatalRuntimeErrors: cdp.errors.length }, null, 2))
  completed = true
} finally {
  const cleanupDeadline = completed ? setTimeout(() => process.exit(0), 10_000) : undefined
  socket?.close()
  for (const child of processes.reverse()) {
    child.kill()
    if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    child.removeAllListeners()
    child.unref()
  }
  await sleep(1500)
  await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 500 }).catch(() => undefined)
  if (cleanupDeadline) clearTimeout(cleanupDeadline)
}
// The browser/API subprocess tree can leave Windows pipe handles referenced after
// verified cleanup. A successful standalone test exits explicitly; thrown failures
// still bypass this line and retain their non-zero exit status.
process.exit(0)
