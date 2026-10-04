import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import {
  GOOGLE_DRIVE_FILE_SCOPE,
  SecureCloudUploadCoordinator,
  assertLeastPrivilegeScopes,
  sanitizeCloudValue,
  validateEncryptedRecoveryPair,
  type ApprovedDriveDestination,
  type CloudCredential,
  type CloudCredentialStore,
  type DriveFolder,
  type DriveIdentity,
  type DriveTransport,
  type SafeCloudUploadResult,
  type ValidatedRecoveryPair
} from './secure-cloud-upload.js'
import type { DesktopOAuthConfiguration, PendingDesktopAuthorization } from './google-drive-cloud-client.js'

export const PROVISIONING_CONFIRM_IDENTITY = 'APPROVE GOOGLE IDENTITY' as const
export const PROVISIONING_CONFIRM_DESTINATION = 'APPROVE DRIVE DESTINATION' as const
export const PROVISIONING_CONFIRM_PUBLICATION = 'PUBLISH VERIFIED PAIR' as const

const referencePattern = /^andalucia-cloud:[A-Za-z0-9._-]+$/
const sha256Pattern = /^[0-9a-f]{64}$/i
const sameIdentity = (left: DriveIdentity, right: DriveIdentity) => left.permissionId === right.permissionId && left.emailAddress.toLowerCase() === right.emailAddress.toLowerCase()
const safeHost = (request: IncomingMessage, port: number) => request.socket.localAddress === '127.0.0.1' && request.headers.host === `127.0.0.1:${port}`
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character)

export type ProvisioningInput = {
  clientId: string
  credentialReference: string
  destination: { folderId: string; label: string; relationship: 'MY_DRIVE' | 'SHARED_DRIVE'; driveId?: string }
  approvedRoot: string
  artifactPath: string
  sidecarPath: string
  expectedBackupId: string
  expectedSchema: string
  expectedManifestSha256: string
  callbackTimeoutMs?: number
}

export type ManagerApprovalBoundary = {
  authorizationReady(localAuthorizationUrl: string, scope: typeof GOOGLE_DRIVE_FILE_SCOPE): Promise<void>
  approveIdentity(identity: { maskedEmail: string; permissionFingerprint: string }): Promise<boolean>
  approveDestination(destination: { label: string; folderId: string; relationship: 'MY_DRIVE' | 'SHARED_DRIVE'; driveId?: string }): Promise<boolean>
  approvePublication(pair: { backupId: string; artifactName: string; sidecarName: string; artifactSha256: string }): Promise<boolean>
}

export type OAuthCoordinatorBoundary = {
  begin(credentialReference: string): PendingDesktopAuthorization
  complete(pending: PendingDesktopAuthorization, callback: { state: string; code: string }): Promise<{ stored: true; grantedScopes: string[] }>
}

export type LoopbackCallbackBoundary = {
  redirectUri: string
  localAuthorizationUrl: string
  setAuthorizationUrl(url: string): void
  wait(): Promise<{ state: string; code: string }>
  close(): Promise<void>
}

export const maskGoogleIdentity = (identity: DriveIdentity) => {
  const [local, domain = ''] = identity.emailAddress.split('@')
  const maskedEmail = `${local.slice(0, 1) || '*'}***${domain ? `@${domain}` : ''}`
  const permissionFingerprint = identity.permissionId.length <= 8 ? identity.permissionId : `${identity.permissionId.slice(0, 4)}...${identity.permissionId.slice(-4)}`
  return { maskedEmail, permissionFingerprint }
}

export const assertProvisioningInput = (input: ProvisioningInput) => {
  if (!input.clientId.trim()) throw new Error('OAUTH_CLIENT_ID_MISSING')
  if (!referencePattern.test(input.credentialReference)) throw new Error('CREDENTIAL_REFERENCE_INVALID')
  if (!input.destination.folderId.trim() || !input.destination.label.trim()) throw new Error('DESTINATION_BINDING_MALFORMED')
  if (input.destination.relationship === 'SHARED_DRIVE' && !input.destination.driveId?.trim()) throw new Error('DESTINATION_DRIVE_ID_MISSING')
  if (!input.expectedBackupId.trim() || !input.expectedSchema.trim() || !sha256Pattern.test(input.expectedManifestSha256)) throw new Error('RECOVERY_EVIDENCE_INPUT_INVALID')
  const timeout = input.callbackTimeoutMs ?? 300_000
  if (!Number.isInteger(timeout) || timeout < 10_000 || timeout > 600_000) throw new Error('OAUTH_CALLBACK_TIMEOUT_INVALID')
  return { ...input, callbackTimeoutMs: timeout }
}

export const assertCredentialPayload = (credential: CloudCredential | null, now = new Date()) => {
  if (!credential || typeof credential.accessToken !== 'string' || !credential.accessToken || !Array.isArray(credential.grantedScopes)) throw new Error('CLOUD_CREDENTIAL_MALFORMED')
  assertLeastPrivilegeScopes(credential.grantedScopes)
  if (credential.expiresAt && (!Number.isFinite(Date.parse(credential.expiresAt)) || Date.parse(credential.expiresAt) <= now.getTime())) throw new Error('CLOUD_AUTHORIZATION_EXPIRED')
  return credential
}

export const assertDestinationFolder = (folder: DriveFolder, identity: DriveIdentity, destination: ProvisioningInput['destination']) => {
  if (folder.id !== destination.folderId || folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder' || !folder.canAddChildren) throw new Error('DESTINATION_FOLDER_UNVERIFIED')
  if (destination.relationship === 'MY_DRIVE' && !folder.owners.some(owner => sameIdentity(owner, identity))) throw new Error('DESTINATION_OWNERSHIP_MISMATCH')
  if (destination.relationship === 'SHARED_DRIVE' && (!destination.driveId || folder.driveId !== destination.driveId)) throw new Error('DESTINATION_DRIVE_MISMATCH')
}

export const assertExistingBindingCompatible = (credential: CloudCredential | null, identity: DriveIdentity, destination: ProvisioningInput['destination']) => {
  const binding = credential?.approvedDestination
  if (!binding) return
  if (!sameIdentity(binding.account, identity)) throw new Error('EXISTING_IDENTITY_BINDING_MISMATCH')
  if (binding.folderId !== destination.folderId || binding.relationship !== destination.relationship || (binding.driveId || '') !== (destination.driveId || '')) throw new Error('EXISTING_DESTINATION_BINDING_MISMATCH')
}

export class LoopbackOAuthCallbackServer implements LoopbackCallbackBoundary {
  redirectUri = ''
  localAuthorizationUrl = ''
  private authorizationUrl = ''
  private server: Server
  private callbackPromise: Promise<{ state: string; code: string }>
  private resolveCallback!: (value: { state: string; code: string }) => void
  private rejectCallback!: (error: Error) => void
  private timer?: NodeJS.Timeout
  private settled = false

  private constructor(server: Server) {
    this.server = server
    this.callbackPromise = new Promise((resolve, reject) => { this.resolveCallback = resolve; this.rejectCallback = reject })
    // The browser can cancel before the CLI reaches wait(); retain rejection for
    // the caller while preventing Node from treating that brief gap as unhandled.
    void this.callbackPromise.catch(() => undefined)
  }

  static async listen(timeoutMs = 300_000) {
    let boundary: LoopbackOAuthCallbackServer
    const server = createServer((request, response) => boundary.handle(request, response))
    boundary = new LoopbackOAuthCallbackServer(server)
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address() as AddressInfo
    boundary.redirectUri = `http://127.0.0.1:${address.port}/callback`
    boundary.localAuthorizationUrl = `http://127.0.0.1:${address.port}/authorize`
    boundary.timer = setTimeout(() => boundary.reject(new Error('OAUTH_CALLBACK_TIMEOUT')), timeoutMs)
    boundary.timer.unref()
    return boundary
  }

  setAuthorizationUrl(url: string) {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'accounts.google.com') throw new Error('OAUTH_AUTHORIZATION_ENDPOINT_UNAPPROVED')
    this.authorizationUrl = parsed.toString()
  }

  wait() { return this.callbackPromise }

  async close() {
    if (this.timer) clearTimeout(this.timer)
    if (!this.server.listening) return
    await new Promise<void>(resolve => this.server.close(() => resolve()))
  }

  private reject(error: Error) {
    if (this.settled) return
    this.settled = true
    this.rejectCallback(error)
    void this.close()
  }

  private resolve(value: { state: string; code: string }) {
    if (this.settled) return
    this.settled = true
    this.resolveCallback(value)
    void this.close()
  }

  private respond(response: ServerResponse, status: number, body: string) {
    response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action https://accounts.google.com; base-uri 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' })
    response.end(body)
  }

  private handle(request: IncomingMessage, response: ServerResponse) {
    const address = this.server.address() as AddressInfo | null
    if (!address || !safeHost(request, address.port) || request.method !== 'GET') return this.respond(response, 400, '<h1>Invalid local authorization request.</h1>')
    const url = new URL(request.url || '/', `http://127.0.0.1:${address.port}`)
    if (url.pathname === '/authorize') {
      if (!this.authorizationUrl) return this.respond(response, 503, '<h1>Authorization is not ready.</h1>')
      return this.respond(response, 200, `<main><h1>ANDALUCÍA secure Google authorization</h1><p>The requested scope is drive.file.</p><p><a href="${escapeHtml(this.authorizationUrl)}">Continue to Google</a></p><p>Do not share passwords, codes, or tokens with Codex.</p></main>`)
    }
    if (url.pathname !== '/callback') return this.respond(response, 404, '<h1>Not found.</h1>')
    if (url.searchParams.get('error')) { this.respond(response, 400, '<h1>Google authorization was cancelled or rejected.</h1>'); return this.reject(new Error('OAUTH_MANAGER_CANCELLED')) }
    const state = url.searchParams.get('state') || ''
    const code = url.searchParams.get('code') || ''
    if (!state || !code) { this.respond(response, 400, '<h1>Authorization callback is incomplete.</h1>'); return this.reject(new Error('OAUTH_CALLBACK_INVALID')) }
    this.respond(response, 200, '<h1>Authorization received.</h1><p>You may return to the terminal. No credential value is displayed here.</p>')
    this.resolve({ state, code })
  }
}

export type ProvisioningDependencies = {
  credentials: CloudCredentialStore
  drive: DriveTransport
  createOAuth(configuration: DesktopOAuthConfiguration): OAuthCoordinatorBoundary
  createCallback(timeoutMs: number): Promise<LoopbackCallbackBoundary>
  manager: ManagerApprovalBoundary
  now?: () => Date
  operationId?: () => string
  maxRetries?: number
}

export type ProvisioningResult = {
  status: 'SUCCEEDED' | 'ALREADY_PRESENT_VERIFIED'
  scope: typeof GOOGLE_DRIVE_FILE_SCOPE
  identity: ReturnType<typeof maskGoogleIdentity>
  destination: { label: string; folderId: string; relationship: 'MY_DRIVE' | 'SHARED_DRIVE'; driveId?: string }
  pair: { backupId: string; artifactName: string; sidecarName: string; artifactSha256: string }
  upload: SafeCloudUploadResult
}

export class ManagerControlledCloudProvisioning {
  constructor(private readonly dependencies: ProvisioningDependencies) {}

  async execute(rawInput: ProvisioningInput): Promise<ProvisioningResult> {
    const input = assertProvisioningInput(rawInput)
    const pair = await validateEncryptedRecoveryPair(input)
    const pendingReference = `${input.credentialReference}.pending-${randomUUID()}`
    const existing = await this.dependencies.credentials.load(input.credentialReference)
    const callback = await this.dependencies.createCallback(input.callbackTimeoutMs)
    let pendingStored = false
    try {
      const oauth = this.dependencies.createOAuth({ clientId: input.clientId, redirectUri: callback.redirectUri })
      const pending = oauth.begin(pendingReference)
      callback.setAuthorizationUrl(pending.authorizationUrl)
      await this.dependencies.manager.authorizationReady(callback.localAuthorizationUrl, GOOGLE_DRIVE_FILE_SCOPE)
      const callbackResult = await callback.wait()
      const completed = await oauth.complete(pending, callbackResult)
      assertLeastPrivilegeScopes(completed.grantedScopes)
      pendingStored = true
      const credential = assertCredentialPayload(await this.dependencies.credentials.load(pendingReference), this.dependencies.now?.() || new Date())
      const identity = await this.dependencies.drive.identity(credential)
      assertExistingBindingCompatible(existing, identity, input.destination)
      if (!await this.dependencies.manager.approveIdentity(maskGoogleIdentity(identity))) throw new Error('MANAGER_IDENTITY_APPROVAL_REQUIRED')
      const folder = await this.dependencies.drive.folder(credential, input.destination.folderId)
      assertDestinationFolder(folder, identity, input.destination)
      if (!await this.dependencies.manager.approveDestination(input.destination)) throw new Error('MANAGER_DESTINATION_APPROVAL_REQUIRED')
      const approvedDestination: ApprovedDriveDestination = { version: 1, credentialReference: input.credentialReference, ...input.destination, account: identity }
      await this.dependencies.credentials.save(input.credentialReference, { ...credential, approvedDestination, destinationApprovedAt: (this.dependencies.now?.() || new Date()).toISOString() })
      const persisted = assertCredentialPayload(await this.dependencies.credentials.load(input.credentialReference), this.dependencies.now?.() || new Date())
      if (!persisted.approvedDestination || persisted.approvedDestination.folderId !== approvedDestination.folderId || !sameIdentity(persisted.approvedDestination.account, identity)) throw new Error('CREDENTIAL_BINDING_READBACK_FAILED')
      await this.dependencies.credentials.remove(pendingReference)
      pendingStored = false
      const pairSummary = { backupId: pair.backupId, artifactName: pair.artifact.name, sidecarName: pair.sidecar.name, artifactSha256: pair.artifact.sha256 }
      if (!await this.dependencies.manager.approvePublication(pairSummary)) throw new Error('MANAGER_PUBLICATION_APPROVAL_REQUIRED')
      const upload = await new SecureCloudUploadCoordinator({ credentialStore: this.dependencies.credentials, drive: this.dependencies.drive, now: this.dependencies.now, operationId: this.dependencies.operationId, maxRetries: this.dependencies.maxRetries }).execute({
        destination: approvedDestination,
        approvedRoot: input.approvedRoot,
        artifactPath: input.artifactPath,
        sidecarPath: input.sidecarPath,
        expectedBackupId: input.expectedBackupId,
        expectedSchema: input.expectedSchema,
        expectedManifestSha256: input.expectedManifestSha256
      })
      if (!['SUCCEEDED', 'ALREADY_PRESENT_VERIFIED'].includes(upload.state)) throw new Error(upload.errorCode || 'CLOUD_UPLOAD_FAILED')
      return sanitizeCloudValue({ status: upload.state, scope: GOOGLE_DRIVE_FILE_SCOPE, identity: maskGoogleIdentity(identity), destination: input.destination, pair: pairSummary, upload }) as ProvisioningResult
    } finally {
      await callback.close().catch(() => undefined)
      if (pendingStored) await this.dependencies.credentials.remove(pendingReference).catch(() => undefined)
    }
  }
}

export const provisioningPairSummary = (pair: ValidatedRecoveryPair) => ({ backupId: pair.backupId, artifactName: pair.artifact.name, sidecarName: pair.sidecar.name, artifactSha256: pair.artifact.sha256 })
