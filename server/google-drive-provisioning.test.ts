import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GoogleDesktopOAuthCoordinator } from './google-drive-cloud-client.js'
import {
  LoopbackOAuthCallbackServer,
  ManagerControlledCloudProvisioning,
  assertCredentialPayload,
  assertDestinationFolder,
  assertExistingBindingCompatible,
  maskGoogleIdentity,
  type LoopbackCallbackBoundary,
  type ManagerApprovalBoundary,
  type ProvisioningInput
} from './google-drive-provisioning.js'
import {
  GOOGLE_DRIVE_FILE_SCOPE,
  OFFDEVICE_EXPORT_FORMAT,
  type CloudCredential,
  type CloudCredentialStore,
  type DriveFolder,
  type DriveIdentity,
  type DriveTransport,
  type FinalizePairRequest,
  type RemoteRecoveryObject,
  type RemoteUploadRequest,
  type UploadSession
} from './secure-cloud-upload.js'

const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const md5 = (value: Uint8Array) => createHash('md5').update(value).digest('hex')
const expectFailure = async (promise: Promise<unknown>, pattern: RegExp) => { await assert.rejects(promise, pattern) }
const testRoot = await mkdtemp(join(tmpdir(), 'andalucia-cloud-provisioning-'))
const pairRoot = join(testRoot, 'pair')
await mkdir(pairRoot)
const artifact = Buffer.from(`synthetic-encrypted-recovery-${'x'.repeat(73)}`)
const artifactName = 'andalucia-synthetic.tar.gz.age'
const sidecar = {
  exportFormat: OFFDEVICE_EXPORT_FORMAT, sourceBackupId: 'synthetic-backup', sourceState: 'VERIFIED_REHEARSED', sourceSchema: '018',
  sourceManifestSha256: 'a'.repeat(64), sourceFileCount: 3, sourceTotalBytes: 1234, encryptedFilename: artifactName,
  encryptedSha256: sha256(artifact), encryptedBytes: artifact.byteLength, localVerification: 'VERIFIED'
}
const artifactPath = join(pairRoot, artifactName)
const sidecarPath = join(pairRoot, 'andalucia-synthetic.offdevice.json')
await writeFile(artifactPath, artifact)
await writeFile(sidecarPath, JSON.stringify(sidecar))

const input: ProvisioningInput = {
  clientId: 'synthetic-client-id.apps.googleusercontent.com', credentialReference: 'andalucia-cloud:synthetic',
  destination: { folderId: 'folder-1', label: 'Synthetic disaster recovery', relationship: 'MY_DRIVE' },
  approvedRoot: pairRoot, artifactPath, sidecarPath, expectedBackupId: 'synthetic-backup', expectedSchema: '018',
  expectedManifestSha256: 'a'.repeat(64), callbackTimeoutMs: 10_000
}
const identity: DriveIdentity = { permissionId: 'permission-1234567890', emailAddress: 'manager@example.invalid' }
const credential: CloudCredential = { accessToken: 'CANARY_ACCESS_TOKEN', refreshToken: 'CANARY_REFRESH_TOKEN', expiresAt: '2030-01-01T00:00:00Z', grantedScopes: [GOOGLE_DRIVE_FILE_SCOPE] }

class MemoryCredentialStore implements CloudCredentialStore {
  values = new Map<string, CloudCredential>()
  failSave = false
  failLoad = false
  malformedReadback = false
  async load(reference: string) {
    if (this.failLoad) throw new Error('CREDENTIAL_STORE_READ_FAILED')
    const value = this.values.get(reference) || null
    return this.malformedReadback && value ? ({ grantedScopes: value.grantedScopes } as CloudCredential) : value
  }
  async save(reference: string, value: CloudCredential) {
    if (this.failSave) throw new Error('CREDENTIAL_STORE_WRITE_FAILED')
    this.values.set(reference, structuredClone(value))
  }
  async remove(reference: string) { this.values.delete(reference) }
}

class SyntheticDrive implements DriveTransport {
  objects = new Map<string, RemoteRecoveryObject>()
  sessions = new Map<string, RemoteUploadRequest>()
  sequence = 0
  wrongFolderId = false
  wrongOwner = false
  failUploadRole = ''
  remoteHashMismatch = false
  async identity() { return identity }
  async folder(): Promise<DriveFolder> {
    return { id: this.wrongFolderId ? 'other-folder' : input.destination.folderId, mimeType: 'application/vnd.google-apps.folder', trashed: false, owners: [this.wrongOwner ? { permissionId: 'other', emailAddress: 'other@example.invalid' } : identity], canAddChildren: true }
  }
  async candidates(_credential: CloudCredential, _folderId: string, names: string[], backupId: string) { return [...this.objects.values()].filter(item => names.includes(item.name) && item.appProperties.backupId === backupId) }
  async createSession(_credential: CloudCredential, request: RemoteUploadRequest) { const id = `remote-${++this.sequence}`; this.sessions.set(id, request); return { url: `synthetic://${id}`, remoteId: id } }
  async upload(_credential: CloudCredential, session: UploadSession, bytes: Uint8Array) {
    const request = this.sessions.get(session.remoteId!)!
    if (request.appProperties.role === this.failUploadRole) throw new Error('PERMANENT_UPLOAD_FAILURE')
    const value: RemoteRecoveryObject = { id: session.remoteId!, name: request.name, parents: [request.parentId], bytes: bytes.byteLength, md5Checksum: this.remoteHashMismatch ? '0'.repeat(32) : md5(bytes), sha256Checksum: this.remoteHashMismatch ? '0'.repeat(64) : sha256(bytes), appProperties: { ...request.appProperties } }
    this.objects.set(value.id, value)
    return value.id
  }
  async remote(_credential: CloudCredential, id: string) { return this.objects.get(id)! }
  async finalizePair(_credential: CloudCredential, request: FinalizePairRequest) {
    for (const [role, item] of [['artifact', request.artifact], ['sidecar', request.sidecar]] as const) {
      const remote = this.objects.get(item.id)!
      remote.name = item.name
      remote.appProperties = { ...remote.appProperties, backupId: item.backupId, pairId: request.pairId, role, state: 'VERIFIED_PAIR', sha256: item.sha256 }
    }
  }
  async remove(_credential: CloudCredential, id: string) { this.objects.delete(id) }
}

class SyntheticManager implements ManagerApprovalBoundary {
  authorize = true
  identity = true
  destination = true
  publication = true
  localUrl = ''
  async authorizationReady(localUrl: string) { this.localUrl = localUrl; if (!this.authorize) throw new Error('MANAGER_AUTHORIZATION_CANCELLED') }
  async approveIdentity() { return this.identity }
  async approveDestination() { return this.destination }
  async approvePublication() { return this.publication }
}

class SyntheticCallback implements LoopbackCallbackBoundary {
  redirectUri = 'http://127.0.0.1:49111/callback'
  localAuthorizationUrl = 'http://127.0.0.1:49111/authorize'
  authorizationUrl = ''
  closed = false
  result = { state: 'synthetic-state', code: 'synthetic-code' }
  setAuthorizationUrl(value: string) { this.authorizationUrl = value }
  async wait() { return this.result }
  async close() { this.closed = true }
}

const createRunner = (options: { store?: MemoryCredentialStore; drive?: SyntheticDrive; manager?: SyntheticManager; callback?: SyntheticCallback; scopes?: string[]; expiresAt?: string; completeFailure?: string } = {}) => {
  const store = options.store || new MemoryCredentialStore()
  const drive = options.drive || new SyntheticDrive()
  const manager = options.manager || new SyntheticManager()
  const callback = options.callback || new SyntheticCallback()
  const runner = new ManagerControlledCloudProvisioning({
    credentials: store, drive, manager, createCallback: async () => callback,
    createOAuth: () => ({
      begin: reference => ({ authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?synthetic=1', state: 'synthetic-state', verifier: 'synthetic-verifier', redirectUri: callback.redirectUri, credentialReference: reference }),
      complete: async (pending, value) => {
        if (options.completeFailure) throw new Error(options.completeFailure)
        if (value.state !== pending.state) throw new Error('OAUTH_STATE_MISMATCH')
        const scopes = options.scopes || [GOOGLE_DRIVE_FILE_SCOPE]
        await store.save(pending.credentialReference, { ...credential, grantedScopes: scopes, expiresAt: options.expiresAt || credential.expiresAt })
        return { stored: true as const, grantedScopes: scopes }
      }
    }),
    now: () => new Date('2026-10-05T00:00:00Z'), operationId: () => 'operation-1'
  })
  return { runner, store, drive, manager, callback }
}

// Successful end-to-end synthetic manager provisioning and idempotent retry.
const successFixture = createRunner()
const success = await successFixture.runner.execute(input)
assert.equal(success.status, 'SUCCEEDED')
assert.equal(success.scope, GOOGLE_DRIVE_FILE_SCOPE)
assert.equal(successFixture.manager.localUrl, successFixture.callback.localAuthorizationUrl)
assert.equal(successFixture.callback.closed, true)
assert.equal(successFixture.store.values.has(input.credentialReference), true)
assert.equal([...successFixture.store.values.keys()].some(key => key.includes('.pending-')), false)
assert.equal((await successFixture.store.load(input.credentialReference))?.approvedDestination?.folderId, input.destination.folderId)
const idempotent = await successFixture.runner.execute(input)
assert.equal(idempotent.status, 'ALREADY_PRESENT_VERIFIED')
assert.equal(successFixture.drive.sequence, 2)

// Manager-controlled approval boundaries fail closed and clean pending credentials.
for (const [stage, configure, pattern] of [
  ['authorization', (manager: SyntheticManager) => { manager.authorize = false }, /MANAGER_AUTHORIZATION_CANCELLED/],
  ['identity', (manager: SyntheticManager) => { manager.identity = false }, /MANAGER_IDENTITY_APPROVAL_REQUIRED/],
  ['destination', (manager: SyntheticManager) => { manager.destination = false }, /MANAGER_DESTINATION_APPROVAL_REQUIRED/],
  ['publication', (manager: SyntheticManager) => { manager.publication = false }, /MANAGER_PUBLICATION_APPROVAL_REQUIRED/]
] as Array<[string, (manager: SyntheticManager) => void, RegExp]>) {
  const fixture = createRunner(); configure(fixture.manager)
  await expectFailure(fixture.runner.execute(input), pattern)
  assert.equal([...fixture.store.values.keys()].some(key => key.includes('.pending-')), false, `${stage} left pending credentials`)
}

// OAuth state, token, PKCE exchange, callback, and scope failures.
const oauthStore = new MemoryCredentialStore()
const oauth = new GoogleDesktopOAuthCoordinator({ configuration: { clientId: 'client', redirectUri: 'http://127.0.0.1:49112/callback' }, credentials: oauthStore, randomState: () => 'expected-state', http: async (_url, init) => {
  const body = String(init?.body)
  assert.match(body, /code_verifier=/)
  return new Response(JSON.stringify({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600, scope: GOOGLE_DRIVE_FILE_SCOPE }), { status: 200, headers: { 'Content-Type': 'application/json' } })
} })
const oauthPending = oauth.begin('andalucia-cloud:oauth')
await expectFailure(oauth.complete(oauthPending, { state: 'wrong', code: 'code' }), /OAUTH_STATE_MISMATCH/)
await oauth.complete(oauthPending, { state: oauthPending.state, code: 'code' })
const tokenFailure = createRunner({ completeFailure: 'OAUTH_TOKEN_EXCHANGE_FAILED' })
await expectFailure(tokenFailure.runner.execute(input), /OAUTH_TOKEN_EXCHANGE_FAILED/)
for (const scopes of [[], ['https://www.googleapis.com/auth/drive'], [GOOGLE_DRIVE_FILE_SCOPE, 'openid']] as string[][]) {
  const broad = createRunner({ scopes })
  await expectFailure(broad.runner.execute(input), /CLOUD_AUTHORIZATION_SCOPE_REJECTED/)
}

// Credential Locker abstraction failures, malformed/expired data, and readback failure.
const saveFailureStore = new MemoryCredentialStore(); saveFailureStore.failSave = true
await expectFailure(createRunner({ store: saveFailureStore }).runner.execute(input), /CREDENTIAL_STORE_WRITE_FAILED/)
const readFailureStore = new MemoryCredentialStore(); readFailureStore.failLoad = true
await expectFailure(createRunner({ store: readFailureStore }).runner.execute(input), /CREDENTIAL_STORE_READ_FAILED/)
assert.throws(() => assertCredentialPayload(null), /CLOUD_CREDENTIAL_MALFORMED/)
assert.throws(() => assertCredentialPayload({ grantedScopes: [GOOGLE_DRIVE_FILE_SCOPE] } as CloudCredential), /CLOUD_CREDENTIAL_MALFORMED/)
assert.throws(() => assertCredentialPayload({ ...credential, expiresAt: '2020-01-01T00:00:00Z' }, new Date('2026-10-05T00:00:00Z')), /CLOUD_AUTHORIZATION_EXPIRED/)
const malformedStore = new MemoryCredentialStore(); malformedStore.malformedReadback = true
await expectFailure(createRunner({ store: malformedStore }).runner.execute(input), /CLOUD_CREDENTIAL_MALFORMED/)
await expectFailure(createRunner({ expiresAt: '2020-01-01T00:00:00Z' }).runner.execute(input), /CLOUD_AUTHORIZATION_EXPIRED/)

// Identity/destination mismatches and immutable binding conflicts.
assert.deepEqual(maskGoogleIdentity(identity), { maskedEmail: 'm***@example.invalid', permissionFingerprint: 'perm...7890' })
const wrongFolder = new SyntheticDrive(); wrongFolder.wrongFolderId = true
await expectFailure(createRunner({ drive: wrongFolder }).runner.execute(input), /DESTINATION_FOLDER_UNVERIFIED/)
const wrongOwner = new SyntheticDrive(); wrongOwner.wrongOwner = true
await expectFailure(createRunner({ drive: wrongOwner }).runner.execute(input), /DESTINATION_OWNERSHIP_MISMATCH/)
assert.throws(() => assertDestinationFolder({ id: 'other', mimeType: 'application/vnd.google-apps.folder', trashed: false, owners: [identity], canAddChildren: true }, identity, input.destination), /DESTINATION_FOLDER_UNVERIFIED/)
assert.throws(() => assertExistingBindingCompatible({ ...credential, approvedDestination: { version: 1, credentialReference: input.credentialReference, label: 'Other', folderId: 'other', account: identity, relationship: 'MY_DRIVE' } }, identity, input.destination), /EXISTING_DESTINATION_BINDING_MISMATCH/)
assert.throws(() => assertExistingBindingCompatible({ ...credential, approvedDestination: { version: 1, credentialReference: input.credentialReference, label: 'Other', folderId: input.destination.folderId, account: { permissionId: 'other', emailAddress: 'other@example.invalid' }, relationship: 'MY_DRIVE' } }, identity, input.destination), /EXISTING_IDENTITY_BINDING_MISMATCH/)

// Artifact/sidecar/binding, upload interruption, remote checksum, partial-pair cleanup, and duplicate conflict failures flow through the production coordinator.
const badManifest = { ...input, expectedManifestSha256: 'b'.repeat(64) }
await expectFailure(createRunner().runner.execute(badManifest), /LOCAL_VALIDATION_MANIFEST_MISMATCH/)
const uploadFailureDrive = new SyntheticDrive(); uploadFailureDrive.failUploadRole = 'artifact'
await expectFailure(createRunner({ drive: uploadFailureDrive }).runner.execute(input), /PERMANENT_UPLOAD_FAILURE/)
assert.equal(uploadFailureDrive.objects.size, 0)
const partialFailureDrive = new SyntheticDrive(); partialFailureDrive.failUploadRole = 'sidecar'
await expectFailure(createRunner({ drive: partialFailureDrive }).runner.execute(input), /PERMANENT_UPLOAD_FAILURE/)
assert.equal(partialFailureDrive.objects.size, 0)
const hashFailureDrive = new SyntheticDrive(); hashFailureDrive.remoteHashMismatch = true
await expectFailure(createRunner({ drive: hashFailureDrive }).runner.execute(input), /REMOTE_CHECKSUM_MISMATCH/)
assert.equal(hashFailureDrive.objects.size, 0)
const conflictDrive = new SyntheticDrive(); conflictDrive.objects.set('conflict', { id: 'conflict', name: artifactName, parents: [input.destination.folderId], bytes: artifact.byteLength, sha256Checksum: sha256(artifact), appProperties: { backupId: input.expectedBackupId } })
await expectFailure(createRunner({ drive: conflictDrive }).runner.execute(input), /REMOTE_NAME_CONFLICT/)

// Real loopback listener: safe host, success callback, cancellation, malformed callback, unexpected host, and timeout.
const get = (url: string, host?: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
  const parsed = new URL(url)
  const request = httpRequest({ hostname: '127.0.0.1', port: Number(parsed.port), path: `${parsed.pathname}${parsed.search}`, method: 'GET', headers: host ? { Host: host } : undefined }, response => {
    const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('end', () => resolve({ status: response.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }))
  })
  request.once('error', reject); request.end()
})
const callbackSuccess = await LoopbackOAuthCallbackServer.listen(2_000)
callbackSuccess.setAuthorizationUrl('https://accounts.google.com/o/oauth2/v2/auth?state=synthetic')
assert.equal((await get(callbackSuccess.localAuthorizationUrl)).status, 200)
assert.equal((await get(`${callbackSuccess.redirectUri}?state=synthetic-state&code=synthetic-code`)).status, 200)
assert.deepEqual(await callbackSuccess.wait(), { state: 'synthetic-state', code: 'synthetic-code' })
const callbackCancelled = await LoopbackOAuthCallbackServer.listen(2_000)
assert.equal((await get(`${callbackCancelled.redirectUri}?error=access_denied`)).status, 400)
await expectFailure(callbackCancelled.wait(), /OAUTH_MANAGER_CANCELLED/)
const callbackBadHost = await LoopbackOAuthCallbackServer.listen(2_000)
assert.equal((await get(callbackBadHost.localAuthorizationUrl, `localhost:${new URL(callbackBadHost.localAuthorizationUrl).port}`)).status, 400)
await callbackBadHost.close()
const callbackTimeout = await LoopbackOAuthCallbackServer.listen(25)
await expectFailure(callbackTimeout.wait(), /OAUTH_CALLBACK_TIMEOUT/)

// No secrets, application database, browser storage, automatic startup, or scheduler wiring entered this source boundary.
const sources = await Promise.all(['server/google-drive-provisioning.ts', 'server/google-drive-provisioning-cli.ts'].map(path => readFile(path, 'utf8')))
const combined = sources.join('\n')
assert.equal(/PGlite|ANDALUCIA_DATA_DIR|database-repository|localStorage|sessionStorage/.test(combined), false)
assert.equal(/setInterval|node-cron|Task Scheduler|schtasks/i.test(combined), false)
const evidence = JSON.stringify({ success, idempotent, identity: maskGoogleIdentity(identity) })
for (const canary of ['CANARY_ACCESS_TOKEN', 'CANARY_REFRESH_TOKEN', 'synthetic-code', 'synthetic-verifier']) assert.equal(evidence.includes(canary), false)

await rm(testRoot, { recursive: true, force: true })
console.log(JSON.stringify({
  status: 'PASS', managerControlled: true, realGoogleNetwork: false, realCredentials: false, loopbackOnly: true,
  stateMismatchRejected: true, tokenExchangeFailureRejected: true, callbackTimeoutRejected: true, unexpectedHostRejected: true,
  leastPrivilegeScopeEnforced: GOOGLE_DRIVE_FILE_SCOPE, managerCancellationRejected: true, identityMismatchRejected: true,
  destinationMismatchRejected: true, credentialFailuresRejected: true, artifactBindingFailuresRejected: true,
  uploadFailureCleanup: true, duplicateConflictRejected: true, idempotentExistingPair: true, secretCanariesAbsent: true,
  canonicalDatabaseRequired: false, startupAndSchedulerWiring: false
}, null, 2))
