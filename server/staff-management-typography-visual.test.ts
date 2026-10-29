import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { AuthService } from './auth-service.js'

const fixture = await createDisposableDevelopmentStore('staff-management-typography-visual')
const profile = join(fixture.root, 'edge-profile')
const output = resolve('artifacts', 'staff-management-typography')
const processes: ChildProcess[] = []
const startupLogs: string[] = []
let socket: WebSocket | null = null
const token = `isolated-${randomUUID()}`
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))
const loopbackReady = (url: string) => new Promise<boolean>(resolveReady => {
  const request = httpRequest(url, response => { response.resume(); response.once('end', () => resolveReady((response.statusCode || 500) < 400)) })
  request.once('error', () => resolveReady(false))
  request.setTimeout(1_000, () => { request.destroy(); resolveReady(false) })
  request.end()
})
const waitFor = async (url: string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await loopbackReady(url)) return
    await sleep(200)
  }
  throw new Error(`Timed out waiting for ${url}${startupLogs.length ? `\n${startupLogs.join('').slice(-4000)}` : ''}`)
}
const observe = (process: ChildProcess, label: string) => {
  process.stdout?.on('data', chunk => startupLogs.push(`[${label}] ${String(chunk)}`))
  process.stderr?.on('data', chunk => startupLogs.push(`[${label}] ${String(chunk)}`))
  processes.push(process)
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
  const owner = (await fixture.db.query<any>("select u.id from user_accounts u join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.active=true where u.status='active' and r.role_key='owner' limit 1")).rows[0]
  assert.ok(owner)
  const position = 'fixture_designation'
  await fixture.db.query("insert into configuration_options(id,group_key,value,label,metadata,active,sort_order) values($1,'staff_positions',$2,'Fixture Designation','{}',true,0) on conflict(group_key,value) do nothing", [randomUUID(), position])
  await fixture.db.query("insert into configuration_options(id,group_key,value,label,metadata,active,sort_order) values($1,'employment_statuses','active','Active',$2,true,0) on conflict(group_key,value) do nothing", [randomUUID(), JSON.stringify({ employmentStage: 'active', rosterEligible: true, selectableForNewRecords: true })])
  const staffId = randomUUID()
  const staffWithoutAccountId = randomUUID()
  const membershipRevisionId = randomUUID()
  const membershipMonth = new Date().toISOString().slice(0, 7)
  const membershipMonthEnd = new Date(Date.UTC(Number(membershipMonth.slice(0, 4)), Number(membershipMonth.slice(5, 7)), 0)).toISOString().slice(0, 10)
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'TYPE-001','Typography Staff',$2,'active','2024-01-01')", [staffId, position])
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'TYPE-002','No Account Staff',$2,'active','2024-02-01')", [staffWithoutAccountId, position])
  await fixture.db.query("insert into staff_membership_baseline_reviews(id,outlet_scope_id,baseline_month,status,revision_number,review_type,is_current_revision,is_authoritative,approved_at,approved_by,approved_by_user_id) values($1,$2,$3,'approved',1,'initial',true,true,now(),'Typography Visual Manager',$4)", [membershipRevisionId, ANDALUCIA_SCOPE_ID, membershipMonth, owner.id])
  await fixture.db.query("insert into staff_membership_history(id,staff_id,outlet_scope_id,membership_dimension,effective_from,effective_to,source,review_status,reviewed_at,reviewed_by,baseline_revision_id,is_current_baseline) values($1,$2,$3,'regular_outlet',$4,$5,'baseline_manager_review','approved',now(),'Typography Visual Manager',$6,true)", [randomUUID(), staffId, ANDALUCIA_SCOPE_ID, `${membershipMonth}-01`, membershipMonthEnd, membershipRevisionId])
  await new AuthService(fixture.db).createEmployeeAccount({ staffId, identifier: 'typography.staff', outletScopeId: ANDALUCIA_SCOPE_ID }, { userId: owner.id, displayName: 'Typography Visual Manager' })
  await fixture.db.query("insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval '1 hour')", [randomUUID(), createHash('sha256').update(token).digest('hex'), owner.id])
  await fixture.db.close()

  const node = process.execPath
  observe(spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', API_PORT: '3317', APP_ORIGIN: 'http://127.0.0.1:5487' }, stdio: ['ignore', 'pipe', 'pipe'] }), 'api')
  observe(spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5487', '--strictPort'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3317' }, stdio: ['ignore', 'pipe', 'pipe'] }), 'vite')
  await Promise.all([waitFor('http://127.0.0.1:3317/api/health'), waitFor('http://127.0.0.1:5487/')])

  const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--edge-skip-compat-layer-relaunch', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  processes.push(edge)
  let debugPort = 0
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const [line] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)
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
  assert.equal((await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5487/', path: '/', httpOnly: true, sameSite: 'Strict' })).success, true)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5487/' })
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Staff Management"]')`)) break; await sleep(100) }
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('button[aria-label="Staff Management"]');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-directory-page')`)) break; await sleep(100) }

  const widths = [1440, 1280, 1024, 768, 430, 390, 360]
  const measurements: Record<string, unknown> = {}
  for (const width of widths) {
    const mobile = width <= 700
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile })
    await sleep(100)
    const result = await cdp.evaluate<any>(`(()=>{const tabs=Array.from(document.querySelectorAll('.staff-section-bar .staff-section-tabs button'));const name=document.querySelector('.staff-directory-page .staff-name-cell b');const style=getComputedStyle(name);const header=document.querySelector('.staff-management-header');const wrap=document.querySelector('.staff-directory-page .staff-table-wrap');const cards=document.querySelector('.staff-directory-page .staff-mobile-cards');return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,headerTop:Math.round(header.getBoundingClientRect().top),containedTableScroll:wrap.scrollWidth>wrap.clientWidth,tableOverflowX:getComputedStyle(wrap).overflowX,mobileCardsDisplay:getComputedStyle(cards).display,tabCount:tabs.length,tabFontSizes:[...new Set(tabs.map(tab=>getComputedStyle(tab).fontSize))],tabFontWeights:[...new Set(tabs.map(tab=>getComputedStyle(tab).fontWeight))],tabLabelsFit:tabs.every(tab=>tab.scrollWidth<=tab.clientWidth+1&&getComputedStyle(tab).whiteSpace==='nowrap'),nameFontSize:style.fontSize,nameFontWeight:style.fontWeight,nameColor:style.color,nameFits:name.scrollWidth<=name.clientWidth+1}})()`)
    assert.equal(result.pageOverflow, false, `Page overflow at ${width}px.`)
    assert.ok(result.headerTop <= (mobile ? 90 : 40), `Staff header was vertically displaced at ${width}px: ${result.headerTop}px.`)
    if (mobile) {
      assert.equal(result.containedTableScroll, true)
      assert.equal(result.tableOverflowX, 'auto')
      assert.equal(result.mobileCardsDisplay, 'none')
    }
    assert.equal(result.tabCount, 4)
    assert.deepEqual(result.tabFontSizes, ['12px'])
    assert.deepEqual(result.tabFontWeights, ['600'])
    assert.equal(result.tabLabelsFit, true)
    assert.equal(result.nameFontSize, '13px')
    assert.equal(result.nameFontWeight, '650')
    assert.equal(result.nameColor, 'rgb(23, 61, 86)')
    assert.equal(result.nameFits, true)
    measurements[String(width)] = result
    await screenshot(cdp, `team-directory-after-${width}.png`)
  }
  const modalMeasurements: Record<string, unknown> = {}
  for (const width of [1440, 390]) {
    const mobile = width <= 700
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile })
    assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('.staff-section-add');if(!button)return false;button.click();return true})()`), true)
    for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-edit-modal .form-actions .ao-action--primary')`)) break; await sleep(100) }
    const result = await cdp.evaluate<any>(`(()=>{const modal=document.querySelector('.staff-edit-modal');const action=modal?.querySelector('.form-actions .ao-action--primary');const label=action?.querySelector('.ao-action__label');const designation=document.querySelector('.staff-directory-page .staff-table td:nth-child(3)');if(!modal||!action||!label||!designation)return null;const actionStyle=getComputedStyle(action);const labelStyle=getComputedStyle(label);return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,modalFits:modal.getBoundingClientRect().width<=document.documentElement.clientWidth,label:label.textContent?.trim(),actionColor:actionStyle.color,actionBackground:actionStyle.backgroundColor,labelVisibility:labelStyle.visibility,labelOpacity:labelStyle.opacity,labelTransform:labelStyle.textTransform,designationAlignment:getComputedStyle(designation).textAlign}})()`)
    assert.ok(result)
    assert.equal(result.pageOverflow, false)
    assert.equal(result.modalFits, true)
    assert.equal(result.label, 'Save staff member')
    assert.equal(result.actionColor, 'rgb(255, 255, 255)')
    assert.equal(result.actionBackground, 'rgb(12, 103, 92)')
    assert.equal(result.labelVisibility, 'visible')
    assert.equal(result.labelOpacity, '1')
    assert.equal(result.labelTransform, 'capitalize')
    assert.equal(result.designationAlignment, 'center')
    modalMeasurements[String(width)] = result
    await screenshot(cdp, `edit-staff-after-${width}.png`)
    assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=[...document.querySelectorAll('.staff-edit-modal .form-actions button')].find(item=>item.textContent?.trim()==='Cancel');if(!button)return false;button.click();return true})()`), true)
    for (let attempt = 0; attempt < 100; attempt++) { if (!await cdp.evaluate<boolean>(`!!document.querySelector('.staff-edit-modal')`)) break; await sleep(50) }
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('[data-staff-action="edit"]');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-edit-modal')`)) break; await sleep(100) }
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const labels=[...document.querySelectorAll('.staff-edit-modal label')];const label=labels.find(item=>item.textContent?.includes('Nationality'));const input=label?.querySelector('input');if(!input)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;setter?.call(input,'Visual Test Nationality');input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`), true)
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const labels=[...document.querySelectorAll('.staff-edit-modal label')];const label=labels.find(item=>item.textContent?.includes('Designation'));const select=label?.querySelector('select');const value=[...select?.options||[]].find(option=>option.value)?.value;if(!select||!value)return false;const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')?.set;setter?.call(select,value);select.dispatchEvent(new Event('change',{bubbles:true}));return true})()`), true)
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('.staff-edit-modal .form-actions .ao-action--primary');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (!await cdp.evaluate<boolean>(`!!document.querySelector('.staff-edit-modal')`)) break; await sleep(100) }
  const saveResult = await cdp.evaluate<any>(`({closed:!document.querySelector('.staff-edit-modal'),error:document.querySelector('.staff-edit-modal .staff-form-error')?.textContent?.trim()||null})`)
  assert.equal(saveResult.closed, true, saveResult.error || 'Edit Staff modal did not close after saving disposable test data.')
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('[data-staff-action="edit"]');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-edit-modal')`)) break; await sleep(100) }
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const labels=[...document.querySelectorAll('.staff-edit-modal label')];const label=labels.find(item=>item.textContent?.includes('Nationality'));return label?.querySelector('input')?.value==='Visual Test Nationality'})()`), true)
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=[...document.querySelectorAll('.staff-edit-modal .form-actions button')].find(item=>item.textContent?.trim()==='Cancel');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (!await cdp.evaluate<boolean>(`!!document.querySelector('.staff-edit-modal')`)) break; await sleep(50) }
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('[data-staff-action="view"]');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-profile-drawer')`)) break; await sleep(100) }
  const profileDesktop = await cdp.evaluate<any>(`(()=>{const drawer=document.querySelector('.staff-profile-drawer');const section=drawer?.querySelector('.staff-profile-scroll>section');if(!drawer||!section)return null;return{fits:drawer.getBoundingClientRect().width<=innerWidth,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,drawerBackground:getComputedStyle(drawer).backgroundColor,sectionBorder:getComputedStyle(section).borderColor}})()`)
  assert.ok(profileDesktop)
  assert.equal(profileDesktop.fits, true)
  assert.equal(profileDesktop.pageOverflow, false)
  await screenshot(cdp, 'staff-profile-after-1440.png')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  const profileMobile = await cdp.evaluate<any>(`(()=>{const drawer=document.querySelector('.staff-profile-drawer');return{fits:drawer.getBoundingClientRect().width<=innerWidth,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
  assert.equal(profileMobile.fits, true)
  assert.equal(profileMobile.pageOverflow, false)
  await screenshot(cdp, 'staff-profile-after-390.png')
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const overlay=document.querySelector('.staff-profile-overlay');if(!overlay)return false;overlay.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (!await cdp.evaluate<boolean>(`!!document.querySelector('.staff-profile-drawer')`)) break; await sleep(50) }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=[...document.querySelectorAll('.staff-section-tabs button')].find(item=>item.textContent?.trim()==='Team Membership');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.team-membership-page')`)) break; await sleep(100) }
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.membership-approved-page .membership-table.approved-table tbody tr')`)) break; await sleep(100) }
  const typographyExpression = (selectors: Record<string, string>) => `(()=>{const result={};const selectors=${JSON.stringify(selectors)};for(const [key,selector] of Object.entries(selectors)){const element=document.querySelector(selector);if(!element){result[key]=null;continue}const style=getComputedStyle(element);result[key]={fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,letterSpacing:style.letterSpacing,color:style.color}}return result})()`
  const membershipTypography = await cdp.evaluate<any>(typographyExpression({ name: '.membership-table.approved-table tbody td:first-child b', id: '.membership-table.approved-table tbody td:nth-child(2)', heading: '.membership-table.approved-table thead th:first-child', value: '.membership-table.approved-table tbody td:nth-child(3)' }))
  await screenshot(cdp, 'team-membership-reference-1440.png')
  assert.ok(membershipTypography.name && membershipTypography.id && membershipTypography.heading && membershipTypography.value)
  const membershipMeasurements: Record<string, unknown> = {}
  for (const width of [1440, 1024, 768, 430, 390, 360]) {
    const mobile = width <= 430
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile })
    await cdp.evaluate(`window.scrollTo({top:0,left:0,behavior:'instant'})`)
    const result = await cdp.evaluate<any>(`(()=>{const root=document.querySelector('.membership-approved-page');const table=root?.querySelector('.membership-table.approved-table');const mobileList=root?.querySelector('.membership-mobile-list');const headers=Array.from(table?.querySelectorAll('thead th')||[]);const cells=Array.from(table?.querySelectorAll('tbody tr:first-child td')||[]);const divider=cells[0]?getComputedStyle(cells[0]):null;const summary=root?.querySelector('.membership-approved-banner');const history=root?.querySelector('.membership-history-disclosure summary');return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,rootOverflow:root?root.scrollWidth>root.clientWidth+1:false,tableVisible:!!table&&getComputedStyle(table).display!=='none'&&table.getBoundingClientRect().width>0,mobileVisible:!!mobileList&&getComputedStyle(mobileList).display!=='none'&&mobileList.getBoundingClientRect().height>0,headerAlign:headers.map(cell=>getComputedStyle(cell).textAlign),cellAlign:cells.map(cell=>getComputedStyle(cell).textAlign),dividerWidth:divider?.borderRightWidth,dividerStyle:divider?.borderRightStyle,summaryHeight:summary?.getBoundingClientRect().height||null,historyHeight:history?.getBoundingClientRect().height||null}})()`)
    assert.equal(result.pageOverflow, false, `Team Membership caused page overflow at ${width}px.`)
    assert.equal(result.rootOverflow, false, `Team Membership root overflowed at ${width}px.`)
    if (width > 700) {
      assert.equal(result.tableVisible, true)
      assert.deepEqual(result.headerAlign, ['left', 'center', 'center'])
      assert.deepEqual(result.cellAlign, ['left', 'center', 'center'])
      assert.equal(result.dividerWidth, '1px')
      assert.equal(result.dividerStyle, 'solid')
    } else {
      assert.equal(result.tableVisible, false)
      assert.equal(result.mobileVisible, true)
    }
    assert.ok(result.summaryHeight <= (width <= 700 ? 310 : width <= 1100 ? 220 : 130), `Approval Summary is not compact at ${width}px.`)
    assert.ok(result.historyHeight <= (width <= 700 ? 74 : 60), `Revision History heading is not compact at ${width}px.`)
    membershipMeasurements[String(width)] = result
    await screenshot(cdp, `team-membership-after-${width}.png`)
    if (width === 1440 || width === 390) {
      await cdp.evaluate(`document.querySelector('.membership-history-disclosure')?.setAttribute('open','')`)
      await screenshot(cdp, `team-membership-history-after-${width}.png`)
      await cdp.evaluate(`document.querySelector('.membership-history-disclosure')?.removeAttribute('open')`)
    }
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('.membership-approved-banner button')).find(item=>item.textContent?.includes('Correct Membership'));if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.membership-dialog')`)) break; await sleep(50) }
  const membershipDialogTheme = await cdp.evaluate<any>(`(()=>{const dialog=document.querySelector('.membership-dialog');const textarea=dialog?.querySelector('textarea');const title=dialog?.querySelector('h2');if(!dialog||!textarea||!title)return null;const style=getComputedStyle(dialog);const field=getComputedStyle(textarea);const titleStyle=getComputedStyle(title);return{background:style.backgroundColor,borderTopColor:style.borderTopColor,fieldBackground:field.backgroundColor,fieldBorder:field.borderTopColor,titleFontFamily:titleStyle.fontFamily,titleFontSize:titleStyle.fontSize,titleFontWeight:titleStyle.fontWeight,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
  assert.ok(membershipDialogTheme)
  assert.equal(membershipDialogTheme.background, 'rgb(244, 248, 245)')
  assert.equal(membershipDialogTheme.borderTopColor, membershipDialogTheme.fieldBorder)
  assert.equal(membershipDialogTheme.fieldBackground, 'rgb(255, 255, 255)')
  assert.match(membershipDialogTheme.titleFontFamily, /(?:AO Good Sans|Good Sans|DM Sans)/)
  assert.equal(membershipDialogTheme.titleFontSize, '18px')
  assert.equal(membershipDialogTheme.titleFontWeight, '500')
  assert.equal(membershipDialogTheme.pageOverflow, false)
  await screenshot(cdp, 'team-membership-correction-dialog-after-1440.png')
  await cdp.evaluate(`document.querySelector('.membership-dialog .close')?.click()`)
  for (let attempt = 0; attempt < 80; attempt++) { if (!await cdp.evaluate<boolean>(`!!document.querySelector('.membership-dialog')`)) break; await sleep(50) }
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=[...document.querySelectorAll('.staff-section-tabs button')].find(item=>item.textContent?.trim()==='Account Management');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-account-table tbody tr')`)) break; await sleep(100) }
  const accountTypography = await cdp.evaluate<any>(typographyExpression({ name: '.staff-account-table tbody td:first-child b', id: '.staff-account-table tbody td:nth-child(2)', heading: '.staff-account-table thead th:first-child', value: '.staff-account-table tbody td:nth-child(3)' }))
  assert.equal(accountTypography.heading.fontSize, '9px')
  assert.equal(accountTypography.heading.fontWeight, '600')
  assert.equal(membershipTypography.name.fontSize, '12px')
  assert.equal(membershipTypography.name.fontWeight, '500')
  assert.equal(membershipTypography.id.fontSize, '10.5px')
  assert.equal(membershipTypography.id.fontWeight, '400')
  assert.equal(membershipTypography.heading.fontSize, '9px')
  assert.equal(membershipTypography.heading.fontWeight, '600')
  assert.equal(membershipTypography.value.fontSize, '11.5px')
  assert.equal(membershipTypography.value.fontWeight, '400')
  for (const sample of [membershipTypography, accountTypography]) {
    assert.match(sample.name.fontFamily, /(?:AO Good Sans|Good Sans|DM Sans)/)
    assert.match(sample.id.fontFamily, /(?:AO Good Sans|Good Sans|DM Sans)/)
    assert.match(sample.heading.fontFamily, /(?:AO Good Sans|Good Sans|DM Sans)/)
    assert.match(sample.value.fontFamily, /(?:AO Good Sans|Good Sans|DM Sans)/)
  }
  await screenshot(cdp, 'account-management-audit-1440.png')
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=[...document.querySelectorAll('.staff-section-tabs button')].find(item=>item.textContent?.trim()==='Timesheets');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.manager-timesheets')`)) break; await sleep(100) }
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.manager-timesheet-kpis article,.manager-timesheets .save-error')`)) break; await sleep(100) }
  const timesheetDesktop = await cdp.evaluate<any>(`(()=>{const root=document.querySelector('.manager-timesheets');const hero=document.querySelector('.manager-timesheet-hero');const title=hero?.querySelector('h2');const kpi=document.querySelector('.manager-timesheet-kpis article');if(!root||!hero||!title)return null;return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,heroBackground:getComputedStyle(hero).backgroundImage,heroTitleColor:getComputedStyle(title).color,kpiBackground:kpi?getComputedStyle(kpi).backgroundColor:null,kpiBorder:kpi?getComputedStyle(kpi).borderTopColor:null,error:document.querySelector('.manager-timesheets .save-error')?.textContent?.trim()||null}})()`)
  assert.ok(timesheetDesktop)
  assert.equal(timesheetDesktop.pageOverflow, false)
  assert.match(timesheetDesktop.heroBackground, /linear-gradient/)
  assert.equal(timesheetDesktop.heroTitleColor, 'rgb(250, 247, 239)')
  assert.equal(timesheetDesktop.error, null)
  assert.ok(timesheetDesktop.kpiBackground)
  await screenshot(cdp, 'timesheets-after-1440.png')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await cdp.evaluate(`(()=>{const close=document.querySelector('button[aria-label="Close navigation menu"]');if(close&&getComputedStyle(close).display!=='none')close.click()})()`)
  await sleep(100)
  assert.equal(await cdp.evaluate<boolean>(`document.documentElement.scrollWidth>document.documentElement.clientWidth+1`), false)
  await screenshot(cdp, 'timesheets-after-390.png')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=[...document.querySelectorAll('.staff-section-tabs button')].find(item=>item.textContent?.trim()==='Team Membership');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.membership-approved-page .membership-mobile-list article')`)) break; await sleep(100) }
  const membershipMobileTypography = await cdp.evaluate<any>(typographyExpression({ name: '.membership-approved-page .membership-mobile-list article>b', id: '.membership-approved-page .membership-mobile-list article>small', value: '.membership-approved-page .membership-mobile-list article>span' }))
  await screenshot(cdp, 'team-membership-reference-390.png')
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=[...document.querySelectorAll('.staff-section-tabs button')].find(item=>item.textContent?.trim()==='Account Management');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-account-cards article')`)) break; await sleep(100) }
  const accountMobileTypography = await cdp.evaluate<any>(typographyExpression({ name: '.staff-account-cards article header b', id: '.staff-account-cards article header small', value: '.staff-account-cards article dd' }))
  assert.equal(membershipMobileTypography.name.fontSize, '13px')
  assert.equal(membershipMobileTypography.name.fontWeight, '500')
  assert.equal(membershipMobileTypography.id.fontSize, '10.5px')
  assert.equal(membershipMobileTypography.id.fontWeight, '400')
  assert.equal(membershipMobileTypography.value.fontSize, '11.5px')
  assert.equal(membershipMobileTypography.value.fontWeight, '400')
  for (const sample of [membershipMobileTypography, accountMobileTypography]) {
    assert.match(sample.name.fontFamily, /(?:AO Good Sans|Good Sans|DM Sans)/)
    assert.match(sample.id.fontFamily, /(?:AO Good Sans|Good Sans|DM Sans)/)
    assert.match(sample.value.fontFamily, /(?:AO Good Sans|Good Sans|DM Sans)/)
  }
  assert.equal(await cdp.evaluate<boolean>(`document.documentElement.scrollWidth>document.documentElement.clientWidth+1`), false)
  await screenshot(cdp, 'account-management-audit-390.png')
  const accountWidths = [1440, 1024, 768, 430, 390, 360]
  const accountMeasurements: Record<string, unknown> = {}
  for (const width of accountWidths) {
    const mobile = width <= 700
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile })
    await sleep(100)
    const result = await cdp.evaluate<any>(`(()=>{const root=document.querySelector('.staff-account-panel');const name=document.querySelector(${mobile ? "'.staff-account-cards article header b'" : "'.staff-account-table tbody td:first-child b'"});const status=document.querySelector('.staff-account-status');const title=document.querySelector('.staff-account-header h2');const label=document.querySelector('.staff-account-header .section-label');const summary=document.querySelector('.staff-account-summary dd');const controls=[...document.querySelectorAll('.staff-account-tools input,.staff-account-tools select')];const table=document.querySelector('.staff-account-table');const tableWrap=table?.closest('.staff-table-wrap');const cells=[...document.querySelectorAll('.staff-account-table tbody tr:first-child td')];const headers=[...document.querySelectorAll('.staff-account-table thead th')];const divider=cells[0]?getComputedStyle(cells[0]):null;const actions=[...document.querySelectorAll('.staff-account-cards .staff-account-actions button')];return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,panelOverflow:root.scrollWidth>root.clientWidth+1,nameFontSize:getComputedStyle(name).fontSize,nameFontWeight:getComputedStyle(name).fontWeight,statusFontSize:getComputedStyle(status).fontSize,statusFontWeight:getComputedStyle(status).fontWeight,statusAlignment:getComputedStyle(status).justifyContent,titleFont:getComputedStyle(title).fontFamily,titleSize:getComputedStyle(title).fontSize,titleWeight:getComputedStyle(title).fontWeight,labelSize:getComputedStyle(label).fontSize,labelWeight:getComputedStyle(label).fontWeight,summarySize:getComputedStyle(summary).fontSize,summaryWeight:getComputedStyle(summary).fontWeight,filterCountPresent:[...document.querySelectorAll('.staff-account-tools p')].some(node=>node.textContent?.includes('Showing')),controlsReadable:controls.every(control=>control.scrollWidth<=control.clientWidth+1),minimumControlHeight:Math.min(...controls.map(control=>control.getBoundingClientRect().height)),tableVisible:!!tableWrap&&getComputedStyle(tableWrap).display!=='none'&&table.getBoundingClientRect().width>0,headerAlign:headers.slice(0,5).map(cell=>getComputedStyle(cell).textAlign),cellAlign:cells.slice(0,5).map(cell=>getComputedStyle(cell).textAlign),dividerWidth:divider?.borderRightWidth,dividerStyle:divider?.borderRightStyle,smallActions:actions.map(button=>({text:button.textContent?.trim(),width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height})).filter(item=>item.width<44||item.height<44)}})()`)
    assert.equal(result.pageOverflow, false, `Account page overflow at ${width}px.`)
    assert.equal(result.panelOverflow, false, `Account panel overflow at ${width}px.`)
    assert.match(result.titleFont, /(?:AO Good Sans|Good Sans|DM Sans)/)
    assert.equal(result.titleSize, mobile ? '17px' : '18px')
    assert.equal(result.titleWeight, '500')
    assert.equal(result.labelSize, '9px')
    assert.equal(result.labelWeight, '500')
    assert.equal(result.filterCountPresent, false)
    assert.equal(result.summarySize, mobile ? '16px' : '18px')
    assert.equal(result.summaryWeight, '500')
    assert.equal(result.nameFontSize, mobile ? '13px' : '12px')
    assert.equal(result.nameFontWeight, '500')
    assert.equal(result.statusFontSize, '9px')
    assert.equal(result.statusFontWeight, '600')
    assert.equal(result.statusAlignment, 'center')
    assert.equal(result.controlsReadable, true)
    assert.ok(result.minimumControlHeight >= (mobile ? 44 : 40))
    if (mobile) {
      assert.equal(result.tableVisible, false)
      assert.deepEqual(result.smallActions, [], `Account Management has undersized mobile actions at ${width}px.`)
    } else {
      assert.equal(result.tableVisible, true)
      assert.deepEqual(result.headerAlign, ['left', 'center', 'center', 'center', 'center'])
      assert.deepEqual(result.cellAlign, ['left', 'center', 'center', 'center', 'center'])
      assert.equal(result.dividerWidth, '1px')
      assert.equal(result.dividerStyle, 'solid')
    }
    accountMeasurements[String(width)] = result
    await screenshot(cdp, `account-management-after-${width}.png`)
  }
  for (const width of [1440, 390]) {
    const mobile = width <= 700
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile })
    assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('.staff-account-actions button')).find(item=>item.textContent?.trim()==='Create Account');if(!button)return false;button.click();return true})()`), true)
    for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-account-modal')`)) break; await sleep(50) }
    const modal = await cdp.evaluate<any>(`(()=>{const dialog=document.querySelector('.staff-account-modal');const title=dialog?.querySelector('h2');const input=dialog?.querySelector('input');const actions=[...dialog?.querySelectorAll('.form-actions button')||[]];if(!dialog||!title||!input)return null;input.focus();return{fits:dialog.getBoundingClientRect().width<=innerWidth&&dialog.getBoundingClientRect().height<=innerHeight,background:getComputedStyle(dialog).backgroundColor,titleFont:getComputedStyle(title).fontFamily,titleSize:getComputedStyle(title).fontSize,titleWeight:getComputedStyle(title).fontWeight,inputBackground:getComputedStyle(input).backgroundColor,actionHeights:actions.map(button=>button.getBoundingClientRect().height),pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
    assert.ok(modal)
    assert.equal(modal.fits, true)
    assert.equal(modal.background, 'rgb(244, 248, 245)')
    assert.match(modal.titleFont, /(?:AO Good Sans|Good Sans|DM Sans)/)
    assert.equal(modal.titleSize, mobile ? '17px' : '18px')
    assert.equal(modal.titleWeight, '500')
    assert.equal(modal.inputBackground, 'rgb(255, 255, 255)')
    assert.ok(modal.actionHeights.every((height: number) => height >= 44))
    assert.equal(modal.pageOverflow, false)
    await screenshot(cdp, `account-management-create-dialog-after-${width}.png`)
    await cdp.evaluate(`document.querySelector('.staff-account-modal .close')?.click()`)
    for (let attempt = 0; attempt < 80; attempt++) { if (!await cdp.evaluate<boolean>(`!!document.querySelector('.staff-account-modal')`)) break; await sleep(50) }
    assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('.staff-account-actions button')).find(item=>item.textContent?.trim()==='Reset Password');if(!button)return false;button.click();return true})()`), true)
    for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-account-reset-modal')`)) break; await sleep(50) }
    const resetModal = await cdp.evaluate<any>(`(()=>{const dialog=document.querySelector('.staff-account-reset-modal');const input=dialog?.querySelector('input');const confirm=Array.from(dialog?.querySelectorAll('button')||[]).find(button=>button.textContent?.trim()==='Reset Password');const text=dialog?.textContent||'';if(!dialog||!input||!confirm)return null;const before=confirm.disabled;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'RESET');input.dispatchEvent(new Event('input',{bubbles:true}));return{fits:dialog.getBoundingClientRect().width<=innerWidth&&dialog.getBoundingClientRect().height<=innerHeight,background:getComputedStyle(dialog).backgroundColor,employeeVisible:/Employee/.test(text)&&/Staff ID/.test(text),revocationVisible:/sessions will be revoked/i.test(text),confirmationCopy:/Type RESET to confirm/i.test(text),disabledBefore:before,actionHeights:Array.from(dialog.querySelectorAll('.form-actions button')).map(button=>button.getBoundingClientRect().height),pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
    await sleep(50)
    resetModal.enabledAfter = await cdp.evaluate<boolean>(`!Array.from(document.querySelectorAll('.staff-account-reset-modal button')).find(button=>button.textContent?.trim()==='Reset Password')?.disabled`)
    assert.ok(resetModal)
    assert.equal(resetModal.fits, true)
    assert.equal(resetModal.background, 'rgb(244, 248, 245)')
    assert.equal(resetModal.employeeVisible, true)
    assert.equal(resetModal.revocationVisible, true)
    assert.equal(resetModal.confirmationCopy, true)
    assert.equal(resetModal.disabledBefore, true)
    assert.equal(resetModal.enabledAfter, true)
    assert.ok(resetModal.actionHeights.every((height: number) => height >= 44))
    assert.equal(resetModal.pageOverflow, false)
    await screenshot(cdp, `account-management-reset-dialog-after-${width}.png`)
    await cdp.evaluate(`document.querySelector('.staff-account-reset-modal .close')?.click()`)
    for (let attempt = 0; attempt < 80; attempt++) { if (!await cdp.evaluate<boolean>(`!!document.querySelector('.staff-account-reset-modal')`)) break; await sleep(50) }
  }
  console.log(JSON.stringify({ membershipTypography, membershipMeasurements, membershipDialogTheme, accountTypography, membershipMobileTypography, accountMobileTypography }, null, 2))
  assert.deepEqual(cdp.errors, [])
  console.log(JSON.stringify({ measurements, modalMeasurements, profileDesktop, profileMobile, timesheetDesktop, accountMeasurements, screenshots: [...widths.map(width => `artifacts/staff-management-typography/team-directory-after-${width}.png`), 'artifacts/staff-management-typography/edit-staff-after-1440.png', 'artifacts/staff-management-typography/edit-staff-after-390.png', 'artifacts/staff-management-typography/staff-profile-after-1440.png', 'artifacts/staff-management-typography/staff-profile-after-390.png', 'artifacts/staff-management-typography/timesheets-after-1440.png', 'artifacts/staff-management-typography/timesheets-after-390.png', ...accountWidths.map(width => `artifacts/staff-management-typography/account-management-after-${width}.png`)], runtimeErrors: cdp.errors.length }, null, 2))
} finally {
  try { socket?.close() } catch {}
  for (const process of processes.reverse()) { try { process.kill() } catch {} }
  await sleep(200)
  await rm(fixture.root, { recursive: true, force: true }).catch(() => undefined)
}
