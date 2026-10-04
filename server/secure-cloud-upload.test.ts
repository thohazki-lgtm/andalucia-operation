import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GoogleDesktopOAuthCoordinator, GoogleDriveRestTransport, WindowsCredentialLockerStore, validateDestinationConfiguration, type CredentialLockerBridge } from './google-drive-cloud-client.js'
import { GOOGLE_DRIVE_FILE_SCOPE, OFFDEVICE_EXPORT_FORMAT, SecureCloudUploadCoordinator, assertLeastPrivilegeScopes, sanitizeCloudValue, validateEncryptedRecoveryPair, type ApprovedDriveDestination, type CloudCredential, type CloudCredentialStore, type DriveFolder, type DriveIdentity, type DriveTransport, type FinalizePairRequest, type RemoteRecoveryObject, type RemoteUploadRequest, type UploadSession } from './secure-cloud-upload.js'

const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const md5 = (value: Uint8Array) => createHash('md5').update(value).digest('hex')
const root = await mkdtemp(join(tmpdir(), 'andalucia-cloud-foundation-'))

type Fixture = { root: string; artifactPath: string; sidecarPath: string; artifact: Buffer; sidecar: Record<string, unknown> }
const fixture = async (name: string, mutate?: (sidecar: Record<string, unknown>, artifact: Buffer) => void): Promise<Fixture> => {
  const folder = join(root, name); await mkdir(folder, { recursive: true })
  const artifact = Buffer.from(`synthetic-encrypted-looking-${name}-${'x'.repeat(37)}`)
  const artifactName = `${name}.tar.gz.age`
  const sidecar: Record<string, unknown> = {
    exportFormat: OFFDEVICE_EXPORT_FORMAT, sourceBackupId: `backup-${name}`, sourceState: 'VERIFIED_REHEARSED', sourceSchema: '018',
    sourceManifestSha256: 'a'.repeat(64), sourceFileCount: 3, sourceTotalBytes: 1234, encryptedFilename: artifactName,
    encryptedSha256: sha256(artifact), encryptedBytes: artifact.byteLength, localVerification: 'VERIFIED'
  }
  mutate?.(sidecar, artifact)
  const artifactPath = join(folder, artifactName); const sidecarPath = join(folder, `${name}.offdevice.json`)
  await writeFile(artifactPath, artifact); await writeFile(sidecarPath, JSON.stringify(sidecar))
  return { root: folder, artifactPath, sidecarPath, artifact, sidecar }
}

const expectFailure = async (promise: Promise<unknown>, code: RegExp) => { await assert.rejects(promise, code) }

const valid = await fixture('valid')
const validated = await validateEncryptedRecoveryPair({ approvedRoot: valid.root, artifactPath: valid.artifactPath, sidecarPath: valid.sidecarPath, expectedBackupId: 'backup-valid', expectedSchema: '018', expectedManifestSha256: 'a'.repeat(64) })
assert.equal(validated.artifact.sha256, sha256(valid.artifact)); assert.equal(validated.sidecarDocument.exportFormat, OFFDEVICE_EXPORT_FORMAT)

const missing = await fixture('missing'); await rm(missing.artifactPath); await expectFailure(validateEncryptedRecoveryPair({ approvedRoot: missing.root, artifactPath: missing.artifactPath, sidecarPath: missing.sidecarPath }), /ENOENT/)
const missingSidecar = await fixture('missing-sidecar'); await rm(missingSidecar.sidecarPath); await expectFailure(validateEncryptedRecoveryPair({ approvedRoot: missingSidecar.root, artifactPath: missingSidecar.artifactPath, sidecarPath: missingSidecar.sidecarPath }), /ENOENT/)
const malformed = await fixture('malformed'); await writeFile(malformed.sidecarPath, '{'); await expectFailure(validateEncryptedRecoveryPair({ approvedRoot: malformed.root, artifactPath: malformed.artifactPath, sidecarPath: malformed.sidecarPath }), /SIDECAR_JSON_MALFORMED/)
for (const [name, mutate, code] of [
  ['format', (s: any) => { s.exportFormat = 'unknown' }, /FORMAT_UNSUPPORTED/],
  ['filename', (s: any) => { s.encryptedFilename = 'wrong.age' }, /FILENAME_MISMATCH/],
  ['size', (s: any) => { s.encryptedBytes += 1 }, /SIZE_MISMATCH/],
  ['hash', (s: any) => { s.encryptedSha256 = 'b'.repeat(64) }, /SHA256_MISMATCH/]
] as Array<[string, (sidecar: any) => void, RegExp]>) {
  const item = await fixture(name, mutate); await expectFailure(validateEncryptedRecoveryPair({ approvedRoot: item.root, artifactPath: item.artifactPath, sidecarPath: item.sidecarPath }), code)
}
await expectFailure(validateEncryptedRecoveryPair({ approvedRoot: valid.root, artifactPath: valid.artifactPath, sidecarPath: valid.sidecarPath, expectedBackupId: 'wrong' }), /BACKUP_ID_MISMATCH/)
await expectFailure(validateEncryptedRecoveryPair({ approvedRoot: valid.root, artifactPath: valid.artifactPath, sidecarPath: valid.sidecarPath, expectedSchema: '017' }), /SCHEMA_MISMATCH/)
await expectFailure(validateEncryptedRecoveryPair({ approvedRoot: valid.root, artifactPath: valid.artifactPath, sidecarPath: valid.sidecarPath, expectedManifestSha256: 'b'.repeat(64) }), /MANIFEST_MISMATCH/)
await expectFailure(validateEncryptedRecoveryPair({ approvedRoot: join(valid.root, 'nested'), artifactPath: valid.artifactPath, sidecarPath: valid.sidecarPath }), /PATH_OUTSIDE_APPROVED_ROOT/)
const linked = await fixture('hardlink'); const outside = join(root, 'outside.age'); await writeFile(outside, 'outside'); await rm(linked.artifactPath); await link(outside, linked.artifactPath); await expectFailure(validateEncryptedRecoveryPair({ approvedRoot: linked.root, artifactPath: linked.artifactPath, sidecarPath: linked.sidecarPath }), /NOT_UNIQUE_REGULAR_FILE/)

const ACCESS = 'CANARY_ACCESS_TOKEN_41F8'; const REFRESH = 'CANARY_REFRESH_TOKEN_B102'; const CODE = 'CANARY_AUTH_CODE_7AA1'; const VERIFIER = 'CANARY_PKCE_VERIFIER_2D91'; const RECOVERY = 'CANARY_RECOVERY_SECRET_7F0C'; const PASSPHRASE = 'CANARY_PASSPHRASE_71D0'
class MemoryStore implements CloudCredentialStore {
  value: CloudCredential | null
  constructor(value: CloudCredential | null = { accessToken: ACCESS, refreshToken: REFRESH, grantedScopes: [GOOGLE_DRIVE_FILE_SCOPE] }) { this.value = value }
  async load() { return this.value }
  async save(_reference: string, credential: CloudCredential) { this.value = credential }
  async remove() { this.value = null }
}

const oauthStore = new MemoryStore(null)
const oauth = new GoogleDesktopOAuthCoordinator({ configuration: { clientId: 'synthetic-client-id.apps.googleusercontent.com', redirectUri: 'http://127.0.0.1:48192/callback' }, credentials: oauthStore, randomState: () => 'deterministic-state', http: async (_url, init) => {
  const body = String(init?.body); assert.match(body, new RegExp(`code=${CODE}`)); assert.match(body, /code_verifier=/)
  return new Response(JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, scope: GOOGLE_DRIVE_FILE_SCOPE }), { status: 200, headers: { 'Content-Type': 'application/json' } })
} })
const pending = oauth.begin('andalucia-cloud:test'); assert.match(pending.authorizationUrl, /code_challenge=/); assert.match(pending.authorizationUrl, /code_challenge_method=S256/); assert.match(pending.authorizationUrl, /drive.file/)
await expectFailure(oauth.complete({ ...pending, verifier: VERIFIER }, { state: 'wrong-state', code: CODE }), /STATE_MISMATCH/)
const completed = await oauth.complete({ ...pending, verifier: VERIFIER }, { state: pending.state, code: CODE }); assert.deepEqual(completed.grantedScopes, [GOOGLE_DRIVE_FILE_SCOPE]); assert.equal(oauthStore.value?.accessToken, ACCESS)
const pkceRejected = new GoogleDesktopOAuthCoordinator({ configuration: { clientId: 'id', redirectUri: 'http://localhost:9000/callback' }, credentials: new MemoryStore(null), http: async () => new Response('{}', { status: 400 }) })
const rejectedPending = pkceRejected.begin('andalucia-cloud:test')
await expectFailure(pkceRejected.complete({ ...rejectedPending, verifier: 'invalid' }, { state: rejectedPending.state, code: CODE }), /TOKEN_EXCHANGE_FAILED/)
assert.doesNotThrow(() => assertLeastPrivilegeScopes([GOOGLE_DRIVE_FILE_SCOPE])); assert.throws(() => assertLeastPrivilegeScopes(['https://www.googleapis.com/auth/drive']), /SCOPE_REJECTED/); assert.throws(() => assertLeastPrivilegeScopes([GOOGLE_DRIVE_FILE_SCOPE, 'openid']), /SCOPE_REJECTED/)

const bridgeCalls: unknown[] = []
const bridge: CredentialLockerBridge = { async request(input) { bridgeCalls.push({ operation: input.operation, reference: input.reference }); return input.operation === 'load' ? { credential: { accessToken: ACCESS, refreshToken: REFRESH, grantedScopes: [GOOGLE_DRIVE_FILE_SCOPE] } } : {} } }
const locker = new WindowsCredentialLockerStore(bridge); assert.equal((await locker.load('andalucia-cloud:test'))?.accessToken, ACCESS); await locker.save('andalucia-cloud:test', { accessToken: ACCESS, refreshToken: REFRESH, grantedScopes: [GOOGLE_DRIVE_FILE_SCOPE] }); await locker.remove('andalucia-cloud:test')
assert.equal(JSON.stringify(bridgeCalls).includes(ACCESS), false); assert.equal(JSON.stringify(bridgeCalls).includes(REFRESH), false)

const destination: ApprovedDriveDestination = validateDestinationConfiguration({ version: 1, credentialReference: 'andalucia-cloud:test', label: 'Approved disaster recovery', folderId: 'folder-1', account: { permissionId: 'permission-1', emailAddress: 'manager@example.invalid' }, relationship: 'MY_DRIVE' })

class FakeDrive implements DriveTransport {
  objects = new Map<string, RemoteRecoveryObject>(); sessions = new Map<string, RemoteUploadRequest>(); sequence = 0; uploadAttempts = 0
  wrongIdentity = false; wrongFolder = false; inaccessible = false; failRole = ''; transientFailures = 0; checksumMismatchRole = ''; sizeMismatchRole = ''; finalizeFailure = false; cleanupFailure = false
  async identity(): Promise<DriveIdentity> { return this.wrongIdentity ? { permissionId: 'wrong', emailAddress: 'wrong@example.invalid' } : destination.account }
  async folder(): Promise<DriveFolder> { return { id: this.wrongFolder ? 'wrong-folder' : destination.folderId, mimeType: 'application/vnd.google-apps.folder', trashed: false, owners: [destination.account], canAddChildren: !this.inaccessible } }
  async candidates(_credential: CloudCredential, _folderId: string, names: string[], backupId: string) { return [...this.objects.values()].filter(item => names.includes(item.name) && item.appProperties.backupId === backupId) }
  async createSession(_credential: CloudCredential, request: RemoteUploadRequest): Promise<UploadSession> { const id = `remote-${++this.sequence}`; this.sessions.set(id, request); return { url: `fake://${id}`, remoteId: id } }
  async upload(_credential: CloudCredential, session: UploadSession, bytes: Uint8Array) {
    this.uploadAttempts += 1; const id = session.remoteId!; const request = this.sessions.get(id)!; const role = request.appProperties.role
    if (this.transientFailures > 0) { this.transientFailures -= 1; throw new Error('TRANSIENT_UPLOAD_FAILURE') }
    if (this.failRole === role) throw new Error('PERMANENT_UPLOAD_FAILURE')
    this.objects.set(id, { id, name: request.name, parents: [request.parentId], bytes: role === this.sizeMismatchRole ? bytes.byteLength + 1 : bytes.byteLength, md5Checksum: role === this.checksumMismatchRole ? '0'.repeat(32) : md5(bytes), sha256Checksum: role === this.checksumMismatchRole ? '0'.repeat(64) : sha256(bytes), appProperties: request.appProperties })
    return id
  }
  async remote(_credential: CloudCredential, id: string) { const value = this.objects.get(id); if (!value) throw new Error('REMOTE_METADATA_LOOKUP_FAILED'); return value }
  async finalizePair(_credential: CloudCredential, request: FinalizePairRequest) {
    if (this.finalizeFailure) throw new Error('PAIR_FINALIZATION_FAILED')
    for (const [role, item] of [['artifact', request.artifact], ['sidecar', request.sidecar]] as const) { const current = this.objects.get(item.id)!; current.name = item.name; current.appProperties = { ...current.appProperties, pairId: request.pairId, role, state: 'VERIFIED_PAIR' } }
  }
  async remove(_credential: CloudCredential, id: string) { if (this.cleanupFailure) throw new Error('REMOTE_CLEANUP_FAILED'); this.objects.delete(id) }
}

const execute = async (drive: FakeDrive, store: CloudCredentialStore = new MemoryStore(), item = valid) => new SecureCloudUploadCoordinator({ credentialStore: store, drive, operationId: () => 'operation-1', now: () => new Date('2026-10-04T00:00:00Z'), maxRetries: 2 }).execute({ destination, approvedRoot: item.root, artifactPath: item.artifactPath, sidecarPath: item.sidecarPath, expectedBackupId: 'backup-valid', expectedSchema: '018', expectedManifestSha256: 'a'.repeat(64) })

const successDrive = new FakeDrive(); const success = await execute(successDrive); assert.equal(success.state, 'SUCCEEDED'); assert.equal(success.artifact?.remoteId, 'remote-1'); assert.equal(success.sidecar?.remoteId, 'remote-2')
const resumedDrive = new FakeDrive(); resumedDrive.transientFailures = 1; const resumed = await execute(resumedDrive); assert.equal(resumed.state, 'SUCCEEDED'); assert.equal(resumed.retries, 1)
const already = await execute(successDrive); assert.equal(already.state, 'ALREADY_PRESENT_VERIFIED'); assert.equal(successDrive.sequence, 2)
const wrongAccount = new FakeDrive(); wrongAccount.wrongIdentity = true; assert.equal((await execute(wrongAccount)).errorCode, 'DESTINATION_ACCOUNT_MISMATCH')
const wrongFolder = new FakeDrive(); wrongFolder.wrongFolder = true; assert.equal((await execute(wrongFolder)).errorCode, 'DESTINATION_FOLDER_UNVERIFIED')
const inaccessible = new FakeDrive(); inaccessible.inaccessible = true; assert.equal((await execute(inaccessible)).errorCode, 'DESTINATION_FOLDER_UNVERIFIED')
assert.equal((await execute(new FakeDrive(), new MemoryStore(null))).errorCode, 'CLOUD_CREDENTIAL_MISSING')
assert.equal((await execute(new FakeDrive(), new MemoryStore({ accessToken: ACCESS, expiresAt: '2020-01-01T00:00:00Z', grantedScopes: [GOOGLE_DRIVE_FILE_SCOPE] }))).errorCode, 'CLOUD_AUTHORIZATION_EXPIRED')
const broadStore = new MemoryStore({ accessToken: ACCESS, grantedScopes: ['https://www.googleapis.com/auth/drive'] }); assert.equal((await execute(new FakeDrive(), broadStore)).errorCode, 'CLOUD_AUTHORIZATION_SCOPE_REJECTED')
const permanent = new FakeDrive(); permanent.failRole = 'artifact'; assert.equal((await execute(permanent)).state, 'FAILED')
const exhausted = new FakeDrive(); exhausted.transientFailures = 4; const exhaustedResult = await execute(exhausted); assert.equal(exhaustedResult.state, 'FAILED'); assert.equal(exhaustedResult.retries, 2)
const remoteSize = new FakeDrive(); remoteSize.sizeMismatchRole = 'artifact'; assert.equal((await execute(remoteSize)).errorCode, 'REMOTE_SIZE_MISMATCH')
const remoteHash = new FakeDrive(); remoteHash.checksumMismatchRole = 'sidecar'; assert.equal((await execute(remoteHash)).errorCode, 'REMOTE_CHECKSUM_MISMATCH')
const sidecarFailure = new FakeDrive(); sidecarFailure.failRole = 'sidecar'; const sidecarFailureResult = await execute(sidecarFailure); assert.equal(sidecarFailureResult.state, 'FAILED'); assert.equal(sidecarFailure.objects.size, 0)
const finalizationFailure = new FakeDrive(); finalizationFailure.finalizeFailure = true; assert.equal((await execute(finalizationFailure)).state, 'FAILED')
const cleanupFailure = new FakeDrive(); cleanupFailure.failRole = 'sidecar'; cleanupFailure.cleanupFailure = true; assert.equal((await execute(cleanupFailure)).state, 'CLEANUP_FAILED')
const conflict = new FakeDrive(); conflict.objects.set('conflict', { id: 'conflict', name: valid.sidecar.encryptedFilename as string, parents: [destination.folderId], bytes: 1, appProperties: { backupId: 'backup-valid' } }); assert.equal((await execute(conflict)).errorCode, 'REMOTE_NAME_CONFLICT')
const ambiguous = new FakeDrive(); for (let index = 0; index < 2; index++) ambiguous.objects.set(`a${index}`, { id: `a${index}`, name: validated.artifact.name, parents: [destination.folderId], bytes: validated.artifact.bytes, sha256Checksum: validated.artifact.sha256, appProperties: { backupId: 'backup-valid' } }); assert.equal((await execute(ambiguous)).errorCode, 'REMOTE_DUPLICATE_AMBIGUOUS')

const httpCalls: Array<{ url: string; authorized: boolean }> = []; let uploadCall = 0
const http = async (input: string, init?: RequestInit) => {
  httpCalls.push({ url: input, authorized: Boolean(new Headers(init?.headers).get('Authorization')) })
  if (input.includes('uploadType=resumable')) return new Response('', { status: 200, headers: { Location: 'https://upload.example.invalid/session' } })
  if (input.includes('upload.example.invalid')) { uploadCall += 1; return uploadCall === 1 ? new Response('', { status: 308, headers: { Range: 'bytes=0-3' } }) : new Response(JSON.stringify({ id: 'uploaded-id' }), { status: 200 }) }
  throw new Error('UNEXPECTED_FAKE_HTTP')
}
const rest = new GoogleDriveRestTransport(http, 4); const session = await rest.createSession({ accessToken: ACCESS, grantedScopes: [GOOGLE_DRIVE_FILE_SCOPE] }, { name: 'synthetic.age', parentId: 'folder-1', mimeType: 'application/octet-stream', appProperties: {} }); assert.equal(await rest.upload({ accessToken: ACCESS, grantedScopes: [GOOGLE_DRIVE_FILE_SCOPE] }, session, Buffer.from('abcdefgh')), 'uploaded-id'); assert.equal(uploadCall, 2)

const serialized = JSON.stringify({ success, resumed, failure: sidecarFailureResult, sanitized: sanitizeCloudValue({ accessToken: ACCESS, refreshToken: REFRESH, authorizationCode: CODE, codeVerifier: VERIFIER, recoverySecret: RECOVERY, passphrase: PASSPHRASE }) })
for (const canary of [ACCESS, REFRESH, CODE, VERIFIER, RECOVERY, PASSPHRASE]) assert.equal(serialized.includes(canary), false, `secret canary leaked: ${canary.slice(0, 8)}`)
assert.equal(httpCalls.every(call => call.authorized), true, 'transport must authorize each upload request without retaining the token in test evidence')
const source = `${await readFile('server/secure-cloud-upload.ts', 'utf8')}\n${await readFile('server/google-drive-cloud-client.ts', 'utf8')}`
assert.equal(/PGlite|ANDALUCIA_DATA_DIR|\.data\\postgres|database-repository/.test(source), false)
assert.equal(/localStorage|sessionStorage/.test(source), false)

await rm(root, { recursive: true, force: true })
console.log(JSON.stringify({ status: 'PASS', localValidation: true, oauthPkce: true, oauthState: 'FAIL_CLOSED', leastPrivilegeScope: GOOGLE_DRIVE_FILE_SCOPE, credentialStoreAbstracted: true, destinationIdentityBound: true, stableFolderBound: true, resumableContinuation: true, remoteVerification: true, pairFinalization: true, idempotency: true, duplicateAmbiguity: 'FAIL_CLOSED', cleanupFailureVisible: true, secretCanariesAbsent: true, realGoogleNetwork: false, canonicalDatabaseRequired: false, realRecoverySecretsAccessed: false }, null, 2))
