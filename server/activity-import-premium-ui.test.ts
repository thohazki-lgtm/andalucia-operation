import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'
import { syntheticActivityProgramPdf } from './activity-program-test-fixture.js'
import { ACTIVITY_PROGRAM_PARSER_VERSION, parseActivityProgramPdf } from './activity-program-parser.js'
import { BookingRepository } from './booking-repository.js'

const fixture = await createDisposableDevelopmentStore('activity-import-premium-ui')
const profile = join(fixture.root, 'edge-profile')
const pdfPath = join(fixture.root, 'activity-program.pdf')
const output = resolve('artifacts', 'stage-b1-activity-import')
const processes: ChildProcess[] = []
let socket: WebSocket | null = null
let spacingEvidence: Record<string, unknown> = {}
const token = `isolated-${randomUUID()}`
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))
const waitFor = async (url: string) => { for (let attempt = 0; attempt < 300; attempt++) { try { if ((await fetch(url)).ok) return } catch {} await sleep(200) } throw new Error(`Timed out waiting for ${url}`) }

class Cdp {
  private id = 0
  private pending = new Map<number, { resolve: (value: any) => void; reject: (reason: unknown) => void }>()
  readonly errors: string[] = []
  constructor(private ws: WebSocket) { ws.onmessage = event => { const message = JSON.parse(String(event.data)); if (message.id) { const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result) } else if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || 'Runtime exception') } }
  send(method: string, params: Record<string, unknown> = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise<any>((resolveCall, rejectCall) => this.pending.set(id, { resolve: resolveCall, reject: rejectCall })) }
  evaluate<T>(expression: string) { return this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then(result => { if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed'); return result.result.value as T }) }
}

const screenshot = async (cdp: Cdp, name: string) => {
  const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const target = join(output, name)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, Buffer.from(capture.data, 'base64'))
}

const clickText = (cdp: Cdp, label: string) => cdp.evaluate<boolean>(`(()=>{const button=Array.from(document.querySelectorAll('button')).find(node=>node.textContent?.trim()===${JSON.stringify(label)});if(!button)return false;button.click();return true})()`)
const waitForSelector = async (cdp: Cdp, selector: string) => { for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`)) return; await sleep(100) } throw new Error(`Timed out waiting for ${selector}`) }
const waitForMissing = async (cdp: Cdp, selector: string) => { for (let attempt = 0; attempt < 100; attempt++) { if (!await cdp.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`)) return; await sleep(100) } throw new Error(`Timed out waiting for ${selector} to close`) }
const setViewport = (cdp: Cdp, width: number) => cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width <= 768 ? 900 : 1000, deviceScaleFactor: 1, mobile: width <= 768 })
const layout = (cdp: Cdp) => cdp.evaluate<any>(`(()=>{const modal=document.querySelector('.activity-import-modal');const workflow=document.querySelector('.import-workflow');const controls=Array.from(modal?.querySelectorAll('button,input')||[]).filter(node=>{const r=node.getBoundingClientRect();return getComputedStyle(node).display!=='none'&&r.width>0&&r.height>0&&!(node instanceof HTMLInputElement&&node.type==='checkbox')});const undersized=controls.map(node=>{const r=node.getBoundingClientRect();return{label:node.getAttribute('aria-label')||node.textContent?.trim()||node.tagName,width:r.width,height:r.height}}).filter(item=>item.width<44||item.height<44);const verticalScrollOwners=Array.from(modal?.querySelectorAll('*')||[]).filter(node=>{const style=getComputedStyle(node);return/(auto|scroll)/.test(style.overflowY)&&node.scrollHeight>node.clientHeight+1}).map(node=>node.className);const table=document.querySelector('.ready-section .import-table-wrap');const cards=document.querySelector('.ready-section .import-record-cards');const modalRect=modal?.getBoundingClientRect();return{pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,modalOverflow:modal?modal.scrollWidth>modal.clientWidth+1:false,workflowOverflow:workflow?workflow.scrollWidth>workflow.clientWidth+1:false,modalWidth:modalRect?.width||0,modalLeft:modalRect?.left||0,modalRightMargin:modalRect?document.documentElement.clientWidth-modalRect.right:0,touchTargets:innerWidth>700||undersized.length===0,undersized,verticalScrollOwners,tableVisible:table?getComputedStyle(table).display!=='none':false,cardsVisible:cards?getComputedStyle(cards).display!=='none':false}})()`)

const assertCompactModal = (measured: any, width: number) => {
  assert.ok(measured.modalWidth <= 980, `${width}px modal is too wide: ${measured.modalWidth}`)
  assert.ok(Math.abs(measured.modalLeft - measured.modalRightMargin) <= 8, `${width}px modal is not centered: ${measured.modalLeft}px / ${measured.modalRightMargin}px`)
  assert.ok(measured.verticalScrollOwners.length <= 1, `${width}px nested vertical scrollers: ${JSON.stringify(measured.verticalScrollOwners)}`)
}

try {
  const owner = (await fixture.db.query<any>("select u.id from user_accounts u join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.active=true where u.status='active' and r.role_key='owner' limit 1")).rows[0]
  assert.ok(owner)
  await fixture.db.query("insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval '1 hour')", [randomUUID(), createHash('sha256').update(token).digest('hex'), owner.id])
  const pdf = Buffer.from(syntheticActivityProgramPdf('import'))
  const parsed = await parseActivityProgramPdf(new Uint8Array(pdf))
  const repository = new BookingRepository(fixture.db)
  await repository.initialize()
  const seededPreview = await repository.prepareImportPreview({ fileName: 'seeded-duplicate.pdf', fileHash: createHash('sha256').update(pdf).digest('hex'), reportDate: parsed.reportDate, parserVersion: ACTIVITY_PROGRAM_PARSER_VERSION, summary: { bookingGroups: parsed.bookings.length, totalCovers: parsed.bookings.reduce((total, booking) => total + (booking.covers || 0), 0), confirmed: parsed.bookings.filter(booking => booking.sourceStatus.toLowerCase() === 'confirmed').length, pending: parsed.bookings.filter(booking => booking.sourceStatus.toLowerCase() === 'pending').length, warnings: parsed.bookings.filter(booking => booking.warnings.length > 0).length, possibleDuplicates: 0 }, validation: parsed.validation, bookings: parsed.bookings })
  const seededIndex = seededPreview.bookings.findIndex(booking => booking.readiness === 'READY')
  assert.ok(seededIndex >= 0)
  assert.equal((await repository.confirmImport(seededPreview.batchId, [seededIndex], [], 'Isolated UI fixture')).importedBookings, 1)
  await fixture.db.close()
  await writeFile(pdfPath, pdf)

  const node = process.execPath
  processes.push(spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', API_PORT: '3016', APP_ORIGIN: 'http://127.0.0.1:5186' }, stdio: 'inherit' }))
  processes.push(spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5186', '--strictPort'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3016' }, stdio: 'ignore' }))
  await Promise.all([waitFor('http://127.0.0.1:3016/api/health'), waitFor('http://127.0.0.1:5186/')])

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
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('DOM.enable')
  assert.equal((await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5186/', path: '/', httpOnly: true, sameSite: 'Strict' })).success, true)
  await setViewport(cdp, 1440)
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5186/' })
  await waitForSelector(cdp, 'button[aria-label="Bookings"]')
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const button=document.querySelector('button[aria-label="Bookings"]');if(!button)return false;button.click();return true})()`), true)
  await waitForSelector(cdp, '.upload-action')
  assert.equal(await clickText(cdp, 'Upload Booking'), true)
  await waitForSelector(cdp, '.activity-import-modal')
  await cdp.evaluate(`(()=>{const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const response=await original(input,init);if(!String(input).includes('/api/bookings/import-preview')||!response.ok)return response;const body=await response.clone().json();const duplicate=body.bookings.find(item=>item.readiness==='DUPLICATE');if(duplicate){for(let index=1;index<7;index++)body.bookings.push({...duplicate,bookingNumber:duplicate.bookingNumber+'-'+index,primaryGuest:duplicate.primaryGuest+' '+index,duplicateBookingId:duplicate.duplicateBookingId+'-'+index});body.summary.possibleDuplicates=7}return new Response(JSON.stringify(body),{status:response.status,headers:{'Content-Type':'application/json'}})}})()`)

  for (const width of [1440,1280,1024,768,430,390,360]) { await setViewport(cdp, width); await sleep(80); const measured = await layout(cdp); assert.deepEqual({ pageOverflow: measured.pageOverflow, modalOverflow: measured.modalOverflow, workflowOverflow: measured.workflowOverflow, touchTargets: measured.touchTargets }, { pageOverflow: false, modalOverflow: false, workflowOverflow: false, touchTargets: true }, `${width}px ${JSON.stringify(measured.undersized)}`); assertCompactModal(measured, width); if (width === 1440 || width === 390) await screenshot(cdp, `upload-${width}.png`) }

  await setViewport(cdp, 1440)
  const documentNode = (await cdp.send('DOM.getDocument')).root.nodeId
  const inputNode = (await cdp.send('DOM.querySelector', { nodeId: documentNode, selector: '.import-file-picker input[type=file]' })).nodeId
  assert.ok(inputNode)
  await cdp.send('DOM.setFileInputFiles', { nodeId: inputNode, files: [pdfPath] })
  assert.equal(await clickText(cdp, 'Parse PDF'), true)
  await waitForSelector(cdp, '.ready-section')
  assert.equal(await cdp.evaluate<number>(`document.querySelectorAll('.import-summary-grid>article').length`), 5)
  assert.equal(await cdp.evaluate<boolean>(`!Array.from(document.querySelectorAll('.import-table th')).some(node=>['Intelligence','Warnings'].includes(node.textContent.trim()))`), true)
  for (const width of [1440,1280,1024,768,430,390,360]) { await setViewport(cdp, width); await sleep(80); const measured = await layout(cdp); assert.equal(measured.pageOverflow, false); assert.equal(measured.modalOverflow, false); assert.equal(measured.touchTargets, true, `${width}px ${JSON.stringify(measured.undersized)}`); assertCompactModal(measured, width); if (width <= 768) assert.deepEqual({ tableVisible: measured.tableVisible, cardsVisible: measured.cardsVisible }, { tableVisible: false, cardsVisible: true }, `${width}px should use aligned booking cards`); if (width === 1440 || width === 390) await screenshot(cdp, `review-${width}.png`) }

  assert.equal(await cdp.evaluate<number>(`document.querySelectorAll('.review-item').length`), 2)
  assert.equal(await cdp.evaluate<number>(`document.querySelectorAll('.review-item[open]').length`), 0)
  assert.match(await cdp.evaluate<string>(`document.querySelector('.manager-review-progress')?.textContent||''`), /0 of 2 reviewed.*0% complete.*2 pending decisions/s)
  assert.match(await cdp.evaluate<string>(`document.querySelector('.decision-state.unresolved')?.textContent||''`), /Needs Review/i)
  await cdp.evaluate(`document.querySelector('.review-item summary')?.click()`)
  assert.deepEqual(await cdp.evaluate<string[]>(`Array.from(document.querySelector('.review-item[open]')?.querySelectorAll('.review-actions button')||[]).map(button=>button.textContent.trim())`), ['Import Anyway','Review / Edit','Skip','Guest Group (1)'])
  assert.deepEqual(await cdp.evaluate<string[]>(`Array.from(document.querySelectorAll('.review-cover-summary small')).slice(0,3).map(node=>node.textContent.trim())`), ['Source covers','Detected covers','Operational covers'])
  assert.equal(await clickText(cdp, 'Import Anyway'), true)
  assert.match(await cdp.evaluate<string>(`document.querySelector('.review-item .decision-state.import')?.textContent||''`), /Reviewed · Import/i)
  await setViewport(cdp, 1440)
  assert.equal(await clickText(cdp, 'Review / Edit'), true)
  await waitForSelector(cdp, '.review-edit-dialog')
  spacingEvidence = await cdp.evaluate<Record<string, unknown>>(`(()=>{const dialog=document.querySelector('.review-edit-dialog');const heading=document.querySelector('.review-edit-heading');const scroll=document.querySelector('.review-edit-scroll');const footer=document.querySelector('.review-edit-footer');const grids=Array.from(document.querySelectorAll('.review-edit-grid'));const fieldsets=Array.from(document.querySelectorAll('.review-edit-scroll fieldset'));const rect=node=>{const value=node.getBoundingClientRect();return{left:value.left,right:value.right,width:value.width,top:value.top,bottom:value.bottom,height:value.height}};const style=node=>{const value=getComputedStyle(node);return{display:value.display,padding:value.padding,margin:value.margin,gap:value.gap,columnGap:value.columnGap,rowGap:value.rowGap,lineHeight:value.lineHeight,minHeight:value.minHeight}};return{dialog:rect(dialog),heading:{...rect(heading),style:style(heading)},scroll:{...rect(scroll),style:style(scroll)},footer:{...rect(footer),style:style(footer)},grids:grids.map(node=>({...rect(node),style:style(node)})),fieldsets:fieldsets.map((node,index)=>({index,...rect(node),style:style(node),firstLabel:style(node.querySelector('label'))})),fieldsetGaps:fieldsets.slice(1).map((node,index)=>node.getBoundingClientRect().top-fieldsets[index].getBoundingClientRect().bottom)}})()`)
  assert.equal(Math.round((spacingEvidence.dialog as { width: number }).width), 700)
  assert.deepEqual(await cdp.evaluate<string[]>(`Array.from(document.querySelectorAll('.review-edit-dialog legend')).map(node=>node.textContent.trim())`), ['Reservation Details','Guest Information','Operational Details'])
  assert.match(await cdp.evaluate<string>(`document.querySelector('.review-edit-heading')?.textContent||''`), /PDF source record.*Original identity preserved/s)
  await setViewport(cdp, 1440); await screenshot(cdp, 'edit-before-import-1440.png')
  await setViewport(cdp, 390); await screenshot(cdp, 'edit-before-import-390.png')
  assert.equal(await cdp.evaluate<boolean>(`(()=>{window.__reviewConfirmCalls=[];window.confirm=message=>{window.__reviewConfirmCalls.push(message);return false};const input=Array.from(document.querySelectorAll('.review-edit-dialog input')).find(node=>node.closest('label')?.textContent.includes('Primary guest'));if(!input)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Fictional Guest Delta Edited');input.dispatchEvent(new Event('input',{bubbles:true}));document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true})()`), true)
  assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.review-edit-dialog')`), true)
  assert.match(await cdp.evaluate<string>(`window.__reviewConfirmCalls?.[0]||''`), /Discard the unsaved booking correction/)
  assert.equal(await clickText(cdp, 'Save Correction'), true)
  await waitForMissing(cdp, '.review-edit-dialog')
  assert.match(await cdp.evaluate<string>(`document.querySelector('.review-item .decision-state.edited')?.textContent||''`), /Reviewed · Edited/i)
  assert.match(await cdp.evaluate<string>(`document.querySelector('.review-item .review-card-primary')?.textContent||''`), /Fictional Guest Delta Edited/)
  assert.match(await cdp.evaluate<string>(`document.querySelector('.manager-review-progress')?.textContent||''`), /1 of 2 reviewed.*50% complete.*1 pending decision/s)
  assert.equal(await cdp.evaluate<boolean>(`(()=>{const item=document.querySelectorAll('.review-item')[1];item.querySelector('summary').click();const skip=Array.from(item.querySelectorAll('button')).find(button=>button.textContent.trim()==='Skip');if(!skip)return false;skip.click();return true})()`), true)
  assert.match(await cdp.evaluate<string>(`document.querySelector('.review-item .decision-state.skip')?.textContent||''`), /Reviewed · Skip/i)
  assert.match(await cdp.evaluate<string>(`document.querySelector('.manager-review-progress')?.textContent||''`), /2 of 2 reviewed.*100% complete.*0 pending decisions/s)
  await cdp.evaluate(`(()=>{const item=document.querySelector('.review-item');item.querySelector('summary').click();item.querySelector('summary').click()})()`)
  assert.match(await cdp.evaluate<string>(`document.querySelector('.review-item .decision-state.edited')?.textContent||''`), /Reviewed · Edited/i)
  await setViewport(cdp, 1440); await cdp.evaluate(`document.querySelector('.requires-review')?.scrollIntoView({block:'start'})`); await sleep(80); await screenshot(cdp, 'review-cards-expanded-1440.png')
  await setViewport(cdp, 390); await cdp.evaluate(`document.querySelector('.requires-review')?.scrollIntoView({block:'start'})`); await sleep(80); await screenshot(cdp, 'review-cards-expanded-390.png')
  await setViewport(cdp, 1440)
  assert.equal(await cdp.evaluate<number>(`document.querySelectorAll('.duplicate-item').length`), 5)
  assert.match(await cdp.evaluate<string>(`document.querySelector('.duplicate-show-toggle')?.textContent||''`), /Show All \(7\)/)
  assert.equal(await clickText(cdp, 'Show All (7)'), true)
  assert.equal(await cdp.evaluate<number>(`document.querySelectorAll('.duplicate-item').length`), 7)
  assert.equal(await cdp.evaluate<boolean>(`!document.querySelector('.duplicate-item summary')?.textContent?.includes('00000000-')`), true)
  await cdp.evaluate(`document.querySelector('.duplicate-item summary')?.click()`)
  assert.equal(await clickText(cdp, 'Re-analyze Intelligence'), true)
  await waitForSelector(cdp, '.reanalysis-summary')
  await cdp.evaluate(`document.querySelector('.duplicate-section')?.scrollIntoView({block:'start'})`); await sleep(100); await screenshot(cdp, 'duplicates-expanded-1440.png')
  await setViewport(cdp, 390); await cdp.evaluate(`document.querySelector('.duplicate-section')?.scrollIntoView({block:'start'})`); await sleep(80); await screenshot(cdp, 'duplicates-expanded-390.png')
  await setViewport(cdp, 1440)
  assert.equal(await clickText(cdp, 'Show Less'), true)
  assert.equal(await cdp.evaluate<number>(`document.querySelectorAll('.duplicate-item').length`), 5)
  assert.equal(await clickText(cdp, 'Review & Import'), true)
  await waitForSelector(cdp, '.confirmation-card')
  for (const width of [1440,1280,1024,768,430,390,360]) { await setViewport(cdp, width); await sleep(60); const measured = await layout(cdp); assert.equal(measured.pageOverflow, false); assertCompactModal(measured, width); if (width === 1440 || width === 390) await screenshot(cdp, `confirm-${width}.png`) }

  assert.equal(await clickText(cdp, 'Confirm Import'), true)
  await waitForSelector(cdp, '.import-result')
  assert.match(await cdp.evaluate<string>(`document.querySelector('.import-result h3')?.textContent||''`), /completed/i)
  for (const width of [1440,1280,1024,768,430,390,360]) { await setViewport(cdp, width); await sleep(60); const measured = await layout(cdp); assert.deepEqual({ pageOverflow: measured.pageOverflow, modalOverflow: measured.modalOverflow, workflowOverflow: measured.workflowOverflow, touchTargets: measured.touchTargets }, { pageOverflow: false, modalOverflow: false, workflowOverflow: false, touchTargets: true }); assertCompactModal(measured, width); if (width === 1440 || width === 390) await screenshot(cdp, `result-${width}.png`) }
  assert.deepEqual(cdp.errors, [])
  console.log(JSON.stringify({ stages: ['Upload','Review','Confirm','Result'], widths: [1440,1280,1024,768,430,390,360], screenshots: output, spacingEvidence, browserErrors: cdp.errors }, null, 2))
} finally {
  socket?.close()
  for (const process of processes.reverse()) if (process.exitCode === null) process.kill()
  await sleep(300)
  await fixture.cleanup()
}
