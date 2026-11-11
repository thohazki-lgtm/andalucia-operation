import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { AuthorizationService } from './authorization-service.js'
import { DatabaseBackupAdminService } from './database-backup-admin.js'
import { createFinancialFinalizationFingerprint, createVerifiedBackup } from './database-backup.js'
import { canonicalStoreDirectory, operationMarkerPaths, readStoreIdentity } from './database-protection.js'
import { copyStoreVerified, createStoreManifest, manifestsMatch, writeJsonAtomic } from './migration-filesystem.js'
import { compareOperationalFingerprints, createMigrationFingerprint, migrationStatus, reviewedMigrationSet, runMigrations, runPreflight } from './migration-store.js'
import { defaultExclusiveAccessCheck, type LiveMigrationAuthorizationArtifact } from './migration-live-gate.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'

const targetVersion = '028'; const previousVersion = '027'; const approvedFeatureSha = '1ce391e1c705ea4f014d7e903bc367ebf0f1eab7'; const sourceDirectory = resolve(process.env.ANDALUCIA_DATA_DIR || '')
const approvedSourceSha = process.env.ANDALUCIA_APPROVED_MIGRATION_SOURCE_SHA?.trim().toLowerCase() || ''
const projectRoot = resolve('.')
if (!/^[0-9a-f]{40}$/.test(approvedSourceSha) || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase() !== approvedSourceSha || execFileSync('git', ['rev-parse', 'refs/remotes/origin/main'], { encoding: 'utf8' }).trim().toLowerCase() !== approvedSourceSha) throw new Error('MIGRATION_028_APPROVED_SOURCE_MISMATCH')
try { execFileSync('git', ['merge-base', '--is-ancestor', approvedFeatureSha, approvedSourceSha], { stdio: 'ignore' }) } catch { throw new Error('MIGRATION_028_APPROVED_FEATURE_ANCESTRY_MISSING') }
if (sourceDirectory !== canonicalStoreDirectory || projectRoot !== resolve(canonicalStoreDirectory, '..', '..')) throw new Error('LIVE_MIGRATION_TARGET_PATH_MISMATCH')
if (process.env.ANDALUCIA_CONFIRM_LIVE_STORE_EXCLUSIVE !== 'YES_I_CONFIRM_ANDALUCIA_APP_IS_STOPPED' || !(await defaultExclusiveAccessCheck())) throw new Error('LIVE_STORE_NOT_EXCLUSIVE')
if (existsSync(operationMarkerPaths(sourceDirectory).recovery) || existsSync(operationMarkerPaths(sourceDirectory).migration)) throw new Error('LIVE_OPERATION_CONFLICT')
const identity = await readStoreIdentity(sourceDirectory, 'canonical')
if (identity.storeId !== 'andalucia-canonical-live' || identity.outletScopeId !== ANDALUCIA_SCOPE_ID) throw new Error('MIGRATION_028_CANONICAL_IDENTITY_INVALID')

const db = new PGlite(sourceDirectory); await db.query('select 1')
let owner: NonNullable<LiveMigrationAuthorizationArtifact['ownerSession']>; let sourceFingerprint: any; let financial: any; let ledger: any; let migrationSet: any
try {
  ledger = await migrationStatus(db); const preflight = await runPreflight(db, sourceDirectory); sourceFingerprint = await createMigrationFingerprint(db); financial = await createFinancialFinalizationFingerprint(db); migrationSet = await reviewedMigrationSet()
  const applied = ledger.migrations.filter((item: any) => item.state === 'applied')
  if (preflight.status !== 'READY' || applied.at(-1)?.version !== previousVersion || ledger.migrations.find((item: any) => item.version === targetVersion)?.state !== 'pending' || ledger.migrations.some((item: any) => item.version <= previousVersion && (item.state !== 'applied' || item.checksumMatches !== true))) throw new Error('MIGRATION_028_LIVE_BASELINE_INVALID')
  const row = (await db.query<any>("select s.id session_id,s.expires_at::text session_expires_at,u.id user_id,u.login_identifier,u.display_name from auth_sessions s join user_accounts u on u.id=s.user_id and u.status='active' join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.active=true and r.role_key='owner' and r.global_scope=true where s.revoked_at is null and s.expires_at>now()+interval '35 minutes' order by s.last_seen_at desc limit 1")).rows[0]
  if (!row) throw new Error('AUTHENTICATED_OWNER_SESSION_REQUIRED')
  const authorization = await new AuthorizationService(db).authorizationForUser(row.user_id); const required = ['manage_platform', 'manage_duty_roster']
  if (!authorization.isOwner || !authorization.globalScope || !required.every(key => authorization.permissionKeys.includes(key as any))) throw new Error('OWNER_MIGRATION_AUTHORIZATION_REQUIRED')
  owner = { sessionId: row.session_id, sessionExpiresAt: row.session_expires_at, userId: row.user_id, loginIdentifier: row.login_identifier, displayName: row.display_name, isOwner: true, globalScope: true, requiredPermissions: required }
} finally { await db.close() }

const backupRoot = resolve('.backups')
const backup = await createVerifiedBackup({ sourceDirectory, category: 'pre-migration', backupRoot, exclusiveConfirmed: true, requiredVersion: previousVersion })
const backupId = backup.metadata.backupId; const admin = new DatabaseBackupAdminService(backupRoot, sourceDirectory, previousVersion)
await admin.pin(backupId, true, { userId: owner.userId, displayName: owner.displayName }, 'PRE_MIGRATION_028 protected rollback source')
const tempRoot = resolve('.tmp'); await mkdir(tempRoot, { recursive: true })
const temp = await mkdtemp(join(tempRoot, 'schema-028-live-readiness-'))
try {
  const rehearsalPath = join(temp, 'rehearsal', 'postgres'); await copyStoreVerified(backup.backupDirectory, rehearsalPath)
  const rehearsal = new PGlite(rehearsalPath); await rehearsal.query('select 1')
  const before = await createMigrationFingerprint(rehearsal); const financialBefore = await createFinancialFinalizationFingerprint(rehearsal)
  const migration = await runMigrations(rehearsal, { throughVersion: targetVersion }); const after = await createMigrationFingerprint(rehearsal); const financialAfter = await createFinancialFinalizationFingerprint(rehearsal); const status = await migrationStatus(rehearsal)
  const stateCount = Number((await rehearsal.query<any>('select count(*)::int count from duty_roster_month_states')).rows[0].count); const auditCount = Number((await rehearsal.query<any>('select count(*)::int count from duty_roster_month_audits')).rows[0].count)
  await rehearsal.close()
  if (!compareOperationalFingerprints(before, after).preserved || financialBefore.digest !== financialAfter.digest || !sameArray(migration.applied, [targetVersion]) || status.migrations.find(item => item.version === targetVersion)?.state !== 'applied' || stateCount !== 0 || auditCount !== 0) throw new Error('MIGRATION_028_REHEARSAL_RECONCILIATION_FAILED')
  const restore = await admin.rehearse(backupId, { userId: owner.userId, displayName: owner.displayName })
  if (restore.status !== 'RESTORE_TEST_PASSED' || !restore.manifestMatch || !restore.fingerprintMatch || !restore.migrationMatch || restore.preflightStatus !== 'READY') throw new Error('MIGRATION_028_ROLLBACK_REHEARSAL_FAILED')
  const sourceManifest = await createStoreManifest(sourceDirectory); const backupManifest = await createStoreManifest(backup.backupDirectory)
  if (!manifestsMatch(sourceManifest, backup.metadata.sourceManifest) || !manifestsMatch(backupManifest, backup.metadata.backupManifest)) throw new Error('LIVE_OR_BACKUP_CHANGED_DURING_PREPARATION')
  const target = migrationSet.versions.find((item: any) => item.version === targetVersion); if (!target) throw new Error('MIGRATION_028_SOURCE_NOT_REVIEWED')
  const createdAt = new Date(); const expiresAt = new Date(Math.min(createdAt.getTime() + 30 * 60_000, Date.parse(owner.sessionExpiresAt))).toISOString(); if (Date.parse(expiresAt) <= createdAt.getTime() + 5 * 60_000) throw new Error('OWNER_SESSION_TOO_CLOSE_TO_EXPIRY')
  const artifact: LiveMigrationAuthorizationArtifact = { artifactVersion: 'andalucia-live-migration-authorization-v2', id: randomUUID(), state: 'prepared', createdAt: createdAt.toISOString(), expiresAt, approvedSourceSha, sourceDirectory, backupDirectory: backup.backupDirectory, sourceManifestAtBackup: backup.metadata.sourceManifest, backupManifest: backup.metadata.backupManifest, preparedSourceManifest: sourceManifest, sourceFingerprintDigest: sourceFingerprint.digest, sourceBusinessSnapshot: sourceFingerprint.business, sourceFinancialFingerprintDigest: financial.digest, sourceMigrationLedger: ledger, preflightStatus: 'READY', migrationSet, targetMigration: { version: target.version, name: target.name, checksum: target.checksum }, canonicalStoreId: identity.storeId, outletScopeId: ANDALUCIA_SCOPE_ID, ownerSession: owner, protectedBackup: { backupId, pinned: true, restoreRehearsal: 'PASS' }, rehearsal: { status: 'PASS', migratedSchema: targetVersion, rollbackSchema: previousVersion, completedAt: new Date().toISOString() }, verifiedBackupMetadataPath: join(backup.folder, 'backup-metadata.json'), rollbackInstructions: 'Keep the application stopped. Restore only from this protected PRE_MIGRATION_028 backup through the controlled rollback procedure.' }
  const artifactPath = join(backup.folder, 'live-migration-authorization.json'); await writeJsonAtomic(artifactPath, artifact)
  console.log(JSON.stringify({ artifactPath, artifactId: artifact.id, state: artifact.state, approvedSourceSha, backupId, canonicalStoreId: identity.storeId, schema: previousVersion, targetSchema: targetVersion, backup: 'VERIFIED', rehearsal: 'PASS', restore: 'PASS', expiresAt }, null, 2))
} finally { await rm(temp, { recursive: true, force: true }) }

function sameArray(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right) }
