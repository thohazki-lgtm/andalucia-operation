import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GOOGLE_DRIVE_FILE_SCOPE, assertLeastPrivilegeScopes, createPkce, sanitizeCloudValue, type ApprovedDriveDestination, type CloudCredential, type CloudCredentialStore, type DriveFolder, type DriveIdentity, type DriveTransport, type FinalizePairRequest, type RemoteRecoveryObject, type RemoteUploadRequest, type UploadSession } from './secure-cloud-upload.js'

type Http = (input: string, init?: RequestInit) => Promise<Response>

export type DesktopOAuthConfiguration = {
  clientId: string
  redirectUri: string
  authorizationEndpoint?: string
  tokenEndpoint?: string
}

export type PendingDesktopAuthorization = {
  authorizationUrl: string
  state: string
  verifier: string
  redirectUri: string
  credentialReference: string
}

const requireLoopback = (value: string) => {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('OAUTH_REDIRECT_NOT_LOOPBACK')
}

const json = async <T>(response: Response, code: string): Promise<T> => {
  if (!response.ok) throw new Error(code)
  return response.json() as Promise<T>
}

export class GoogleDesktopOAuthCoordinator {
  constructor(private readonly dependencies: { configuration: DesktopOAuthConfiguration; credentials: CloudCredentialStore; http?: Http; randomState?: () => string }) {}

  begin(credentialReference: string): PendingDesktopAuthorization {
    const configuration = this.dependencies.configuration
    if (!configuration.clientId.trim()) throw new Error('OAUTH_CLIENT_ID_MISSING')
    requireLoopback(configuration.redirectUri)
    const state = this.dependencies.randomState?.() || randomUUID()
    const pkce = createPkce()
    const url = new URL(configuration.authorizationEndpoint || 'https://accounts.google.com/o/oauth2/v2/auth')
    url.search = new URLSearchParams({ client_id: configuration.clientId, redirect_uri: configuration.redirectUri, response_type: 'code', scope: GOOGLE_DRIVE_FILE_SCOPE, code_challenge: pkce.challenge, code_challenge_method: pkce.method, state, access_type: 'offline', prompt: 'consent' }).toString()
    return { authorizationUrl: url.toString(), state, verifier: pkce.verifier, redirectUri: configuration.redirectUri, credentialReference }
  }

  async complete(pending: PendingDesktopAuthorization, callback: { state: string; code: string }): Promise<{ stored: true; grantedScopes: string[] }> {
    if (!callback.state || callback.state !== pending.state) throw new Error('OAUTH_STATE_MISMATCH')
    if (!callback.code) throw new Error('OAUTH_CODE_MISSING')
    const response = await (this.dependencies.http || fetch)(this.dependencies.configuration.tokenEndpoint || 'https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.dependencies.configuration.clientId, code: callback.code, code_verifier: pending.verifier, grant_type: 'authorization_code', redirect_uri: pending.redirectUri })
    })
    const payload = await json<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string }>(response, 'OAUTH_TOKEN_EXCHANGE_FAILED')
    if (!payload.access_token) throw new Error('OAUTH_ACCESS_TOKEN_MISSING')
    const scopes = (payload.scope || '').split(/\s+/).filter(Boolean)
    assertLeastPrivilegeScopes(scopes)
    await this.dependencies.credentials.save(pending.credentialReference, { accessToken: payload.access_token, refreshToken: payload.refresh_token, expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : undefined, grantedScopes: scopes })
    return { stored: true, grantedScopes: scopes }
  }
}

export interface CredentialLockerBridge {
  request(input: { operation: 'load' | 'save' | 'remove'; reference: string; credential?: CloudCredential }): Promise<{ credential?: CloudCredential }>
}

export class WindowsCredentialLockerStore implements CloudCredentialStore {
  constructor(private readonly bridge: CredentialLockerBridge) {}
  async load(reference: string) { return (await this.bridge.request({ operation: 'load', reference })).credential || null }
  async save(reference: string, credential: CloudCredential) { await this.bridge.request({ operation: 'save', reference, credential }) }
  async remove(reference: string) { await this.bridge.request({ operation: 'remove', reference }) }

  static production() {
    const absolute = resolve(join(dirname(fileURLToPath(import.meta.url)), 'windows-credential-locker.ps1'))
    return new WindowsCredentialLockerStore({ request: input => new Promise((resolveRequest, reject) => {
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', absolute], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      const stdout: Buffer[] = []; let stderrBytes = 0
      child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
      child.stderr.on('data', chunk => { stderrBytes += Buffer.byteLength(chunk) })
      child.once('error', () => reject(new Error('CREDENTIAL_LOCKER_HELPER_FAILED')))
      child.once('close', code => {
        if (code !== 0 || stderrBytes) return reject(new Error('CREDENTIAL_LOCKER_HELPER_FAILED'))
        try { resolveRequest(JSON.parse(Buffer.concat(stdout).toString('utf8'))) } catch { reject(new Error('CREDENTIAL_LOCKER_HELPER_RESPONSE_INVALID')) }
      })
      child.stdin.end(JSON.stringify(input))
    }) })
  }
}

const bearer = (credential: CloudCredential) => ({ Authorization: `Bearer ${credential.accessToken}`, Accept: 'application/json' })
const driveFields = 'id,name,size,md5Checksum,sha1Checksum,sha256Checksum,parents,appProperties'
const escapeQuery = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

export class GoogleDriveRestTransport implements DriveTransport {
  constructor(private readonly http: Http = fetch, private readonly chunkBytes = 8 * 1024 * 1024) {}

  async identity(credential: CloudCredential): Promise<DriveIdentity> {
    const value = await json<{ user?: { permissionId?: string; emailAddress?: string } }>(await this.http('https://www.googleapis.com/drive/v3/about?fields=user', { headers: bearer(credential) }), 'DRIVE_IDENTITY_LOOKUP_FAILED')
    if (!value.user?.permissionId || !value.user.emailAddress) throw new Error('DRIVE_IDENTITY_UNVERIFIED')
    return { permissionId: value.user.permissionId, emailAddress: value.user.emailAddress }
  }

  async folder(credential: CloudCredential, folderId: string): Promise<DriveFolder> {
    const fields = 'id,mimeType,trashed,driveId,owners(permissionId,emailAddress),capabilities(canAddChildren)'
    const value = await json<any>(await this.http(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=${encodeURIComponent(fields)}`, { headers: bearer(credential) }), 'DRIVE_FOLDER_LOOKUP_FAILED')
    return { id: value.id, mimeType: value.mimeType, trashed: Boolean(value.trashed), driveId: value.driveId, owners: (value.owners || []).map((owner: any) => ({ permissionId: owner.permissionId, emailAddress: owner.emailAddress })), canAddChildren: Boolean(value.capabilities?.canAddChildren) }
  }

  async candidates(credential: CloudCredential, folderId: string, names: string[], backupId: string): Promise<RemoteRecoveryObject[]> {
    const nameQuery = names.map(name => `name = '${escapeQuery(name)}'`).join(' or ')
    const pairQuery = `appProperties has { key='backupId' and value='${escapeQuery(backupId)}' }`
    const query = `'${escapeQuery(folderId)}' in parents and trashed = false and ((${nameQuery}) or ${pairQuery})`
    const url = `https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=100&fields=${encodeURIComponent(`files(${driveFields})`)}&q=${encodeURIComponent(query)}`
    const value = await json<{ files?: any[] }>(await this.http(url, { headers: bearer(credential) }), 'DRIVE_CANDIDATE_LOOKUP_FAILED')
    return (value.files || []).filter(file => file.appProperties?.backupId === backupId).map(this.mapRemote)
  }

  async createSession(credential: CloudCredential, request: RemoteUploadRequest): Promise<UploadSession> {
    const response = await this.http('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id', {
      method: 'POST', headers: { ...bearer(credential), 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': request.mimeType },
      body: JSON.stringify({ name: request.name, parents: [request.parentId], mimeType: request.mimeType, appProperties: request.appProperties })
    })
    if (!response.ok) throw new Error('UPLOAD_SESSION_CREATION_FAILED')
    const location = response.headers.get('location')
    if (!location) throw new Error('UPLOAD_SESSION_RESPONSE_INVALID')
    return { url: location }
  }

  async upload(credential: CloudCredential, session: UploadSession, bytes: Uint8Array): Promise<string> {
    let offset = 0
    while (offset < bytes.byteLength) {
      const end = Math.min(offset + this.chunkBytes, bytes.byteLength)
      const response = await this.http(session.url, { method: 'PUT', headers: { Authorization: `Bearer ${credential.accessToken}`, 'Content-Length': String(end - offset), 'Content-Range': `bytes ${offset}-${end - 1}/${bytes.byteLength}` }, body: bytes.slice(offset, end) })
      if (response.status === 308) {
        const range = response.headers.get('range')
        offset = range ? Number(range.match(/(\d+)$/)?.[1] || -1) + 1 : end
        continue
      }
      if (!response.ok) throw new Error(response.status >= 500 ? 'TRANSIENT_UPLOAD_FAILURE' : response.status === 404 ? 'UPLOAD_SESSION_EXPIRED' : 'PERMANENT_UPLOAD_FAILURE')
      const completed = await response.json().catch(() => ({})) as { id?: string }
      session.remoteId = completed.id || session.remoteId
      offset = end
    }
    if (!session.remoteId) throw new Error('UPLOAD_COMPLETION_ID_MISSING')
    return session.remoteId
  }

  async remote(credential: CloudCredential, id: string): Promise<RemoteRecoveryObject> {
    const value = await json<any>(await this.http(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${encodeURIComponent(driveFields)}`, { headers: bearer(credential) }), 'REMOTE_METADATA_LOOKUP_FAILED')
    return this.mapRemote(value)
  }

  async finalizePair(credential: CloudCredential, request: FinalizePairRequest): Promise<void> {
    for (const [role, item] of [['artifact', request.artifact], ['sidecar', request.sidecar]] as const) {
      const response = await this.http(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}?supportsAllDrives=true&fields=id`, { method: 'PATCH', headers: { ...bearer(credential), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: item.name, appProperties: { backupId: item.backupId, pairId: request.pairId, role, state: 'VERIFIED_PAIR', sha256: item.sha256 } }) })
      if (!response.ok) throw new Error('PAIR_FINALIZATION_FAILED')
    }
  }

  async remove(credential: CloudCredential, id: string): Promise<void> {
    const response = await this.http(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true`, { method: 'DELETE', headers: bearer(credential) })
    if (!response.ok && response.status !== 404) throw new Error('REMOTE_CLEANUP_FAILED')
  }

  private mapRemote(value: any): RemoteRecoveryObject {
    return { id: String(value.id), name: String(value.name), parents: Array.isArray(value.parents) ? value.parents.map(String) : [], bytes: Number(value.size), md5Checksum: value.md5Checksum, sha256Checksum: value.sha256Checksum, appProperties: value.appProperties || {} }
  }
}

export const safeCloudError = (error: unknown) => sanitizeCloudValue({ error: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[url-redacted]') : 'UNKNOWN_CLOUD_ERROR' })

export const validateDestinationConfiguration = (value: ApprovedDriveDestination) => {
  if (value.version !== 1 || !value.credentialReference || !value.folderId || !value.label || !value.account.permissionId || !value.account.emailAddress) throw new Error('DESTINATION_BINDING_MALFORMED')
  return Object.freeze({ ...value, account: Object.freeze({ ...value.account }) })
}
