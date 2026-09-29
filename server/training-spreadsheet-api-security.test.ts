import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { canonicalStoreDirectory, readStoreIdentity } from './database-protection.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { TRAINING_UPLOAD_MAX_BYTES } from './training-spreadsheet-security.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const root = resolve('.')
const fixture = await createDisposableDevelopmentStore('training-spreadsheet-api-security')
const developmentStoreDirectory = fixture.store
const normalized = (value: string) => resolve(value).replaceAll('\\', '/').toLowerCase()
assert.notEqual(normalized(developmentStoreDirectory), normalized(canonicalStoreDirectory), 'The API security test must never select the canonical store.')
const identity = await readStoreIdentity(developmentStoreDirectory, 'development')
assert.equal(identity.role, 'development')

const tokens = {
  owner: `r1-12-owner-${randomUUID()}`,
  noPermission: `r1-12-no-permission-${randomUUID()}`,
  wrongOutlet: `r1-12-wrong-outlet-${randomUUID()}`
}
const userIds = {
  owner: randomUUID(),
  noPermission: randomUUID(),
  wrongOutlet: randomUUID()
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const db = fixture.db
const before = Number((await db.query<{ count: number }>('select count(*)::int count from training_sessions')).rows[0]?.count || 0)
for (const [key, id] of Object.entries(userIds)) {
  await db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status,created_by,updated_by) values($1,$2,$2,$3,'isolated-test-no-login','active','R1.12 isolated test','R1.12 isolated test')", [id, `r112-${key}-${id}`, `R1.12 ${key}`])
  await db.query("insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,now()+interval '1 hour')", [randomUUID(), hash(tokens[key as keyof typeof tokens]), id])
}
await db.query("insert into authorization_user_roles(id,user_id,role_id,active,created_by,updated_by) select $1,$2,id,true,'R1.12 isolated test','R1.12 isolated test' from authorization_roles where role_key='owner'", [randomUUID(), userIds.owner])
await db.query("insert into authorization_user_roles(id,user_id,role_id,active,created_by,updated_by) select $1,$2,id,true,'R1.12 isolated test','R1.12 isolated test' from authorization_roles where role_key='viewer'", [randomUUID(), userIds.noPermission])
await db.query("insert into authorization_user_roles(id,user_id,role_id,active,created_by,updated_by) select $1,$2,id,true,'R1.12 isolated test','R1.12 isolated test' from authorization_roles where role_key='operational_user'", [randomUUID(), userIds.wrongOutlet])
await db.query("insert into authorization_user_outlet_scopes(id,user_id,outlet_scope_id,active,created_by,updated_by) values($1,$2,$3,true,'R1.12 isolated test','R1.12 isolated test')", [randomUUID(), userIds.noPermission, ANDALUCIA_SCOPE_ID])
await db.close()

const port = 3012
const base = `http://127.0.0.1:${port}`
const trustedOrigin = 'https://r1-12-security.test'
let api: ChildProcess | undefined
let stdout = ''
let stderr = ''
const stop = async () => {
  if (!api || api.exitCode !== null) return
  api.kill('SIGTERM')
  await Promise.race([
    new Promise<void>(resolveExit => api!.once('exit', () => resolveExit())),
    new Promise<void>(resolveTimeout => setTimeout(resolveTimeout, 5_000))
  ])
  if (api.exitCode === null) api.kill('SIGKILL')
}
const waitForHealth = async () => {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try { const response = await fetch(`${base}/api/health`); if (response.ok) return response }
    catch { /* wait for the isolated API */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 150))
  }
  throw new Error(`Isolated API did not become healthy. stdout=${stdout} stderr=${stderr}`)
}
const upload = (data: Uint8Array, options: { token?: string; origin?: string; mime?: string; filename?: string } = {}) => fetch(`${base}/api/training/import-preview?filename=${encodeURIComponent(options.filename || 'training.xlsx')}`, {
  method: 'POST',
  headers: {
    Origin: options.origin || trustedOrigin,
    'Content-Type': options.mime || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ...(options.token ? { Cookie: `andalucia_session=${encodeURIComponent(options.token)}` } : {})
  },
  body: Buffer.from(data)
})

try {
  api = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
      ANDALUCIA_DATA_DIR: developmentStoreDirectory,
      ANDALUCIA_STORE_ROLE: 'development',
      NODE_ENV: 'test',
      ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: developmentStoreDirectory,
      ANDALUCIA_REQUIRED_SCHEMA_VERSION: '018',
      APP_ORIGIN: trustedOrigin,
      API_PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  api.stdout?.on('data', chunk => { stdout += String(chunk) })
  api.stderr?.on('data', chunk => { stderr += String(chunk) })
  const health = await waitForHealth()
  assert.equal(health.status, 200)

  const invalidWorkbook = new Uint8Array([1, 2, 3, 4])
  assert.equal((await upload(invalidWorkbook, { token: tokens.owner, origin: 'https://untrusted.test' })).status, 401)
  assert.equal((await upload(invalidWorkbook)).status, 401)
  assert.equal((await upload(invalidWorkbook, { token: `invalid-${randomUUID()}` })).status, 401)
  assert.equal((await upload(invalidWorkbook, { token: tokens.noPermission })).status, 403)
  assert.equal((await upload(invalidWorkbook, { token: tokens.wrongOutlet })).status, 403)

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Date', 'Topic', 'Time', 'Trainer', 'Location'],
    ['27-Sep-26', 'R1.12 Synthetic Training', '17:30-18:00', 'Security Test', 'Andalucía']
  ]), 'Training')
  const data = new Uint8Array(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
  const previewResponse = await upload(data, { token: tokens.owner })
  if (previewResponse.status !== 200) throw new Error(`Authorized preview failed (${previewResponse.status}): ${await previewResponse.text()}`)
  const preview = await previewResponse.json() as { summary?: { detected?: number } }
  assert.equal(preview.summary?.detected, 1)

  const mimeMismatch = await upload(data, { token: tokens.owner, mime: 'application/pdf' })
  assert.equal(mimeMismatch.status, 400)
  assert.match(String((await mimeMismatch.json() as { message?: string }).message), /content type does not match/)

  const malformedResponse = await upload(invalidWorkbook, { token: tokens.owner })
  assert.equal(malformedResponse.status, 400)
  assert.match(String((await malformedResponse.json() as { message?: string }).message), /Office Open XML ZIP container/)
  assert.equal((await fetch(`${base}/api/health`)).status, 200, 'A malformed workbook must not crash the API.')

  const oversized = new Uint8Array(TRAINING_UPLOAD_MAX_BYTES + 1)
  oversized.set([0x50, 0x4b, 0x03, 0x04])
  const oversizedResponse = await upload(oversized, { token: tokens.owner })
  assert.equal(oversizedResponse.status, 400)
  assert.match(String((await oversizedResponse.json() as { message?: string }).message), /Training calendar exceeds the 20 MB upload limit/)
  assert.equal((await fetch(`${base}/api/health`)).status, 200, 'The API must remain responsive after an oversized upload.')

  const sessionsResponse = await fetch(`${base}/api/training`, { headers: { Cookie: `andalucia_session=${encodeURIComponent(tokens.owner)}` } })
  assert.equal(sessionsResponse.status, 200)
  const sessions = await sessionsResponse.json() as unknown[]
  assert.equal(sessions.length, before, 'Preview must not persist Training sessions.')

  console.log(JSON.stringify({
    isolatedStoreRole: identity.role,
    canonicalStoreSelected: false,
    trustedOriginBeforeParsing: true,
    anonymousBeforeParsing: true,
    invalidSessionBeforeParsing: true,
    missingPermissionBeforeParsing: true,
    wrongOutletBeforeParsing: true,
    authorizedPreview: true,
    previewTrainingMutations: sessions.length - before,
    mimeMismatchControlled: true,
    malformedWorkbookControlled: true,
    parserFailureTrainingMutations: sessions.length - before,
    oversizedUploadControlled: true,
    apiResponsiveAfterRejection: true
  }, null, 2))
} finally {
  await stop()
  await fixture.cleanup()
}
