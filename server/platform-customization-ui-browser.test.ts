import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const fixture = await createDisposableDevelopmentStore('platform-customization-ui')
const profile = join(fixture.root, 'edge-profile')
const processes: ChildProcess[] = []
const output: string[] = []
const token = `platform-ui-${randomUUID()}`
const artifactDirectory = resolve('artifacts', 'platform-customization-final')
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))
const capture = (child: ChildProcess, label: string) => { child.stdout?.on('data', chunk => output.push(`${label}: ${chunk}`)); child.stderr?.on('data', chunk => output.push(`${label}: ${chunk}`)); return child }
const waitFor = async (url: string) => { for (let attempt = 0; attempt < 100; attempt++) { try { await fetch(url); return } catch {} await sleep(150) } throw new Error(`Timed out waiting for ${url}\n${output.join('')}`) }

class Cdp {
  private id = 0
  private pending = new Map<number, { resolve: (value: any) => void; reject: (reason: unknown) => void }>()
  readonly errors: string[] = []
  constructor(private socket: WebSocket) { socket.onmessage = event => { const message = JSON.parse(String(event.data)); if (message.id) { const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result) } else if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || 'Runtime exception') } }
  send(method: string, params: Record<string, unknown> = {}) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params })); return new Promise<any>((resolveCall, rejectCall) => this.pending.set(id, { resolve: resolveCall, reject: rejectCall })) }
  evaluate<T>(expression: string) { return this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then(result => result.result.value as T) }
}

let socket: WebSocket | null = null
try {
  await fixture.db.query('insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval \'1 hour\')', [randomUUID(), createHash('sha256').update(token).digest('hex'), fixture.ownerId])
  await fixture.db.close()
  const node = process.execPath
  const sharedNodeModules = resolve('node_modules')
  processes.push(capture(spawn(node, [join(sharedNodeModules, 'tsx/dist/cli.mjs'), 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, NODE_ENV: 'test', ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', API_PORT: '3016', APP_ORIGIN: 'http://127.0.0.1:5186' }, stdio: ['ignore', 'pipe', 'pipe'] }), 'api'))
  processes.push(capture(spawn(node, [join(sharedNodeModules, 'vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5186', '--strictPort'], { cwd: resolve('.'), env: { ...process.env, API_PORT: '3016' }, stdio: ['ignore', 'pipe', 'pipe'] }), 'vite'))
  await Promise.all([waitFor('http://127.0.0.1:3016/api/health'), waitFor('http://127.0.0.1:5186/')])
  const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' }); processes.push(edge)
  const activePortFile = join(profile, 'DevToolsActivePort'); let debugPort = 0
  for (let attempt = 0; attempt < 150; attempt++) { try { debugPort = Number((await readFile(activePortFile, 'utf8')).split(/\r?\n/)[0]); if (debugPort && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) break } catch {} await sleep(100) }
  assert.ok(debugPort, 'Edge debugging port was not available')
  const page = ((await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()) as any[]).find(item => item.type === 'page'); assert.ok(page)
  socket = new WebSocket(page.webSocketDebuggerUrl); await new Promise<void>((done, fail) => { socket!.onopen = () => done(); socket!.onerror = () => fail(new Error('CDP connection failed')) })
  const cdp = new Cdp(socket); await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Network.enable')
  assert.equal((await cdp.send('Network.setCookie', { name: 'andalucia_session', value: token, url: 'http://127.0.0.1:5186/', path: '/', httpOnly: true, sameSite: 'Strict' })).success, true)
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5186/' })
  for (let attempt = 0; attempt < 100; attempt++) { if (await cdp.evaluate<boolean>(`!!document.querySelector('button[aria-label="Customization Center"]')`)) break; await sleep(100) }
  await cdp.evaluate(`document.querySelector('button[aria-label="Customization Center"]')?.click()`)
  for (let attempt = 0; attempt < 80; attempt++) { if ((await cdp.evaluate<number>(`document.querySelectorAll('.customization-category-nav button').length`)) === 7) break; await sleep(100) }
  const mockInventory = Array.from({ length: 23 }, (_, index) => ({ backupId: `ui-backup-${index + 1}`, category: index % 3 === 0 ? 'automatic-weekly' : index % 3 === 1 ? 'automatic-daily' : 'manual', createdAt: new Date(Date.UTC(2026, 9, 27 - index, 1, 0)).toISOString(), verificationStatus: index === 22 ? 'INVALID' : 'VERIFIED', schemaVersion: '027', sizeBytes: 20_000_000 + index, protected: index % 4 === 0, protectionReasons: index % 4 === 0 ? ['Retention policy'] : [], restoreTestStatus: index % 2 === 0 ? 'RESTORE_TEST_PASSED' : 'RESTORE_TEST_PENDING', latestRestoreTestAt: index % 2 === 0 ? '2026-10-27T01:00:00.000Z' : null, operationalFingerprint: null }))
  const mockHealth = { database: { status: 'HEALTHY', storeId: 'isolated-ui-store', storeRole: 'development', migrationVersion: '027', migrationRequired: false, recoveryRequired: false, lastVerifiedBackup: null, checks: [] }, policy: { version: '1', backupAgeWarningHours: 24, restoreRehearsalIntervalDays: 7, retention: { daily: 14, weekly: 8 }, schedule: { dailyLocalTime: '01:00', weeklyDay: 'Sunday', weeklyLocalTime: '02:00', restoreWeeklyDay: 'Monday', restoreLocalTime: '03:00' } }, inventory: mockInventory, storage: { totalBackupStorageBytes: 460_000_000, backupCount: 23, verifiedBackupCount: 22, oldestVerifiedAt: mockInventory[22].createdAt, newestVerifiedAt: mockInventory[0].createdAt }, pendingBackupRequest: null, lastVerifiedBackup: mockInventory[0], lastRestoreTest: mockInventory[0], recoveryReadiness: 'READY', warnings: ['Restore rehearsal remains due for one older recovery point.'], recoveryCandidates: [], recovery: { required: false, activeIncident: null, candidates: [], history: [{ id: 'incident-ui-1', detectedAt: '2026-10-20T01:00:00.000Z', failureClass: 'STARTUP_OWNERSHIP_CONFLICT', state: 'RECOVERY_ACCEPTED', selectedBackupId: 'ui-backup-1', rehearsalStatus: 'PASSED', promotionStatus: 'COMPLETED', rollbackStatus: 'PRESERVED', acceptedAt: '2026-10-20T02:00:00.000Z', acceptedBy: 'Owner' }] } }
  await cdp.evaluate(`(()=>{const original=window.fetch.bind(window);const health=${JSON.stringify(mockHealth)};window.fetch=(input,init)=>{const url=typeof input==='string'?input:input.url;if(url.endsWith('/api/database/health'))return Promise.resolve(new Response(JSON.stringify(health),{status:200,headers:{'Content-Type':'application/json'}}));return original(input,init)}})()`)
  await mkdir(artifactDirectory, { recursive: true })
  const results: Record<string, unknown> = {}
  for (const viewport of [{ width: 1440, height: 900, mobile: false }, { width: 1024, height: 900, mobile: false }, { width: 768, height: 900, mobile: false }, { width: 430, height: 900, mobile: true }, { width: 390, height: 844, mobile: true }, { width: 360, height: 800, mobile: true }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1 }); await sleep(120)
    const shared = await cdp.evaluate<any>(`(()=>{const nav=document.querySelector('.customization-category-nav');const buttons=Array.from(nav.querySelectorAll('button'));const panel=document.querySelector('.customization-category-panel');return{labels:buttons.map(node=>node.textContent.trim()),columns:getComputedStyle(nav).gridTemplateColumns.split(' ').length,equalButtons:Math.max(...buttons.map(node=>node.getBoundingClientRect().width))-Math.min(...buttons.map(node=>node.getBoundingClientRect().width))<=1,minHeight:Math.min(...buttons.map(node=>node.getBoundingClientRect().height)),goldButtons:buttons.every(node=>getComputedStyle(node).borderTopColor==='rgb(222, 197, 143)'||node.classList.contains('selected')),goldNav:getComputedStyle(nav).borderTopColor==='rgb(222, 197, 143)',goldPanel:getComputedStyle(panel).borderTopColor==='rgb(222, 197, 143)',overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`)
    assert.deepEqual(shared.labels, ['Workforce', 'Bookings', 'Training', 'Guest Experience', 'Chargeable', 'Maintenance', 'Platform'])
    assert.equal(shared.columns, viewport.width > 1100 ? 7 : viewport.width > 700 ? 4 : 2)
    assert.equal(shared.equalButtons, true); assert.ok(shared.minHeight >= 42); assert.equal(shared.goldButtons, true); assert.equal(shared.goldNav, true); assert.equal(shared.goldPanel, true); assert.equal(shared.overflow, false)
    const allSections = await cdp.evaluate<Record<string, boolean>>(`(async()=>{const result={};for(const button of document.querySelectorAll('.customization-category-nav button')){button.click();await new Promise(done=>setTimeout(done,80));result[button.textContent.trim()]=button.classList.contains('selected')&&document.querySelector('.customization-category-panel').innerText.trim().length>0}return result})()`)
    assert.ok(Object.values(allSections).every(Boolean), `A customization section failed at ${viewport.width}px`)
    await cdp.evaluate(`Array.from(document.querySelectorAll('.customization-category-nav button')).find(node=>node.textContent.trim()==='Platform')?.click()`)
    for (let attempt = 0; attempt < 50; attempt++) { if ((await cdp.evaluate<number>(`document.querySelectorAll('.database-health-cards article').length`)) === 6) break; await sleep(100) }
    const platform = await cdp.evaluate<any>(`(()=>{const cards=Array.from(document.querySelectorAll('.database-health-cards article'));const major=Array.from(document.querySelectorAll('.database-health-heading,.database-health-cards article,.backup-history,.recovery-history'));const select=document.querySelector('.backup-history-controls select');const page=document.querySelector('.backup-pagination');return{metrics:cards.length,goldMajor:major.every(node=>getComputedStyle(node).borderTopColor==='rgb(222, 197, 143)'),categoryFilter:!!select,pagination:!!page,firstPageText:page?.textContent,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,mobileCards:getComputedStyle(document.querySelector('.backup-mobile-list')).display!=='none',tableVisible:getComputedStyle(document.querySelector('.backup-table-wrap')).display!=='none'}})()`)
    assert.equal(platform.metrics, 6); assert.equal(platform.goldMajor, true); assert.equal(platform.categoryFilter, true); assert.equal(platform.pagination, true); assert.match(platform.firstPageText, /Showing 1–10 of 23/); assert.equal(platform.overflow, false); assert.equal(platform.mobileCards, viewport.width <= 700); assert.equal(platform.tableVisible, viewport.width > 700)
    if (viewport.width === 1440) {
      assert.equal(await cdp.evaluate<number>(`document.querySelectorAll('.backup-table-wrap tbody tr').length`), 10)
      await cdp.evaluate(`Array.from(document.querySelectorAll('.backup-pagination button')).find(node=>node.textContent.trim()==='Next')?.click()`); await sleep(60)
      assert.match(await cdp.evaluate<string>(`document.querySelector('.backup-pagination').textContent`), /Showing 11–20 of 23/)
      await cdp.evaluate(`(()=>{const select=document.querySelector('.backup-history-controls select');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(select,'automatic-weekly');select.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(60)
      assert.equal(await cdp.evaluate<number>(`document.querySelectorAll('.backup-table-wrap tbody tr').length`), 8)
      await cdp.evaluate(`document.querySelector('.backup-table-wrap tbody .backup-actions button')?.click()`); await sleep(60)
      const detail = await cdp.evaluate<any>(`(()=>{const modal=document.querySelector('.backup-detail');const box=modal.getBoundingClientRect();return{visible:!!modal,inside:box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight,gold:getComputedStyle(modal).borderTopColor==='rgb(222, 197, 143)',sections:modal.querySelectorAll('dl>div').length}})()`)
      assert.deepEqual(detail, { visible: true, inside: true, gold: true, sections: 6 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(40)
      assert.equal(await cdp.evaluate<boolean>(`!!document.querySelector('.backup-detail')`), false)
      await cdp.evaluate(`(()=>{const select=document.querySelector('.backup-history-controls select');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(select,'all');select.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(60)
    }
    const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true }); await writeFile(join(artifactDirectory, `platform-${viewport.width}.png`), Buffer.from(image.data, 'base64'))
    results[String(viewport.width)] = { shared, platform }
  }
  const actionRequests = await cdp.evaluate<number>(`performance.getEntriesByType('resource').map(entry=>entry.name).filter(name=>name.includes('/api/database/backups/request')||name.includes('/restore-rehearsal')||name.endsWith('/pin')||name.includes('/api/database/recovery/')).length`)
  assert.equal(actionRequests, 0, 'Visual validation must not invoke a backup or recovery operation')
  assert.deepEqual(cdp.errors, [])
  console.log(JSON.stringify({ schema027: true, canonicalDatabaseTouched: false, operationalActionsTriggered: false, responsive: results, screenshots: Object.keys(results).map(width => `artifacts/platform-customization-final/platform-${width}.png`) }, null, 2))
} finally {
  socket?.close()
  for (const child of processes.reverse()) { if (child.exitCode === null) child.kill(); child.removeAllListeners(); child.unref() }
  await sleep(700)
  await rm(fixture.root, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(() => undefined)
}
