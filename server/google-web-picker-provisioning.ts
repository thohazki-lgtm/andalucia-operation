import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  WEB_PICKER_API_KEY_REFERENCE,
  WEB_PICKER_OAUTH_REFERENCE,
  WEB_PICKER_ORIGIN,
  WEB_PICKER_PROJECT_NUMBER,
  WEB_PICKER_REDIRECT_URI
} from './google-web-picker-credential-configuration.js'
import type { WebPickerProtectedConfiguration } from './google-drive-cloud-client.js'
import {
  GOOGLE_DRIVE_FILE_SCOPE,
  assertLeastPrivilegeScopes,
  createPkce,
  type ApprovedDriveDestination,
  type CloudCredential,
  type CloudCredentialStore,
  type DriveFolder,
  type DriveIdentity,
  type DriveTransport
} from './secure-cloud-upload.js'

export const WEB_PICKER_PORT = 4175 as const
export const WEB_PICKER_FOLDER_MIME = 'application/vnd.google-apps.folder' as const
export const WEB_PICKER_DESTINATION_NAME = 'Encrypted_Database_Backups' as const
export const WEB_PICKER_APPROVAL_CHECKPOINT = 'AWAITING_MANAGER_DESTINATION_APPROVAL' as const
export const WEB_PICKER_APPROVAL_PHRASE = 'APPROVE DRIVE DESTINATION' as const

export type WebPickerSessionState =
  | 'CREATED'
  | 'OAUTH_PENDING'
  | 'PICKER_READY'
  | 'VALIDATING_SELECTION'
  | typeof WEB_PICKER_APPROVAL_CHECKPOINT
  | 'FAILED'
  | 'EXPIRED'
  | 'CONSUMED'

type Http = (input: string, init?: RequestInit) => Promise<Response>
type ProtectedConfigurationStore = { load(oauthReference: string, apiKeyReference: string): Promise<WebPickerProtectedConfiguration> }

type Session = {
  id: string
  csrf: string
  oauthState: string
  pkceVerifier: string
  pkceChallenge: string
  createdAt: number
  expiresAt: number
  state: WebPickerSessionState
  configuration?: WebPickerProtectedConfiguration
  credential?: CloudCredential
  verifiedIdentity?: DriveIdentity
  selectedFolder?: DriveFolder
  bootstrapIssued?: boolean
  errorCode?: string
}

export type SafeWebPickerCheckpoint = {
  state: typeof WEB_PICKER_APPROVAL_CHECKPOINT
  identity: { maskedEmail: string; permissionFingerprint: string }
  destination: { name: typeof WEB_PICKER_DESTINATION_NAME; relationship: 'MY_DRIVE'; writable: true }
}

export type WebPickerServiceDependencies = {
  configurationStore: ProtectedConfigurationStore
  drive: DriveTransport
  http?: Http
  now?: () => number
  randomId?: () => string
  sessionTtlMs?: number
}

const safeHeaders = (contentType: string) => ({
  'Content-Type': contentType,
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy': "default-src 'none'; script-src 'self' https://apis.google.com https://accounts.google.com; frame-src https://docs.google.com https://accounts.google.com; connect-src 'self'; img-src data: https://*.googleusercontent.com; style-src 'self'; base-uri 'none'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; worker-src 'none'"
})

const sameIdentity = (left: DriveIdentity, right: DriveIdentity) => left.permissionId === right.permissionId && left.emailAddress.toLowerCase() === right.emailAddress.toLowerCase()
export const assertVerifiedIdentity = (actual: DriveIdentity, expected: DriveIdentity) => {
  if (!sameIdentity(actual, expected)) throw new Error('WEB_PICKER_IDENTITY_MISMATCH')
  return actual
}
const maskIdentity = (identity: DriveIdentity) => {
  const [local, domain = ''] = identity.emailAddress.split('@')
  return {
    maskedEmail: `${local.slice(0, 1) || '*'}***${domain ? `@${domain}` : ''}`,
    permissionFingerprint: identity.permissionId.length > 8 ? `${identity.permissionId.slice(0, 4)}...${identity.permissionId.slice(-4)}` : identity.permissionId
  }
}

const requiredSessionToken = (value: unknown, code: string) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{20,}$/.test(value)) throw new Error(code)
  return value
}

const parseJsonBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += Buffer.byteLength(chunk)
    if (bytes > 16_384) throw new Error('WEB_PICKER_REQUEST_TOO_LARGE')
    chunks.push(Buffer.from(chunk))
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown } catch { throw new Error('WEB_PICKER_REQUEST_MALFORMED') }
}

const tokenPayload = async (response: Response) => {
  if (!response.ok) throw new Error('WEB_OAUTH_TOKEN_EXCHANGE_FAILED')
  const value = await response.json().catch(() => null) as null | { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }
  if (!value?.access_token || !value.refresh_token) throw new Error('WEB_OAUTH_TOKEN_RESPONSE_INVALID')
  const scopes = (value.scope || '').split(/\s+/).filter(Boolean)
  assertLeastPrivilegeScopes(scopes)
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    expiresAt: value.expires_in ? new Date(Date.now() + value.expires_in * 1000).toISOString() : undefined,
    grantedScopes: scopes
  } satisfies CloudCredential
}

export const assertMyDriveFolder = (folder: DriveFolder, identity: DriveIdentity) => {
  if (folder.trashed || folder.mimeType !== WEB_PICKER_FOLDER_MIME || folder.name !== WEB_PICKER_DESTINATION_NAME || !folder.canAddChildren) throw new Error('WEB_PICKER_DESTINATION_INVALID')
  if (folder.driveId) throw new Error('WEB_PICKER_SHARED_DRIVE_REJECTED')
  if (!folder.owners.some(owner => sameIdentity(owner, identity))) throw new Error('WEB_PICKER_MY_DRIVE_RELATIONSHIP_INVALID')
  return folder
}

export const assertPickerDocuments = (action: unknown, documents: unknown) => {
  if (action !== 'picked' || !Array.isArray(documents) || documents.length !== 1) throw new Error('WEB_PICKER_SELECTION_INVALID')
  const document = documents[0]
  if (!document || typeof document !== 'object') throw new Error('WEB_PICKER_SELECTION_INVALID')
  const id = String((document as any).id || '')
  const mimeType = String((document as any).mimeType || '')
  if (!/^[A-Za-z0-9_-]+$/.test(id) || mimeType !== WEB_PICKER_FOLDER_MIME) throw new Error('WEB_PICKER_SELECTION_INVALID')
  return id
}

export const webPickerClientScript = `(() => {
  'use strict';
  const root = document.documentElement;
  const sessionId = root.dataset.session || '';
  const csrf = root.dataset.csrf || '';
  let accessToken = null;
  let developerKey = null;
  const clearSensitive = () => { accessToken = null; developerKey = null; };
  const fail = () => { clearSensitive(); document.body.textContent = 'Google Drive destination selection did not complete.'; };
  const post = async (path, body) => {
    const response = await fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-ANDALUCIA-CSRF': csrf }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('REQUEST_REJECTED');
    return response.json();
  };
  const pickerCallback = async data => {
    if (data.action === google.picker.Action.CANCEL) {
      await post('/api/web-picker/callback', { sessionId, action: 'cancel', documents: [] }).catch(() => undefined);
      return fail();
    }
    if (data.action !== google.picker.Action.PICKED) return;
    try {
      const documents = Array.isArray(data.docs) ? data.docs.map(item => ({ id: item.id, mimeType: item.mimeType })) : [];
      const result = await post('/api/web-picker/callback', { sessionId, action: 'picked', documents });
      clearSensitive();
      location.replace(result.approvalUrl);
    } catch { fail(); }
  };
  const start = async () => {
    try {
      const bootstrap = await post('/api/web-picker/bootstrap', { sessionId });
      accessToken = bootstrap.accessToken;
      developerKey = bootstrap.developerKey;
      await new Promise((resolve, reject) => gapi.load('picker', { callback: resolve, onerror: reject }));
      const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMode(google.picker.DocsViewMode.LIST);
      const picker = new google.picker.PickerBuilder()
        .addView(view)
        .setAppId(bootstrap.appId)
        .setDeveloperKey(developerKey)
        .setOAuthToken(accessToken)
        .setOrigin('http://127.0.0.1:4175')
        .setCallback(pickerCallback)
        .build();
      picker.setVisible(true);
    } catch { fail(); }
  };
  addEventListener('pagehide', clearSensitive, { once: true });
  start();
})();`

export class GoogleWebPickerProvisioningService {
  private readonly sessions = new Map<string, Session>()
  private readonly byOAuthState = new Map<string, string>()
  private server?: Server
  private readonly now: () => number
  private readonly ttl: number
  private readonly http: Http

  constructor(private readonly dependencies: WebPickerServiceDependencies) {
    this.now = dependencies.now || Date.now
    this.ttl = dependencies.sessionTtlMs ?? 300_000
    if (this.ttl < 30_000 || this.ttl > 600_000) throw new Error('WEB_PICKER_SESSION_TTL_INVALID')
    this.http = dependencies.http || fetch
  }

  async listen() {
    if (this.server?.listening) throw new Error('WEB_PICKER_SERVICE_ALREADY_LISTENING')
    this.server = createServer((request, response) => { void this.handle(request, response) })
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(WEB_PICKER_PORT, '127.0.0.1', resolve)
    })
  }

  async close() {
    for (const session of this.sessions.values()) this.clearSecrets(session, 'CONSUMED')
    this.sessions.clear()
    this.byOAuthState.clear()
    if (this.server?.listening) await new Promise<void>(resolve => this.server!.close(() => resolve()))
  }

  async createSession() {
    const configuration = await this.dependencies.configurationStore.load(WEB_PICKER_OAUTH_REFERENCE, WEB_PICKER_API_KEY_REFERENCE)
    const id = this.dependencies.randomId?.() || randomBytes(32).toString('base64url')
    const csrf = randomBytes(32).toString('base64url')
    const oauthState = randomBytes(32).toString('base64url')
    const pkce = createPkce()
    const createdAt = this.now()
    const session: Session = { id, csrf, oauthState, pkceVerifier: pkce.verifier, pkceChallenge: pkce.challenge, createdAt, expiresAt: createdAt + this.ttl, state: 'CREATED', configuration }
    this.sessions.set(id, session)
    this.byOAuthState.set(oauthState, id)
    return { localUrl: `${WEB_PICKER_ORIGIN}/provision/${id}`, expiresAt: new Date(session.expiresAt).toISOString() }
  }

  inspectCheckpoint(sessionId: string): SafeWebPickerCheckpoint | null {
    const session = this.requireSession(sessionId)
    if (session.state !== WEB_PICKER_APPROVAL_CHECKPOINT || !session.verifiedIdentity || !session.selectedFolder) return null
    return { state: WEB_PICKER_APPROVAL_CHECKPOINT, identity: maskIdentity(session.verifiedIdentity), destination: { name: WEB_PICKER_DESTINATION_NAME, relationship: 'MY_DRIVE', writable: true } }
  }

  async waitForCheckpoint(sessionId: string): Promise<SafeWebPickerCheckpoint> {
    while (true) {
      const checkpoint = this.inspectCheckpoint(sessionId)
      if (checkpoint) return checkpoint
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }

  async approveDestination(sessionId: string, confirmation: string, credentials: CloudCredentialStore, credentialReference: string, label: string) {
    const session = this.requireSession(sessionId)
    if (confirmation !== WEB_PICKER_APPROVAL_PHRASE) throw new Error('WEB_PICKER_MANAGER_APPROVAL_REQUIRED')
    if (session.state !== WEB_PICKER_APPROVAL_CHECKPOINT || !session.credential || !session.verifiedIdentity || !session.selectedFolder) throw new Error('WEB_PICKER_APPROVAL_NOT_READY')
    if (!/^andalucia-cloud:[A-Za-z0-9._-]+$/.test(credentialReference) || !label.trim()) throw new Error('WEB_PICKER_FINAL_CREDENTIAL_BINDING_INVALID')
    if (await credentials.load(credentialReference)) throw new Error('WEB_PICKER_FINAL_CREDENTIAL_ALREADY_EXISTS')
    const approvedDestination: ApprovedDriveDestination = {
      version: 1,
      credentialReference,
      label: label.trim(),
      folderId: session.selectedFolder.id,
      account: { ...session.verifiedIdentity },
      relationship: 'MY_DRIVE'
    }
    let saved = false
    try {
      await credentials.save(credentialReference, { ...session.credential, approvedDestination, destinationApprovedAt: new Date(this.now()).toISOString() })
      saved = true
      const readback = await credentials.load(credentialReference)
      if (!readback?.approvedDestination || readback.approvedDestination.folderId !== approvedDestination.folderId || !sameIdentity(readback.approvedDestination.account, session.verifiedIdentity)) throw new Error('WEB_PICKER_FINAL_CREDENTIAL_READBACK_FAILED')
      this.clearSecrets(session, 'CONSUMED')
      return { stored: true as const, credentialReference, destination: { name: WEB_PICKER_DESTINATION_NAME, relationship: 'MY_DRIVE' as const } }
    } catch (error) {
      if (saved) await credentials.remove(credentialReference).catch(() => undefined)
      throw error
    }
  }

  private requireSession(id: string) {
    const session = this.sessions.get(requiredSessionToken(id, 'WEB_PICKER_SESSION_INVALID'))
    if (!session) throw new Error('WEB_PICKER_SESSION_INVALID')
    if (this.now() >= session.expiresAt) {
      this.clearSecrets(session, 'EXPIRED')
      throw new Error('WEB_PICKER_SESSION_EXPIRED')
    }
    if (['FAILED', 'EXPIRED', 'CONSUMED'].includes(session.state)) throw new Error('WEB_PICKER_SESSION_NOT_ACTIVE')
    return session
  }

  private verifyCsrf(session: Session, request: IncomingMessage, body?: Record<string, unknown>) {
    const supplied = request.headers['x-andalucia-csrf']
    if (supplied !== session.csrf || (body?.sessionId && body.sessionId !== session.id)) throw new Error('WEB_PICKER_CSRF_MISMATCH')
  }

  private authorizationUrl(session: Session) {
    if (session.state !== 'CREATED' || !session.configuration) throw new Error('WEB_PICKER_SESSION_REPLAYED')
    session.state = 'OAUTH_PENDING'
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.search = new URLSearchParams({
      client_id: session.configuration.clientId,
      redirect_uri: WEB_PICKER_REDIRECT_URI,
      response_type: 'code',
      scope: GOOGLE_DRIVE_FILE_SCOPE,
      state: session.oauthState,
      code_challenge: session.pkceChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent'
    }).toString()
    return url.toString()
  }

  private async completeOAuth(session: Session, code: string, state: string) {
    if (session.state !== 'OAUTH_PENDING') throw new Error('WEB_PICKER_OAUTH_CALLBACK_REPLAYED')
    if (state !== session.oauthState || !code || !session.configuration) throw new Error('WEB_PICKER_OAUTH_CALLBACK_INVALID')
    const response = await this.http('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: session.configuration.clientId,
        client_secret: session.configuration.clientSecret,
        code,
        code_verifier: session.pkceVerifier,
        grant_type: 'authorization_code',
        redirect_uri: WEB_PICKER_REDIRECT_URI
      })
    })
    const credential = await tokenPayload(response)
    session.credential = credential
    session.verifiedIdentity = await this.dependencies.drive.identity(credential)
    session.state = 'PICKER_READY'
    session.pkceVerifier = ''
    session.pkceChallenge = ''
    session.oauthState = ''
    if (session.configuration) session.configuration.clientSecret = ''
  }

  private pickerBootstrap(session: Session) {
    if (session.state !== 'PICKER_READY' || !session.credential?.accessToken || !session.configuration?.apiKey) throw new Error('WEB_PICKER_NOT_READY')
    if (session.bootstrapIssued) throw new Error('WEB_PICKER_BOOTSTRAP_REPLAYED')
    session.bootstrapIssued = true
    return { accessToken: session.credential.accessToken, developerKey: session.configuration.apiKey, appId: WEB_PICKER_PROJECT_NUMBER, scope: GOOGLE_DRIVE_FILE_SCOPE }
  }

  private async pickerCallback(session: Session, body: Record<string, unknown>) {
    if (session.state !== 'PICKER_READY') throw new Error('WEB_PICKER_CALLBACK_REPLAYED')
    if (body.action === 'cancel') {
      this.clearSecrets(session, 'FAILED')
      throw new Error('WEB_PICKER_MANAGER_CANCELLED')
    }
    const id = assertPickerDocuments(body.action, body.documents)
    if (!session.credential || !session.verifiedIdentity) throw new Error('WEB_PICKER_SESSION_CREDENTIAL_MISSING')
    session.state = 'VALIDATING_SELECTION'
    const identity = await this.dependencies.drive.identity(session.credential)
    assertVerifiedIdentity(identity, session.verifiedIdentity)
    const folder = assertMyDriveFolder(await this.dependencies.drive.folder(session.credential, id), identity)
    if (folder.id !== id) throw new Error('WEB_PICKER_DESTINATION_ID_MISMATCH')
    session.selectedFolder = folder
    session.state = WEB_PICKER_APPROVAL_CHECKPOINT
    if (session.configuration) session.configuration.apiKey = ''
    return { approvalUrl: `${WEB_PICKER_ORIGIN}/provision/${session.id}/approval` }
  }

  private clearSecrets(session: Session, state: Extract<WebPickerSessionState, 'FAILED' | 'EXPIRED' | 'CONSUMED'>) {
    session.state = state
    session.pkceVerifier = ''
    session.pkceChallenge = ''
    session.oauthState = ''
    if (session.configuration) { session.configuration.clientSecret = ''; session.configuration.apiKey = '' }
    if (session.credential) { session.credential.accessToken = ''; session.credential.refreshToken = undefined }
    this.byOAuthState.forEach((id, oauthState) => { if (id === session.id) this.byOAuthState.delete(oauthState) })
  }

  private respond(response: ServerResponse, status: number, contentType: string, body: string, headers: Record<string, string> = {}) {
    response.writeHead(status, { ...safeHeaders(contentType), ...headers })
    response.end(body)
  }

  private redirect(response: ServerResponse, location: string) {
    response.writeHead(303, { ...safeHeaders('text/plain; charset=utf-8'), Location: location })
    response.end('Continue in the browser.')
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    try {
      if (request.socket.localAddress !== '127.0.0.1' || request.headers.host !== `127.0.0.1:${WEB_PICKER_PORT}`) throw new Error('WEB_PICKER_LOOPBACK_REQUIRED')
      const url = new URL(request.url || '/', WEB_PICKER_ORIGIN)
      if (request.method === 'GET' && url.pathname === '/web-picker.js') return this.respond(response, 200, 'text/javascript; charset=utf-8', webPickerClientScript)
      if (request.method === 'GET' && url.pathname === '/oauth/google/callback') {
        const state = url.searchParams.get('state') || ''
        const id = this.byOAuthState.get(state) || ''
        const session = this.requireSession(id)
        try {
          if (url.searchParams.get('error')) throw new Error('WEB_PICKER_OAUTH_CANCELLED')
          await this.completeOAuth(session, url.searchParams.get('code') || '', state)
          return this.redirect(response, `${WEB_PICKER_ORIGIN}/provision/${session.id}/picker`)
        } catch (error) {
          this.clearSecrets(session, 'FAILED')
          throw error
        }
      }
      const provision = url.pathname.match(/^\/provision\/([A-Za-z0-9_-]{20,})(?:\/(oauth|picker|approval))?$/)
      if (request.method === 'GET' && provision) {
        const session = this.requireSession(provision[1])
        if (provision[2] === 'oauth') return this.redirect(response, this.authorizationUrl(session))
        if (provision[2] === 'picker') {
          if (session.state !== 'PICKER_READY') throw new Error('WEB_PICKER_NOT_READY')
          return this.respond(response, 200, 'text/html; charset=utf-8', `<!doctype html><html data-session="${session.id}" data-csrf="${session.csrf}"><head><meta charset="utf-8"><meta name="referrer" content="origin"><title>ANDALUCÍA secure folder selection</title><script defer src="https://apis.google.com/js/api.js"></script><script defer src="/web-picker.js"></script></head><body><main><h1>Select the encrypted database backup folder</h1><p>Select exactly one folder. No Drive data will be modified.</p></main></body></html>`, { 'Referrer-Policy': 'origin' })
        }
        if (provision[2] === 'approval') {
          const checkpoint = this.inspectCheckpoint(session.id)
          if (!checkpoint) throw new Error('WEB_PICKER_APPROVAL_NOT_READY')
          return this.respond(response, 200, 'text/html; charset=utf-8', `<!doctype html><html><head><meta charset="utf-8"><title>Destination approval required</title></head><body><main><h1>Manager destination approval required</h1><p>Google identity: ${checkpoint.identity.maskedEmail}</p><p>Destination: ${checkpoint.destination.name}</p><p>Relationship: MY_DRIVE</p><p>Return to Codex. No credential has been retained and no Drive object has been modified.</p></main></body></html>`)
        }
        if (session.state !== 'CREATED') throw new Error('WEB_PICKER_SESSION_REPLAYED')
        return this.respond(response, 200, 'text/html; charset=utf-8', `<!doctype html><html><head><meta charset="utf-8"><title>ANDALUCÍA secure Google provisioning</title></head><body><main><h1>ANDALUCÍA secure Google provisioning</h1><p>The requested scope is drive.file.</p><p><a href="/provision/${session.id}/oauth">Continue to Google</a></p></main></body></html>`)
      }
      if (request.method === 'POST' && ['/api/web-picker/bootstrap', '/api/web-picker/callback'].includes(url.pathname)) {
        const parsed = await parseJsonBody(request)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('WEB_PICKER_REQUEST_MALFORMED')
        const body = parsed as Record<string, unknown>
        const session = this.requireSession(String(body.sessionId || ''))
        try {
          this.verifyCsrf(session, request, body)
          const result = url.pathname.endsWith('/bootstrap') ? this.pickerBootstrap(session) : await this.pickerCallback(session, body)
          return this.respond(response, 200, 'application/json; charset=utf-8', JSON.stringify(result))
        } catch (error) {
          this.clearSecrets(session, 'FAILED')
          throw error
        }
      }
      this.respond(response, 404, 'text/plain; charset=utf-8', 'Not found.')
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'WEB_PICKER_REQUEST_FAILED'
      this.respond(response, 400, 'application/json; charset=utf-8', JSON.stringify({ error: code }))
    }
  }
}
