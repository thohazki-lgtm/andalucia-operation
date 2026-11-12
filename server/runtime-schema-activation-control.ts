import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fail = (code: string): never => { throw new Error(code) }
const json = async <T = any>(path: string) => JSON.parse(await readFile(path, 'utf8')) as T
const normalized = (path: string) => resolve(path).replaceAll('\\', '/').toLowerCase()
const sha = /^[0-9a-f]{40}$/i
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const reviewedActivationSuccessorFiles = new Set([
  'server/runtime-schema-activation-control.ts',
  'server/schema-028-activation-control.test.ts',
  'server/schema-028-migration-activation-bridge.test.ts',
])
const reviewedActivationSuccessorSha = 'd38869b2765332573337b0c1a0b9fc7c05f59c62'
const assertReviewedActivationSuccessor = (projectRoot: string, migrationSourceSha: string, activationSourceSha: string, reviewedSuccessorSha = reviewedActivationSuccessorSha) => {
  if (migrationSourceSha === activationSourceSha) return
  if (!sha.test(migrationSourceSha) || !sha.test(reviewedSuccessorSha)) fail('SCHEMA_ACTIVATION_AUTHORIZATION_BINDING_INVALID')
  try {
    execFileSync('git', ['-C', projectRoot, 'merge-base', '--is-ancestor', migrationSourceSha, reviewedSuccessorSha], { stdio: 'ignore' })
    execFileSync('git', ['-C', projectRoot, 'merge-base', '--is-ancestor', reviewedSuccessorSha, activationSourceSha], { stdio: 'ignore' })
  } catch { fail('SCHEMA_ACTIVATION_SOURCE_SUCCESSOR_INVALID') }
  const changed = execFileSync('git', ['-C', projectRoot, 'diff', '--name-only', `${migrationSourceSha}..${reviewedSuccessorSha}`], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
  if (!changed.includes('server/runtime-schema-activation-control.ts') || changed.some(path => !reviewedActivationSuccessorFiles.has(path))) fail('SCHEMA_ACTIVATION_SOURCE_SUCCESSOR_INVALID')
}

export const resolveRuntimeSchemaActivation = async (projectRootInput: string, approvedSourceSha: string, reviewedSuccessorSha = reviewedActivationSuccessorSha) => {
  const projectRoot = resolve(projectRootInput)
  if (!sha.test(approvedSourceSha)) fail('SCHEMA_ACTIVATION_SOURCE_SHA_INVALID')
  const head = execFileSync('git', ['-C', projectRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase()
  const origin = execFileSync('git', ['-C', projectRoot, 'rev-parse', 'refs/remotes/origin/main'], { encoding: 'utf8' }).trim().toLowerCase()
  if (head !== approvedSourceSha.toLowerCase() || origin !== head) fail('SCHEMA_ACTIVATION_SOURCE_MISMATCH')
  const identity = await json<any>(join(projectRoot, '.data', 'andalucia-store-identity.json'))
  const canonicalData = resolve(projectRoot, '.data', 'postgres')
  if (identity.role !== 'canonical' || identity.storeId !== 'andalucia-canonical-live' || normalized(identity.databaseDirectory) !== normalized(canonicalData)) fail('SCHEMA_ACTIVATION_CANONICAL_IDENTITY_INVALID')

  const backupRoot = join(projectRoot, '.backups')
  const folders = existsSync(backupRoot) ? await readdir(backupRoot, { withFileTypes: true }) : []
  const candidates: Array<{ folder: string; artifact: any }> = []
  for (const entry of folders) {
    if (!entry.isDirectory()) continue
    const path = join(backupRoot, entry.name, 'live-migration-authorization.json')
    if (!existsSync(path)) continue
    const artifact = await json<any>(path).catch(() => fail('SCHEMA_ACTIVATION_AUTHORIZATION_INVALID'))
    const version = artifact?.targetMigration?.version
    if (typeof version === 'string' && version > '028') fail('SCHEMA_ACTIVATION_VERSION_UNSUPPORTED')
    if (version === '028') candidates.push({ folder: join(backupRoot, entry.name), artifact })
  }
  if (!candidates.length) return { requiredSchemaVersion: '027' as const, mode: 'pre-migration' as const, approvedSourceSha: head }
  if (candidates.length !== 1) fail('SCHEMA_ACTIVATION_AUTHORIZATION_AMBIGUOUS')
  const { folder, artifact } = candidates[0]
  if (artifact.artifactVersion !== 'andalucia-live-migration-authorization-v2' || artifact.state !== 'consumed') fail('SCHEMA_ACTIVATION_MIGRATION_INCOMPLETE')
  assertReviewedActivationSuccessor(projectRoot, artifact.approvedSourceSha, head, reviewedSuccessorSha)
  if (artifact.canonicalStoreId !== identity.storeId || artifact.outletScopeId !== identity.outletScopeId || normalized(artifact.sourceDirectory) !== normalized(canonicalData)) fail('SCHEMA_ACTIVATION_AUTHORIZATION_BINDING_INVALID')
  if (artifact.rehearsal?.status !== 'PASS' || artifact.rehearsal?.rollbackSchema !== '027' || artifact.rehearsal?.migratedSchema !== '028' || artifact.protectedBackup?.pinned !== true || artifact.protectedBackup?.restoreRehearsal !== 'PASS') fail('SCHEMA_ACTIVATION_REHEARSAL_EVIDENCE_INVALID')
  const source027 = artifact.sourceMigrationLedger?.migrations?.find((item: any) => item.version === '027')
  const target028 = artifact.sourceMigrationLedger?.migrations?.find((item: any) => item.version === '028')
  if (!artifact.consumedPostMigrationFingerprint || artifact.targetMigration?.version !== '028' || artifact.sourceMigrationLedger?.migrations?.filter((item: any) => item.state === 'applied').at(-1)?.version !== '027' || source027?.state !== 'applied' || source027?.checksumMatches !== true || target028?.state !== 'pending' || target028?.checksum !== artifact.targetMigration?.checksum || target028?.checksumMatches !== null) fail('SCHEMA_ACTIVATION_TRANSITION_INVALID')
  const backupId = artifact.protectedBackup.backupId
  if (!backupId || folder !== resolve(backupRoot, backupId)) fail('SCHEMA_ACTIVATION_BACKUP_BINDING_INVALID')
  const metadata = await json<any>(join(folder, 'backup-metadata.json')).catch(() => fail('SCHEMA_ACTIVATION_BACKUP_EVIDENCE_MISSING'))
  const restore = await json<any>(join(folder, 'restore-test.json')).catch(() => fail('SCHEMA_ACTIVATION_RESTORE_EVIDENCE_MISSING'))
  const result = await json<any>(join(folder, 'migration-result.json')).catch(() => fail('SCHEMA_ACTIVATION_MIGRATION_RESULT_MISSING'))
  const after = await json<any>(join(folder, 'migration-after-fingerprint.json')).catch(() => fail('SCHEMA_ACTIVATION_MIGRATION_FINGERPRINT_MISSING'))
  if (metadata.backupId !== backupId || metadata.schemaVersion !== '027' || metadata.verificationStatus !== 'VERIFIED' || metadata.openTestStatus !== 'PASS' || metadata.preflightStatus !== 'READY') fail('SCHEMA_ACTIVATION_BACKUP_EVIDENCE_INVALID')
  if (restore.backupId !== backupId || restore.status !== 'RESTORE_TEST_PASSED' || !restore.manifestMatch || !restore.fingerprintMatch || !restore.migrationMatch || restore.preflightStatus !== 'READY') fail('SCHEMA_ACTIVATION_RESTORE_EVIDENCE_INVALID')
  if (result.success !== true || !same(result.migration?.applied, ['028']) || result.comparison?.preserved !== true || after.digest !== artifact.consumedPostMigrationFingerprint) fail('SCHEMA_ACTIVATION_MIGRATION_RESULT_INVALID')
  return { requiredSchemaVersion: '028' as const, mode: 'approved-027-to-028' as const, approvedSourceSha: head, backupId, authorizationId: artifact.id }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const arg = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined }
  const projectRoot = arg('--project-root'); const expectedSha = arg('--expected-sha')
  if (!projectRoot || !isAbsolute(projectRoot) || !expectedSha) fail('SCHEMA_ACTIVATION_ARGUMENT_REQUIRED')
  console.log(JSON.stringify(await resolveRuntimeSchemaActivation(projectRoot!, expectedSha!)))
}
