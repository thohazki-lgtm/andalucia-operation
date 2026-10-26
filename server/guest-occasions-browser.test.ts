import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { BookingRepository } from './booking-repository.js'
import { GuestOccasionRepository } from './guest-occasion-repository.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'
import { addCalendarDays, serviceDate } from '../src/service-date.js'
import type { GuestOccasionRecord } from '../src/domain.js'

const fixture = await createDisposableDevelopmentStore('guest-occasions-browser')
const profile = join(fixture.root, 'edge-profile')
const visualPhase = process.env.ANDALUCIA_GUEST_OCCASIONS_VISUAL_PHASE || 'after'
const output = resolve('artifacts', 'guest-occasions-mobile-tab-fix')
const processes: ChildProcess[] = []
let socket: WebSocket | null = null
const token = `guest-occasions-ui-${randomUUID()}`
const date = serviceDate()
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
  const owner = (await fixture.db.query<any>("select u.id from user_accounts u join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.active=true where u.status='active' and r.role_key='owner' limit 1")).rows[0]
  assert.ok(owner)
  await fixture.db.query("insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval '1 hour')", [randomUUID(), createHash('sha256').update(token).digest('hex'), owner.id])
  const repository = new GuestOccasionRepository(fixture.db)
  const bookings = new BookingRepository(fixture.db)
  await bookings.initialize()
  await repository.initialize()
  const configuration = await repository.configuration()
  const pending = configuration.statuses.find(option => option.metadata?.occasionWorkflow === 'attention')!.value
  for (const [index, type] of ['honeymoon', 'anniversary', 'see_you_soon', 'siyam_family', 'famtrip', 'presstrip'].entries()) {
    const record: GuestOccasionRecord = { id: randomUUID(), occasionType: type, bookingId: null, guestName: `${configuration.types.find(option => option.value === type)!.label} Guest`, roomNumber: String(710 + index), reservationDate: date, reservationTime: `${18 + Math.floor(index / 2)}:${index % 2 ? '30' : '00'}`, tableNumber: '', waiterId: null, waiter: null, status: pending, source: 'manual', sourceText: type === 'siyam_family' ? 'Siyam Family · 4th Visit' : 'Isolated rendered-browser fixture', notes: index === 0 ? 'Welcome amenity prepared' : '', active: true }
    await repository.save(record, 'Isolated UI Manager')
    if (type === 'siyam_family') for (let previous = 1; previous <= 3; previous++) await repository.save({ ...record, id: randomUUID(), reservationDate: addCalendarDays(date, -previous), sourceText: `Historical Siyam Family visit ${previous}` }, 'Isolated UI Manager')
  }
  const booking = await bookings.save({ id: randomUUID(), guestName: 'Birthday Import Guest', roomNumber: '719', birthDate: null, arrivalDate: null, departureDate: null, mealPeriod: 'Dinner', reservationDate: date, reservationTime: '18:15', bookingNumber: 'OCC-IMPORTED-01', covers: 4, bookingStatus: 'confirmed', bookingSource: 'pdf_import', bookedBy: 'Activity Program', guestNotes: 'Birthday celebration requested.', tableNumber: '', waiterId: null, waiter: null, importSource: 'activity_program', sourceFilename: 'isolated-activity-program.pdf' }, 'Isolated UI Manager')
  const importedOccasion = await repository.save({ id: randomUUID(), occasionType: 'birthday', bookingId: booking.id, guestName: booking.guestName, roomNumber: booking.roomNumber, reservationDate: date, reservationTime: booking.reservationTime, tableNumber: '', waiterId: null, waiter: null, status: pending, source: 'manual', sourceText: 'Birthday celebration requested in Activity Program. Nut allergy recorded for the guest.', notes: '', active: true }, 'Isolated UI Manager')
  await fixture.db.query("update guest_occasions set source='automatic_detection' where id=$1", [importedOccasion.id])
  const outletScope = (await fixture.db.query<{ id: string }>('select os.id from outlet_scopes os join bookings b on lower(os.scope_key)=lower(b.venue_key) where b.id=$1', [booking.id])).rows[0]
  assert.ok(outletScope)
  const attentionEvidence = 'Birthday celebration requested in Activity Program. Nut allergy recorded for the guest. Strictly avoid peanuts, tree nuts, shared nut oils, cross-contact utensils and nut-based garnishes. The manager must confirm the dietary alert directly with the kitchen before service. END OF EXACT DIETARY NOTE.'
  await fixture.db.query(`insert into booking_intelligence_findings(id,outlet_scope_id,booking_id,finding_type,normalized_key,raw_evidence_text,detected_phrase,evidence_location,evidence_sha256,rule_key,rule_version,source_payload,detected_payload,effective_payload,resolution_method,confidence,review_state,review_required,created_by_user_id,created_by_actor,updated_by_user_id,updated_by_actor)
    values($1,$2,$3,'allergy','ALLERGY',$4,'Nut allergy','guest_notes',$5,'attention.allergy','booking-intelligence-r1',$6,$7,$8,'bounded_phrase_match',0.99,'not_required',false,$9,'Isolated UI Manager',$9,'Isolated UI Manager')`, [randomUUID(), outletScope.id, booking.id, attentionEvidence, createHash('sha256').update(attentionEvidence).digest('hex'), JSON.stringify({ guestNotes: attentionEvidence }), JSON.stringify({ displayLabel: 'Allergy', classification: 'ALLERGY' }), JSON.stringify({ classification: 'ALLERGY' }), owner.id])
  const tlcBooking = await bookings.save({ id: randomUUID(), guestName: 'TLC Follow-up Guest', roomNumber: '720', birthDate: null, arrivalDate: null, departureDate: null, mealPeriod: 'Dinner', reservationDate: date, reservationTime: '18:45', bookingNumber: 'ATT-TLC-01', covers: 2, bookingStatus: 'confirmed', bookingSource: 'pdf_import', bookedBy: 'Activity Program', guestNotes: 'TLC requested after previous service recovery.', tableNumber: '', waiterId: null, waiter: null, importSource: 'activity_program', sourceFilename: 'isolated-activity-program.pdf' }, 'Isolated UI Manager')
  const tlcEvidence = 'TLC requested after previous service recovery. Welcome the guest personally and confirm the requested quiet table before seating.'
  await fixture.db.query(`insert into booking_intelligence_findings(id,outlet_scope_id,booking_id,finding_type,normalized_key,raw_evidence_text,detected_phrase,evidence_location,evidence_sha256,rule_key,rule_version,source_payload,detected_payload,effective_payload,resolution_method,confidence,review_state,review_required,created_by_user_id,created_by_actor,updated_by_user_id,updated_by_actor)
    values($1,$2,$3,'guest_attention','GUEST_ATTENTION_TLC',$4,'TLC','guest_notes',$5,'attention.tlc','booking-intelligence-r1',$6,$7,$8,'bounded_token_match',0.99,'not_required',false,$9,'Isolated UI Manager',$9,'Isolated UI Manager')`, [randomUUID(), outletScope.id, tlcBooking.id, tlcEvidence, createHash('sha256').update(tlcEvidence).digest('hex'), JSON.stringify({ guestNotes: tlcEvidence }), JSON.stringify({ displayLabel: 'TLC', classification: 'GUEST_ATTENTION_TLC' }), JSON.stringify({ classification: 'GUEST_ATTENTION_TLC' }), owner.id])
  await fixture.db.close()

  const node = process.execPath
  processes.push(spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', API_PORT: '33002' }, stdio: 'inherit' }))
  processes.push(spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5174'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '33002' }, stdio: 'inherit' }))
  await Promise.all([waitFor('http://127.0.0.1:33002/api/health'), waitFor('http://127.0.0.1:5174/')])

  const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--edge-skip-compat-layer-relaunch', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  processes.push(edge)
  const portFile = join(profile, 'DevToolsActivePort')
  let debugPort = 0
  for (let attempt = 0; attempt < 200; attempt++) { try { debugPort = Number((await readFile(portFile, 'utf8')).trim().split(/\r?\n/)[0]); if (debugPort && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) break } catch {} await sleep(100) }
  assert.ok(debugPort)
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json() as Array<{ type: string; webSocketDebuggerUrl: string }>
  const page = pages.find(item => item.type === 'page'); assert.ok(page)
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise<void>((resolveOpen, rejectOpen) => { socket!.onopen = () => resolveOpen(); socket!.onerror = () => rejectOpen(new Error('CDP connection failed')) })
  const cdp = new Cdp(socket)
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Network.enable')
  assert.equal((await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5174/', path: '/', httpOnly: true, sameSite: 'Strict' })).success, true)
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Guest Occasions"]')`)) break; await sleep(150) }
  await cdp.evaluate(`document.querySelector('button[aria-label="Guest Occasions"]')?.click()`)
  for (let attempt = 0; attempt < 100; attempt++) { if ((await cdp.evaluate<number>(`document.querySelectorAll('.occasion-table tbody tr').length`)) === 7) break; await sleep(150) }
  assert.equal(await cdp.evaluate<number>(`document.querySelectorAll('.occasion-table tbody tr').length`), 7, await cdp.evaluate<string>('document.body.innerText'))
  const nextDate = addCalendarDays(date, 1)
  await cdp.evaluate(`document.querySelector('.occasion-date-next')?.click()`)
  for (let attempt = 0; attempt < 40; attempt++) { if ((await cdp.evaluate<string>(`document.querySelector('.occasion-date-picker input')?.value`)) === nextDate) break; await sleep(100) }
  assert.equal(await cdp.evaluate<string>(`document.querySelector('.occasion-date-picker input')?.value`), nextDate)
  await cdp.evaluate(`document.querySelector('.occasion-date-previous')?.click()`)
  for (let attempt = 0; attempt < 60; attempt++) { if ((await cdp.evaluate<string>(`document.querySelector('.occasion-date-picker input')?.value`)) === date && (await cdp.evaluate<number>(`document.querySelectorAll('.occasion-table tbody tr').length`)) === 7) break; await sleep(100) }
  assert.equal(await cdp.evaluate<string>(`document.querySelector('.occasion-date-picker input')?.value`), date)
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const input=document.querySelector('.occasion-date-picker input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(nextDate)});input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`), true)
  for (let attempt = 0; attempt < 40; attempt++) { if ((await cdp.evaluate<string>(`document.querySelector('.occasion-date-picker input')?.value`)) === nextDate) break; await sleep(100) }
  await cdp.evaluate(`document.querySelector('.occasion-date-today')?.click()`)
  for (let attempt = 0; attempt < 60; attempt++) { if ((await cdp.evaluate<string>(`document.querySelector('.occasion-date-picker input')?.value`)) === date && (await cdp.evaluate<number>(`document.querySelectorAll('.occasion-table tbody tr').length`)) === 7) break; await sleep(100) }
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('.occasion-add-manual');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.occasion-form')`)) break; await sleep(100) }
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.occasion-form')`), true)
  await cdp.evaluate(`Array.from(document.querySelectorAll('.occasion-form button')).find(node=>node.textContent?.trim()==='Cancel')?.click()`)
  assert.deepEqual((await cdp.evaluate<string[]>(`Array.from(document.querySelectorAll('.occasion-table .occasion-chip')).map(node=>node.textContent.trim())`)).sort(), ['Anniversary','Birthday','Famtrip','Honeymoon','Presstrip','See You Soon','Siyam Family'])
  assert.deepEqual(await cdp.evaluate<string[]>(`Array.from(document.querySelectorAll('.occasion-table thead th')).map(node=>node.textContent.trim())`), ['Time','Guest / Room','Occasion','Details','Table','Waiter','Status',''])
  assert.equal(await cdp.evaluate<boolean>(`document.querySelector('.occasion-table')?.textContent?.includes('Source')`), false)
  assert.equal(await cdp.evaluate<boolean>(`document.querySelector('.occasion-table .row-actions')?.textContent?.includes('View')`), false)
  assert.equal(await cdp.evaluate<boolean>(`document.querySelector('.occasion-table .row-actions .ao-icon-action[aria-label^="Edit occasion for"]') !== null`), true)
  assert.equal(await cdp.evaluate<number>(`document.querySelectorAll('.attention-table tbody tr').length`), 2)
  assert.deepEqual(await cdp.evaluate<string[]>(`Array.from(document.querySelectorAll('.attention-table thead th')).map(node=>node.textContent.trim())`), ['Time','Guest / Room','Attention','Evidence','Table','Waiter','Status'])
  assert.equal(await cdp.evaluate<boolean>(`document.querySelector('.attention-table')?.textContent?.includes('View')`), false)
  assert.equal(await cdp.evaluate<number>(`document.querySelectorAll('.attention-table .occasion-guest-trigger').length`), 2)
  assert.deepEqual(await cdp.evaluate<string[]>(`Array.from(document.querySelectorAll('.occasion-records .eyebrow,.attention-records .eyebrow')).map(node=>node.textContent.trim())`), ['ATTENTION NEEDED','GUEST OCCASIONS'])
  for (const attentionCase of [{ guest: 'Birthday Import Guest', type: 'Allergy', note: 'END OF EXACT DIETARY NOTE.' }, { guest: 'TLC Follow-up Guest', type: 'TLC / Guest Attention', note: 'confirm the requested quiet table before seating.' }]) {
    assert.equal(await cdp.evaluate<boolean>(`(()=>{const row=Array.from(document.querySelectorAll('.attention-table tbody tr')).find(node=>node.textContent?.includes(${JSON.stringify(attentionCase.guest)}));const button=row?.querySelector('.occasion-guest-trigger');if(!button)return false;button.click();return true})()`), true)
    for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.occasion-drawer')`)) break; await sleep(100) }
    assert.equal(await cdp.evaluate<boolean>(`(()=>{const text=document.querySelector('.occasion-drawer')?.textContent||'';return text.includes(${JSON.stringify(attentionCase.guest)})&&text.includes(${JSON.stringify(attentionCase.type)})&&text.includes(${JSON.stringify(attentionCase.note)})&&!['Evidence location','Rule','Created','Updated','sourceFilename','internal ID'].some(label=>text.includes(label))})()`), true)
    await cdp.evaluate(`document.querySelector('.occasion-drawer .close')?.click()`)
  }
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('.occasion-table .occasion-guest-trigger');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.occasion-drawer')`)) break; await sleep(100) }
  assert.equal(await cdp.evaluate<boolean>(`document.querySelector('.occasion-drawer')?.textContent?.includes('Reservation')`), true)
  await cdp.evaluate(`document.querySelector('.occasion-drawer .close')?.click()`)
  assert.ok(await cdp.evaluate<number>(`Array.from(document.querySelectorAll('.occasion-status-select')).filter(select=>getComputedStyle(select).borderRadius!=='0px').length`) >= 7)
  const prepared = configuration.statuses.find(option => option.metadata?.occasionWorkflow === 'prepared')!.value
  await cdp.evaluate(`(()=>{const select=document.querySelector('.occasion-table tbody tr select');select.value=${JSON.stringify(prepared)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  for (let attempt = 0; attempt < 60; attempt++) { if ((await cdp.evaluate<string>(`document.querySelector('.occasion-table tbody tr select')?.value`)) === prepared) break; await sleep(100) }
  assert.equal((await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5174/', path: '/', httpOnly: true, sameSite: 'Strict' })).success, true)
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Guest Occasions"]')`)) break; await sleep(150) }
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Guest Occasions"]')`), true, await cdp.evaluate<string>('document.body.innerText'))
  await cdp.evaluate(`document.querySelector('button[aria-label="Guest Occasions"]')?.click()`)
  for (let attempt = 0; attempt < 100; attempt++) { if ((await cdp.evaluate<number>(`document.querySelectorAll('.occasion-table tbody tr').length`)) === 7) break; await sleep(150) }
  assert.equal(await cdp.evaluate<number>(`document.querySelectorAll('.occasion-table tbody tr').length`), 7, await cdp.evaluate<string>('document.body.innerText'))
  assert.equal(await cdp.evaluate<string>(`document.querySelector('.occasion-table tbody tr select')?.value`), prepared)
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('.occasion-table tbody tr:first-child .row-actions .ao-icon-action');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.occasion-form')`)) break; await sleep(100) }
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const field=document.querySelector('.occasion-form textarea');if(!field)return false;const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(field,'Updated through isolated manager editing');field.dispatchEvent(new Event('input',{bubbles:true}));return true})()`), true)
  await cdp.evaluate(`document.querySelector('.occasion-form .ao-action--primary')?.click()`)
  for (let attempt = 0; attempt < 60; attempt++) { if (!(await cdp.evaluate<boolean>(`!!document.querySelector('.occasion-form')`))) break; await sleep(100) }
  const completed = configuration.statuses.find(option => option.metadata?.occasionWorkflow === 'completed')!.value
  await cdp.evaluate(`(()=>{const select=document.querySelector('.occasion-table tbody tr select');select.value=${JSON.stringify(completed)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  for (let attempt = 0; attempt < 60; attempt++) { if ((await cdp.evaluate<string>(`document.querySelector('.occasion-table tbody tr select')?.value`)) === completed) break; await sleep(100) }
  assert.equal((await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5174/', path: '/', httpOnly: true, sameSite: 'Strict' })).success, true)
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Guest Occasions"]')`)) break; await sleep(150) }
  await cdp.evaluate(`document.querySelector('button[aria-label="Guest Occasions"]')?.click()`)
  for (let attempt = 0; attempt < 100; attempt++) { if ((await cdp.evaluate<number>(`document.querySelectorAll('.occasion-table tbody tr').length`)) === 7) break; await sleep(150) }
  assert.equal(await cdp.evaluate<string>(`document.querySelector('.occasion-table tbody tr select')?.value`), completed)
  assert.equal(await cdp.evaluate<string>(`document.querySelector('.occasion-table tbody tr:first-child td:nth-child(4) b')?.textContent?.trim()`), 'Updated through isolated manager editing')
  assert.equal(await cdp.evaluate<string>(`Array.from(document.querySelectorAll('.occasion-summary article')).find(card=>card.textContent?.includes('Completed'))?.querySelector('strong')?.textContent?.trim()`), '1')

  await mkdir(output, { recursive: true })
  const results: Record<string, unknown>[] = []
  for (const viewport of [
    { name: 'desktop-1440', width: 1440, height: 1000, mobile: false },
    { name: 'desktop-1280', width: 1280, height: 960, mobile: false },
    { name: 'desktop-1024', width: 1024, height: 900, mobile: false },
    { name: 'tablet-768', width: 768, height: 900, mobile: false },
    { name: 'mobile-430', width: 430, height: 900, mobile: true },
    { name: 'mobile-390', width: 390, height: 844, mobile: true },
    { name: 'mobile-360', width: 360, height: 800, mobile: true }
  ]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile })
    await sleep(250)
    const result = await cdp.evaluate<any>(`(()=>{const visible=node=>{const style=getComputedStyle(node);return style.display!=='none'&&node.getBoundingClientRect().width>0};const table=document.querySelector('.occasion-table');const attentionTable=document.querySelector('.attention-table');const tableWrap=document.querySelector('.occasion-table-wrap');const attentionWrap=document.querySelector('.attention-table-wrap');const cards=Array.from(document.querySelectorAll('.mobile-occasion-card')).filter(visible);const attentionCards=Array.from(document.querySelectorAll('.mobile-attention-card')).filter(visible);const tabs=Array.from(document.querySelectorAll('.occasion-tabs button'));const occasionWidths=Array.from(document.querySelectorAll('.occasion-table thead th')).map(node=>Math.round(node.getBoundingClientRect().width));const attentionWidths=Array.from(document.querySelectorAll('.attention-table thead th')).map(node=>Math.round(node.getBoundingClientRect().width));return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,tableVisible:visible(table),attentionTableVisible:visible(attentionTable),tableScrolls:tableWrap.scrollWidth>tableWrap.clientWidth+1,attentionScrolls:attentionWrap.scrollWidth>attentionWrap.clientWidth+1,cards:cards.length,attentionCards:attentionCards.length,cardClipping:[...cards,...attentionCards].filter(card=>card.scrollWidth>card.clientWidth+1).length,tabsClipped:tabs.filter(tab=>tab.scrollWidth>tab.clientWidth+1).length,summaryCards:document.querySelectorAll('.occasion-summary article').length,occasionWidths,attentionWidths,occasionLabels:Array.from((visible(table)?table.querySelectorAll('.occasion-chip'):cards.map(card=>card.querySelector('.occasion-chip')))).map(node=>node?.textContent?.trim())}})()`)
    if (result.pageOverflow) result.overflowers = await cdp.evaluate(`Array.from(document.querySelectorAll('*')).filter(node=>node.getBoundingClientRect().right>document.documentElement.clientWidth+1).slice(0,20).map(node=>({tag:node.tagName,class:node.className,right:Math.round(node.getBoundingClientRect().right),width:Math.round(node.getBoundingClientRect().width)}))`)
    assert.equal(result.pageOverflow, false, `page overflow at ${viewport.width}px: ${JSON.stringify(result.overflowers || [])}`)
    assert.equal(result.summaryCards, 4)
    assert.equal(result.tabsClipped, 0)
    const tabStart = await cdp.evaluate<any>(`(()=>{const tabs=document.querySelector('.occasion-tabs');const first=tabs?.querySelector('button');const filter=document.querySelector('.occasion-filters input');const tabsRect=tabs?.getBoundingClientRect();const firstRect=first?.getBoundingClientRect();const filterRect=filter?.getBoundingClientRect();return{scrollLeft:tabs?.scrollLeft||0,firstOffset:Math.round((firstRect?.left||0)-(tabsRect?.left||0)),filterOffset:Math.round((filterRect?.left||0)-(tabsRect?.left||0)),canScroll:(tabs?.scrollWidth||0)>(tabs?.clientWidth||0)+1}})()`)
    assert.equal(tabStart.scrollLeft, 0)
    if (viewport.mobile) assert.ok(Math.abs(tabStart.firstOffset - tabStart.filterOffset) <= 1, `first tab/filter drift at ${viewport.width}px: ${JSON.stringify(tabStart)}`)
    if (tabStart.canScroll) {
      await cdp.evaluate(`document.querySelector('.occasion-tabs')?.scrollTo({left:document.querySelector('.occasion-tabs').scrollWidth,behavior:'instant'})`)
      await sleep(80)
      const tabEnd = await cdp.evaluate<any>(`(()=>{const tabs=document.querySelector('.occasion-tabs');const last=tabs?.querySelector('button:last-child');const style=getComputedStyle(tabs);const tabsRect=tabs?.getBoundingClientRect();const lastRect=last?.getBoundingClientRect();const contentRight=(tabsRect?.right||0)-parseFloat(style.paddingRight);return{reached:(tabs?.scrollLeft||0)>0,lastRightGap:Math.round(contentRight-(lastRect?.right||0)),lastClipped:last?last.scrollWidth>last.clientWidth+1:true}})()`)
      assert.equal(tabEnd.reached, true)
      assert.equal(tabEnd.lastClipped, false)
      assert.ok(Math.abs(tabEnd.lastRightGap) <= 1, `last tab reach at ${viewport.width}px: ${JSON.stringify(tabEnd)}`)
      await cdp.evaluate(`document.querySelector('.occasion-tabs')?.scrollTo({left:0,behavior:'instant'})`)
      await sleep(80)
    }
    assert.equal(await cdp.evaluate<boolean>(`!document.body.innerText.includes('Occasion date')&&!Array.from(document.querySelectorAll('.occasion-toolbar button')).some(button=>['Previous','Next'].includes(button.textContent?.trim()||''))`), true)
    if (viewport.mobile) {
      assert.equal(result.tableVisible, false); assert.equal(result.attentionTableVisible, false); assert.equal(result.cards, 7); assert.equal(result.attentionCards, 2); assert.equal(result.cardClipping, 0)
      assert.equal(await cdp.evaluate<number>(`Array.from(document.querySelectorAll('.mobile-attention-card button')).filter(node=>node.textContent?.includes('View Details')).length`), 0)
      assert.equal(await cdp.evaluate<boolean>(`Array.from(document.querySelectorAll('.occasion-toolbar .ao-action,.occasion-toolbar .ao-icon-action,.mobile-occasion-card .ao-action,.mobile-occasion-card .ao-status-select')).every(node=>node.getBoundingClientRect().height>=44)`), true)
      const mobileHeader = await cdp.evaluate<any>(`(()=>{const rect=selector=>document.querySelector(selector).getBoundingClientRect();const toolbarNode=document.querySelector('.occasion-toolbar');const toolbar=toolbarNode.getBoundingClientRect();const toolbarStyle=getComputedStyle(toolbarNode);const innerLeft=toolbar.left+parseFloat(toolbarStyle.borderLeftWidth)+parseFloat(toolbarStyle.paddingLeft);const innerRight=toolbar.right-parseFloat(toolbarStyle.borderRightWidth)-parseFloat(toolbarStyle.paddingRight);const picker=rect('.occasion-date-picker');const previous=rect('.occasion-date-previous');const today=rect('.occasion-date-today');const next=rect('.occasion-date-next');const add=rect('.occasion-add-manual');const input=document.querySelector('.occasion-date-picker input');const inputStyle=getComputedStyle(input);const card=Array.from(document.querySelectorAll('.mobile-occasion-card')).find(node=>node.textContent?.includes('Siyam Family Guest'));const pill=card?.querySelector('.occasion-chip');return{topRowAligned:Math.max(previous.top,picker.top,next.top)-Math.min(previous.top,picker.top,next.top)<2,navOrdered:previous.left<picker.left&&picker.left<next.left,arrowsEqual:Math.abs(previous.width-next.width)<1,centeredDate:inputStyle.textAlign==='center',actionsBelow:today.top>picker.bottom&&add.top>picker.bottom,actionsAligned:Math.abs(today.top-add.top)<2&&today.right<add.left,equalActions:Math.abs(today.width-add.width)<1,actionsBounded:Math.abs(today.left-innerLeft)<1&&Math.abs(add.right-innerRight)<1,pillText:pill?.textContent?.trim(),pillClipped:pill?pill.scrollWidth>pill.clientWidth+1:true,pillWidth:Math.round(pill?.getBoundingClientRect().width||0)}})()`)
      assert.deepEqual({ topRowAligned: mobileHeader.topRowAligned, navOrdered: mobileHeader.navOrdered, arrowsEqual: mobileHeader.arrowsEqual, centeredDate: mobileHeader.centeredDate, actionsBelow: mobileHeader.actionsBelow, actionsAligned: mobileHeader.actionsAligned, equalActions: mobileHeader.equalActions, actionsBounded: mobileHeader.actionsBounded, pillText: mobileHeader.pillText, pillClipped: mobileHeader.pillClipped }, { topRowAligned: true, navOrdered: true, arrowsEqual: true, centeredDate: true, actionsBelow: true, actionsAligned: true, equalActions: true, actionsBounded: true, pillText: 'Siyam Family · 4th Visit', pillClipped: false })
      assert.ok(mobileHeader.pillWidth > 100)
    } else {
      assert.equal(result.tableVisible, true); assert.equal(result.attentionTableVisible, true); assert.equal(result.cards, 0); assert.equal(result.attentionCards, 0)
      if (viewport.width >= 1280) { assert.equal(result.tableScrolls, false); assert.equal(result.attentionScrolls, false) }
      assert.equal(result.occasionWidths.length, 8); assert.equal(result.attentionWidths.length, 7); assert.ok(result.occasionWidths.every((width: number) => width > 0)); assert.ok(result.attentionWidths.every((width: number) => width > 0))
      assert.equal(await cdp.evaluate<number>(`new Set(Array.from(document.querySelectorAll('.occasion-table .occasion-chip')).map(node=>Math.round(node.getBoundingClientRect().width))).size`), 1)
    }
    const metrics = await cdp.send('Page.getLayoutMetrics')
    const content = metrics.cssContentSize || metrics.contentSize
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { x: 0, y: 0, width: content.width, height: content.height, scale: 1 } })
    await writeFile(join(output, `guest-occasions-${visualPhase}-${viewport.name}.png`), Buffer.from(screenshot.data, 'base64'))
    assert.equal(await cdp.evaluate<boolean>(`(()=>{const visible=node=>getComputedStyle(node).display!=='none'&&node.getBoundingClientRect().width>0;const target=Array.from(document.querySelectorAll(${viewport.mobile ? "'.mobile-occasion-card'" : "'.occasion-table tbody tr'"})).filter(visible).find(node=>node.textContent?.includes('Birthday Import Guest'));const button=${viewport.mobile ? "Array.from(target?.querySelectorAll('button')||[]).find(node=>node.textContent?.trim()==='View Details')" : "target?.querySelector('.occasion-guest-trigger')"};if(!button)return false;button.click();return true})()`), true)
    for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.occasion-drawer')`)) break; await sleep(100) }
    await sleep(250)
    const drawer = await cdp.evaluate<any>(`(()=>{const drawer=document.querySelector('.occasion-drawer');const body=drawer?.querySelector('.occasion-drawer-body');const footer=drawer?.querySelector('footer');const text=drawer?.textContent||'';const rect=drawer?.getBoundingClientRect();return{text,forbidden:['Evidence summary','View full source evidence','Evidence Provenance','Evidence location','Rule','Created','Updated','Guest Profile','internal ID'].filter(label=>text.includes(label)),hasGuest:text.includes('Birthday Import Guest'),hasOccasion:text.includes('Birthday'),hasRoom:text.includes('719'),hasBooking:text.includes('OCC-IMPORTED-01'),hasTime:text.includes('18:15'),hasCovers:text.includes('4'),hasTable:text.includes('Unassigned'),hasWaiter:text.includes('Unassigned'),hasStatus:text.includes('Attention'),hasAlert:text.includes('Nut allergy'),hasActions:['Edit','Mark as Prepared','Mark as Completed'].every(label=>text.includes(label)),hasCloseControl:!!drawer?.querySelector('.close')||Array.from(drawer?.querySelectorAll('button')||[]).some(node=>node.textContent?.trim()==='Close'),height:Math.round(rect?.height||0),viewportHeight:innerHeight,bodyScrolls:body?body.scrollHeight>body.clientHeight+1:false,footerVisible:footer?footer.getBoundingClientRect().bottom<=innerHeight+1:false,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
    assert.deepEqual({ forbidden: drawer.forbidden, hasGuest: drawer.hasGuest, hasOccasion: drawer.hasOccasion, hasRoom: drawer.hasRoom, hasBooking: drawer.hasBooking, hasTime: drawer.hasTime, hasCovers: drawer.hasCovers, hasTable: drawer.hasTable, hasWaiter: drawer.hasWaiter, hasStatus: drawer.hasStatus, hasAlert: drawer.hasAlert, hasActions: drawer.hasActions, hasCloseControl: drawer.hasCloseControl, footerVisible: drawer.footerVisible, pageOverflow: drawer.pageOverflow }, { forbidden: [], hasGuest: true, hasOccasion: true, hasRoom: true, hasBooking: true, hasTime: true, hasCovers: true, hasTable: true, hasWaiter: true, hasStatus: true, hasAlert: true, hasActions: true, hasCloseControl: false, footerVisible: true, pageOverflow: false })
    assert.ok(drawer.height <= drawer.viewportHeight - (viewport.mobile ? 16 : 32) + 1)
    const detailScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
    await writeFile(join(output, `guest-occasion-details-${visualPhase}-${viewport.name}.png`), Buffer.from(detailScreenshot.data, 'base64'))
    if (viewport.name === 'desktop-1440' || viewport.name === 'mobile-390') {
      assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('.occasion-drawer footer button')).find(node=>node.textContent?.trim()==='Edit');if(!button)return false;button.click();return true})()`), true)
      for (let attempt = 0; attempt < 20; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.occasion-edit-modal')`)) break; await sleep(50) }
      const editModal = await cdp.evaluate<any>(`(()=>{const modal=document.querySelector('.occasion-edit-modal');const labels=modal?.querySelectorAll('.occasion-form-grid label');const footer=modal?.querySelector('.form-actions');const rect=modal?.getBoundingClientRect();const first=labels?.[0]?.getBoundingClientRect();const second=labels?.[1]?.getBoundingClientRect();return{width:Math.round(rect?.width||0),hasClose:!!modal?.querySelector('.close'),sections:modal?.querySelectorAll('.occasion-form-section').length||0,buttons:footer?.querySelectorAll('button').length||0,footerVisible:footer?footer.getBoundingClientRect().bottom<=innerHeight+1:false,twoColumns:first&&second?Math.abs(first.top-second.top)<2:false,singleColumn:first&&second?second.top>first.bottom:false,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
      assert.deepEqual({ hasClose: editModal.hasClose, sections: editModal.sections, buttons: editModal.buttons, footerVisible: editModal.footerVisible, pageOverflow: editModal.pageOverflow }, { hasClose: false, sections: 3, buttons: 2, footerVisible: true, pageOverflow: false }, `edit modal at ${viewport.name}: ${JSON.stringify(editModal)}`)
      if (viewport.mobile) { assert.equal(editModal.singleColumn, true); assert.ok(editModal.width <= viewport.width - 16 + 1) } else { assert.equal(editModal.twoColumns, true); assert.ok(editModal.width >= 720 && editModal.width <= 780) }
      assert.equal(await cdp.evaluate<boolean>(`(()=>{const notes=document.querySelector('.occasion-edit-modal textarea:not([readonly])');if(!notes)return false;const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;setter?.call(notes,'Unsaved O4.1 validation');notes.dispatchEvent(new Event('input',{bubbles:true}));window.confirm=()=>false;document.querySelector('.modal-backdrop')?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));return true})()`), true)
      await sleep(100)
      assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.occasion-edit-modal')`), true)
      await cdp.evaluate(`window.confirm=()=>true;window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`)
      for (let attempt = 0; attempt < 20; attempt++) { if (await cdp.evaluate<boolean>(`!document.querySelector('.occasion-edit-modal')`)) break; await sleep(50) }
      assert.equal(await cdp.evaluate<boolean>(`!document.querySelector('.occasion-edit-modal')`), true)
    } else {
      await cdp.evaluate(`document.querySelector('.occasion-drawer-backdrop')?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`)
      for (let attempt = 0; attempt < 20; attempt++) { if (await cdp.evaluate<boolean>(`!document.querySelector('.occasion-drawer')`)) break; await sleep(50) }
      assert.equal(await cdp.evaluate<boolean>(`!document.querySelector('.occasion-drawer')`), true)
    }
    assert.equal(await cdp.evaluate<boolean>(`(()=>{const visible=node=>getComputedStyle(node).display!=='none'&&node.getBoundingClientRect().width>0;const target=Array.from(document.querySelectorAll(${viewport.mobile ? "'.mobile-occasion-card'" : "'.occasion-table tbody tr'"})).filter(visible).find(node=>node.textContent?.includes('Siyam Family Guest'));const button=${viewport.mobile ? "Array.from(target?.querySelectorAll('button')||[]).find(node=>node.textContent?.trim()==='View Details')" : "target?.querySelector('.occasion-guest-trigger')"};if(!button)return false;button.click();return true})()`), true)
    for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.occasion-drawer')`)) break; await sleep(100) }
    await sleep(250)
    const longDrawerPill = await cdp.evaluate<any>(`(()=>{const pill=document.querySelector('.occasion-drawer .occasion-chip');return{text:pill?.textContent?.trim(),clipped:pill?pill.scrollWidth>pill.clientWidth+1:true,width:Math.round(pill?.getBoundingClientRect().width||0),pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
    assert.deepEqual({ text: longDrawerPill.text, clipped: longDrawerPill.clipped, pageOverflow: longDrawerPill.pageOverflow }, { text: 'Siyam Family · 4th Visit', clipped: false, pageOverflow: false })
    assert.ok(longDrawerPill.width > 100)
    const longPillScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
    await writeFile(join(output, `guest-occasion-long-pill-${visualPhase}-${viewport.name}.png`), Buffer.from(longPillScreenshot.data, 'base64'))
    await cdp.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`)
    for (let attempt = 0; attempt < 20; attempt++) { if (await cdp.evaluate<boolean>(`!document.querySelector('.occasion-drawer')`)) break; await sleep(50) }
    assert.equal(await cdp.evaluate<boolean>(`!document.querySelector('.occasion-drawer')`), true)
    assert.equal(await cdp.evaluate<boolean>(`(()=>{const visible=node=>getComputedStyle(node).display!=='none'&&node.getBoundingClientRect().width>0;const target=Array.from(document.querySelectorAll(${viewport.mobile ? "'.mobile-attention-card'" : "'.attention-table tbody tr'"})).filter(visible).find(node=>node.textContent?.includes('Birthday Import Guest'));const button=target?.querySelector('.occasion-guest-trigger');if(!button)return false;button.click();return true})()`), true)
    for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.occasion-drawer')`)) break; await sleep(100) }
    await sleep(150)
    const attentionDrawer = await cdp.evaluate<any>(`(()=>{const drawer=document.querySelector('.occasion-drawer');const text=drawer?.textContent||'';const body=drawer?.querySelector('.occasion-drawer-body');const footer=drawer?.querySelector('footer');const rect=drawer?.getBoundingClientRect();return{hasGuest:text.includes('Birthday Import Guest'),hasType:text.includes('Allergy'),hasRoom:text.includes('719'),hasBooking:text.includes('OCC-IMPORTED-01'),hasCovers:text.includes('4'),hasTime:text.includes('18:15'),hasTable:text.includes('Unassigned'),hasWaiter:text.includes('Unassigned'),hasExactNoteEnd:text.includes('END OF EXACT DIETARY NOTE.'),forbidden:['Evidence location','Rule','Created','Updated','sourceFilename','internal ID'].filter(label=>text.includes(label)),hasCloseControl:!!drawer?.querySelector('.close')||Array.from(drawer?.querySelectorAll('button')||[]).some(node=>node.textContent?.trim()==='Close'),height:Math.round(rect?.height||0),viewportHeight:innerHeight,footerPresent:!!footer,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,bodyClipping:body?body.scrollWidth>body.clientWidth+1:false}})()`)
    assert.deepEqual({ hasGuest: attentionDrawer.hasGuest, hasType: attentionDrawer.hasType, hasRoom: attentionDrawer.hasRoom, hasBooking: attentionDrawer.hasBooking, hasCovers: attentionDrawer.hasCovers, hasTime: attentionDrawer.hasTime, hasTable: attentionDrawer.hasTable, hasWaiter: attentionDrawer.hasWaiter, hasExactNoteEnd: attentionDrawer.hasExactNoteEnd, forbidden: attentionDrawer.forbidden, hasCloseControl: attentionDrawer.hasCloseControl, footerPresent: attentionDrawer.footerPresent, pageOverflow: attentionDrawer.pageOverflow, bodyClipping: attentionDrawer.bodyClipping }, { hasGuest: true, hasType: true, hasRoom: true, hasBooking: true, hasCovers: true, hasTime: true, hasTable: true, hasWaiter: true, hasExactNoteEnd: true, forbidden: [], hasCloseControl: false, footerPresent: false, pageOverflow: false, bodyClipping: false })
    assert.ok(attentionDrawer.height <= attentionDrawer.viewportHeight - (viewport.mobile ? 16 : 32) + 1)
    const attentionScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
    await writeFile(join(output, `guest-attention-details-${visualPhase}-${viewport.name}.png`), Buffer.from(attentionScreenshot.data, 'base64'))
    await cdp.evaluate(`document.querySelector('.occasion-drawer-backdrop')?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`)
    for (let attempt = 0; attempt < 20; attempt++) { if (await cdp.evaluate<boolean>(`!document.querySelector('.occasion-drawer')`)) break; await sleep(50) }
    assert.equal(await cdp.evaluate<boolean>(`!document.querySelector('.occasion-drawer')`), true)
    results.push({ viewport: viewport.name, ...result })
  }
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('button[aria-label="Customization Center"]');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.customization-category-nav')`)) break; await sleep(100) }
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('.customization-category-nav button')).find(node=>node.textContent?.trim()==='Guest Experience');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.guest-experience-config')`)) break; await sleep(100) }
  const customizationResults: Array<Record<string, unknown>> = []
  for (const width of [1440, 1024, 768, 430, 390, 360]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width <= 430 ? 860 : 920, deviceScaleFactor: 1, mobile: false })
    await sleep(120)
    const result = await cdp.evaluate<any>(`(()=>{const root=document.querySelector('.guest-experience-config');const grid=document.querySelector('.occasion-config-grid');const cards=Array.from(document.querySelectorAll('.occasion-config-card'));const rows=Array.from(document.querySelectorAll('.occasion-config-row'));const actions=Array.from(document.querySelectorAll('.occasion-config-actions button'));const first=cards[0]?.getBoundingClientRect();const second=cards[1]?.getBoundingClientRect();return{width:innerWidth,headings:cards.map(card=>card.querySelector('h4')?.textContent?.trim()),cardCount:cards.length,rowCount:rows.length,columns:getComputedStyle(grid).gridTemplateColumns,twoPanel:first&&second?Math.abs(first.top-second.top)<2&&second.left>first.left:false,singlePanel:first&&second?second.top>first.bottom:false,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,rootOverflow:root.scrollWidth>root.clientWidth+1,minActionHeight:Math.min(...actions.map(node=>Math.round(node.getBoundingClientRect().height))),goldCards:cards.every(card=>getComputedStyle(card).borderColor==='rgb(222, 197, 143)'),ivorySurface:getComputedStyle(root).backgroundColor==='rgb(255, 253, 248)',protectedCount:root.querySelectorAll('.config-protected-state').length,swatches:root.querySelectorAll('.occasion-config-swatch').length}})()`)
    assert.deepEqual(result.headings, ['Guest Types', 'Workflow'])
    const resultMessage = `Guest Experience customization at ${width}px: ${JSON.stringify(result)}`
    assert.equal(result.cardCount, 2, resultMessage); assert.ok(result.rowCount >= 10, resultMessage); assert.equal(result.pageOverflow, false, resultMessage); assert.equal(result.rootOverflow, false, resultMessage); assert.equal(result.goldCards, true, resultMessage); assert.equal(result.ivorySurface, true, resultMessage); assert.ok(result.protectedCount >= 10, resultMessage); assert.equal(result.swatches, result.rowCount, resultMessage)
    if (width > 1024) assert.equal(result.twoPanel, true, `Expected desktop two-panel layout at ${width}px: ${JSON.stringify(result)}`)
    else assert.equal(result.singlePanel, true, `Expected responsive single-column layout at ${width}px: ${JSON.stringify(result)}`)
    if (width <= 430) assert.ok(result.minActionHeight >= 44)
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true })
    await writeFile(join(output, `guest-experience-customization-${width}.png`), Buffer.from(screenshot.data, 'base64'))
    customizationResults.push(result)
  }
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('.occasion-config-row.protected button')).find(node=>node.textContent?.includes('Edit Color'));if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 20; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.guest-config-modal')`)) break; await sleep(50) }
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const modal=document.querySelector('.guest-config-modal');const input=modal?.querySelector('input[type=color]');if(!input)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;setter?.call(input,'#123456');input.dispatchEvent(new Event('input',{bubbles:true}));window.confirm=()=>false;document.querySelector('.modal-backdrop')?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));return true})()`), true)
  await sleep(80); assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.guest-config-modal')`), true)
  await cdp.evaluate(`window.confirm=()=>true;window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`)
  for (let attempt = 0; attempt < 20; attempt++) { if (await cdp.evaluate<boolean>(`!document.querySelector('.guest-config-modal')`)) break; await sleep(50) }
  assert.equal(await cdp.evaluate<boolean>(`!document.querySelector('.guest-config-modal')`), true)
  assert.deepEqual(cdp.errors, [])
  console.log(JSON.stringify({ status: 'PASS', isolated: true, sevenProtectedTypesRendered: true, distinctAttentionAndOccasionSections: true, sourceColumnHiddenFromDesktopTable: true, attentionViewColumnRemoved: true, attentionGuestNamesOpenDetails: true, allergyAndTlcRendered: true, occasionPlusAttentionGuestValidated: true, exactDietaryEvidencePreserved: true, longOccasionPillsReadable: true, mobileDateHeaderResponsive: true, dateNavigationAndPickerFunctional: true, addManualAccessible: true, managerEditRefreshPersistence: true, completionRefreshPersistence: true, approvedOccasionDetailsPreserved: true, technicalMetadataHidden: true, actionsAccessible: true, allRequestedWidths: true, guestExperienceCustomization: { responsive: true, protectedTypesRetained: true, safeDismissal: true, results: customizationResults }, screenshots: ['artifacts/guest-occasions-mobile-tab-fix/guest-experience-customization-1440.png', 'artifacts/guest-occasions-mobile-tab-fix/guest-experience-customization-390.png'], results, consoleErrors: cdp.errors, canonicalDatabaseTouched: false }, null, 2))
} finally {
  socket?.close()
  for (const child of processes.reverse()) { if (child.exitCode === null) child.kill(); child.removeAllListeners(); child.unref() }
  await sleep(1000)
  await rm(fixture.root, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(() => undefined)
}
