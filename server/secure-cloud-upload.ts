import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'

export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file' as const
export const OFFDEVICE_EXPORT_FORMAT = 'andalucia-offdevice-database-export-v1' as const

export type CloudCredential = {
  accessToken: string
  refreshToken?: string
  expiresAt?: string
  grantedScopes: string[]
}

export interface CloudCredentialStore {
  load(reference: string): Promise<CloudCredential | null>
  save(reference: string, credential: CloudCredential): Promise<void>
  remove(reference: string): Promise<void>
}

export type ApprovedDriveDestination = {
  version: 1
  credentialReference: string
  label: string
  folderId: string
  account: { permissionId: string; emailAddress: string }
  relationship: 'MY_DRIVE' | 'SHARED_DRIVE'
  driveId?: string
}

export type OffdeviceSidecar = {
  exportFormat: typeof OFFDEVICE_EXPORT_FORMAT
  sourceBackupId: string
  sourceState: 'VERIFIED_REHEARSED'
  sourceSchema: string
  sourceManifestSha256: string
  sourceFileCount: number
  sourceTotalBytes: number
  encryptedFilename: string
  encryptedSha256: string
  encryptedBytes: number
  localVerification: 'VERIFIED'
}

export type ValidatedLocalFile = { path: string; name: string; bytes: number; sha256: string; md5: string }
export type ValidatedRecoveryPair = {
  backupId: string
  schema: string
  manifestSha256: string
  artifact: ValidatedLocalFile
  sidecar: ValidatedLocalFile
  sidecarDocument: OffdeviceSidecar
}

const sha256Pattern = /^[0-9a-f]{64}$/
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const requiredString = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`LOCAL_VALIDATION_${name.toUpperCase()}_MISSING`)
  return value.trim()
}
const requiredInteger = (value: unknown, name: string) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`LOCAL_VALIDATION_${name.toUpperCase()}_INVALID`)
  return Number(value)
}
const digest = (algorithm: 'sha256' | 'md5', value: Uint8Array) => createHash(algorithm).update(value).digest('hex')

const within = (parent: string, child: string) => {
  const fragment = relative(parent, child)
  return fragment === '' || (!fragment.startsWith(`..${sep}`) && fragment !== '..' && !isAbsolute(fragment))
}

const safeRegularFile = async (root: string, candidate: string) => {
  const absoluteRoot = resolve(root)
  const absoluteCandidate = resolve(candidate)
  if (!within(absoluteRoot, absoluteCandidate)) throw new Error('LOCAL_VALIDATION_PATH_OUTSIDE_APPROVED_ROOT')
  const [physicalRoot, physicalCandidate, information] = await Promise.all([realpath(absoluteRoot), realpath(absoluteCandidate), lstat(absoluteCandidate)])
  if (resolve(physicalRoot).toLowerCase() !== absoluteRoot.toLowerCase()) throw new Error('LOCAL_VALIDATION_APPROVED_ROOT_REDIRECTED')
  if (!within(physicalRoot, physicalCandidate)) throw new Error('LOCAL_VALIDATION_FILE_REDIRECTED')
  if (!information.isFile() || information.isSymbolicLink() || information.nlink !== 1) throw new Error('LOCAL_VALIDATION_NOT_UNIQUE_REGULAR_FILE')
  return { path: physicalCandidate, information }
}

const parseSidecar = (value: unknown): OffdeviceSidecar => {
  if (!isObject(value)) throw new Error('LOCAL_VALIDATION_SIDECAR_INVALID')
  const exportFormat = requiredString(value.exportFormat, 'export_format')
  if (exportFormat !== OFFDEVICE_EXPORT_FORMAT) throw new Error('LOCAL_VALIDATION_SIDECAR_FORMAT_UNSUPPORTED')
  const sourceState = requiredString(value.sourceState, 'source_state')
  if (sourceState !== 'VERIFIED_REHEARSED') throw new Error('LOCAL_VALIDATION_SOURCE_NOT_REHEARSED')
  const localVerification = requiredString(value.localVerification, 'local_verification')
  if (localVerification !== 'VERIFIED') throw new Error('LOCAL_VALIDATION_SOURCE_NOT_VERIFIED')
  const encryptedSha256 = requiredString(value.encryptedSha256, 'encrypted_sha256').toLowerCase()
  const sourceManifestSha256 = requiredString(value.sourceManifestSha256, 'manifest_sha256').toLowerCase()
  if (!sha256Pattern.test(encryptedSha256) || !sha256Pattern.test(sourceManifestSha256)) throw new Error('LOCAL_VALIDATION_SHA256_INVALID')
  return {
    exportFormat,
    sourceBackupId: requiredString(value.sourceBackupId, 'backup_id'),
    sourceState,
    sourceSchema: requiredString(value.sourceSchema, 'schema'),
    sourceManifestSha256,
    sourceFileCount: requiredInteger(value.sourceFileCount, 'source_file_count'),
    sourceTotalBytes: requiredInteger(value.sourceTotalBytes, 'source_total_bytes'),
    encryptedFilename: requiredString(value.encryptedFilename, 'encrypted_filename'),
    encryptedSha256,
    encryptedBytes: requiredInteger(value.encryptedBytes, 'encrypted_bytes'),
    localVerification
  }
}

export const validateEncryptedRecoveryPair = async (input: {
  approvedRoot: string
  artifactPath: string
  sidecarPath: string
  expectedBackupId?: string
  expectedSchema?: string
  expectedManifestSha256?: string
}): Promise<ValidatedRecoveryPair> => {
  const [artifactFile, sidecarFile] = await Promise.all([
    safeRegularFile(input.approvedRoot, input.artifactPath),
    safeRegularFile(input.approvedRoot, input.sidecarPath)
  ])
  if (extname(artifactFile.path).toLowerCase() !== '.age') throw new Error('LOCAL_VALIDATION_ARTIFACT_NOT_AGE')
  if (!basename(sidecarFile.path).endsWith('.offdevice.json')) throw new Error('LOCAL_VALIDATION_SIDECAR_FILENAME_INVALID')
  if (dirname(artifactFile.path).toLowerCase() !== dirname(sidecarFile.path).toLowerCase()) throw new Error('LOCAL_VALIDATION_PAIR_DIRECTORY_MISMATCH')
  const [artifactBytes, sidecarBytes] = await Promise.all([readFile(artifactFile.path), readFile(sidecarFile.path)])
  let parsed: unknown
  try { parsed = JSON.parse(sidecarBytes.toString('utf8')) } catch { throw new Error('LOCAL_VALIDATION_SIDECAR_JSON_MALFORMED') }
  const sidecar = parseSidecar(parsed)
  const artifactSha256 = digest('sha256', artifactBytes)
  if (sidecar.encryptedFilename !== basename(artifactFile.path)) throw new Error('LOCAL_VALIDATION_ARTIFACT_FILENAME_MISMATCH')
  if (sidecar.encryptedBytes !== artifactBytes.byteLength) throw new Error('LOCAL_VALIDATION_ARTIFACT_SIZE_MISMATCH')
  if (sidecar.encryptedSha256 !== artifactSha256) throw new Error('LOCAL_VALIDATION_ARTIFACT_SHA256_MISMATCH')
  if (input.expectedBackupId && sidecar.sourceBackupId !== input.expectedBackupId) throw new Error('LOCAL_VALIDATION_BACKUP_ID_MISMATCH')
  if (input.expectedSchema && sidecar.sourceSchema !== input.expectedSchema) throw new Error('LOCAL_VALIDATION_SCHEMA_MISMATCH')
  if (input.expectedManifestSha256 && sidecar.sourceManifestSha256 !== input.expectedManifestSha256.toLowerCase()) throw new Error('LOCAL_VALIDATION_MANIFEST_MISMATCH')
  return {
    backupId: sidecar.sourceBackupId,
    schema: sidecar.sourceSchema,
    manifestSha256: sidecar.sourceManifestSha256,
    artifact: { path: artifactFile.path, name: basename(artifactFile.path), bytes: artifactBytes.byteLength, sha256: artifactSha256, md5: digest('md5', artifactBytes) },
    sidecar: { path: sidecarFile.path, name: basename(sidecarFile.path), bytes: sidecarBytes.byteLength, sha256: digest('sha256', sidecarBytes), md5: digest('md5', sidecarBytes) },
    sidecarDocument: sidecar
  }
}

export const assertLeastPrivilegeScopes = (scopes: readonly string[]) => {
  const normalized = [...new Set(scopes.map(value => value.trim()).filter(Boolean))]
  if (normalized.length !== 1 || normalized[0] !== GOOGLE_DRIVE_FILE_SCOPE) throw new Error('CLOUD_AUTHORIZATION_SCOPE_REJECTED')
}

export type DriveIdentity = { permissionId: string; emailAddress: string }
export type DriveFolder = { id: string; mimeType: string; trashed: boolean; driveId?: string; owners: DriveIdentity[]; canAddChildren: boolean }
export type RemoteRecoveryObject = {
  id: string
  name: string
  parents: string[]
  bytes: number
  md5Checksum?: string
  sha256Checksum?: string
  appProperties: Record<string, string>
}
export type UploadSession = { url: string; remoteId?: string }
export type RemoteUploadRequest = {
  name: string
  parentId: string
  mimeType: string
  appProperties: Record<string, string>
}
export type FinalizePairRequest = {
  artifact: { id: string; name: string; backupId: string; sha256: string }
  sidecar: { id: string; name: string; backupId: string; sha256: string }
  pairId: string
}

export interface DriveTransport {
  identity(credential: CloudCredential): Promise<DriveIdentity>
  folder(credential: CloudCredential, folderId: string): Promise<DriveFolder>
  candidates(credential: CloudCredential, folderId: string, names: string[], backupId: string): Promise<RemoteRecoveryObject[]>
  createSession(credential: CloudCredential, request: RemoteUploadRequest): Promise<UploadSession>
  upload(credential: CloudCredential, session: UploadSession, bytes: Uint8Array): Promise<string>
  remote(credential: CloudCredential, id: string): Promise<RemoteRecoveryObject>
  finalizePair(credential: CloudCredential, request: FinalizePairRequest): Promise<void>
  remove(credential: CloudCredential, id: string): Promise<void>
}

export type CloudUploadState =
  | 'CREATED' | 'LOCAL_VALIDATION_PASSED' | 'AUTHORIZATION_REQUIRED' | 'AUTHORIZED'
  | 'DESTINATION_VERIFIED' | 'UPLOAD_IN_PROGRESS' | 'REMOTE_VERIFICATION_PENDING'
  | 'PAIR_FINALIZATION_PENDING' | 'SUCCEEDED' | 'ALREADY_PRESENT_VERIFIED'
  | 'FAILED' | 'CLEANUP_REQUIRED' | 'CLEANUP_FAILED'

export type SafeCloudUploadResult = {
  operationId: string
  backupId?: string
  state: CloudUploadState
  history: Array<{ state: CloudUploadState; at: string }>
  destinationLabel: string
  destinationFolderId: string
  artifact?: { name: string; bytes: number; sha256: string; remoteId?: string }
  sidecar?: { name: string; bytes: number; sha256: string; remoteId?: string }
  retries: number
  errorCode?: string
}

const safeCode = (error: unknown) => {
  const value = error instanceof Error ? error.message : 'UNKNOWN_CLOUD_UPLOAD_ERROR'
  return /^[A-Z0-9_]+$/.test(value) ? value : 'SANITIZED_THIRD_PARTY_FAILURE'
}

export const sanitizeCloudValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitizeCloudValue)
  if (!isObject(value)) return value
  const secret = /token|secret|authorization|codeverifier|code_verifier|passphrase|password|credentialpayload/i
  return Object.fromEntries(Object.entries(value).filter(([key]) => !secret.test(key)).map(([key, item]) => [key, sanitizeCloudValue(item)]))
}

const sameIdentity = (actual: DriveIdentity, expected: DriveIdentity) => actual.permissionId === expected.permissionId && actual.emailAddress.toLowerCase() === expected.emailAddress.toLowerCase()
const pairProperties = (object: RemoteRecoveryObject, pairId: string, role: 'artifact' | 'sidecar', pair: ValidatedRecoveryPair) => object.appProperties.backupId === pair.backupId && object.appProperties.pairId === pairId && object.appProperties.role === role && object.appProperties.state === 'VERIFIED_PAIR'
const verifyRemote = (remote: RemoteRecoveryObject, local: ValidatedLocalFile, folderId: string) => {
  if (!remote.parents.includes(folderId)) throw new Error('REMOTE_DESTINATION_MISMATCH')
  if (remote.bytes !== local.bytes) throw new Error('REMOTE_SIZE_MISMATCH')
  if (remote.sha256Checksum) {
    if (remote.sha256Checksum.toLowerCase() !== local.sha256) throw new Error('REMOTE_CHECKSUM_MISMATCH')
    return
  }
  if (remote.md5Checksum) {
    if (remote.md5Checksum.toLowerCase() !== local.md5) throw new Error('REMOTE_CHECKSUM_MISMATCH')
    return
  }
  throw new Error('REMOTE_CHECKSUM_UNAVAILABLE')
}

const retryable = new Set(['TRANSIENT_UPLOAD_FAILURE', 'UPLOAD_TIMEOUT', 'PROVIDER_TEMPORARY_FAILURE'])

export class SecureCloudUploadCoordinator {
  constructor(private readonly dependencies: {
    credentialStore: CloudCredentialStore
    drive: DriveTransport
    now?: () => Date
    operationId?: () => string
    maxRetries?: number
  }) {}

  async execute(input: {
    destination: ApprovedDriveDestination
    approvedRoot: string
    artifactPath: string
    sidecarPath: string
    expectedBackupId?: string
    expectedSchema?: string
    expectedManifestSha256?: string
  }): Promise<SafeCloudUploadResult> {
    const operationId = this.dependencies.operationId?.() || randomUUID()
    const now = () => (this.dependencies.now?.() || new Date()).toISOString()
    const history: SafeCloudUploadResult['history'] = []
    let state: CloudUploadState = 'CREATED'
    let retries = 0
    let pair: ValidatedRecoveryPair | undefined
    let artifactId: string | undefined
    let sidecarId: string | undefined
    const transition = (next: CloudUploadState) => { state = next; history.push({ state: next, at: now() }) }
    const result = (errorCode?: string): SafeCloudUploadResult => sanitizeCloudValue({
      operationId, backupId: pair?.backupId, state, history, destinationLabel: input.destination.label,
      destinationFolderId: input.destination.folderId,
      artifact: pair && { name: pair.artifact.name, bytes: pair.artifact.bytes, sha256: pair.artifact.sha256, remoteId: artifactId },
      sidecar: pair && { name: pair.sidecar.name, bytes: pair.sidecar.bytes, sha256: pair.sidecar.sha256, remoteId: sidecarId },
      retries, errorCode
    }) as SafeCloudUploadResult
    transition('CREATED')
    try {
      if (input.destination.version !== 1 || !input.destination.folderId || !input.destination.account.permissionId || !input.destination.account.emailAddress || !input.destination.credentialReference) throw new Error('DESTINATION_BINDING_MALFORMED')
      pair = await validateEncryptedRecoveryPair(input)
      transition('LOCAL_VALIDATION_PASSED')
      transition('AUTHORIZATION_REQUIRED')
      const credential = await this.dependencies.credentialStore.load(input.destination.credentialReference)
      if (!credential) throw new Error('CLOUD_CREDENTIAL_MISSING')
      if (credential.expiresAt && Date.parse(credential.expiresAt) <= Date.parse(now())) throw new Error('CLOUD_AUTHORIZATION_EXPIRED')
      assertLeastPrivilegeScopes(credential.grantedScopes)
      transition('AUTHORIZED')
      const [identity, folder] = await Promise.all([
        this.dependencies.drive.identity(credential),
        this.dependencies.drive.folder(credential, input.destination.folderId)
      ])
      if (!sameIdentity(identity, input.destination.account)) throw new Error('DESTINATION_ACCOUNT_MISMATCH')
      if (folder.id !== input.destination.folderId || folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder' || !folder.canAddChildren) throw new Error('DESTINATION_FOLDER_UNVERIFIED')
      if (input.destination.relationship === 'MY_DRIVE' && !folder.owners.some(owner => sameIdentity(owner, input.destination.account))) throw new Error('DESTINATION_OWNERSHIP_MISMATCH')
      if (input.destination.relationship === 'SHARED_DRIVE' && (!input.destination.driveId || folder.driveId !== input.destination.driveId)) throw new Error('DESTINATION_DRIVE_MISMATCH')
      transition('DESTINATION_VERIFIED')
      const existing = await this.dependencies.drive.candidates(credential, folder.id, [pair.artifact.name, pair.sidecar.name], pair.backupId)
      if (existing.length) {
        const artifacts = existing.filter(item => item.name === pair!.artifact.name)
        const sidecars = existing.filter(item => item.name === pair!.sidecar.name)
        if (artifacts.length === 1 && sidecars.length === 1) {
          const pairId = artifacts[0].appProperties.pairId
          if (pairId && pairProperties(artifacts[0], pairId, 'artifact', pair) && pairProperties(sidecars[0], pairId, 'sidecar', pair)) {
            verifyRemote(artifacts[0], pair.artifact, folder.id); verifyRemote(sidecars[0], pair.sidecar, folder.id)
            artifactId = artifacts[0].id; sidecarId = sidecars[0].id
            transition('ALREADY_PRESENT_VERIFIED')
            return result()
          }
        }
        throw new Error(existing.length > 2 || existing.filter(item => item.name === pair!.artifact.name).length > 1 || existing.filter(item => item.name === pair!.sidecar.name).length > 1 ? 'REMOTE_DUPLICATE_AMBIGUOUS' : 'REMOTE_NAME_CONFLICT')
      }
      transition('UPLOAD_IN_PROGRESS')
      const pairId = randomUUID()
      const uploadOne = async (local: ValidatedLocalFile, role: 'artifact' | 'sidecar', mimeType: string) => {
        const session = await this.dependencies.drive.createSession(credential, {
          name: `${local.name}.incomplete.${operationId}`,
          parentId: folder.id,
          mimeType,
          appProperties: { backupId: pair!.backupId, pairId, role, state: 'INCOMPLETE', sha256: local.sha256 }
        })
        for (;;) {
          try { return await this.dependencies.drive.upload(credential, session, await readFile(local.path)) }
          catch (error) {
            if (!retryable.has(safeCode(error)) || retries >= (this.dependencies.maxRetries ?? 2)) throw error
            retries += 1
          }
        }
      }
      artifactId = await uploadOne(pair.artifact, 'artifact', 'application/octet-stream')
      sidecarId = await uploadOne(pair.sidecar, 'sidecar', 'application/json')
      transition('REMOTE_VERIFICATION_PENDING')
      const [remoteArtifact, remoteSidecar] = await Promise.all([this.dependencies.drive.remote(credential, artifactId), this.dependencies.drive.remote(credential, sidecarId)])
      verifyRemote(remoteArtifact, pair.artifact, folder.id); verifyRemote(remoteSidecar, pair.sidecar, folder.id)
      transition('PAIR_FINALIZATION_PENDING')
      await this.dependencies.drive.finalizePair(credential, {
        artifact: { id: artifactId, name: pair.artifact.name, backupId: pair.backupId, sha256: pair.artifact.sha256 },
        sidecar: { id: sidecarId, name: pair.sidecar.name, backupId: pair.backupId, sha256: pair.sidecar.sha256 },
        pairId
      })
      const [finalArtifact, finalSidecar] = await Promise.all([this.dependencies.drive.remote(credential, artifactId), this.dependencies.drive.remote(credential, sidecarId)])
      if (!pairProperties(finalArtifact, pairId, 'artifact', pair) || !pairProperties(finalSidecar, pairId, 'sidecar', pair)) throw new Error('PAIR_FINALIZATION_VERIFICATION_FAILED')
      verifyRemote(finalArtifact, pair.artifact, folder.id); verifyRemote(finalSidecar, pair.sidecar, folder.id)
      transition('SUCCEEDED')
      return result()
    } catch (error) {
      const errorCode = safeCode(error)
      if (artifactId || sidecarId) {
        transition('CLEANUP_REQUIRED')
        const credential = await this.dependencies.credentialStore.load(input.destination.credentialReference).catch(() => null)
        if (credential) {
          const settled = await Promise.allSettled([artifactId, sidecarId].filter((id): id is string => Boolean(id)).map(id => this.dependencies.drive.remove(credential, id)))
          if (settled.some(item => item.status === 'rejected')) { transition('CLEANUP_FAILED'); return result(errorCode) }
        }
      }
      transition('FAILED')
      return result(errorCode)
    }
  }
}

export const createPkce = () => {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge, method: 'S256' as const }
}
