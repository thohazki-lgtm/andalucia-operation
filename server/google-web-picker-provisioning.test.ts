import assert from 'node:assert/strict'
import {
  GoogleWebPickerProvisioningService,
  WEB_PICKER_APPROVAL_CHECKPOINT,
  WEB_PICKER_APPROVAL_PHRASE,
  WEB_PICKER_DESTINATION_NAME,
  WEB_PICKER_FOLDER_MIME,
  WEB_PICKER_PORT,
  assertMyDriveFolder,
  assertPickerDocuments,
  assertVerifiedIdentity,
  webPickerClientScript
} from './google-web-picker-provisioning.js'
import { WEB_PICKER_API_KEY_REFERENCE, WEB_PICKER_OAUTH_REFERENCE, WEB_PICKER_ORIGIN, WEB_PICKER_PROJECT_NUMBER, WEB_PICKER_REDIRECT_URI } from './google-web-picker-credential-configuration.js'
import { GOOGLE_DRIVE_FILE_SCOPE, type CloudCredential, type CloudCredentialStore, type DriveFolder, type DriveIdentity, type DriveTransport } from './secure-cloud-upload.js'

const ACCESS = 'ACCESS_TOKEN_CANARY_NOT_REAL'
const REFRESH = 'REFRESH_TOKEN_CANARY_NOT_REAL'
const CLIENT_SECRET = 'WEB_CLIENT_SECRET_CANARY_NOT_REAL'
const API_KEY = `AIza${'B'.repeat(35)}`
const identity: DriveIdentity = { permissionId: 'permission-verified-1234', emailAddress: 'manager@example.invalid' }
const folder: DriveFolder = { id: 'folder-selected', name: WEB_PICKER_DESTINATION_NAME, mimeType: WEB_PICKER_FOLDER_MIME, trashed: false, owners: [identity], canAddChildren: true }
const calls = { identity: 0, folder: 0, mutations: 0, token: 0, configuration: 0 }

const unsupportedMutation = async () => { calls.mutations += 1; throw new Error('UNEXPECTED_DRIVE_MUTATION') }
const drive: DriveTransport = {
  identity: async () => { calls.identity += 1; return identity },
  folder: async () => { calls.folder += 1; return folder },
  candidates: async () => { calls.mutations += 1; return [] },
  createSession: unsupportedMutation as any,
  upload: unsupportedMutation as any,
  remote: unsupportedMutation as any,
  finalizePair: unsupportedMutation as any,
  remove: unsupportedMutation as any
}

const configurationStore = {
  async load(oauthReference: string, apiKeyReference: string) {
    calls.configuration += 1
    assert.equal(oauthReference, WEB_PICKER_OAUTH_REFERENCE)
    assert.equal(apiKeyReference, WEB_PICKER_API_KEY_REFERENCE)
    return { clientId: 'synthetic-web.apps.googleusercontent.com', clientSecret: CLIENT_SECRET, apiKey: API_KEY }
  }
}

const http = async (url: string, init?: RequestInit) => {
  calls.token += 1
  assert.equal(url, 'https://oauth2.googleapis.com/token')
  const body = new URLSearchParams(String(init?.body || ''))
  assert.equal(body.get('client_secret'), CLIENT_SECRET)
  assert.equal(body.get('grant_type'), 'authorization_code')
  assert.equal(body.get('redirect_uri'), WEB_PICKER_REDIRECT_URI)
  assert.ok(body.get('code_verifier'))
  return new Response(JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, scope: GOOGLE_DRIVE_FILE_SCOPE }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

let now = Date.parse('2026-10-06T08:00:00Z')
const service = new GoogleWebPickerProvisioningService({ configurationStore, drive, http, now: () => now })
await service.listen()

const beginOAuth = async () => {
  const created = await service.createSession()
  assert.match(created.localUrl, new RegExp(`^http://127\\.0\\.0\\.1:${WEB_PICKER_PORT}/provision/`))
  const sessionId = created.localUrl.split('/').at(-1)!
  const landing = await fetch(created.localUrl)
  assert.equal(landing.status, 200)
  assert.equal(landing.headers.get('cache-control')?.includes('no-store'), true)
  assert.equal(landing.headers.get('referrer-policy'), 'no-referrer')
  assert.match(landing.headers.get('content-security-policy') || '', /worker-src 'none'/)
  const landingText = await landing.text()
  for (const secret of [ACCESS, REFRESH, CLIENT_SECRET, API_KEY]) assert.equal(landingText.includes(secret), false)
  const oauthStart = await fetch(`${created.localUrl}/oauth`, { redirect: 'manual' })
  assert.equal(oauthStart.status, 303)
  assert.equal(oauthStart.headers.get('referrer-policy'), 'no-referrer')
  const authorization = new URL(oauthStart.headers.get('location')!)
  assert.equal(authorization.origin, 'https://accounts.google.com')
  assert.equal(authorization.searchParams.get('scope'), GOOGLE_DRIVE_FILE_SCOPE)
  assert.equal(authorization.searchParams.get('redirect_uri'), WEB_PICKER_REDIRECT_URI)
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(authorization.searchParams.has('file_ids'), false)
  return { created, sessionId, authorization }
}

const completeOAuth = async (value: Awaited<ReturnType<typeof beginOAuth>>) => {
  const callback = new URL(WEB_PICKER_REDIRECT_URI)
  callback.searchParams.set('state', value.authorization.searchParams.get('state')!)
  callback.searchParams.set('code', 'AUTHORIZATION_CODE_CANARY_NOT_REAL')
  const response = await fetch(callback, { redirect: 'manual' })
  assert.equal(response.status, 303)
  assert.equal(response.headers.get('location'), `${value.created.localUrl}/picker`)
  const pickerPage = await fetch(response.headers.get('location')!)
  const html = await pickerPage.text()
  assert.equal(pickerPage.status, 200)
  assert.equal(pickerPage.headers.get('referrer-policy'), 'origin')
  assert.match(html, /<meta name="referrer" content="origin">/)
  assert.equal(html.includes('content="no-referrer"'), false)
  for (const secret of [ACCESS, REFRESH, CLIENT_SECRET, API_KEY]) assert.equal(html.includes(secret), false)
  for (const url of [value.created.localUrl, response.headers.get('location') || '']) {
    for (const secret of [ACCESS, REFRESH, CLIENT_SECRET, API_KEY, 'AUTHORIZATION_CODE_CANARY_NOT_REAL']) assert.equal(url.includes(secret), false)
  }
  const csrf = html.match(/data-csrf="([A-Za-z0-9_-]+)"/)?.[1]
  assert.ok(csrf)
  return { ...value, callback, csrf: csrf! }
}

const happy = await completeOAuth(await beginOAuth())
const bootstrap = await fetch(`${WEB_PICKER_ORIGIN}/api/web-picker/bootstrap`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ANDALUCIA-CSRF': happy.csrf }, body: JSON.stringify({ sessionId: happy.sessionId })
})
assert.equal(bootstrap.status, 200)
const bootstrapValue = await bootstrap.json() as any
assert.equal(bootstrapValue.accessToken, ACCESS)
assert.equal(bootstrapValue.developerKey, API_KEY)
assert.equal(bootstrapValue.appId, WEB_PICKER_PROJECT_NUMBER)
assert.equal(bootstrapValue.scope, GOOGLE_DRIVE_FILE_SCOPE)

const picked = await fetch(`${WEB_PICKER_ORIGIN}/api/web-picker/callback`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ANDALUCIA-CSRF': happy.csrf },
  body: JSON.stringify({ sessionId: happy.sessionId, action: 'picked', documents: [{ id: folder.id, mimeType: WEB_PICKER_FOLDER_MIME }] })
})
assert.equal(picked.status, 200)
const pickedValue = await picked.json() as any
assert.equal(pickedValue.approvalUrl, `${happy.created.localUrl}/approval`)
const checkpoint = service.inspectCheckpoint(happy.sessionId)
assert.equal(checkpoint?.state, WEB_PICKER_APPROVAL_CHECKPOINT)
assert.equal(checkpoint?.destination.name, WEB_PICKER_DESTINATION_NAME)
assert.equal(JSON.stringify(checkpoint).includes(identity.emailAddress), false)

class MemoryCredentials implements CloudCredentialStore {
  value: CloudCredential | null = null
  async load(_reference: string) { return this.value }
  async save(_reference: string, credential: CloudCredential) { this.value = structuredClone(credential) }
  async remove(_reference: string) { this.value = null }
}
const durable = new MemoryCredentials()
assert.equal(await durable.load('andalucia-cloud:web-picker-production'), null, 'no durable credential before explicit approval')
assert.equal((await service.approveDestination(happy.sessionId, WEB_PICKER_APPROVAL_PHRASE, durable, 'andalucia-cloud:web-picker-production', 'Encrypted database backups')).stored, true)
assert.equal((await durable.load('andalucia-cloud:web-picker-production'))?.approvedDestination?.folderId, folder.id)

const replay = await completeOAuth(await beginOAuth())
assert.equal((await fetch(replay.callback, { redirect: 'manual' })).status, 400)

const stateMismatch = await beginOAuth()
const wrongStateCallback = new URL(WEB_PICKER_REDIRECT_URI)
wrongStateCallback.searchParams.set('state', 'wrong-oauth-state-value-000000')
wrongStateCallback.searchParams.set('code', 'AUTHORIZATION_CODE_CANARY_NOT_REAL')
assert.equal((await fetch(wrongStateCallback, { redirect: 'manual' })).status, 400)

const bootstrapReplay = await completeOAuth(await beginOAuth())
const bootstrapRequest = () => fetch(`${WEB_PICKER_ORIGIN}/api/web-picker/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ANDALUCIA-CSRF': bootstrapReplay.csrf }, body: JSON.stringify({ sessionId: bootstrapReplay.sessionId }) })
assert.equal((await bootstrapRequest()).status, 200)
assert.equal((await bootstrapRequest()).status, 400)

const csrfRejected = await completeOAuth(await beginOAuth())
assert.equal((await fetch(`${WEB_PICKER_ORIGIN}/api/web-picker/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ANDALUCIA-CSRF': 'wrong-csrf-token-value-000' }, body: JSON.stringify({ sessionId: csrfRejected.sessionId }) })).status, 400)

const cancelled = await completeOAuth(await beginOAuth())
assert.equal((await fetch(`${WEB_PICKER_ORIGIN}/api/web-picker/callback`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ANDALUCIA-CSRF': cancelled.csrf }, body: JSON.stringify({ sessionId: cancelled.sessionId, action: 'cancel', documents: [] }) })).status, 400)

const expiring = await service.createSession()
now += 300_001
assert.equal((await fetch(expiring.localUrl)).status, 400)

assert.equal(assertPickerDocuments('picked', [{ id: folder.id, mimeType: WEB_PICKER_FOLDER_MIME }]), folder.id)
assert.throws(() => assertPickerDocuments('picked', []), /WEB_PICKER_SELECTION_INVALID/)
assert.throws(() => assertPickerDocuments('picked', [{ id: 'a', mimeType: WEB_PICKER_FOLDER_MIME }, { id: 'b', mimeType: WEB_PICKER_FOLDER_MIME }]), /WEB_PICKER_SELECTION_INVALID/)
assert.throws(() => assertPickerDocuments('picked', [{ id: folder.id, mimeType: 'application/pdf' }]), /WEB_PICKER_SELECTION_INVALID/)
assert.throws(() => assertVerifiedIdentity({ ...identity, permissionId: 'other' }, identity), /WEB_PICKER_IDENTITY_MISMATCH/)
assert.throws(() => assertMyDriveFolder({ ...folder, name: 'Wrong folder' }, identity), /WEB_PICKER_DESTINATION_INVALID/)
assert.throws(() => assertMyDriveFolder({ ...folder, driveId: 'shared-drive' }, identity), /WEB_PICKER_SHARED_DRIVE_REJECTED/)
assert.throws(() => assertMyDriveFolder({ ...folder, owners: [{ permissionId: 'other', emailAddress: 'other@example.invalid' }] }, identity), /WEB_PICKER_MY_DRIVE_RELATIONSHIP_INVALID/)

assert.match(webPickerClientScript, /google\.picker\.PickerBuilder/)
assert.match(webPickerClientScript, /google\.picker\.ViewId\.FOLDERS/)
assert.match(webPickerClientScript, /setIncludeFolders\(true\)/)
assert.match(webPickerClientScript, /setSelectFolderEnabled\(true\)/)
assert.equal(/setMimeTypes\(/.test(webPickerClientScript), false)
assert.match(webPickerClientScript, /DocsViewMode\.LIST/)
assert.match(webPickerClientScript, /setAppId/)
assert.match(webPickerClientScript, /setDeveloperKey/)
assert.match(webPickerClientScript, /setOAuthToken/)
assert.equal(/file_ids|localStorage|sessionStorage|serviceWorker/.test(webPickerClientScript), false)
assert.equal(calls.mutations, 0)

const evidence = JSON.stringify({ checkpoint, calls: { ...calls, token: calls.token > 0 }, configuration: { origin: WEB_PICKER_ORIGIN, redirectUri: WEB_PICKER_REDIRECT_URI, scope: GOOGLE_DRIVE_FILE_SCOPE } })
for (const secret of [ACCESS, REFRESH, CLIENT_SECRET, API_KEY, 'AUTHORIZATION_CODE_CANARY_NOT_REAL']) assert.equal(evidence.includes(secret), false)

await service.close()
console.log(JSON.stringify({
  status: 'PASS', loopbackOnly: true, stablePort: WEB_PICKER_PORT, oneUseSessions: true, expiryRejected: true, csrfRejected: true, oauthStateMismatchRejected: true,
  callbackReplayRejected: true, scope: GOOGLE_DRIVE_FILE_SCOPE, pickerBuilder: true, folderSelection: true, exactlyOneFolder: true,
  cancellationRejected: true, identityMismatchRejected: true, myDriveOnly: true, sharedDriveRejected: true,
  noPreApprovalCredentialRetention: true, driveMutations: calls.mutations, secretCanariesAbsent: true, realOAuth: false, realPicker: false, realDrive: false
}, null, 2))
