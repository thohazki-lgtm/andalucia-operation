import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'

const fixture = await createDisposableDevelopmentStore('staff-management-typography-visual')
const profile = join(fixture.root, 'edge-profile')
const output = resolve('artifacts', 'staff-management-typography')
const processes: ChildProcess[] = []
let socket: WebSocket | null = null
const token = `isolated-${randomUUID()}`
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))
const waitFor = async (url: string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(url)).ok) return } catch {}
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
  const owner = (await fixture.db.query<any>("select u.id from user_accounts u join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.active=true where u.status='active' and r.role_key='owner' limit 1")).rows[0]
  assert.ok(owner)
  const position = (await fixture.db.query<{ value: string }>("select value from configuration_options where group_key='staff_positions' and active=true order by sort_order limit 1")).rows[0]?.value || 'F&B Attendant'
  const staffId = randomUUID()
  const membershipRevisionId = randomUUID()
  const membershipMonth = new Date().toISOString().slice(0, 7)
  const membershipMonthEnd = new Date(Date.UTC(Number(membershipMonth.slice(0, 4)), Number(membershipMonth.slice(5, 7)), 0)).toISOString().slice(0, 10)
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'TYPE-001','Typography Staff',$2,'active','2024-01-01')", [staffId, position])
  await fixture.db.query("insert into staff_membership_baseline_reviews(id,outlet_scope_id,baseline_month,status,revision_number,review_type,is_current_revision,is_authoritative,approved_at,approved_by,approved_by_user_id) values($1,$2,$3,'approved',1,'initial',true,true,now(),'Typography Visual Manager',$4)", [membershipRevisionId, ANDALUCIA_SCOPE_ID, membershipMonth, owner.id])
  await fixture.db.query("insert into staff_membership_history(id,staff_id,outlet_scope_id,membership_dimension,effective_from,effective_to,source,review_status,reviewed_at,reviewed_by,baseline_revision_id,is_current_baseline) values($1,$2,$3,'regular_outlet',$4,$5,'baseline_manager_review','approved',now(),'Typography Visual Manager',$6,true)", [randomUUID(), staffId, ANDALUCIA_SCOPE_ID, `${membershipMonth}-01`, membershipMonthEnd, membershipRevisionId])
  await fixture.db.query("insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval '1 hour')", [randomUUID(), createHash('sha256').update(token).digest('hex'), owner.id])
  await fixture.db.close()

  const node = process.execPath
  processes.push(spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '026', API_PORT: '3017', APP_ORIGIN: 'http://127.0.0.1:5187' }, stdio: 'ignore' }))
  processes.push(spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5187', '--strictPort'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3017' }, stdio: 'ignore' }))
  await Promise.all([waitFor('http://127.0.0.1:3017/api/health'), waitFor('http://127.0.0.1:5187/')])

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
  assert.equal((await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5187/', path: '/', httpOnly: true, sameSite: 'Strict' })).success, true)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5187/' })
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Staff Management"]')`)) break; await sleep(100) }
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('button[aria-label="Staff Management"]');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-directory-page')`)) break; await sleep(100) }

  const widths = [1440, 1280, 1024, 768, 430, 390, 360]
  const measurements: Record<string, unknown> = {}
  for (const width of widths) {
    const mobile = width <= 700
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile })
    await sleep(100)
    const result = await cdp.evaluate<any>(`(()=>{const tabs=Array.from(document.querySelectorAll('.staff-section-bar .staff-section-tabs button'));const name=document.querySelector(${mobile ? "'.staff-directory-page .staff-mobile-card>header b'" : "'.staff-directory-page .staff-name-cell b'"});const style=getComputedStyle(name);return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,tabCount:tabs.length,tabFontSizes:[...new Set(tabs.map(tab=>getComputedStyle(tab).fontSize))],tabFontWeights:[...new Set(tabs.map(tab=>getComputedStyle(tab).fontWeight))],tabLabelsFit:tabs.every(tab=>tab.scrollWidth<=tab.clientWidth+1&&getComputedStyle(tab).whiteSpace==='nowrap'),nameFontSize:style.fontSize,nameFontWeight:style.fontWeight,nameColor:style.color,nameFits:name.scrollWidth<=name.clientWidth+1}})()`)
    assert.equal(result.pageOverflow, false, `Page overflow at ${width}px.`)
    assert.equal(result.tabCount, 5)
    assert.deepEqual(result.tabFontSizes, ['12px'])
    assert.deepEqual(result.tabFontWeights, ['600'])
    assert.equal(result.tabLabelsFit, true)
    assert.equal(result.nameFontSize, mobile ? '13.5px' : '12.6px')
    assert.equal(result.nameFontWeight, '600')
    assert.equal(result.nameColor, 'rgb(23, 61, 86)')
    assert.equal(result.nameFits, true)
    measurements[String(width)] = result
    await screenshot(cdp, `team-directory-after-${width}.png`)
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=[...document.querySelectorAll('.staff-section-tabs button')].find(item=>item.textContent?.trim()==='Team Membership');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.team-membership-page')`)) break; await sleep(100) }
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.membership-approved-page .membership-table.approved-table tbody tr')`)) break; await sleep(100) }
  const typographyExpression = (selectors: Record<string, string>) => `(()=>{const result={};const selectors=${JSON.stringify(selectors)};for(const [key,selector] of Object.entries(selectors)){const element=document.querySelector(selector);if(!element){result[key]=null;continue}const style=getComputedStyle(element);result[key]={fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,letterSpacing:style.letterSpacing,color:style.color}}return result})()`
  const membershipTypography = await cdp.evaluate<any>(typographyExpression({ name: '.membership-table.approved-table tbody td:first-child b', id: '.membership-table.approved-table tbody td:nth-child(2)', heading: '.membership-table.approved-table thead th:first-child', value: '.membership-table.approved-table tbody td:nth-child(3)' }))
  await screenshot(cdp, 'team-membership-reference-1440.png')
  assert.ok(membershipTypography.name && membershipTypography.id && membershipTypography.heading && membershipTypography.value)
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=[...document.querySelectorAll('.staff-section-tabs button')].find(item=>item.textContent?.trim()==='Account Management');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-account-table tbody tr')`)) break; await sleep(100) }
  const accountTypography = await cdp.evaluate<any>(typographyExpression({ name: '.staff-account-table tbody td:first-child b', id: '.staff-account-table tbody td:nth-child(2)', heading: '.staff-account-table thead th:first-child', value: '.staff-account-table tbody td:nth-child(3)' }))
  assert.deepEqual(accountTypography, membershipTypography)
  await screenshot(cdp, 'account-management-audit-1440.png')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=[...document.querySelectorAll('.staff-section-tabs button')].find(item=>item.textContent?.trim()==='Team Membership');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.membership-approved-page .membership-mobile-list article')`)) break; await sleep(100) }
  const membershipMobileTypography = await cdp.evaluate<any>(typographyExpression({ name: '.membership-approved-page .membership-mobile-list article>b', id: '.membership-approved-page .membership-mobile-list article>small', value: '.membership-approved-page .membership-mobile-list article>span' }))
  await screenshot(cdp, 'team-membership-reference-390.png')
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=[...document.querySelectorAll('.staff-section-tabs button')].find(item=>item.textContent?.trim()==='Account Management');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.staff-account-cards article')`)) break; await sleep(100) }
  const accountMobileTypography = await cdp.evaluate<any>(typographyExpression({ name: '.staff-account-cards article header b', id: '.staff-account-cards article header small', value: '.staff-account-cards article dd' }))
  assert.deepEqual(accountMobileTypography, membershipMobileTypography)
  assert.equal(await cdp.evaluate<boolean>(`document.documentElement.scrollWidth>document.documentElement.clientWidth+1`), false)
  await screenshot(cdp, 'account-management-audit-390.png')
  console.log(JSON.stringify({ membershipTypography, accountTypography, membershipMobileTypography, accountMobileTypography }, null, 2))
  assert.deepEqual(cdp.errors, [])
  console.log(JSON.stringify({ measurements, screenshots: widths.map(width => `artifacts/staff-management-typography/team-directory-after-${width}.png`), runtimeErrors: cdp.errors.length }, null, 2))
} finally {
  try { socket?.close() } catch {}
  for (const process of processes.reverse()) { try { process.kill() } catch {} }
  await sleep(200)
  await rm(fixture.root, { recursive: true, force: true }).catch(() => undefined)
}
