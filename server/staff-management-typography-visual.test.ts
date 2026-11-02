import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
const loopbackReady = async (url: string) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    await response.body?.cancel()
    return response.ok
  } catch { return false }
}
const waitFor = async (url: string) => {
  for (let attempt = 0; attempt < 200; attempt++) {
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
    const result = await cdp.evaluate<any>(`(()=>{const tabList=document.querySelector('.staff-section-bar .staff-section-tabs');const tabs=Array.from(tabList.querySelectorAll('button'));const tabWidths=tabs.map(tab=>tab.getBoundingClientRect().width);const kpis=Array.from(document.querySelectorAll('.staff-directory-page .staff-summary .panel'));const panel=document.querySelector('.staff-directory-page .staff-panel');const tools=document.querySelector('.staff-directory-page .staff-tools');const name=document.querySelector('.staff-directory-page .staff-name-cell b');const style=getComputedStyle(name);const header=document.querySelector('.staff-management-header');const wrap=document.querySelector('.staff-directory-page .staff-table-wrap');const tableHeader=document.querySelector('.staff-directory-page .staff-table thead th');const tableCell=document.querySelector('.staff-directory-page .staff-table tbody td');const cards=document.querySelector('.staff-directory-page .staff-mobile-cards');const selected=tabs.find(tab=>tab.classList.contains('selected'));return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,headerTop:Math.round(header.getBoundingClientRect().top),tableDisplay:getComputedStyle(wrap).display,mobileCardsDisplay:getComputedStyle(cards).display,visibleMobileCards:[...cards.children].filter(card=>getComputedStyle(card).display!=='none').length,tabCount:tabs.length,tabGap:parseFloat(getComputedStyle(tabList).gap),tabWidthSpread:Math.max(...tabWidths)-Math.min(...tabWidths),tabBorderColors:[...new Set(tabs.map(tab=>getComputedStyle(tab).borderTopColor))],tabFontSizes:[...new Set(tabs.map(tab=>getComputedStyle(tab).fontSize))],tabFontWeights:[...new Set(tabs.map(tab=>getComputedStyle(tab).fontWeight))],tabHeights:[...new Set(tabs.map(tab=>Math.round(tab.getBoundingClientRect().height)))],tabLabelsFit:tabs.every(tab=>tab.scrollWidth<=tab.clientWidth+1&&tab.scrollHeight<=tab.clientHeight+1),kpiCount:kpis.length,kpiBorderColors:[...new Set(kpis.map(kpi=>getComputedStyle(kpi).borderTopColor))],kpiHeights:[...new Set(kpis.map(kpi=>Math.round(kpi.getBoundingClientRect().height)))],kpiSelectorMatches:kpis.every(kpi=>kpi.matches('html body main.module-staff-management .staff-directory-page .staff-summary > .panel')),moduleClass:document.querySelector('main')?.className,panelBorder:getComputedStyle(panel).borderTopColor,toolsBorder:getComputedStyle(tools).borderTopColor,tableOuter:getComputedStyle(wrap).borderTopColor,tableTopWidth:getComputedStyle(wrap).borderTopWidth,tableHeaderDivider:getComputedStyle(tableHeader).borderRightColor,tableRowDividerShadow:getComputedStyle(tableCell).boxShadow,selectedLabel:selected?.textContent?.trim(),selectedTextColor:selected?getComputedStyle(selected).color:null,nameFontSize:style.fontSize,nameFontWeight:style.fontWeight,nameColor:style.color,nameFits:name.scrollWidth<=name.clientWidth+1}})()`)
    assert.equal(result.pageOverflow, false, `Page overflow at ${width}px.`)
    assert.ok(result.headerTop <= (mobile ? 90 : 40), `Staff header was vertically displaced at ${width}px: ${result.headerTop}px.`)
    if (mobile) {
      assert.equal(result.tableDisplay, 'none')
      assert.equal(result.mobileCardsDisplay, 'grid')
      assert.ok(result.visibleMobileCards > 0)
    }
    assert.equal(result.tabCount, 4)
    assert.ok(result.tabGap >= 8)
    assert.ok(result.tabWidthSpread <= 1, `Staff tabs were not equal width at ${width}px (spread ${result.tabWidthSpread}px).`)
    assert.deepEqual(result.tabBorderColors, ['rgb(189, 161, 106)'])
    assert.deepEqual(result.tabFontSizes, ['12px'])
    assert.deepEqual(result.tabFontWeights, ['600'])
    assert.equal(result.tabHeights.length, 1)
    assert.equal(result.tabLabelsFit, true)
    assert.equal(result.kpiCount, 4)
    assert.deepEqual(result.kpiBorderColors, ['rgb(189, 161, 106)'])
    assert.equal(result.kpiHeights.length, 1)
    assert.equal(result.panelBorder, 'rgb(189, 161, 106)')
    assert.equal(result.toolsBorder, 'rgb(189, 161, 106)')
    assert.equal(result.tableOuter, 'rgb(189, 161, 106)')
    assert.equal(result.tableTopWidth, '2px')
    assert.equal(result.tableHeaderDivider, 'rgb(189, 161, 106)')
    assert.match(result.tableRowDividerShadow, /189, 161, 106/, `Team Directory row divider mismatch at ${width}px.`)
    assert.equal(result.selectedLabel, 'Team Directory')
    assert.equal(result.selectedTextColor, 'rgb(255, 255, 255)')
    assert.equal(result.nameFontSize, '13px')
    assert.equal(result.nameFontWeight, '650')
    assert.equal(result.nameColor, 'rgb(23, 61, 86)')
    assert.equal(result.nameFits, true)
    measurements[String(width)] = result
    await screenshot(cdp, `team-directory-after-${width}.png`)
  }
  for (const width of [1440, 390]) {
    const mobile = width <= 700
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile })
    assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('[data-staff-action="archive"]');if(!button)return false;button.click();return true})()`), true)
    for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-archive-confirm-modal')`)) break; await sleep(50) }
    const archiveDialog = await cdp.evaluate<any>(`(()=>{const dialog=document.querySelector('.staff-archive-confirm-modal');const actions=[...dialog.querySelectorAll('button')];return{visible:!!dialog,title:dialog?.querySelector('h2')?.textContent?.trim(),preservesHistory:dialog?.textContent?.includes('does not delete roster, booking, leave, timesheet, or financial history'),pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,actions:actions.map(button=>button.textContent?.trim())}})()`)
    assert.equal(archiveDialog.visible, true)
    assert.equal(archiveDialog.title, 'Archive staff member?')
    assert.equal(archiveDialog.preservesHistory, true)
    assert.equal(archiveDialog.pageOverflow, false)
    assert.deepEqual(archiveDialog.actions, ['Cancel', 'Archive Staff'])
    await screenshot(cdp, `team-directory-archive-dialog-${width}.png`)
    assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=[...document.querySelectorAll('.staff-archive-confirm-modal button')].find(item=>item.textContent?.trim()==='Cancel');if(!button)return false;button.click();return true})()`), true)
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
    assert.equal(result.actionBackground, 'rgb(16, 62, 56)')
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
    const result = await cdp.evaluate<any>(`(()=>{const root=document.querySelector('.membership-approved-page');const command=root?.querySelector('.membership-command-header');const table=root?.querySelector('.membership-table.approved-table');const mobileList=root?.querySelector('.membership-mobile-list');const headers=Array.from(table?.querySelectorAll('thead th')||[]);const cells=Array.from(table?.querySelectorAll('tbody tr:first-child td')||[]);const divider=cells[0]?getComputedStyle(cells[0]):null;const summary=root?.querySelector('.membership-approved-banner');const review=root?.querySelector('.membership-review-card');const history=root?.querySelector('.membership-history-disclosure summary');const nav=root?.querySelector('.membership-month-nav');const month=nav?.querySelector('.staff-header-month-trigger');const arrows=Array.from(nav?.querySelectorAll(':scope>button')||[]);const navRect=nav?.getBoundingClientRect();const navStyle=nav?getComputedStyle(nav):null;const card=mobileList?.querySelector('article');const cardStyle=card?getComputedStyle(card):null;return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,rootOverflow:root?root.scrollWidth>root.clientWidth+1:false,rootBorder:root?getComputedStyle(root).borderTopWidth:null,commandBorder:command?getComputedStyle(command).borderTopColor:null,commandBackground:command?getComputedStyle(command).backgroundImage:null,summaryBorder:summary?getComputedStyle(summary).borderTopColor:null,reviewBorder:review?getComputedStyle(review).borderTopColor:null,monthFont:month?getComputedStyle(month).fontFamily:null,monthTag:month?.tagName||null,monthCentered:month&&navRect?Math.abs((month.getBoundingClientRect().left+month.getBoundingClientRect().right)/2-(navRect.left+navRect.right)/2)<2:false,arrowsContained:navRect&&arrows.length===2?arrows.every(button=>{const rect=button.getBoundingClientRect();return rect.left>=navRect.left&&rect.right<=navRect.right}):false,arrowBackgrounds:[...new Set(arrows.map(button=>getComputedStyle(button).backgroundColor))],arrowBorders:[...new Set(arrows.map(button=>getComputedStyle(button).borderTopColor))],navBorder:navStyle?.borderTopWidth,navBackground:navStyle?.backgroundColor,pickerAvailable:!!nav?.querySelector('.staff-header-month-popover input[type="month"]'),mobileCardBorder:cardStyle?.borderTopColor,mobileCardBackground:cardStyle?.backgroundColor,tableVisible:!!table&&getComputedStyle(table).display!=='none'&&table.getBoundingClientRect().width>0,mobileVisible:!!mobileList&&getComputedStyle(mobileList).display!=='none'&&mobileList.getBoundingClientRect().height>0,headerAlign:headers.map(cell=>getComputedStyle(cell).textAlign),cellAlign:cells.map(cell=>getComputedStyle(cell).textAlign),dividerShadow:divider?.boxShadow,dividerWidth:divider?.borderRightWidth,dividerStyle:divider?.borderRightStyle,summaryHeight:summary?.getBoundingClientRect().height||null,historyHeight:history?.getBoundingClientRect().height||null}})()`)
    const membershipHeader = await cdp.evaluate<any>(`(()=>{const header=document.querySelector('.membership-table.approved-table thead th');const actions=document.querySelector('.membership-command-header .membership-intro-actions');const nav=document.querySelector('.membership-month-nav');if(!header||!actions||!nav)return null;const style=getComputedStyle(header);const actionsRect=actions.getBoundingClientRect();const navRect=nav.getBoundingClientRect();return{fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,color:style.color,background:style.backgroundColor,bottomWidth:style.borderBottomWidth,bottomColor:style.borderBottomColor,navRightAligned:Math.abs(actionsRect.right-navRect.right)<2}})()`)
    assert.equal(result.pageOverflow, false, `Team Membership caused page overflow at ${width}px.`)
    assert.equal(result.rootOverflow, false, `Team Membership root overflowed at ${width}px.`)
    assert.equal(result.rootBorder, '0px')
    assert.equal(result.commandBorder, 'rgb(189, 161, 106)')
    assert.match(result.commandBackground, /linear-gradient/)
    assert.equal(result.summaryBorder, 'rgb(189, 161, 106)')
    assert.equal(result.reviewBorder, 'rgb(189, 161, 106)')
    assert.match(result.monthFont, /(?:AO Dahlia|Dahlia|Georgia)/)
    assert.equal(result.monthTag, 'SUMMARY')
    assert.equal(result.monthCentered, true, `Team Membership month was not centered at ${width}px.`)
    assert.equal(result.arrowsContained, true, `Team Membership arrows escaped the navigation box at ${width}px.`)
    assert.equal(result.navBorder, '0px')
    assert.equal(result.navBackground, 'rgba(0, 0, 0, 0)')
    assert.deepEqual(result.arrowBackgrounds, ['rgba(0, 0, 0, 0)'])
    assert.deepEqual(result.arrowBorders, ['rgb(189, 161, 106)'])
    assert.equal(result.pickerAvailable, true)
    assert.ok(membershipHeader)
    assert.match(membershipHeader.fontFamily, /Good Sans/)
    assert.equal(membershipHeader.fontSize, '11px')
    assert.equal(membershipHeader.fontWeight, '600')
    assert.equal(membershipHeader.color, 'rgb(16, 62, 56)')
    assert.equal(membershipHeader.bottomWidth, '2px')
    assert.equal(membershipHeader.bottomColor, 'rgb(189, 161, 106)')
    if (width > 1100) assert.equal(membershipHeader.navRightAligned, true, `Team Membership navigation was not right-aligned at ${width}px.`)
    if (width > 700) {
      assert.equal(result.tableVisible, true)
      assert.deepEqual(result.headerAlign, ['left', 'center', 'center'])
      assert.deepEqual(result.cellAlign, ['left', 'center', 'center'])
      assert.equal(result.dividerWidth, '1px')
      assert.equal(result.dividerStyle, 'solid')
      assert.match(result.dividerShadow, /189, 161, 106/)
    } else {
      assert.equal(result.tableVisible, false)
      assert.equal(result.mobileVisible, true)
      assert.equal(result.mobileCardBorder, 'rgb(189, 161, 106)')
      assert.equal(result.mobileCardBackground, 'rgb(225, 240, 229)')
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
  const membershipMonthPicker = await cdp.evaluate<any>(`(()=>{const details=document.querySelector('.membership-month-nav .staff-header-month-picker');const trigger=details?.querySelector('.staff-header-month-trigger');if(!details||!trigger)return null;trigger.click();const popover=details.querySelector('.staff-header-month-popover');const input=popover?.querySelector('input[type="month"]');if(!popover||!input)return null;const popoverStyle=getComputedStyle(popover);const inputStyle=getComputedStyle(input);return{open:details.open,popoverBackground:popoverStyle.backgroundColor,popoverBorder:popoverStyle.borderTopColor,inputBorder:inputStyle.borderTopColor,inputValue:input.value}})()`)
  assert.ok(membershipMonthPicker)
  assert.equal(membershipMonthPicker.open, true)
  assert.equal(membershipMonthPicker.popoverBackground, 'rgb(225, 240, 229)')
  assert.equal(membershipMonthPicker.popoverBorder, 'rgb(189, 161, 106)')
  assert.notEqual(membershipMonthPicker.inputBorder, 'rgba(0, 0, 0, 0)')
  assert.match(membershipMonthPicker.inputValue, /^\d{4}-\d{2}$/)
  await screenshot(cdp, 'team-membership-month-picker-after-1440.png')
  await cdp.evaluate(`document.querySelector('.membership-month-nav .staff-header-month-trigger')?.click()`)
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('.membership-approved-banner button')).find(item=>item.textContent?.includes('Correct Membership'));if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.membership-dialog')`)) break; await sleep(50) }
  const membershipDialogTheme = await cdp.evaluate<any>(`(()=>{const dialog=document.querySelector('.membership-dialog');const textarea=dialog?.querySelector('textarea');const title=dialog?.querySelector('h2');if(!dialog||!textarea||!title)return null;const style=getComputedStyle(dialog);const field=getComputedStyle(textarea);const titleStyle=getComputedStyle(title);return{background:style.backgroundColor,borderTopColor:style.borderTopColor,fieldBackground:field.backgroundColor,fieldBorder:field.borderTopColor,titleFontFamily:titleStyle.fontFamily,titleFontSize:titleStyle.fontSize,titleFontWeight:titleStyle.fontWeight,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
  assert.ok(membershipDialogTheme)
  assert.equal(membershipDialogTheme.background, 'rgb(242, 248, 243)')
  assert.equal(membershipDialogTheme.borderTopColor, membershipDialogTheme.fieldBorder)
  assert.equal(membershipDialogTheme.fieldBackground, 'rgb(255, 255, 255)')
  assert.match(membershipDialogTheme.titleFontFamily, /(?:AO Dahlia|Dahlia|Georgia)/)
  assert.equal(membershipDialogTheme.titleFontSize, '22px')
  assert.equal(membershipDialogTheme.titleFontWeight, '500')
  assert.equal(membershipDialogTheme.pageOverflow, false)
  await screenshot(cdp, 'team-membership-correction-dialog-after-1440.png')
  await cdp.evaluate(`document.querySelector('.membership-dialog .close')?.click()`)
  for (let attempt = 0; attempt < 80; attempt++) { if (!await cdp.evaluate<boolean>(`!!document.querySelector('.membership-dialog')`)) break; await sleep(50) }
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=[...document.querySelectorAll('.staff-section-tabs button')].find(item=>item.textContent?.trim()==='Account Management');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-account-table tbody tr')`)) break; await sleep(100) }
  const accountTypography = await cdp.evaluate<any>(typographyExpression({ name: '.staff-account-table tbody td:first-child b', id: '.staff-account-table tbody td:nth-child(2)', heading: '.staff-account-table thead th:first-child', value: '.staff-account-table tbody td:nth-child(3)' }))
  assert.equal(accountTypography.heading.fontSize, '11px')
  assert.equal(accountTypography.heading.fontWeight, '600')
  assert.equal(membershipTypography.name.fontSize, '12px')
  assert.equal(membershipTypography.name.fontWeight, '500')
  assert.equal(membershipTypography.id.fontSize, '10.5px')
  assert.equal(membershipTypography.id.fontWeight, '400')
  assert.equal(membershipTypography.heading.fontSize, '11px')
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
  const timesheetMeasurements: Record<string, unknown> = {}
  for (const width of [1440, 1024, 768, 430, 390, 360]) {
    const mobile = width <= 700
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile })
    await cdp.evaluate(`(()=>{const close=document.querySelector('button[aria-label="Close navigation menu"]');if(close&&getComputedStyle(close).display!=='none')close.click()})()`)
    await sleep(100)
    const result = await cdp.evaluate<any>(`(()=>{const root=document.querySelector('.manager-timesheets');const hero=document.querySelector('.manager-timesheet-hero');const table=document.querySelector('.manager-timesheet-table');const tableHeader=table?.querySelector('thead th');const tableCell=table?.querySelector('tbody td');const kpis=[...document.querySelectorAll('.manager-timesheet-kpis article')];const nav=document.querySelector('.manager-month-nav');const month=document.querySelector('.staff-header-month-trigger');const arrows=[...document.querySelectorAll('.manager-month-nav>button')];if(!root||!hero||!table||!tableHeader||!tableCell||!nav||!month||arrows.length!==2)return null;const navRect=nav.getBoundingClientRect();const navStyle=getComputedStyle(nav);return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,rootOverflow:root.scrollWidth>root.clientWidth+1,heroBorder:getComputedStyle(hero).borderTopColor,tableBorder:getComputedStyle(table).borderTopColor,tableHeaderDivider:getComputedStyle(tableHeader).borderRightColor,tableRowDividerShadow:getComputedStyle(tableCell).boxShadow,kpiCount:kpis.length,kpiBorderColors:[...new Set(kpis.map(kpi=>getComputedStyle(kpi).borderTopColor))],kpiHeights:[...new Set(kpis.map(kpi=>Math.round(kpi.getBoundingClientRect().height)))],monthFont:getComputedStyle(month).fontFamily,monthTag:month.tagName,monthCentered:Math.abs((month.getBoundingClientRect().left+month.getBoundingClientRect().right)/2-(navRect.left+navRect.right)/2)<2,arrowsContained:arrows.every(button=>{const rect=button.getBoundingClientRect();return rect.left>=navRect.left&&rect.right<=navRect.right}),arrowHeights:[...new Set(arrows.map(button=>Math.round(button.getBoundingClientRect().height)))],arrowBackgrounds:[...new Set(arrows.map(button=>getComputedStyle(button).backgroundColor))],arrowBorders:[...new Set(arrows.map(button=>getComputedStyle(button).borderTopColor))],navBorder:navStyle.borderTopWidth,navBackground:navStyle.backgroundColor,pickerAvailable:!!nav.querySelector('.staff-header-month-popover input[type="month"]'),error:document.querySelector('.manager-timesheets .save-error')?.textContent?.trim()||null}})()`)
    assert.ok(result)
    assert.equal(result.pageOverflow, false, `Timesheets caused page overflow at ${width}px.`)
    assert.equal(result.rootOverflow, false, `Timesheets root overflowed at ${width}px.`)
    assert.equal(result.heroBorder, 'rgb(189, 161, 106)')
    assert.equal(result.tableBorder, 'rgb(189, 161, 106)')
    assert.equal(result.tableHeaderDivider, 'rgb(189, 161, 106)')
    assert.match(result.tableRowDividerShadow, /189, 161, 106/)
    assert.equal(result.kpiCount, 4)
    assert.deepEqual(result.kpiBorderColors, ['rgb(189, 161, 106)'])
    assert.equal(result.kpiHeights.length, 1)
    assert.match(result.monthFont, /(?:AO Dahlia|Dahlia|Georgia)/)
    assert.equal(result.monthTag, 'SUMMARY')
    assert.equal(result.monthCentered, true, `Timesheets month was not centered at ${width}px.`)
    assert.equal(result.arrowsContained, true, `Timesheets arrows escaped the navigation box at ${width}px.`)
    assert.equal(result.arrowHeights.length, 1)
    assert.deepEqual(result.arrowBackgrounds, ['rgba(0, 0, 0, 0)'])
    assert.deepEqual(result.arrowBorders, ['rgb(189, 161, 106)'])
    assert.equal(result.navBorder, '0px')
    assert.equal(result.navBackground, 'rgba(0, 0, 0, 0)')
    assert.equal(result.pickerAvailable, true)
    assert.equal(result.error, null)
    timesheetMeasurements[String(width)] = result
    await screenshot(cdp, `timesheets-after-${width}.png`)
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=[...document.querySelectorAll('.staff-section-tabs button')].find(item=>item.textContent?.trim()==='Team Membership');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.membership-approved-page .membership-mobile-list article')`)) break; await sleep(100) }
  const membershipMobileTypography = await cdp.evaluate<any>(typographyExpression({ name: '.membership-approved-page .approved-member-cards article>b', id: '.membership-approved-page .approved-member-cards article dl>div:first-child dd', value: '.membership-approved-page .approved-member-cards article dl>div:last-child dd' }))
  await screenshot(cdp, 'team-membership-reference-390.png')
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=[...document.querySelectorAll('.staff-section-tabs button')].find(item=>item.textContent?.trim()==='Account Management');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-account-cards article')`)) break; await sleep(100) }
  const accountMobileTypography = await cdp.evaluate<any>(typographyExpression({ name: '.staff-account-cards article header b', id: '.staff-account-cards article header small', value: '.staff-account-cards article dd' }))
  assert.equal(membershipMobileTypography.name.fontSize, '14px')
  assert.equal(membershipMobileTypography.name.fontWeight, '600')
  assert.equal(membershipMobileTypography.id.fontSize, '11px')
  assert.equal(membershipMobileTypography.id.fontWeight, '500')
  assert.equal(membershipMobileTypography.value.fontSize, '11px')
  assert.equal(membershipMobileTypography.value.fontWeight, '500')
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
    const result = await cdp.evaluate<any>(`(()=>{const root=document.querySelector('.staff-account-panel');const command=document.querySelector('.staff-account-header');const toolsPanel=document.querySelector('.staff-account-tools-panel');const directoryPanel=document.querySelector('.staff-account-directory-panel');const name=document.querySelector(${mobile ? "'.staff-account-cards article header b'" : "'.staff-account-table tbody td:first-child b'"});const status=document.querySelector('.staff-account-status');const title=document.querySelector('.staff-account-header h2');const label=document.querySelector('.staff-account-header .section-label');const summary=document.querySelector('.staff-account-summary dd');const controls=[...document.querySelectorAll('.staff-account-tools input,.staff-account-tools select')];const table=document.querySelector('.staff-account-table');const tableWrap=table?.closest('.staff-table-wrap');const cells=[...document.querySelectorAll('.staff-account-table tbody tr:first-child td')];const headers=[...document.querySelectorAll('.staff-account-table thead th')];const divider=cells[0]?getComputedStyle(cells[0]):null;const actions=[...document.querySelectorAll('.staff-account-cards .staff-account-actions button')];return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,panelOverflow:root.scrollWidth>root.clientWidth+1,panelBorderWidth:getComputedStyle(root).borderTopWidth,panelBackground:getComputedStyle(root).backgroundColor,commandBorder:getComputedStyle(command).borderTopColor,commandBackground:getComputedStyle(command).backgroundImage,titleColor:getComputedStyle(title).color,toolsBorder:getComputedStyle(toolsPanel).borderTopColor,directoryBorder:getComputedStyle(directoryPanel).borderTopColor,nameFontSize:getComputedStyle(name).fontSize,nameFontWeight:getComputedStyle(name).fontWeight,statusFontSize:getComputedStyle(status).fontSize,statusFontWeight:getComputedStyle(status).fontWeight,statusAlignment:getComputedStyle(status).justifyContent,titleFont:getComputedStyle(title).fontFamily,titleSize:getComputedStyle(title).fontSize,titleWeight:getComputedStyle(title).fontWeight,labelSize:getComputedStyle(label).fontSize,labelWeight:getComputedStyle(label).fontWeight,summarySize:getComputedStyle(summary).fontSize,summaryWeight:getComputedStyle(summary).fontWeight,filterCountPresent:[...document.querySelectorAll('.staff-account-tools p')].some(node=>node.textContent?.includes('Showing')),controlsReadable:controls.every(control=>control.scrollWidth<=control.clientWidth+1),minimumControlHeight:Math.min(...controls.map(control=>control.getBoundingClientRect().height)),tableVisible:!!tableWrap&&getComputedStyle(tableWrap).display!=='none'&&table.getBoundingClientRect().width>0,headerAlign:headers.slice(0,5).map(cell=>getComputedStyle(cell).textAlign),cellAlign:cells.slice(0,5).map(cell=>getComputedStyle(cell).textAlign),dividerShadow:divider?.boxShadow,dividerWidth:divider?.borderRightWidth,dividerStyle:divider?.borderRightStyle,smallActions:actions.map(button=>({text:button.textContent?.trim(),width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height})).filter(item=>item.width<44||item.height<44)}})()`)
    assert.equal(result.pageOverflow, false, `Account page overflow at ${width}px.`)
    assert.equal(result.panelOverflow, false, `Account panel overflow at ${width}px.`)
    assert.equal(result.panelBorderWidth, '0px')
    assert.equal(result.panelBackground, 'rgba(0, 0, 0, 0)')
    assert.equal(result.commandBorder, 'rgb(189, 161, 106)')
    assert.match(result.commandBackground, /linear-gradient/)
    assert.equal(result.titleColor, 'rgb(250, 247, 239)')
    assert.equal(result.toolsBorder, 'rgb(189, 161, 106)')
    assert.equal(result.directoryBorder, 'rgb(189, 161, 106)')
    assert.match(result.titleFont, /(?:AO Dahlia|Dahlia|Georgia)/)
    assert.equal(result.titleSize, mobile ? '22px' : '25px')
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
      assert.match(result.dividerShadow, /189, 161, 106/)
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
    assert.equal(modal.background, 'rgb(242, 248, 243)')
    assert.match(modal.titleFont, /(?:AO Dahlia|Dahlia|Georgia)/)
    assert.equal(modal.titleSize, mobile ? '20px' : '22px')
    assert.equal(modal.titleWeight, '500')
    assert.equal(modal.inputBackground, 'rgb(255, 255, 255)')
    assert.ok(modal.actionHeights.every((height: number) => height >= 44))
    assert.equal(modal.pageOverflow, false)
    await screenshot(cdp, `account-management-create-dialog-after-${width}.png`)
    await cdp.evaluate(`document.querySelector('.staff-account-modal .close')?.click()`)
    for (let attempt = 0; attempt < 80; attempt++) { if (!await cdp.evaluate<boolean>(`!!document.querySelector('.staff-account-modal')`)) break; await sleep(50) }
    assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('.staff-account-actions button')).find(item=>item.textContent?.trim()==='Manage Account');if(!button)return false;button.click();return true})()`), true)
    for (let attempt = 0; attempt < 80; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-account-manage-modal')`)) break; await sleep(50) }
    assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('.staff-account-manage-options button')).find(item=>item.querySelector('strong')?.textContent?.trim()==='Reset Password');if(!button)return false;button.click();return true})()`), true)
    const resetModal = await cdp.evaluate<any>(`(()=>{const dialog=document.querySelector('.staff-account-manage-modal');const input=dialog?.querySelector('input');const confirm=Array.from(dialog?.querySelectorAll('button')||[]).find(button=>button.textContent?.trim()==='Reset Password');const text=dialog?.textContent||'';if(!dialog||!input||!confirm)return null;const before=confirm.disabled;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'RESET');input.dispatchEvent(new Event('input',{bubbles:true}));return{fits:dialog.getBoundingClientRect().width<=innerWidth&&dialog.getBoundingClientRect().height<=innerHeight,background:getComputedStyle(dialog).backgroundColor,employeeVisible:/Employee/.test(text)&&/Staff ID/.test(text),revocationVisible:/sessions will be revoked/i.test(text),confirmationCopy:/Type RESET to confirm/i.test(text),protectedCopy:/security approval/i.test(text),disabledBefore:before,actionHeights:Array.from(dialog.querySelectorAll('.form-actions button')).map(button=>button.getBoundingClientRect().height),pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
    await sleep(50)
    resetModal.enabledAfter = await cdp.evaluate<boolean>(`!Array.from(document.querySelectorAll('.staff-account-manage-modal button')).find(button=>button.textContent?.trim()==='Reset Password')?.disabled`)
    assert.ok(resetModal)
    assert.equal(resetModal.fits, true)
    assert.equal(resetModal.background, 'rgb(242, 248, 243)')
    assert.equal(resetModal.employeeVisible, true)
    assert.equal(resetModal.revocationVisible, true)
    assert.equal(resetModal.confirmationCopy, true)
    assert.equal(resetModal.protectedCopy, true)
    assert.equal(resetModal.disabledBefore, true)
    assert.equal(resetModal.enabledAfter, false)
    assert.ok(resetModal.actionHeights.every((height: number) => height >= 44))
    assert.equal(resetModal.pageOverflow, false)
    await screenshot(cdp, `account-management-reset-dialog-after-${width}.png`)
    assert.equal(await cdp.evaluate<boolean>(`(()=>{const back=Array.from(document.querySelectorAll('.staff-account-manage-modal button')).find(button=>button.textContent?.trim()==='Back');if(!back)return false;back.click();return true})()`), true)
    await sleep(50)
    assert.equal(await cdp.evaluate<boolean>(`(()=>{const option=Array.from(document.querySelectorAll('.staff-account-manage-options button')).find(button=>button.querySelector('strong')?.textContent?.trim()==='Deactivate Account');if(!option)return false;option.click();return true})()`), true)
    await sleep(50)
    const deactivateModal = await cdp.evaluate<any>(`(()=>{const dialog=document.querySelector('.staff-account-manage-modal');const input=dialog?.querySelector('input');const confirm=Array.from(dialog?.querySelectorAll('button')||[]).find(button=>button.textContent?.trim()==='Deactivate Account');if(!dialog||!input||!confirm)return null;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'DEACTIVATE');input.dispatchEvent(new Event('input',{bubbles:true}));const text=dialog.textContent||'';return{immediateRemoval:/Access will be removed immediately/i.test(text),auditPreserved:/audit history will be preserved/i.test(text),confirmationCopy:/Type DEACTIVATE to confirm/i.test(text),protectedCopy:/security approval/i.test(text),confirmDisabled:confirm.disabled,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
    assert.ok(deactivateModal)
    assert.equal(deactivateModal.immediateRemoval, true)
    assert.equal(deactivateModal.auditPreserved, true)
    assert.equal(deactivateModal.confirmationCopy, true)
    assert.equal(deactivateModal.protectedCopy, true)
    assert.equal(deactivateModal.confirmDisabled, true)
    assert.equal(deactivateModal.pageOverflow, false)
    await screenshot(cdp, `account-management-deactivate-dialog-after-${width}.png`)
    await cdp.evaluate(`document.querySelector('.staff-account-manage-modal .close')?.click()`)
    for (let attempt = 0; attempt < 80; attempt++) { if (!await cdp.evaluate<boolean>(`!!document.querySelector('.staff-account-manage-modal')`)) break; await sleep(50) }
  }
  console.log(JSON.stringify({ membershipTypography, membershipMeasurements, membershipDialogTheme, accountTypography, membershipMobileTypography, accountMobileTypography }, null, 2))
  assert.deepEqual(cdp.errors, [])
  console.log(JSON.stringify({ measurements, modalMeasurements, profileDesktop, profileMobile, timesheetDesktop, timesheetMeasurements, accountMeasurements, screenshots: [...widths.map(width => `artifacts/staff-management-typography/team-directory-after-${width}.png`), 'artifacts/staff-management-typography/edit-staff-after-1440.png', 'artifacts/staff-management-typography/edit-staff-after-390.png', 'artifacts/staff-management-typography/staff-profile-after-1440.png', 'artifacts/staff-management-typography/staff-profile-after-390.png', ...Object.keys(timesheetMeasurements).map(width => `artifacts/staff-management-typography/timesheets-after-${width}.png`), ...accountWidths.map(width => `artifacts/staff-management-typography/account-management-after-${width}.png`)], runtimeErrors: cdp.errors.length }, null, 2))
} finally {
  try { socket?.close() } catch {}
  for (const process of processes.reverse()) { try { process.kill() } catch {} }
  await sleep(200)
  await rm(fixture.root, { recursive: true, force: true }).catch(() => undefined)
}
