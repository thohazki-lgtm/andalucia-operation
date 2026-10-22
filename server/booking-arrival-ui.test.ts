import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { BookingImportPreviewRecord, BookingRecord } from '../src/domain.js'
import { BookingRepository } from './booking-repository.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const fixture = await createDisposableDevelopmentStore('booking-arrival-ui')
const profile = join(fixture.root, 'edge-profile')
const processes: ChildProcess[] = []
let socket: WebSocket | null = null
const token = `booking-arrival-ui-${randomUUID()}`
const visualPhase = process.env.ANDALUCIA_STAGE4B_VISUAL_PHASE || 'after'
const output = resolve('artifacts', 'stage4b-action-system')
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))
const waitFor = async (url: string) => { for (let attempt = 0; attempt < 100; attempt++) { try { if ((await fetch(url)).ok) return } catch {} await sleep(200) } throw new Error(`Timed out waiting for ${url}`) }

class Cdp {
  private id = 0
  private pending = new Map<number, { resolve: (value: any) => void; reject: (reason: unknown) => void }>()
  readonly errors: string[] = []
  deniedGuestOccasionRequests = 0
  denyGuestOccasionRequests = true
  constructor(private ws: WebSocket) { ws.onmessage = event => { const message = JSON.parse(String(event.data)); if (message.id) { const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result) } else if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || 'Runtime exception'); else if (message.method === 'Fetch.requestPaused') { if (this.denyGuestOccasionRequests) { this.deniedGuestOccasionRequests += 1; void this.send('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 403, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ message: 'Permission manage_guest_occasions is required.' })).toString('base64') }) } else void this.send('Fetch.continueRequest', { requestId: message.params.requestId }) } } }
  send(method: string, params: Record<string, unknown> = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise<any>((resolveCall, rejectCall) => this.pending.set(id, { resolve: resolveCall, reject: rejectCall })) }
  evaluate<T>(expression: string) { return this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then(result => result.result.value as T) }
}

const record = (id: string, name: string, status: string, time: string): BookingRecord => ({ id, guestName: name, roomNumber: '501', birthDate: null, arrivalDate: null, departureDate: null, mealPeriod: 'Dinner', reservationDate: '2026-10-15', reservationTime: time, bookingNumber: `UI-${time.replace(':', '')}`, covers: 2, bookingStatus: status, bookingSource: 'manual', bookedBy: 'UI fixture', guestNotes: '', tableNumber: '', waiterId: null, waiter: null })

try {
  const owner = (await fixture.db.query<any>("select u.id from user_accounts u join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.active=true where u.status='active' and r.role_key='owner' limit 1")).rows[0]
  assert.ok(owner)
  await fixture.db.query("insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval '1 hour')", [randomUUID(), createHash('sha256').update(token).digest('hex'), owner.id])
  const repository = new BookingRepository(fixture.db)
  await repository.initialize()
  const assignmentWaiterId = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date,created_by,updated_by) values($1,'B2-W25','Alexandra Noor','Waiter','active','2026-01-01','B2.2 isolated visual test','B2.2 isolated visual test')", [assignmentWaiterId])
  const confirmed = await repository.save({ ...record(randomUUID(), 'Confirmed Guest', 'confirmed', '18:00'), bookingNumber: '', bookingSource: 'walk_in' }, 'UI Test Manager')
  await repository.save(record(randomUUID(), 'Waiting Guest', 'waiting', '18:15'), 'UI Test Manager')
  const arrivalBase = await repository.save(record(randomUUID(), 'Arrived Guest', 'confirmed', '18:30'), 'UI Test Manager')
  await repository.save({ ...arrivalBase, bookingStatus: 'arrived' }, 'UI Test Manager')
  await fixture.db.query("update audit_logs set created_at='2026-10-15T13:12:35.000Z' where entity_type='booking' and entity_id=$1 and after_data->>'bookingStatus'='arrived'", [arrivalBase.id])
  await repository.save(record(randomUUID(), 'No Show Guest', 'no_show', '19:00'), 'UI Test Manager')
  const celebration: BookingImportPreviewRecord = { venue: 'andalucia', reservationDate: '2026-10-15', reservationTime: '19:30', serviceEndTime: '21:30', serviceKind: 'celebration', bookingNumber: '2738768', primaryGuest: 'Ritu Celebration Fixture', rooms: ['718', '719', '720'], covers: 6, sourceStatus: 'Confirmed', bookedBy: 'Test Agent With A Long Operational Name', sourceNotes: 'Birthday celebration for Ritu with a detailed source note that must wrap safely. Nut allergy.', activityLabel: 'Celebration @ Andalucia', walkIn: false, guestMembers: [
    { guestName: 'Ritu Celebration Fixture', roomNumber: '718', accommodationCode: '', birthDate: null, arrivalDate: null, departureDate: null, mealPlan: 'AI', guestNotes: 'Birthday celebration for Ritu. Nut allergy.', sourceRowOrder: 1 },
    { guestName: 'Alexandra Long-Name Companion', roomNumber: '718', accommodationCode: 'DBL', birthDate: '1988-04-12', arrivalDate: '2026-10-14', departureDate: '2026-10-22', mealPlan: 'AI', guestNotes: 'Vegetarian meal preference.', sourceRowOrder: 2 },
    { guestName: 'Mohamed Abdul Rahman Al-Siyam', roomNumber: '719', accommodationCode: 'DBL', birthDate: '1979-11-02', arrivalDate: '2026-10-14', departureDate: '2026-10-22', mealPlan: 'AI', guestNotes: 'Linked family guest.', sourceRowOrder: 3 },
    { guestName: 'Leila Noor', roomNumber: '719', accommodationCode: 'DBL', birthDate: '2014-06-18', arrivalDate: '2026-10-14', departureDate: '2026-10-22', mealPlan: 'AI', guestNotes: 'Child guest.', sourceRowOrder: 4 },
    { guestName: 'Christopher Montgomery', roomNumber: '720', accommodationCode: 'TWN', birthDate: '1991-09-25', arrivalDate: '2026-10-15', departureDate: '2026-10-23', mealPlan: 'AI', guestNotes: 'Late departure requested.', sourceRowOrder: 5 },
    { guestName: 'Isabella María Fernández', roomNumber: '720', accommodationCode: 'TWN', birthDate: '1993-01-07', arrivalDate: '2026-10-15', departureDate: '2026-10-23', mealPlan: 'AI', guestNotes: 'No additional notes.', sourceRowOrder: 6 }
  ], warnings: [], readiness: 'READY' }
  const celebrationPreview = await repository.prepareImportPreview({ fileName: 'celebration-fixture.pdf', fileHash: 'd'.repeat(64), reportDate: '2026-10-15', parserVersion: 'ui-fixture', summary: { bookingGroups: 1, totalCovers: 6, confirmed: 1, pending: 0, warnings: 0, possibleDuplicates: 0 }, validation: { declaredBookingGroups: 1, declaredCovers: 6, reconciled: true, messages: [] }, bookings: [celebration] }, 'UI Test Manager')
  assert.equal((await repository.confirmImport(celebrationPreview.batchId, [0], [], 'UI Test Manager')).importedBookings, 1)
  const celebrationBooking = (await fixture.db.query<any>("select id from bookings where booking_number='2738768' limit 1")).rows[0]
  assert.ok(celebrationBooking)
  for (const [occasionType, sourceText] of [['birthday', 'Birthday celebration for Ritu'], ['famtrip', 'Famtrip guest recognition']]) {
    await fixture.db.query("insert into guest_occasions(id,booking_id,occasion_type,status_value,source,source_text,notes,manual_guest_name,manual_room_number,occasion_date,occasion_time,active,created_by,updated_by) values($1,$2,$3,'attention','booking_intelligence',$4,'','Ritu Celebration Fixture','718','2026-10-15','19:30',true,'UI Test Manager','UI Test Manager') on conflict do nothing", [randomUUID(), celebrationBooking.id, occasionType, sourceText])
  }
  const linkedPartyBooking = (count: number, time: string): BookingImportPreviewRecord => ({
    ...celebration,
    reservationDate: '2026-10-16',
    reservationTime: time,
    serviceEndTime: null,
    serviceKind: 'dinner',
    bookingNumber: `B2-PARTY-${count}`,
    primaryGuest: `${count} Member Party`,
    rooms: [`P${count}1`],
    covers: count,
    sourceNotes: `${count} linked member layout fixture`,
    activityLabel: 'Dinner',
    guestMembers: Array.from({ length: count }, (_, index) => ({ guestName: `Party ${count} Guest ${index + 1}`, roomNumber: `P${count}${index + 1}`, accommodationCode: index % 2 ? 'DBL' : '', birthDate: null, arrivalDate: '2026-10-16', departureDate: '2026-10-20', mealPlan: 'AI', guestNotes: index === count - 1 ? 'Final linked guest note.' : '', sourceRowOrder: index + 1 }))
  })
  const cardinalityPreview = await repository.prepareImportPreview({ fileName: 'linked-party-cardinality.pdf', fileHash: 'e'.repeat(64), reportDate: '2026-10-16', parserVersion: 'ui-fixture', summary: { bookingGroups: 2, totalCovers: 4, confirmed: 2, pending: 0, warnings: 0, possibleDuplicates: 0 }, validation: { declaredBookingGroups: 2, declaredCovers: 4, reconciled: true, messages: [] }, bookings: [linkedPartyBooking(1, '18:00'), linkedPartyBooking(3, '18:30')] }, 'UI Test Manager')
  assert.equal((await repository.confirmImport(cardinalityPreview.batchId, [0, 1], [], 'UI Test Manager')).importedBookings, 2)
  assert.equal(confirmed.bookingStatus, 'confirmed')
  await fixture.db.close()

  const node = process.execPath
  processes.push(spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '026', API_PORT: '3012', APP_ORIGIN: 'http://127.0.0.1:5182' }, stdio: 'ignore' }))
  processes.push(spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5182', '--strictPort'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3012' }, stdio: 'ignore' }))
  await Promise.all([waitFor('http://127.0.0.1:3012/api/health'), waitFor('http://127.0.0.1:5182/')])

  const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--edge-skip-compat-layer-relaunch', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' }); processes.push(edge)
  let debugPort = 0
  const activePort = join(profile, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 200; attempt++) { try { const [line] = (await readFile(activePort, 'utf8')).trim().split(/\r?\n/); debugPort = Number(line); if (debugPort > 0 && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) break } catch {} await sleep(100) }
  assert.ok(debugPort)
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json() as any[]
  const page = pages.find(item => item.type === 'page'); assert.ok(page)
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise<void>((done, fail) => { socket!.onopen = () => done(); socket!.onerror = () => fail(new Error('CDP connection failed')) })
  const cdp = new Cdp(socket)
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Network.enable'); await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*api/guest-occasions*', requestStage: 'Request' }] })
  assert.equal((await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5182/', path: '/', httpOnly: true, sameSite: 'Strict' })).success, true)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5182/' })
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Bookings"]')`)) break; await sleep(150) }
  await cdp.evaluate(`document.querySelector('button[aria-label="Bookings"]')?.click()`)
  for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('input[aria-label="Booking date"]')`)) break; await sleep(100) }
  for (let attempt = 0; attempt < 80; attempt++) { if (!(await cdp.evaluate<boolean>(`document.body.innerText.includes('Loading dinner service')`))) break; await sleep(100) }
  await cdp.evaluate(`(()=>{const input=document.querySelector('input[aria-label="Booking date"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'2026-10-15');input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  for (let attempt = 0; attempt < 80; attempt++) { if ((await cdp.evaluate<number>(`document.querySelectorAll('.service-table tbody tr').length`)) === 5) break; await sleep(100) }
  assert.ok(cdp.deniedGuestOccasionRequests > 0)
  assert.equal(await cdp.evaluate<boolean>(`document.body.textContent.includes('Permission manage_guest_occasions is required.')`), false)
  cdp.denyGuestOccasionRequests = false
  await cdp.evaluate(`(()=>{const input=document.querySelector('input[aria-label="Booking date"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'2026-10-14');input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await sleep(150)
  await cdp.evaluate(`(()=>{const input=document.querySelector('input[aria-label="Booking date"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'2026-10-15');input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  for (let attempt = 0; attempt < 80; attempt++) { if ((await cdp.evaluate<number>(`document.querySelectorAll('.service-table tbody tr').length`)) === 5) break; await sleep(100) }
  const desktop = await cdp.evaluate<any>(`(()=>{const rows=Array.from(document.querySelectorAll('.service-table tbody tr'));const measure=row=>{const cell=row.querySelector('.service-status-cell');const controls=cell.querySelector('.service-status-controls');const select=cell.querySelector('.service-status-select');const field=cell.querySelector('.booking-status-field');const rr=row.getBoundingClientRect(),sr=cell.getBoundingClientRect(),cr=controls.getBoundingClientRect(),buttons=Array.from(cell.querySelectorAll('.service-actions button')).map(button=>button.getBoundingClientRect()),widths=buttons.map(rect=>rect.width),style=getComputedStyle(select);return{status:select.value,textAlign:style.textAlign,textAlignLast:style.textAlignLast,centeredInRow:Math.abs((rr.top+rr.bottom-cr.top-cr.bottom)/2)<1,cellMatchesRow:Math.abs(rr.top-sr.top)<1&&Math.abs(rr.bottom-sr.bottom)<1,buttons:buttons.length,buttonsAligned:buttons.every(rect=>Math.abs(rect.top-buttons[0].top)<1),buttonsEqual:widths.length<2||Math.max(...widths)-Math.min(...widths)<1,selectBackground:style.backgroundColor,selectColor:style.color,selectRadius:style.borderRadius,statusIcons:field?.querySelectorAll('.ao-icon').length||0,clipped:buttons.some(rect=>rect.left<sr.left-1||rect.right>sr.right+1)}};const dateInput=document.querySelector('input[aria-label="Booking date"]');const assignmentSelects=Array.from(document.querySelectorAll('.service-table .booking-assignment-select')).map(select=>{const rect=select.getBoundingClientRect(),style=getComputedStyle(select);return{height:rect.height,radius:style.borderRadius,background:style.backgroundColor,color:style.color,clipped:select.scrollWidth>select.clientWidth+1}});return{rows:rows.map(measure),assignmentSelects,uploadLabel:document.querySelector('.booking-command .upload-action .ao-action__label')?.textContent?.trim(),dateInputType:dateInput?.type,hasTodayServiceText:document.body.textContent.includes("Today's dinner service"),pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
  assert.deepEqual(desktop.rows.map((row: any) => row.status), ['confirmed', 'waiting', 'arrived', 'no_show', 'confirmed'])
  assert.ok(desktop.rows.every((row: any) => row.textAlign === 'center' && row.textAlignLast === 'center' && row.centeredInRow && row.cellMatchesRow && !row.clipped))
  assert.deepEqual(desktop.rows.map((row: any) => row.buttons), [3, 2, 0, 0, 3])
  assert.ok(desktop.rows.every((row: any) => row.buttonsAligned && row.buttonsEqual && row.selectRadius === '8px'))
  assert.deepEqual(desktop.rows.map((row: any) => row.selectBackground), ['rgb(255, 255, 255)', 'rgb(255, 255, 255)', 'rgb(223, 242, 231)', 'rgb(253, 228, 225)', 'rgb(255, 255, 255)'])
  assert.deepEqual(desktop.rows.map((row: any) => row.statusIcons), [0, 0, 1, 1, 0])
  assert.equal(desktop.uploadLabel, 'Upload Booking')
  assert.ok(desktop.assignmentSelects.every((select: any) => select.height === 38 && select.radius === '8px' && select.background === 'rgb(255, 250, 240)' && select.color === 'rgb(119, 91, 34)' && !select.clipped))
  assert.equal(desktop.dateInputType, 'date')
  assert.equal(desktop.hasTodayServiceText, false)
  assert.equal(desktop.pageOverflow, false)
  const rowHighlights = await cdp.evaluate<any>(`(()=>{const rows=Array.from(document.querySelectorAll('.service-table tbody tr'));const inspect=status=>{const row=rows.find(item=>item.querySelector('.service-status-select')?.value===status);const cells=Array.from(row?.children||[]);return{backgrounds:[...new Set(cells.map(cell=>getComputedStyle(cell).backgroundColor))],leftAccent:cells[0]?getComputedStyle(cells[0]).boxShadow:''}};return{confirmed:inspect('confirmed'),waiting:inspect('waiting'),arrived:inspect('arrived'),noShow:inspect('no_show')}})()`)
  assert.deepEqual(rowHighlights.confirmed.backgrounds, ['rgb(255, 255, 255)'])
  assert.deepEqual(rowHighlights.waiting.backgrounds, ['rgb(255, 255, 255)'])
  assert.deepEqual(rowHighlights.arrived.backgrounds, ['rgb(233, 247, 239)'])
  assert.match(rowHighlights.arrived.leftAccent, /rgb\(47, 118, 86\)/)
  assert.deepEqual(rowHighlights.noShow.backgrounds, ['rgb(255, 240, 237)'])
  assert.match(rowHighlights.noShow.leftAccent, /rgb\(169, 71, 64\)/)
  const desktopTypography = await cdp.evaluate<any>(`(()=>{const summary=document.querySelector('.service-summary .panel');const firstTable=document.querySelector('.service-table');const headerCells=Array.from(firstTable.querySelectorAll('thead th'));const bodyCells=Array.from(firstTable.querySelector('tbody tr')?.children||[]);const headerRects=headerCells.map(node=>node.getBoundingClientRect());const bodyRects=bodyCells.map(node=>node.getBoundingClientRect());const drift=Math.max(...headerRects.map((rect,index)=>Math.max(Math.abs(rect.left-bodyRects[index].left),Math.abs(rect.width-bodyRects[index].width))));const style=node=>getComputedStyle(node);return{hasVisibleServiceDateLabel:!!document.querySelector('.booking-command label'),summaryLabel:style(summary.querySelector('span')).fontSize,summaryMetric:style(summary.querySelector('strong')).fontSize,summaryDetailDisplay:style(summary.querySelector('small')).display,header:style(headerCells[0]).fontSize,headerWeight:style(headerCells[0]).fontWeight,guest:style(firstTable.querySelector('.service-guest b')).fontSize,time:style(firstTable.querySelector('.service-time b')).fontSize,room:style(firstTable.querySelector('.service-room b')).fontSize,covers:style(firstTable.querySelector('.service-covers b')).fontSize,maxColumnDrift:drift}})()`)
  assert.deepEqual(desktopTypography, { hasVisibleServiceDateLabel: false, summaryLabel: '11px', summaryMetric: '26px', summaryDetailDisplay: 'none', header: '11px', headerWeight: '700', guest: '13px', time: '12px', room: '12px', covers: '15px', maxColumnDrift: 0 })
  assert.deepEqual(await cdp.evaluate<any>(`(()=>{const row=Array.from(document.querySelectorAll('.service-table tbody tr')).find(item=>item.textContent?.includes('Confirmed Guest'));const badge=row?.querySelector('.booking-walk-in-badge');return{text:badge?.textContent?.trim(),noBookingNumber:row?.textContent?.includes('No booking number'),sourceIdentityPreserved:!row?.textContent?.includes('UI-1800')}})()`), { text: 'Walk-In', noBookingNumber: false, sourceIdentityPreserved: true })
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const imported=Array.from(document.querySelectorAll('.service-table tbody tr')).find(item=>item.textContent?.includes('2738768'));return !!imported&&!imported.querySelector('.booking-walk-in-badge')})()`), true)
  assert.deepEqual(await cdp.evaluate<any>(`(()=>{const group=document.querySelector('.celebration-time-group');return{groups:document.querySelectorAll('.celebration-time-group').length,header:group?.querySelector('.time-group-header strong')?.textContent?.trim(),rows:group?.querySelectorAll('tbody tr').length,mobileCards:group?.querySelectorAll('.mobile-operation-card').length}})()`), { groups: 1, header: '19:30–21:30 · Celebration @ Andalucía', rows: 1, mobileCards: 1 })
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1400, deviceScaleFactor: 1, mobile: false })
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const row=Array.from(document.querySelectorAll('.service-table tbody tr')).find(item=>item.textContent?.includes('2738768'));const button=row?.querySelector('.booking-guest-trigger');if(!button)return false;button.focus();button.click();return true})()`), true)
  for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.booking-detail-drawer')`)) break; await sleep(100) }
  for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`document.querySelector('.booking-detail-drawer')?.textContent?.toLowerCase().includes('linked guest members')`)) break; await sleep(100) }
  const celebrationDetails = await cdp.evaluate<any>(`(()=>{const drawer=document.querySelector('.booking-detail-drawer');const rect=drawer?.getBoundingClientRect();const members=document.querySelector('.booking-detail-drawer .guest-member-table');const memberTable=members?.querySelector('table');const text=drawer?.textContent||'';const pills=Array.from(drawer?.querySelectorAll('.booking-info-pill')||[]);return{hasGuest:text.includes('Ritu Celebration Fixture'),hasRange:text.includes('19:30–21:30'),hasSourceInformation:text.includes('SOURCE INFORMATION'),hasMembers:text.toLowerCase().includes('linked guest members'),memberCount:members?.querySelectorAll('tbody tr').length||0,hasAllergy:text.includes('ALLERGIES / DIETARY ALERTS')&&text.toLowerCase().includes('nut'),technicalLabels:['Source file','Report / parser','Import provenance','Created','Updated'].filter(label=>text.includes(label)),drawerClipped:rect?rect.left<0||rect.right>innerWidth+1:true,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,drawerWidth:rect?.width||0,drawerClientWidth:drawer?.clientWidth||0,drawerScrollWidth:drawer?.scrollWidth||0,memberViewportWidth:members?.clientWidth||0,memberScrollWidth:members?.scrollWidth||0,memberTableWidth:memberTable?.getBoundingClientRect().width||0,hasVisibleClose:!!drawer?.querySelector('.close'),drawerFocused:document.activeElement===drawer,pills:pills.map(pill=>({tag:pill.tagName,text:pill.textContent?.trim(),clipped:pill.scrollWidth>pill.clientWidth+1}))}})()`)
  assert.deepEqual({ ...celebrationDetails, drawerWidth: undefined, drawerClientWidth: undefined, drawerScrollWidth: undefined, memberViewportWidth: undefined, memberScrollWidth: undefined, memberTableWidth: undefined, pills: undefined }, { hasGuest: true, hasRange: true, hasSourceInformation: true, hasMembers: true, memberCount: 6, hasAllergy: true, technicalLabels: [], drawerClipped: false, pageOverflow: false, hasVisibleClose: false, drawerFocused: true, drawerWidth: undefined, drawerClientWidth: undefined, drawerScrollWidth: undefined, memberViewportWidth: undefined, memberScrollWidth: undefined, memberTableWidth: undefined, pills: undefined })
  assert.ok(celebrationDetails.pills.some((pill: any) => pill.text.includes('Birthday')))
  assert.ok(celebrationDetails.pills.some((pill: any) => pill.text.toLowerCase().includes('nut')))
  assert.ok(celebrationDetails.pills.every((pill: any) => pill.tag === 'SPAN' && !pill.clipped))
  const desktopDetailsRect = await cdp.evaluate<any>(`(()=>{const rect=document.querySelector('.booking-detail-drawer')?.getBoundingClientRect();return rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null})()`)
  assert.ok(desktopDetailsRect)
  const desktopDetailsShot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { ...desktopDetailsRect, scale: 1 } })
  await mkdir(output, { recursive: true })
  await writeFile(join(output, `bookings-${visualPhase}-details-desktop.png`), Buffer.from(desktopDetailsShot.data, 'base64'))
  const detailsResponsive: Array<Record<string, unknown>> = []
  for (const viewport of [
    { width: 1280, height: 1000, mobile: false },
    { width: 1024, height: 1000, mobile: false },
    { width: 768, height: 1000, mobile: false },
    { width: 430, height: 932, mobile: true },
    { width: 390, height: 844, mobile: true },
    { width: 360, height: 800, mobile: true }
  ]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1 })
    await sleep(80)
    const state = await cdp.evaluate<any>(`(()=>{const drawer=document.querySelector('.booking-detail-drawer');const rect=drawer?.getBoundingClientRect();const table=drawer?.querySelector('.booking-members-table');const cards=Array.from(drawer?.querySelectorAll('.booking-member-cards>article')||[]).filter(card=>card.getBoundingClientRect().width>0);const edit=drawer?.querySelector('.booking-detail-actions .ao-action');const verticalScrollers=[drawer,...Array.from(drawer?.querySelectorAll('*')||[])].filter(node=>['auto','scroll'].includes(getComputedStyle(node).overflowY));return{drawerWidth:rect?.width||0,drawerOverflow:(drawer?.scrollWidth||0)-(drawer?.clientWidth||0),pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,tableVisible:table?table.getBoundingClientRect().width>0:false,memberCards:cards.length,cardOverflow:cards.filter(card=>card.scrollWidth>card.clientWidth+1).length,editHeight:edit?.getBoundingClientRect().height||0,verticalScrollers:verticalScrollers.length}})()`)
    assert.equal(state.drawerOverflow, 0, `Booking Details internal horizontal overflow at ${viewport.width}px`)
    assert.equal(state.pageOverflow, false, `Booking Details page overflow at ${viewport.width}px`)
    assert.equal(state.cardOverflow, 0, `Booking member card overflow at ${viewport.width}px`)
    assert.equal(state.verticalScrollers, 1, `Booking Details must have one vertical scrolling region at ${viewport.width}px`)
    if (viewport.width <= 700) { assert.equal(state.drawerWidth, viewport.width); assert.equal(state.tableVisible, false); assert.equal(state.memberCards, 6); assert.ok(state.editHeight >= 44) } else { assert.equal(state.tableVisible, true); assert.equal(state.memberCards, 0) }
    detailsResponsive.push({ width: viewport.width, ...state })
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 2800, deviceScaleFactor: 1, mobile: true })
  await sleep(150)
  const mobileDetails = await cdp.evaluate<any>(`(()=>{const drawer=document.querySelector('.booking-detail-drawer');const rect=drawer?.getBoundingClientRect();const table=drawer?.querySelector('.booking-members-table');const cards=Array.from(drawer?.querySelectorAll('.booking-member-cards>article')||[]).filter(card=>card.getBoundingClientRect().width>0);return{drawerWidth:rect?.width||0,drawerClientWidth:drawer?.clientWidth||0,drawerScrollWidth:drawer?.scrollWidth||0,memberCards:cards.length,memberTableVisible:table?table.getBoundingClientRect().width>0:false,cardOverflow:cards.filter(card=>card.scrollWidth>card.clientWidth+1).length,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
  const mobileDetailsRect = await cdp.evaluate<any>(`(()=>{const rect=document.querySelector('.booking-detail-drawer')?.getBoundingClientRect();return rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null})()`)
  assert.ok(mobileDetailsRect)
  const mobileDetailsShot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { ...mobileDetailsRect, scale: 1 } })
  await writeFile(join(output, `bookings-${visualPhase}-details-mobile-390.png`), Buffer.from(mobileDetailsShot.data, 'base64'))
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1400, deviceScaleFactor: 1, mobile: false })
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const drawer=document.querySelector('.booking-detail-drawer');drawer?.dispatchEvent(new MouseEvent('click',{bubbles:true}));return !!document.querySelector('.booking-detail-drawer')})()`), true)
  await cdp.evaluate(`document.querySelector('.booking-drawer-backdrop')?.dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  for (let attempt = 0; attempt < 20; attempt++) { if (!(await cdp.evaluate<boolean>(`!!document.querySelector('.booking-detail-drawer')`))) break; await sleep(50) }
  assert.equal(await cdp.evaluate<boolean>(`document.activeElement?.textContent?.includes('Ritu Celebration Fixture')`), true)
  await cdp.evaluate(`(()=>{const input=document.querySelector('input[aria-label="Booking date"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'2026-10-16');input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  for (let attempt = 0; attempt < 80; attempt++) { if ((await cdp.evaluate<number>(`document.querySelectorAll('.service-table tbody tr').length`)) === 2) break; await sleep(100) }
  const memberCardinality: number[] = []
  for (const expected of [1, 3]) {
    assert.equal(await cdp.evaluate<boolean>(`(()=>{const row=Array.from(document.querySelectorAll('.service-table tbody tr')).find(item=>item.textContent?.includes('B2-PARTY-${expected}'));const button=row?.querySelector('.booking-guest-trigger');if(!button)return false;button.click();return true})()`), true)
    for (let attempt = 0; attempt < 40; attempt++) { if ((await cdp.evaluate<number>(`document.querySelectorAll('.booking-detail-drawer .booking-members-table tbody tr').length`)) === expected) break; await sleep(100) }
    const count = await cdp.evaluate<number>(`document.querySelectorAll('.booking-detail-drawer .booking-members-table tbody tr').length`)
    assert.equal(count, expected)
    memberCardinality.push(count)
    await cdp.evaluate(`document.querySelector('.booking-drawer-backdrop')?.dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
    for (let attempt = 0; attempt < 20; attempt++) { if (!(await cdp.evaluate<boolean>(`!!document.querySelector('.booking-detail-drawer')`))) break; await sleep(50) }
  }
  await cdp.evaluate(`(()=>{const input=document.querySelector('input[aria-label="Booking date"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'2026-10-15');input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  for (let attempt = 0; attempt < 80; attempt++) { if ((await cdp.evaluate<number>(`document.querySelectorAll('.service-table tbody tr').length`)) === 5) break; await sleep(100) }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await mkdir(output, { recursive: true })
  const desktopShot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(output, `bookings-${visualPhase}-desktop.png`), Buffer.from(desktopShot.data, 'base64'))
  const desktopToolbarRect = await cdp.evaluate<any>(`(()=>{const rect=document.querySelector('.booking-command')?.getBoundingClientRect();return rect?{x:Math.max(0,rect.x-4+scrollX),y:Math.max(0,rect.y-4+scrollY),width:Math.min(document.documentElement.scrollWidth,rect.width+8),height:rect.height+8}:null})()`)
  assert.ok(desktopToolbarRect)
  const desktopToolbarShot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { ...desktopToolbarRect, scale: 1 } })
  await writeFile(join(output, `bookings-${visualPhase}-toolbar-desktop.png`), Buffer.from(desktopToolbarShot.data, 'base64'))

  assert.equal(await cdp.evaluate<boolean>(`(()=>{const row=Array.from(document.querySelectorAll('.service-table tbody tr')).find(item=>item.textContent?.includes('2738768'));const button=row?.querySelector('.booking-guest-trigger');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.booking-detail-drawer')`)) break; await sleep(100) }
  await cdp.evaluate(`document.querySelector('.booking-detail-actions .ao-action')?.click()`)
  for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`document.querySelector('.booking-form[aria-label]')||Array.from(document.querySelectorAll('.modal h2')).some(node=>node.textContent==='Edit Booking')`)) break; await sleep(100) }
  const chosenAssignment = await cdp.evaluate<any>(`(()=>{const form=document.querySelector('.booking-form');const labels=Array.from(form?.querySelectorAll('label')||[]);const selectFor=text=>labels.find(label=>label.firstChild?.textContent?.trim()===text)?.querySelector('select');const table=selectFor('Table number');const waiter=selectFor('Waiter');const tableOption=Array.from(table?.options||[]).find(option=>option.textContent?.includes('25'))||Array.from(table?.options||[]).find(option=>option.value);const waiterOption=Array.from(waiter?.options||[]).find(option=>option.value&&!option.disabled);const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;if(table&&tableOption){setter.call(table,tableOption.value);table.dispatchEvent(new Event('change',{bubbles:true}))}if(waiter&&waiterOption){setter.call(waiter,waiterOption.value);waiter.dispatchEvent(new Event('change',{bubbles:true}))}const notes=labels.find(label=>label.firstChild?.textContent?.trim()==='Guest notes')?.querySelector('textarea');const textSetter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;if(notes){textSetter.call(notes,'B2.2 disposable persistence check');notes.dispatchEvent(new Event('input',{bubbles:true}));notes.dispatchEvent(new Event('change',{bubbles:true}))}return{table:tableOption?.textContent?.trim(),waiter:waiterOption?.textContent?.trim()}})()`)
  assert.ok(chosenAssignment.table)
  assert.ok(chosenAssignment.waiter)
  await cdp.evaluate(`Array.from(document.querySelectorAll('.booking-form .ao-action')).find(button=>button.textContent?.includes('Save booking'))?.click()`)
  for (let attempt = 0; attempt < 50; attempt++) { if (!(await cdp.evaluate<boolean>(`!!document.querySelector('.booking-form')`))) break; await sleep(100) }
  await cdp.evaluate(`(()=>{const input=document.querySelector('input[aria-label="Booking date"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'2026-10-14');input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await sleep(120)
  await cdp.evaluate(`(()=>{const input=document.querySelector('input[aria-label="Booking date"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'2026-10-15');input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  for (let attempt = 0; attempt < 80; attempt++) { if ((await cdp.evaluate<number>(`document.querySelectorAll('.service-table tbody tr').length`)) === 5) break; await sleep(100) }
  const persistedAssignment = await cdp.evaluate<any>(`(()=>{const row=Array.from(document.querySelectorAll('.service-table tbody tr')).find(item=>item.textContent?.includes('2738768'));const selects=Array.from(row?.querySelectorAll('.booking-assignment-select')||[]);return{table:selects[0]?.selectedOptions[0]?.textContent?.trim(),waiter:selects[1]?.selectedOptions[0]?.textContent?.trim(),clipped:selects.some(select=>select.scrollWidth>select.clientWidth+1)}})()`)
  assert.equal(persistedAssignment.table, chosenAssignment.table)
  assert.ok(chosenAssignment.waiter.startsWith(persistedAssignment.waiter))
  assert.equal(persistedAssignment.clipped, false)
  const selectorClip = await cdp.evaluate<any>(`(()=>{const row=Array.from(document.querySelectorAll('.service-table tbody tr')).find(item=>item.textContent?.includes('2738768'));const first=row?.children[6]?.getBoundingClientRect();const last=row?.children[8]?.getBoundingClientRect();return first&&last?{x:first.left-5,y:first.top-5,width:last.right-first.left+10,height:first.height+10}:null})()`)
  assert.ok(selectorClip)
  await cdp.evaluate(`(()=>{const style=document.createElement('style');style.id='b2-2-selector-baseline';style.textContent='.service-table th:nth-child(7){width:80px!important}.service-table th:nth-child(8){width:95px!important}.service-table th:nth-child(9){width:212px!important}';document.head.appendChild(style)})()`)
  const beforeSelectorsShot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { ...selectorClip, scale: 1 } })
  await writeFile(join(output, 'bookings-bookings-b2-2-before-selectors-desktop.png'), Buffer.from(beforeSelectorsShot.data, 'base64'))
  await cdp.evaluate(`document.querySelector('#b2-2-selector-baseline')?.remove()`)
  const afterSelectorsShot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { ...selectorClip, scale: 1 } })
  await writeFile(join(output, `bookings-${visualPhase}-selectors-desktop.png`), Buffer.from(afterSelectorsShot.data, 'base64'))
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const row=Array.from(document.querySelectorAll('.service-table tbody tr')).find(item=>item.textContent?.includes('2738768'));const button=row?.querySelector('.booking-guest-trigger');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`document.querySelector('.booking-detail-drawer')?.textContent?.includes('B2.2 disposable persistence check')`)) break; await sleep(100) }
  assert.equal(await cdp.evaluate<boolean>(`document.querySelector('.booking-detail-drawer')?.textContent?.includes('B2.2 disposable persistence check')`), true)
  await cdp.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
  for (let attempt = 0; attempt < 20; attempt++) { if (!(await cdp.evaluate<boolean>(`!!document.querySelector('.booking-detail-drawer')`))) break; await sleep(50) }

  assert.equal(await cdp.evaluate<boolean>(`(()=>{const row=Array.from(document.querySelectorAll('.service-table tbody tr')).find(item=>item.textContent?.includes('Arrived Guest'));const button=row?.querySelector('.booking-guest-trigger');if(!button)return false;button.click();return true})()`), true)
  for (let attempt = 0; attempt < 40; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('.booking-arrived-banner')`)) break; await sleep(100) }
  assert.deepEqual(await cdp.evaluate<string[]>(`[document.querySelector('.booking-arrived-banner strong')?.textContent?.trim(),document.querySelector('.booking-arrived-banner small')?.textContent?.trim()]`), ['✓ Guest has arrived', 'Arrived at 18:12:35'])

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  const mobile = await cdp.evaluate<any>(`(()=>{const drawer=document.querySelector('.booking-detail-drawer')?.getBoundingClientRect();const statuses=Array.from(document.querySelectorAll('.mobile-operation-card .service-status-select')).filter(select=>getComputedStyle(select).display!=='none');return{cards:Array.from(document.querySelectorAll('.mobile-operation-card')).filter(card=>getComputedStyle(card).display!=='none').length,statuses:statuses.map(select=>({value:select.value,textAlign:getComputedStyle(select).textAlign,textAlignLast:getComputedStyle(select).textAlignLast})),tableHidden:Array.from(document.querySelectorAll('.booking-table-wrap')).every(table=>getComputedStyle(table).display==='none'),pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,drawerClipped:drawer?drawer.left<0||drawer.right>innerWidth+1:true,banner:[document.querySelector('.booking-arrived-banner strong')?.textContent?.trim(),document.querySelector('.booking-arrived-banner small')?.textContent?.trim()]}})()`)
  assert.equal(mobile.cards, 5)
  assert.deepEqual(mobile.statuses.map((status: any) => status.value), ['confirmed', 'waiting', 'arrived', 'no_show', 'confirmed'])
  assert.ok(mobile.statuses.every((status: any) => status.textAlign === 'center' && status.textAlignLast === 'center'))
  assert.deepEqual({ tableHidden: mobile.tableHidden, pageOverflow: mobile.pageOverflow, drawerClipped: mobile.drawerClipped, banner: mobile.banner }, { tableHidden: true, pageOverflow: false, drawerClipped: false, banner: ['✓ Guest has arrived', 'Arrived at 18:12:35'] })
  const mobileShot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(output, `bookings-${visualPhase}-mobile-390.png`), Buffer.from(mobileShot.data, 'base64'))
  await cdp.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
  for (let attempt = 0; attempt < 20; attempt++) { if (!(await cdp.evaluate<boolean>(`!!document.querySelector('.booking-detail-drawer')`))) break; await sleep(50) }
  assert.equal(await cdp.evaluate<boolean>(`document.activeElement?.textContent?.includes('Arrived Guest')`), true)
  await sleep(150)
  const mobileVisual = await cdp.evaluate<any>(`(()=>{const cards=Array.from(document.querySelectorAll('.mobile-operation-card')).filter(card=>getComputedStyle(card).display!=='none');const card=cards.find(node=>node.querySelector('.service-status-select')?.value==='confirmed');const pill=card?.querySelector('.booking-status');const selector=card?.querySelector('.service-status-select');const actions=Array.from(card?.querySelectorAll('.mobile-card-actions .ao-action')||[]);const widths=actions.map(node=>node.getBoundingClientRect().width);return{pillBackground:pill?getComputedStyle(pill).backgroundColor:null,pillColor:pill?getComputedStyle(pill).color:null,selectorBackground:selector?getComputedStyle(selector).backgroundColor:null,selectorRadius:selector?getComputedStyle(selector).borderRadius:null,actionBackgrounds:actions.map(node=>getComputedStyle(node).backgroundColor),actionColors:actions.map(node=>getComputedStyle(node).color),actionsEqual:widths.length===3&&Math.max(...widths)-Math.min(...widths)<1,minActionHeight:actions.length?Math.min(...actions.map(node=>node.getBoundingClientRect().height)):0}})()`)
  assert.deepEqual(mobileVisual, { pillBackground: 'rgb(237, 244, 247)', pillColor: 'rgb(23, 59, 82)', selectorBackground: 'rgb(255, 255, 255)', selectorRadius: '8px', actionBackgrounds: ['rgb(255, 248, 232)', 'rgb(238, 248, 243)', 'rgb(251, 237, 235)'], actionColors: ['rgb(128, 96, 31)', 'rgb(39, 105, 79)', 'rgb(151, 62, 56)'], actionsEqual: true, minActionHeight: 44 })
  assert.deepEqual(await cdp.evaluate<any>(`(()=>{const cards=Array.from(document.querySelectorAll('.mobile-operation-card'));const inspect=value=>{const select=cards.find(card=>card.querySelector('.service-status-select')?.value===value)?.querySelector('.service-status-select');const field=select?.closest('.booking-status-field');return{background:select?getComputedStyle(select).backgroundColor:null,color:select?getComputedStyle(select).color:null,icons:field?.querySelectorAll('.ao-icon').length||0,height:select?.getBoundingClientRect().height||0}};const assignments=Array.from(document.querySelectorAll('.mobile-operation-card .booking-assignment-select'));return{arrived:inspect('arrived'),noShow:inspect('no_show'),assignments:assignments.map(select=>select.getBoundingClientRect().height)}})()`), { arrived: { background: 'rgb(223, 242, 231)', color: 'rgb(32, 95, 68)', icons: 1, height: 44 }, noShow: { background: 'rgb(253, 228, 225)', color: 'rgb(148, 58, 52)', icons: 1, height: 44 }, assignments: Array(10).fill(44) })
  assert.deepEqual(await cdp.evaluate<any>(`(()=>{const panel=document.querySelector('.service-summary .panel');const style=node=>getComputedStyle(node);return{summaryLabel:style(panel.querySelector('span')).fontSize,summaryMetric:style(panel.querySelector('strong')).fontSize,summaryDetail:style(panel.querySelector('small')).fontSize,guest:style(document.querySelector('.mobile-operation-card .booking-guest-trigger b')).fontSize}})()`), { summaryLabel: '11px', summaryMetric: '27px', summaryDetail: '10px', guest: '16px' })
  assert.deepEqual(await cdp.evaluate<any>(`(()=>{const card=Array.from(document.querySelectorAll('.mobile-operation-card')).find(item=>item.textContent?.includes('Confirmed Guest'));const badge=card?.querySelector('.booking-walk-in-badge');return{text:badge?.textContent?.trim(),noBookingNumber:card?.textContent?.includes('No booking number')}})()`), { text: 'Walk-In', noBookingNumber: false })
  const mobileMainShot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(output, `bookings-${visualPhase}-mobile-main-390.png`), Buffer.from(mobileMainShot.data, 'base64'))
  const mobileCardRect = await cdp.evaluate<any>(`(()=>{const card=Array.from(document.querySelectorAll('.mobile-operation-card')).find(node=>getComputedStyle(node).display!=='none');const rect=card?.getBoundingClientRect();return rect?{x:Math.max(0,rect.x-4+scrollX),y:Math.max(0,rect.y-4+scrollY),width:Math.min(document.documentElement.scrollWidth,rect.width+8),height:rect.height+8}:null})()`)
  assert.ok(mobileCardRect)
  const mobileCardShot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { ...mobileCardRect, scale: 1 } })
  await writeFile(join(output, `bookings-${visualPhase}-card-mobile-390.png`), Buffer.from(mobileCardShot.data, 'base64'))
  const responsive: Array<Record<string, unknown>> = []
  for (const viewport of [
    { width: 1440, height: 900, mobile: false },
    { width: 1280, height: 900, mobile: false },
    { width: 1024, height: 900, mobile: false },
    { width: 768, height: 900, mobile: false },
    { width: 430, height: 900, mobile: true },
    { width: 390, height: 844, mobile: true },
    { width: 360, height: 800, mobile: true }
  ]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1 })
    await sleep(150)
    const state = await cdp.evaluate<any>(`(()=>{const visible=node=>node&&getComputedStyle(node).display!=='none'&&node.getBoundingClientRect().width>0;const table=document.querySelector('.booking-table-wrap');const cards=Array.from(document.querySelectorAll('.mobile-operation-card')).filter(visible);const actions=Array.from(document.querySelectorAll('.booking-command .ao-action,.booking-command .ao-icon-action,.mobile-operation-card .ao-action,.mobile-operation-card .ao-status-select')).filter(visible);const commandActions=Array.from(document.querySelectorAll('.booking-command .ao-action')).filter(visible);const pills=Array.from(document.querySelectorAll('.booking-info-pill')).filter(visible);const dateInput=document.querySelector('input[aria-label="Booking date"]');const summaryCards=Array.from(document.querySelectorAll('.service-summary .panel')).map(node=>node.getBoundingClientRect());const filterNodes=Array.from(document.querySelectorAll('.service-tools input,.service-tools select'));const filters=filterNodes.map(node=>node.getBoundingClientRect());const filterPanel=document.querySelector('.service-tools');const filterGrid=filterPanel?getComputedStyle(filterPanel):null;const canvas=document.createElement('canvas');const context=canvas.getContext('2d');const filterLabelClipping=filterNodes.filter(node=>node.tagName==='SELECT').filter(node=>{const style=getComputedStyle(node);context.font=style.font;const label=node.selectedOptions[0]?.textContent||'';return context.measureText(label).width+46>node.getBoundingClientRect().width}).length;const activeTab=document.querySelector('.booking-service-tabs .active')?.getBoundingClientRect();const search=document.querySelector('.service-tools input')?.getBoundingClientRect();const progressLayout=getComputedStyle(document.querySelector('.service-progress>div:first-child'));const firstRow=document.querySelector('.service-table tbody tr');const headers=Array.from(firstRow?.closest('table')?.querySelectorAll('thead th')||[]);const cells=Array.from(firstRow?.children||[]);const tableColumnDrift=headers.length===cells.length?Math.max(...headers.map((header,index)=>Math.abs(header.getBoundingClientRect().left-cells[index].getBoundingClientRect().left))):999;return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,tableVisible:visible(table),tableContained:table?table.scrollWidth>table.clientWidth+1:false,cards:cards.length,cardClipping:cards.filter(card=>card.scrollWidth>card.clientWidth+1).length,pillClipping:pills.filter(pill=>pill.scrollWidth>pill.clientWidth+1).length,interactivePills:pills.filter(pill=>pill.matches('button,a,[tabindex]')).length,commandActionClipping:commandActions.filter(action=>action.scrollWidth>action.clientWidth+1).length,minActionHeight:actions.length?Math.min(...actions.map(node=>node.getBoundingClientRect().height)):0,calendarIcon:!!document.querySelector('.booking-command .ao-date-control__icon'),dateInputType:dateInput?.type,hasTodayServiceText:document.body.textContent.includes("Today's dinner service"),sharedActions:document.querySelectorAll('.booking-command .ao-action,.service-actions .ao-action').length,summaryHeightSpread:summaryCards.length?Math.max(...summaryCards.map(rect=>rect.height))-Math.min(...summaryCards.map(rect=>rect.height)):999,summaryWidthSpread:summaryCards.length?Math.max(...summaryCards.map(rect=>rect.width))-Math.min(...summaryCards.map(rect=>rect.width)):999,minFilterHeight:filters.length?Math.min(...filters.map(rect=>rect.height)):0,filterWidths:filters.map(rect=>Math.round(rect.width*100)/100),filterGridColumns:filterGrid?.gridTemplateColumns,filterDisplay:filterGrid?.display,filterLabelClipping,tabSearchAlignment:activeTab&&search?Math.abs(activeTab.left-search.left):999,progressDirection:progressLayout.flexDirection,tableColumnDrift}})()`)
    if (state.pageOverflow) state.overflowers = await cdp.evaluate(`Array.from(document.querySelectorAll('*')).filter(node=>node.getBoundingClientRect().right>document.documentElement.clientWidth+1).slice(0,20).map(node=>({tag:node.tagName,class:node.className,right:Math.round(node.getBoundingClientRect().right),width:Math.round(node.getBoundingClientRect().width)}))`)
    assert.equal(state.pageOverflow, false, `Bookings page overflow at ${viewport.width}px: ${JSON.stringify(state.overflowers || [])}`)
    assert.equal(state.cardClipping, 0, `Booking card clipping at ${viewport.width}px`)
    assert.equal(state.pillClipping, 0, `Booking informational pill clipping at ${viewport.width}px`)
    assert.equal(state.interactivePills, 0, `Booking informational pills must not be interactive at ${viewport.width}px`)
    assert.equal(state.commandActionClipping, 0, `Booking command action clipping at ${viewport.width}px`)
    assert.equal(state.filterDisplay, 'grid', `Booking filters must use the scoped grid at ${viewport.width}px`)
    assert.equal(state.filterLabelClipping, 0, `Booking filter labels clipped at ${viewport.width}px`)
    assert.equal(state.calendarIcon, true)
    assert.equal(state.dateInputType, 'date')
    assert.equal(state.hasTodayServiceText, false)
    assert.ok(state.sharedActions >= 3)
    assert.ok(state.summaryHeightSpread < 1, `Summary card height mismatch at ${viewport.width}px`)
    assert.ok(state.summaryWidthSpread < 1, `Summary card width mismatch at ${viewport.width}px`)
    if (viewport.width <= 700) { assert.equal(state.tableVisible, false); assert.equal(state.cards, 5); assert.ok(state.minActionHeight >= 44); assert.ok(state.minFilterHeight >= 44); assert.ok(state.tabSearchAlignment <= 10); assert.equal(state.progressDirection, 'row') } else { assert.equal(state.tableVisible, true); assert.equal(state.cards, 0); assert.ok(state.tableColumnDrift < 1); if (viewport.width >= 1280) assert.equal(state.tableContained, false) }
    responsive.push({ width: viewport.width, ...state })
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await cdp.evaluate(`scrollTo(0,120)`)
  const filterScrollBefore = await cdp.evaluate<number>(`scrollY`)
  await cdp.evaluate(`(()=>{const select=document.querySelector('select[aria-label="Filter by operational status"]');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(select,'arrived');select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await sleep(120)
  const filterScrollAfter = await cdp.evaluate<number>(`scrollY`)
  assert.ok(Math.abs(filterScrollAfter - filterScrollBefore) <= 1, `Booking filter caused a ${filterScrollAfter - filterScrollBefore}px scroll jump`)
  await cdp.evaluate(`(()=>{const select=document.querySelector('select[aria-label="Filter by operational status"]');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(select,'all');select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await sleep(120)
  const statusScrollBefore = await cdp.evaluate<number>(`scrollY`)
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const card=Array.from(document.querySelectorAll('.mobile-operation-card')).find(item=>item.querySelector('.service-status-select')?.value==='confirmed');const button=card?.querySelector('.quick-waiting');if(!button)return false;button.click();return true})()`), true)
  await sleep(250)
  const statusScrollAfter = await cdp.evaluate<number>(`scrollY`)
  assert.ok(Math.abs(statusScrollAfter - statusScrollBefore) <= 1, `Booking status change caused a ${statusScrollAfter - statusScrollBefore}px scroll jump`)
  assert.deepEqual(cdp.errors, [])
  console.log(JSON.stringify({ bookingsLoadWhenGuestOccasionsForbidden: true, desktopStatusAlignment: true, confirmedButtonsTogether: true, arrivedAndNoShowCompact: true, arrivalBanner: 'Arrived at 18:12:35', celebrationGroup: '19:30-21:30', celebrationBookingOnce: true, bookingDetailsSourceMembersAndAllergies: true, bookingDetailsTechnicalMetadataHidden: true, bookingDetailsLinkedMemberCounts: [...memberCardinality, celebrationDetails.memberCount], bookingDetailsEditSavePersistence: { table: chosenAssignment.table, waiter: chosenAssignment.waiter, notes: true }, bookingDetailsMetrics: { desktop: celebrationDetails, mobile: mobileDetails, responsive: detailsResponsive }, responsive, scrollStability: { filterDelta: filterScrollAfter - filterScrollBefore, statusDelta: statusScrollAfter - statusScrollBefore }, pageOverflow: false, runtimeErrors: 0, canonicalDatabaseTouched: false }, null, 2))
} finally {
  socket?.close()
  for (const child of processes.reverse()) { if (child.exitCode === null) child.kill(); child.removeAllListeners(); child.unref() }
  await sleep(1000)
  await rm(fixture.root, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(() => undefined)
}
