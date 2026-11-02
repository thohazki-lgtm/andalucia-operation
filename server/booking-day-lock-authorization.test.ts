import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import type { BookingDayLockStatus, BookingRecord } from '../src/domain.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const fixture = await createDisposableDevelopmentStore('booking-day-lock-authorization')
const db = fixture.db
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex')
const tokens = { manager: `day-lock-manager-${randomUUID()}`, operational: `day-lock-operational-${randomUUID()}` }
const users = { manager: { id: randomUUID(), role: 'outlet_manager' }, operational: { id: randomUUID(), role: 'operational_user' } }
for (const key of Object.keys(users) as Array<keyof typeof users>) {
  const user = users[key]
  await db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status,created_by,updated_by) values($1,$2,$2,$3,'isolated-test-no-login','active','Booking day lock test','Booking day lock test')", [user.id, `day-lock-${key}-${user.id}`, `Day Lock ${key}`])
  await db.query("insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval '1 hour')", [randomUUID(), tokenHash(tokens[key]), user.id])
  await db.query("insert into authorization_user_roles(id,user_id,role_id,active,created_by,updated_by) select $1,$2,id,true,'Booking day lock test','Booking day lock test' from authorization_roles where role_key=$3", [randomUUID(), user.id, user.role])
  await db.query("insert into authorization_user_outlet_scopes(id,user_id,outlet_scope_id,active,created_by,updated_by) values($1,$2,$3,true,'Booking day lock test','Booking day lock test')", [randomUUID(), user.id, ANDALUCIA_SCOPE_ID])
}
await db.close()

const date = '2026-11-01'
const origin = 'https://booking-day-lock.test'
const port = 3031
const base = `http://127.0.0.1:${port}`
const request = (path: string, method: string, token: string, payload?: unknown) => fetch(`${base}${path}`, {
  method,
  headers: { Cookie: `andalucia_session=${encodeURIComponent(token)}`, ...(method === 'GET' ? {} : { Origin: origin, 'Content-Type': 'application/json' }) },
  body: payload === undefined ? undefined : JSON.stringify(payload)
})
let api: ChildProcess | undefined
let stdout = ''
let stderr = ''
const stop = async () => {
  if (!api || api.exitCode !== null) return
  api.kill('SIGTERM')
  await Promise.race([new Promise<void>(done => api!.once('exit', () => done())), new Promise<void>(done => setTimeout(done, 5_000))])
  if (api.exitCode === null) api.kill('SIGKILL')
}

try {
  api = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
    cwd: resolve('.'), env: { ...process.env, ANDALUCIA_DATA_DIR: fixture.store, ANDALUCIA_STORE_ROLE: 'development', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: fixture.store, ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027', NODE_ENV: 'test', APP_ORIGIN: origin, API_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
  })
  api.stdout?.on('data', chunk => { stdout += String(chunk) })
  api.stderr?.on('data', chunk => { stderr += String(chunk) })
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) { try { if ((await fetch(`${base}/api/health`)).ok) break } catch {}; await new Promise(done => setTimeout(done, 150)) }
  if (!(await fetch(`${base}/api/health`)).ok) throw new Error(`Isolated API did not start. stdout=${stdout} stderr=${stderr}`)

  const automatic = await request(`/api/bookings/day-lock?date=${date}`, 'GET', tokens.manager)
  assert.equal(automatic.status, 200)
  assert.equal(((await automatic.json()) as BookingDayLockStatus).lockKind, 'automatic')

  assert.equal((await request('/api/bookings/day-lock/reopen', 'POST', tokens.operational, { date })).status, 403)
  const managerReopen = await request('/api/bookings/day-lock/reopen', 'POST', tokens.manager, { date })
  assert.equal(managerReopen.status, 200)
  const reopened = await managerReopen.json() as BookingDayLockStatus
  assert.equal(reopened.state, 'reopened')
  assert.equal(reopened.reopenedUntil, null)

  const booking: BookingRecord = { id: randomUUID(), guestName: 'Authorized correction guest', roomNumber: 'I02', birthDate: null, arrivalDate: null, departureDate: null, mealPeriod: 'Dinner', reservationDate: date, reservationTime: '19:00', bookingNumber: 'LOCK-AUTH', covers: 2, bookingStatus: 'confirmed', bookingSource: 'manual', bookedBy: 'Operational user', guestNotes: '', tableNumber: '', waiterId: null, waiter: null }
  assert.equal((await request('/api/bookings', 'POST', tokens.operational, booking)).status, 201, 'authorized booking editors may make audited corrections during the manager-opened window')
  assert.equal((await request('/api/bookings/day-lock/relock', 'POST', tokens.operational, { date, reason: 'Unauthorized re-lock attempt', confirmation: `RELOCK BOOKINGS ${date}` })).status, 403)
  assert.equal((await request('/api/bookings/day-lock/relock', 'POST', tokens.manager, { date, reason: 'Manager finalized correction window', confirmation: `RELOCK BOOKINGS ${date}` })).status, 200)
  assert.equal((await request(`/api/bookings/${booking.id}`, 'PUT', tokens.operational, { ...booking, covers: 3 })).status, 409)
  console.log('Booking day lock one-click manager authorization, persistent reopen and locked API mutation denial tests passed.')
} finally {
  await stop()
  await fixture.cleanup()
}
