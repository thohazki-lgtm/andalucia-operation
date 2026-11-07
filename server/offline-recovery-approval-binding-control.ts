import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PGlite } from '@electric-sql/pglite'
import { DatabaseOperationCoordinator } from './database-operation-coordinator.js'
import { openVerifiedDatabase } from './database-protection.js'
import { authenticateOfflineManager } from './offline-recovery-request-control.js'
import { historicalRuntimeEvidence, latestVerifiedSchemaEvidence } from './requested-backup-activation-control.js'

type Manager = { userId: string; displayName: string }
type RegistrationInput = { projectRoot: string; previousHealthySha: string; approvedControlSha: string; identifier: string; password: string }
type Dependencies = {
  portsClosed?: () => Promise<boolean>
  authenticate?: (db: PGlite, identifier: string, password: string) => Promise<Manager>
  openDatabase?: typeof openVerifiedDatabase
  now?: () => Date
}

const SHA = /^[0-9a-f]{40}$/i
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const fail = (code: string): never => { throw new Error(code) }
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
const allowedRegistrationPaths = new Set([
  'deployment/windows/New-AndaluciaOfflineRecoveryRequest.ps1',
  'deployment/windows/Register-AndaluciaStoppedRuntimeRecoveryApproval.ps1',
  'package.json',
  'server/database-operation-coordinator.ts',
  'server/offline-recovery-approval-binding-control.ts',
  'server/offline-recovery-approval-binding-security.test.mjs',
  'server/offline-recovery-request-control.ts',
  'server/requested-backup-activation-control.ts',
])

const portOpen = (port: number) => new Promise<boolean>(resolveOpen => {
  const socket = createConnection({ host: '127.0.0.1', port })
  const done = (value: boolean) => { socket.destroy(); resolveOpen(value) }
  socket.setTimeout(750, () => done(false)); socket.once('connect', () => done(true)); socket.once('error', () => done(false))
})

const verifyControlSource = (projectRoot: string, approvedControlSha: string) => {
  const branch = git(projectRoot, 'branch', '--show-current')
  const head = git(projectRoot, 'rev-parse', 'HEAD').toLowerCase()
  const remoteMain = git(projectRoot, 'rev-parse', 'refs/remotes/origin/main').toLowerCase()
  const dirty = git(projectRoot, 'status', '--porcelain', '--untracked-files=no')
  if (branch !== 'main' || dirty || head !== remoteMain) fail('RECOVERY_APPROVAL_REGISTRATION_SOURCE_INVALID')
  const ancestor = spawnSync('git', ['-C', projectRoot, 'merge-base', '--is-ancestor', approvedControlSha, head])
  if (ancestor.status !== 0) fail('RECOVERY_APPROVAL_CONTROL_SOURCE_NOT_ANCESTOR')
  const changed = git(projectRoot, 'diff', '--name-only', `${approvedControlSha}..${head}`).split(/\r?\n/).filter(Boolean)
  if (!changed.length || changed.some(path => !allowedRegistrationPaths.has(path.replaceAll('\\', '/')))) fail('RECOVERY_APPROVAL_REGISTRATION_SCOPE_INVALID')
  return head
}

export async function registerStoppedRuntimeRecoveryApproval(input: RegistrationInput, dependencies: Dependencies = {}) {
  const projectRoot = resolve(input.projectRoot)
  const previousHealthySha = input.previousHealthySha.toLowerCase()
  const approvedControlSha = input.approvedControlSha.toLowerCase()
  if (!SHA.test(previousHealthySha) || !SHA.test(approvedControlSha)) fail('RECOVERY_APPROVAL_SOURCE_SHA_INVALID')
  if (!await (dependencies.portsClosed || (async () => !(await portOpen(3001)) && !(await portOpen(5173))))() || existsSync(join(projectRoot, '.runtime', 'canonical-owner.json'))) fail('RECOVERY_APPROVAL_RUNTIME_NOT_EXCLUSIVE')
  const registrationSourceSha = verifyControlSource(projectRoot, approvedControlSha)
  try { git(projectRoot, 'cat-file', '-e', `${previousHealthySha}^{commit}`) } catch { return fail('RECOVERY_APPROVAL_PREVIOUS_SOURCE_MISSING') }

  const identityPath = join(projectRoot, '.data', 'andalucia-store-identity.json')
  const identityRaw = await readFile(identityPath)
  const identity = JSON.parse(identityRaw.toString('utf8')) as { role?: string; storeId?: string; databaseDirectory?: string }
  const databaseDirectory = resolve(String(identity.databaseDirectory || ''))
  if (identity.role !== 'canonical' || identity.storeId !== 'andalucia-canonical-live' || databaseDirectory !== resolve(projectRoot, '.data', 'postgres')) fail('RECOVERY_APPROVAL_CANONICAL_IDENTITY_INVALID')
  const canonicalStoreId = String(identity.storeId)
  const backupRoot = join(projectRoot, '.backups')
  const guarded = await (dependencies.openDatabase || openVerifiedDatabase)({ dataDirectory: databaseDirectory, role: 'canonical', requiredVersion: '027', backupRoot })
  let actor: Manager
  try {
    if (guarded.identity.storeId !== identity.storeId || guarded.health.migrationVersion !== '027' || guarded.health.migrationRequired || guarded.health.recoveryRequired) fail('RECOVERY_APPROVAL_SCHEMA_EVIDENCE_INVALID')
    actor = await (dependencies.authenticate || authenticateOfflineManager)(guarded.db, input.identifier, input.password)
  } finally { await guarded.db.close() }

  const historicalEvidence = await historicalRuntimeEvidence(projectRoot, previousHealthySha, 'main', 'verified_main')
  const backupEvidence = await latestVerifiedSchemaEvidence(projectRoot)
  const coordinator = new DatabaseOperationCoordinator(join(backupRoot, '.db2', 'operations'), { now: dependencies.now })
  const now = dependencies.now?.() || new Date()
  return coordinator.createRecoveryApprovalBinding({
    previousLiveSha: previousHealthySha,
    approvedControlSha,
    registrationSourceSha,
    targetBranch: 'main',
    canonicalIdentitySha256: sha256(identityRaw),
    canonicalStoreId,
    schema: '027',
    historicalRuntimeEvidenceSha256: historicalEvidence,
    backupId: backupEvidence.backupId,
    backupEvidenceSha256: backupEvidence.sha256,
    approvedBy: actor,
    expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
  })
}

async function readStdin() {
  let value = ''
  for await (const chunk of process.stdin) value += String(chunk)
  const parsed = JSON.parse(value) as { identifier?: string; password?: string }
  return { identifier: String(parsed.identifier || ''), password: String(parsed.password || '') }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const arg = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined }
  const projectRoot = arg('--project-root') || fail('ARGUMENT_REQUIRED:--project-root')
  const previousHealthySha = arg('--previous-healthy-sha') || fail('ARGUMENT_REQUIRED:--previous-healthy-sha')
  const approvedControlSha = arg('--approved-control-sha') || fail('ARGUMENT_REQUIRED:--approved-control-sha')
  readStdin().then(credentials => registerStoppedRuntimeRecoveryApproval({ projectRoot, previousHealthySha, approvedControlSha, ...credentials })).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 })
}
