import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'
import { StaffMembershipBaselineService } from './staff-membership-baseline-service.js'
import { ANDALUCIA_SCOPE_KEY } from './outlet-membership-repository.js'
import { StaffRepository } from './staff-repository.js'

const fixture = await createDisposableDevelopmentStore('duty-roster-calendar-frame')
const profile = join(fixture.root, 'edge-profile')
const output = resolve('artifacts', 'visual-validation')
const processes: ChildProcess[] = []
let socket: WebSocket | null = null
const token = `isolated-${randomUUID()}`
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))
const waitFor = async (url: string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      if (attempt === 99) throw new Error(`${url} returned ${response.status}: ${await response.text()}`)
    } catch (error) { if (attempt === 99) throw error }
    await sleep(200)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

class Cdp {
  private id = 0
  private pending = new Map<number, { resolve: (value: any) => void; reject: (reason: unknown) => void }>()
  readonly errors: string[] = []
  constructor(private ws: WebSocket) {
    ws.onmessage = event => {
      const message = JSON.parse(String(event.data))
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result)
      } else if (message.method === 'Runtime.exceptionThrown') {
        this.errors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || 'Runtime exception')
      }
    }
  }
  send(method: string, params: Record<string, unknown> = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise<any>((resolveCall, rejectCall) => this.pending.set(id, { resolve: resolveCall, reject: rejectCall }))
  }
  evaluate<T>(expression: string) {
    return this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then(result => {
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed')
      return result.result.value as T
    })
  }
}

const screenshot = async (cdp: Cdp, name: string) => {
  const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const target = join(output, name)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, Buffer.from(capture.data, 'base64'))
}

try {
  const staffRepository = new StaffRepository(fixture.store, fixture.db)
  await staffRepository.initialize()
  const position = (await fixture.db.query<{ value: string }>("select value from configuration_options where group_key='staff_positions' and active=true order by sort_order limit 1")).rows[0]?.value || 'F&B Attendant'
  const staffId = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'VIS-001','Visual Roster Staff',$2,'active','2024-01-01')", [staffId, position])
  const membership = new StaffMembershipBaselineService(fixture.db)
  const review = await membership.beginReview('2026-11', ANDALUCIA_SCOPE_KEY)
  await membership.saveSelection(review.id, { staffId, included: true, effectiveFrom: '2026-11-01', effectiveTo: null })
  await membership.approve(review.id)
  await fixture.db.query("insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval '1 hour')", [randomUUID(), createHash('sha256').update(token).digest('hex'), fixture.ownerId])
  await fixture.db.close()

  const node = process.execPath
  processes.push(spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', API_PORT: '3021', APP_ORIGIN: 'http://127.0.0.1:5191' }, stdio: 'ignore' }))
  processes.push(spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5191', '--strictPort'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3021' }, stdio: 'ignore' }))
  await Promise.all([waitFor('http://127.0.0.1:3021/api/health'), waitFor('http://127.0.0.1:5191/')])

  const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--edge-skip-compat-layer-relaunch', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  processes.push(edge)
  const activePort = join(profile, 'DevToolsActivePort')
  let debugPort = 0
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const [line] = (await readFile(activePort, 'utf8')).trim().split(/\r?\n/)
      debugPort = Number(line)
      if (debugPort > 0 && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) break
    } catch {}
    await sleep(100)
  }
  assert.ok(debugPort)
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json() as any[]
  const page = pages.find(item => item.type === 'page')
  assert.ok(page)
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise<void>((done, fail) => { socket!.onopen = () => done(); socket!.onerror = () => fail(new Error('CDP connection failed')) })
  const cdp = new Cdp(socket)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Network.enable')
  assert.equal((await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5191/', path: '/', httpOnly: true, sameSite: 'Strict' })).success, true)
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5191/' })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Duty Roster"]')`)) break
    await sleep(150)
  }
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('button[aria-label="Duty Roster"]');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await cdp.evaluate<boolean>(`!!document.querySelector('.roster-weekly tbody tr')`)) break
    await sleep(100)
  }
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.roster-weekly tbody tr')`), true, 'The disposable roster fixture did not render its approved staff row.')

  const results: Record<string, unknown> = {}
  for (const width of [1440, 1024, 390]) {
    const mobile = width <= 700
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile })
    await sleep(150)
    const result = await cdp.evaluate<any>(`(()=>{const nav=document.querySelector('.roster-period-navigation');const navRect=nav.getBoundingClientRect();const arrows=Array.from(nav.querySelectorAll(':scope > .ao-icon-action')).map(button=>button.getBoundingClientRect());const table=document.querySelector('.roster-weekly');const headers=table?Array.from(table.querySelectorAll('thead th')):[];const cells=table?Array.from(table.querySelectorAll('tbody tr:first-child td')):[];const drift=headers.length===cells.length?headers.map((header,index)=>Math.max(Math.abs(header.getBoundingClientRect().left-cells[index].getBoundingClientRect().left),Math.abs(header.getBoundingClientRect().right-cells[index].getBoundingClientRect().right))):[];const pillDrift=cells.slice(1,-1).map(cell=>{const pill=cell.querySelector('.duty-code-select');if(!pill)return null;const cellRect=cell.getBoundingClientRect();const pillRect=pill.getBoundingClientRect();return Math.abs((cellRect.left+cellRect.right)/2-(pillRect.left+pillRect.right)/2)}).filter(value=>value!==null);const navStyle=getComputedStyle(nav);return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,navBorderColor:navStyle.borderTopColor,navBorderWidth:parseFloat(navStyle.borderTopWidth),navRadius:parseFloat(navStyle.borderTopLeftRadius),arrows:arrows.length,arrowsInside:arrows.every(rect=>rect.left>=navRect.left&&rect.right<=navRect.right&&rect.top>=navRect.top&&rect.bottom<=navRect.bottom),headerCount:headers.length,cellCount:cells.length,maxDrift:drift.length?Math.max(...drift):null,maxPillCenterDrift:pillDrift.length?Math.max(...pillDrift):null,headerRightBorders:headers.slice(0,-1).every(cell=>parseFloat(getComputedStyle(cell).borderRightWidth)===1),bodyRightBorders:cells.slice(0,-1).every(cell=>parseFloat(getComputedStyle(cell).borderRightWidth)===1),bodyLeftBorders:cells.every(cell=>parseFloat(getComputedStyle(cell).borderLeftWidth)===0),mobileCards:Array.from(document.querySelectorAll('.mobile-roster-card')).filter(card=>getComputedStyle(card).display!=='none').length}})()`)
    assert.equal(result.pageOverflow, false, `Duty Roster overflowed at ${width}px.`)
    assert.equal(result.navBorderColor, 'rgb(201, 166, 90)')
    assert.ok(result.navBorderWidth >= 1)
    assert.ok(result.navRadius >= 12)
    assert.equal(result.arrows, 2)
    assert.equal(result.arrowsInside, true)
    if (mobile) {
      assert.ok(result.mobileCards >= 1)
      const pageScrollbar = await cdp.evaluate<any>(`(()=>{const root=document.documentElement;const standard=getComputedStyle(root);const webkit=getComputedStyle(root,'::-webkit-scrollbar');const thumb=getComputedStyle(root,'::-webkit-scrollbar-thumb');const button=getComputedStyle(root,'::-webkit-scrollbar-button');return{width:standard.scrollbarWidth,color:standard.scrollbarColor,webkitWidth:parseFloat(webkit.width),thumbColor:thumb.backgroundColor,buttonDisplay:button.display,buttonWidth:parseFloat(button.width),buttonHeight:parseFloat(button.height)}})()`)
      assert.equal(pageScrollbar.width, 'thin')
      assert.equal(pageScrollbar.color, 'rgb(201, 166, 90) rgba(0, 0, 0, 0)')
      assert.equal(pageScrollbar.webkitWidth, 5)
      assert.equal(pageScrollbar.thumbColor, 'rgb(201, 166, 90)')
      assert.equal(pageScrollbar.buttonDisplay, 'none')
      assert.equal(pageScrollbar.buttonWidth, 0)
      assert.equal(pageScrollbar.buttonHeight, 0)
      result.pageScrollbar = pageScrollbar
      assert.equal(await cdp.evaluate<boolean>(`(()=>{const trigger=Array.from(document.querySelectorAll('.mobile-roster-card .duty-code-trigger')).find(button=>getComputedStyle(button).display!=='none');if(!trigger)return false;trigger.click();return true})()`), true)
      await sleep(100)
      const scrollbar = await cdp.evaluate<any>(`(()=>{const menu=document.querySelector('.duty-code-menu');if(!menu)return null;const standard=getComputedStyle(menu);const webkit=getComputedStyle(menu,'::-webkit-scrollbar');const button=getComputedStyle(menu,'::-webkit-scrollbar-button');return{width:standard.scrollbarWidth,webkitWidth:parseFloat(webkit.width),buttonDisplay:button.display,buttonWidth:parseFloat(button.width),buttonHeight:parseFloat(button.height)}})()`)
      assert.ok(scrollbar, 'The mobile duty menu did not open.')
      assert.equal(scrollbar.width, 'thin')
      assert.ok(scrollbar.webkitWidth <= 7)
      assert.equal(scrollbar.buttonDisplay, 'none')
      assert.equal(scrollbar.buttonWidth, 0)
      assert.equal(scrollbar.buttonHeight, 0)
      result.dropdownScrollbar = scrollbar
      await screenshot(cdp, `duty-roster-dropdown-scrollbar-${width}.png`)
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    } else {
      assert.equal(result.headerCount, 9)
      assert.equal(result.cellCount, 9)
      assert.ok(result.maxDrift <= 0.1, `Header/body column drift at ${width}px: ${result.maxDrift}`)
      assert.ok(result.maxPillCenterDrift <= 0.6, `Duty pill center drift at ${width}px: ${result.maxPillCenterDrift}`)
      assert.equal(result.headerRightBorders, true)
      assert.equal(result.bodyRightBorders, true)
      assert.equal(result.bodyLeftBorders, true)
    }
    await screenshot(cdp, `duty-roster-calendar-frame-${width}.png`)
    results[String(width)] = result
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('.duty-roster-tabs button')).find(item=>item.textContent?.trim()==='Duty Code Settings');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await cdp.evaluate<boolean>(`!!document.querySelector('.duty-code-manager > .panel-title')`)) break
    await sleep(50)
  }
  const dutyCodeHeader = await cdp.evaluate<any>(`(()=>{const header=document.querySelector('.duty-code-manager > .panel-title');const title=header?.querySelector('h3');const eyebrow=header?.querySelector('.eyebrow');if(!header||!title||!eyebrow)return null;const style=getComputedStyle(header);return{backgroundImage:style.backgroundImage,titleColor:getComputedStyle(title).color,eyebrowColor:getComputedStyle(eyebrow).color,borderTopColor:getComputedStyle(header.closest('.duty-code-manager')).borderTopColor}})()`)
  assert.ok(dutyCodeHeader)
  assert.match(dutyCodeHeader.backgroundImage, /linear-gradient\(100deg, rgb\(20, 59, 97\) 0%, rgb\(31, 82, 123\) 58%, rgb\(63, 143, 194\) 100%\)/)
  assert.equal(dutyCodeHeader.titleColor, 'rgb(255, 255, 255)')
  assert.equal(dutyCodeHeader.eyebrowColor, 'rgb(216, 187, 117)')
  assert.equal(dutyCodeHeader.borderTopColor, 'rgb(201, 166, 90)')
  await screenshot(cdp, 'duty-code-settings-header-1440.png')
  results.dutyCodeHeader = dutyCodeHeader
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await cdp.evaluate(`document.querySelector('.app-sidebar.mobile-open .drawer-close')?.click()`)
  await sleep(100)
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await cdp.evaluate<boolean>(`!!document.querySelector('.duty-code-card')`)) break
    await sleep(50)
  }
  const mobileDutyCodeCard = await cdp.evaluate<any>(`(()=>{const card=document.querySelector('.duty-code-card');const details=card?.querySelector('dl');const items=details?Array.from(details.children):[];const financial=card?.querySelector('.duty-financial-rule');const availability=card?.querySelector('.duty-availability-fixed, .duty-availability-toggle');if(!card||items.length!==3||!financial||!availability)return null;const tops=items.map(item=>item.getBoundingClientRect().top);return{height:card.getBoundingClientRect().height,detailColumns:getComputedStyle(details).gridTemplateColumns.split(' ').length,maxRowTopDrift:Math.max(...tops)-Math.min(...tops),financialWhiteSpace:getComputedStyle(financial).whiteSpace,availabilityWhiteSpace:getComputedStyle(availability).whiteSpace,financialOverflow:financial.scrollWidth>financial.clientWidth+1,availabilityOverflow:availability.scrollWidth>availability.clientWidth+1,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
  assert.ok(mobileDutyCodeCard, 'The mobile Duty Code card did not render its three status details.')
  assert.equal(mobileDutyCodeCard.detailColumns, 3)
  assert.ok(mobileDutyCodeCard.maxRowTopDrift <= 0.1)
  assert.equal(mobileDutyCodeCard.financialWhiteSpace, 'nowrap')
  assert.equal(mobileDutyCodeCard.availabilityWhiteSpace, 'nowrap')
  assert.equal(mobileDutyCodeCard.financialOverflow, false)
  assert.equal(mobileDutyCodeCard.availabilityOverflow, false)
  assert.equal(mobileDutyCodeCard.pageOverflow, false)
  assert.ok(mobileDutyCodeCard.height < 210, `Mobile Duty Code card remained too tall: ${mobileDutyCodeCard.height}px`)
  await screenshot(cdp, 'duty-code-settings-card-390.png')
  results.mobileDutyCodeCard = mobileDutyCodeCard
  assert.deepEqual(cdp.errors, [])
  console.log(JSON.stringify({ rendered: true, results, screenshots: [1440, 1024, 390].map(width => `artifacts/visual-validation/duty-roster-calendar-frame-${width}.png`) }, null, 2))
} finally {
  socket?.close()
  for (const child of processes.reverse()) {
    if (child.exitCode === null) child.kill()
    child.removeAllListeners()
    child.unref()
  }
  await sleep(800)
  await fixture.cleanup().catch(() => undefined)
}
