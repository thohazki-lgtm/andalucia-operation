import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { buildHostessServiceBoard } from '../src/dashboard-data.js'
import type { BookingRecord } from '../src/domain.js'
import { auditActorLabel } from './authorization-service.js'
import { BookingRepository } from './booking-repository.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { ReportingRepository } from './reporting-repository.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const fixture = await createDisposableDevelopmentStore('booking-correction-workflow')
const db = fixture.db
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex')
const tokens = { manager: `booking-manager-${randomUUID()}`, viewer: `booking-viewer-${randomUUID()}` }
const users = { manager: { id: randomUUID(), name: 'Booking Correction Manager' }, viewer: { id: randomUUID(), name: 'Booking Read Only Viewer' } }

for (const key of Object.keys(users) as Array<keyof typeof users>) {
  const user = users[key]
  await db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status,created_by,updated_by) values($1,$2,$2,$3,'isolated-test-no-login','active','Booking correction test','Booking correction test')", [user.id, `booking-${key}-${user.id}`, user.name])
  await db.query("insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval '1 hour')", [randomUUID(), tokenHash(tokens[key]), user.id])
  await db.query("insert into authorization_user_roles(id,user_id,role_id,active,created_by,updated_by) select $1,$2,id,true,'Booking correction test','Booking correction test' from authorization_roles where role_key=$3", [randomUUID(), user.id, key === 'manager' ? 'outlet_manager' : 'viewer'])
  await db.query("insert into authorization_user_outlet_scopes(id,user_id,outlet_scope_id,active,created_by,updated_by) values($1,$2,$3,true,'Booking correction test','Booking correction test')", [randomUUID(), user.id, ANDALUCIA_SCOPE_ID])
}

const reservationDate = '2026-10-07'
const targetId = randomUUID()
const companionId = randomUUID()
const originalPayload = {
  original: { bookingNumber: '2723242', covers: 4, sourceStatus: 'pending', sourceNotes: 'I: joining with 20 PAX, GROUP' },
  effective: { bookingNumber: '2723242', covers: 20, coverResolution: { source: 'joining_family_total', evidence: 'joining with 20 PAX', baseCovers: 4, groupTotal: 20, totalCovers: 20 } },
  review: { required: true, reason: 'GROUP_REVIEW_REQUIRED' }
}
const insertBooking = async (id: string, bookingNumber: string, covers: number, status: string, time: string, imported = false) => db.query("insert into bookings(id,guest_name,room_number,meal_period,reservation_date,reservation_time,booking_number,booking_status,covers,booking_source,booked_by,guest_notes,imported_batch_id,import_source,source_activity_label,source_booking_status,source_filename,source_report_date,source_parser_version,source_guest_notes,raw_import_payload,created_by,updated_by) values($1,$2,'','Dinner',$3,$4,$5,$6,$7,'activity_program','Reservations','',$8,$9,'Dinner at Andalucia',$10,'Oct 7_daily_bookings_report.pdf',$3,'andalucia-activity-program-v2',$11,$12,'Import fixture','Import fixture')", [id, `Guest ${bookingNumber}`, reservationDate, time, bookingNumber, status, covers, imported ? randomUUID() : null, imported ? 'activity_program' : 'manual', imported ? 'pending' : 'confirmed', imported ? 'I: joining with 20 PAX, GROUP' : null, imported ? JSON.stringify(originalPayload) : null])

await insertBooking(targetId, '2723242', 20, 'arrived', '18:30', true)
await insertBooking(companionId, '2691640', 16, 'arrived', '19:00')
await insertBooking(randomUUID(), 'OTHER-ARRIVED', 81, 'arrived', '19:30')
await insertBooking(randomUUID(), 'NO-SHOW', 2, 'no_show', '20:30')
await db.close()

const port = 3026
const base = `http://127.0.0.1:${port}`
const trustedOrigin = 'https://booking-correction.test'
const request = (path: string, method = 'GET', token?: string, origin = trustedOrigin, payload?: unknown) => {
  const headers = new Headers()
  if (method !== 'GET') { headers.set('Origin', origin); headers.set('Content-Type', 'application/json') }
  if (token) headers.set('Cookie', `andalucia_session=${encodeURIComponent(token)}`)
  return fetch(`${base}${path}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) })
}

let api: ChildProcess | undefined
let stdout = ''
let stderr = ''
const stop = async () => {
  if (!api || api.exitCode !== null) return
  api.kill('SIGTERM')
  await Promise.race([new Promise<void>(done => api!.once('exit', () => done())), new Promise<void>(done => setTimeout(done, 5_000))])
  if (api.exitCode === null) api.kill('SIGKILL')
}
const waitForHealth = async () => {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/api/health`)).ok) return } catch {}
    await new Promise(done => setTimeout(done, 150))
  }
  throw new Error(`Isolated booking API did not become healthy. stdout=${stdout} stderr=${stderr}`)
}

try {
  api = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
    cwd: resolve('.'),
    env: { ...process.env, ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', NODE_ENV: 'test', APP_ORIGIN: trustedOrigin, API_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  api.stdout?.on('data', chunk => { stdout += String(chunk) })
  api.stderr?.on('data', chunk => { stderr += String(chunk) })
  await waitForHealth()

  const records = await request(`/api/bookings?date=${reservationDate}`, 'GET', tokens.manager).then(response => response.json()) as BookingRecord[]
  const target = records.find(record => record.id === targetId)
  assert.ok(target)
  const correction = { ...target, covers: 4, bookingNumber: 'ATTEMPTED-IDENTITY-CHANGE', bookingSource: 'manual', bookedBy: 'Spoofed Client Actor', importSource: 'manual' }

  assert.equal((await request(`/api/bookings/${targetId}`, 'PUT', undefined, trustedOrigin, correction)).status, 401)
  assert.equal((await request(`/api/bookings/${targetId}`, 'PUT', tokens.viewer, trustedOrigin, correction)).status, 403)
  assert.equal((await request(`/api/bookings/${targetId}`, 'PUT', tokens.manager, 'https://untrusted.example', correction)).status, 401)

  const savedResponse = await request(`/api/bookings/${targetId}`, 'PUT', tokens.manager, trustedOrigin, correction)
  assert.equal(savedResponse.status, 200)
  const saved = await savedResponse.json() as BookingRecord
  assert.equal(saved.covers, 4)
  assert.equal(saved.bookingNumber, '2723242')
  assert.equal(saved.bookingSource, 'activity_program')
  assert.equal(saved.bookedBy, 'Reservations')
  assert.equal(saved.importSource, 'activity_program')
  assert.equal(saved.sourceGuestNotes, 'I: joining with 20 PAX, GROUP')
  assert.equal(saved.coverResolution?.baseCovers, 4)
  assert.equal(saved.coverResolution?.groupTotal, 20)

  const refreshed = await request(`/api/bookings?date=${reservationDate}`, 'GET', tokens.manager).then(response => response.json()) as BookingRecord[]
  assert.deepEqual(refreshed.filter(record => ['2723242', '2691640'].includes(record.bookingNumber)).map(record => [record.bookingNumber, record.covers]), [['2723242', 4], ['2691640', 16]])
  const summary = await request(`/api/bookings/summary?date=${reservationDate}`, 'GET', tokens.manager).then(response => response.json()) as { expectedCovers: number; arrivedCovers: number; noShowCovers: number }
  assert.equal(summary.expectedCovers, 101)
  assert.equal(summary.arrivedCovers, 101)
  assert.equal(summary.noShowCovers, 2)
} finally {
  await stop()
}

const verified = new PGlite(fixture.store)
try {
  const repository = new BookingRepository(verified)
  const refreshed = await repository.list(reservationDate)
  const target = refreshed.find(record => record.id === targetId)
  const companion = refreshed.find(record => record.id === companionId)
  assert.equal(target?.covers, 4)
  assert.equal(companion?.covers, 16)
  assert.equal((target?.covers || 0) + (companion?.covers || 0), 20)

  const persisted = (await verified.query<any>('select booking_number,booking_source,booked_by,import_source,source_guest_notes,raw_import_payload from bookings where id=$1', [targetId])).rows[0]
  assert.equal(persisted.booking_number, '2723242')
  assert.equal(persisted.booking_source, 'activity_program')
  assert.equal(persisted.booked_by, 'Reservations')
  assert.equal(persisted.import_source, 'activity_program')
  assert.equal(persisted.source_guest_notes, 'I: joining with 20 PAX, GROUP')
  assert.deepEqual(typeof persisted.raw_import_payload === 'string' ? JSON.parse(persisted.raw_import_payload) : persisted.raw_import_payload, originalPayload)

  const audit = (await verified.query<any>("select action,before_data,after_data,actor from audit_logs where entity_type='booking' and entity_id=$1 and action='updated' order by created_at desc limit 1", [targetId])).rows[0]
  assert.ok(audit)
  const before = typeof audit.before_data === 'string' ? JSON.parse(audit.before_data) : audit.before_data
  const after = typeof audit.after_data === 'string' ? JSON.parse(audit.after_data) : audit.after_data
  assert.equal(before.covers, 20)
  assert.equal(after.covers, 4)
  assert.equal(audit.actor, auditActorLabel({ userId: users.manager.id, displayName: users.manager.name }))
  assert.notEqual(audit.actor, 'Spoofed Client Actor')

  const statuses = (await repository.configuration()).statuses
  const board = buildHostessServiceBoard(refreshed, statuses, reservationDate, new Date('2026-10-07T12:00:00Z'))
  assert.equal(board.summary.arrivedCovers, 101)
  assert.equal(board.summary.noShowCovers, 2)
  const report = await new ReportingRepository(verified).report('custom', reservationDate, reservationDate)
  assert.equal(report.bookings.expectedCovers, 101)
  assert.equal(report.bookings.totalCovers, 103)

  const [uiSource, apiSource, css] = await Promise.all([readFile('src/bookings.tsx', 'utf8'), readFile('server/index.ts', 'utf8'), readFile('src/booking-service.css', 'utf8')])
  assert.match(uiSource, /onEdit=\{\(\) => \{ setEditing\(viewing\); setViewing\(null\) \}\}/)
  assert.match(uiSource, /<ActionButton[^>]*icon="edit"[^>]*>Edit Booking<\/ActionButton>/)
  assert.match(uiSource, /Imported source evidence is preserved/)
  assert.match(uiSource, /readOnly=\{imported\}/)
  assert.match(uiSource, /label="Total Adults"/)
  assert.match(uiSource, /label="Total Kids"/)
  assert.match(uiSource, /booking-guest-trigger/)
  assert.doesNotMatch(uiSource, />View Details<\/button>/)
  assert.match(uiSource, /selectedBookings\.reduce\(\(total, \{ booking \}\) => total \+ operationalPax\(booking\), 0\)/)
  assert.match(uiSource, /Reviewed · Import/)
  assert.doesNotMatch(uiSource, /<details className="booking-source-evidence"/)
  assert.match(uiSource, /className="detail-section booking-source-summary"/)
  assert.ok(
    uiSource.indexOf('className="detail-section booking-source-summary"') <
      uiSource.indexOf('className="detail-section operation-section compact-operation-card"'),
    "source and guest evidence must remain visible before the operational card",
  )
  assert.match(apiSource, /bookingNumber: imported \? previous\.bookingNumber/)
  assert.match(css, /\.booking-detail-actions[\s\S]*?\.booking-source-protection|\.booking-source-protection[\s\S]*?\.booking-detail-actions/)
  assert.match(css, /\.service-table td\.service-status-cell\{height:72px;padding-block:0;vertical-align:middle/)
  assert.match(css, /\.service-table \.service-status-controls\{box-sizing:border-box;display:flex;min-height:72px;padding-block:8px;flex-direction:column;justify-content:center/)
  assert.match(css, /\.service-table \.service-actions\{display:flex;gap:4px;margin-top:0;white-space:nowrap\}/)
  assert.match(css, /\.service-table \.service-actions button\{flex:1 1 0;width:auto/)

  console.log(JSON.stringify({ managerEditAction: true, importedIdentityProtected: true, sourceEvidencePreserved: true, anonymousRejected: true, insufficientPermissionRejected: true, trustedOriginRequired: true, auditBeforeAfterPreserved: true, refreshPersistence: true, bookings: { '2723242': target?.covers, '2691640': companion?.covers, combined: 20 }, dashboardAndHostessCovers: board.summary.arrivedCovers, reportIncludingNoShows: report.bookings.totalCovers, canonicalDatabaseTouched: false }, null, 2))
} finally {
  await verified.close()
  await fixture.cleanup()
}
