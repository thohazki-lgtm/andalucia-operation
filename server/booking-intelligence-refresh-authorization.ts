import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { AuthorizationService } from './authorization-service.js'
import { createFinancialFinalizationFingerprint } from './database-backup.js'
import { canonicalStoreDirectory, operationMarkerPaths, readStoreIdentity } from './database-protection.js'
import { createStoreManifest, manifestsMatch, writeJsonAtomic } from './migration-filesystem.js'
import { createMigrationFingerprint, migrationStatus, reviewedMigrationSet, runPreflight } from './migration-store.js'
import { defaultExclusiveAccessCheck, type LiveMigrationAuthorizationArtifact } from './migration-live-gate.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'

const targetVersion = '017'
const expectedChecksum = '9bcbfa0b56364bf8e0a0912de9ea3a1b5e326dd625dda1641f9bea39ccb9dcff'
const expectedBackupId = 'andalucia-pre-migration-2026-09-19T115559-111Z-6d51ebbd'
const sourceDirectory = resolve(process.env.ANDALUCIA_DATA_DIR || '')
const oldArtifactPath = resolve(process.env.ANDALUCIA_PREVIOUS_MIGRATION_AUTHORIZATION_FILE || '')
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
const evidenceTables = ['bookings', 'guest_occasions', 'staff', 'duty_roster_entries', 'daily_reports', 'daily_report_snapshots', 'training_sessions'] as const
const tableFingerprint = async (db: PGlite, table: string) => {
  const rows = (await db.query<{ row: unknown }>(`select row_to_json(r) row from (select * from ${table} order by 1) r`)).rows.map(item => item.row)
  return { count: rows.length, digest: sha256(JSON.stringify(rows)) }
}

if (sourceDirectory !== canonicalStoreDirectory) throw new Error('LIVE_MIGRATION_TARGET_PATH_MISMATCH')
if (!oldArtifactPath || !existsSync(oldArtifactPath)) throw new Error('PREVIOUS_AUTHORIZATION_ARTIFACT_REQUIRED')
if (process.env.ANDALUCIA_CONFIRM_LIVE_STORE_EXCLUSIVE !== 'YES_I_CONFIRM_ANDALUCIA_APP_IS_STOPPED' || !(await defaultExclusiveAccessCheck())) throw new Error('LIVE_STORE_NOT_EXCLUSIVE')
if (existsSync(operationMarkerPaths(sourceDirectory).recovery) || existsSync(operationMarkerPaths(sourceDirectory).migration)) throw new Error('LIVE_OPERATION_CONFLICT')

const old = JSON.parse(await readFile(oldArtifactPath, 'utf8')) as LiveMigrationAuthorizationArtifact
const oldOwner = old.ownerSession
if (old.artifactVersion !== 'andalucia-live-migration-authorization-v2' || old.targetMigration?.version !== targetVersion || old.protectedBackup?.backupId !== expectedBackupId || old.protectedBackup.pinned !== true || old.protectedBackup.restoreRehearsal !== 'PASS' || old.rehearsal?.status !== 'PASS' || !oldOwner) throw new Error('PREVIOUS_AUTHORIZATION_EVIDENCE_INVALID')
const migrationPath = resolve('database', 'migrations', '017_booking_intelligence_foundation.sql')
const checksum = sha256(await readFile(migrationPath))
if (checksum !== expectedChecksum || checksum !== old.targetMigration.checksum) throw new Error('MIGRATION_017_SOURCE_CHANGED_REHEARSAL_REQUIRED')

const backupFolder = dirname(old.backupDirectory)
if (basename(backupFolder) !== expectedBackupId) throw new Error('PRE_MIGRATION_017_BACKUP_ID_MISMATCH')
const metadata = JSON.parse(await readFile(join(backupFolder, 'backup-metadata.json'), 'utf8')) as any
const protection = JSON.parse(await readFile(join(backupFolder, 'db2-protection.json'), 'utf8')) as any
const restore = JSON.parse(await readFile(join(backupFolder, 'restore-test.json'), 'utf8')) as any
if (metadata.backupId !== expectedBackupId || metadata.verificationStatus !== 'VERIFIED' || metadata.openTestStatus !== 'PASS' || metadata.preflightStatus !== 'READY' || metadata.schemaVersion !== '016' || protection.pinned !== true || restore.status !== 'RESTORE_TEST_PASSED' || !restore.manifestMatch || !restore.fingerprintMatch || !restore.migrationMatch) throw new Error('PRE_MIGRATION_017_BACKUP_VERIFICATION_FAILED')
const backupManifest = await createStoreManifest(old.backupDirectory)
if (!manifestsMatch(backupManifest, old.backupManifest) || !manifestsMatch(metadata.backupManifest, old.backupManifest)) throw new Error('PRE_MIGRATION_017_BACKUP_CHANGED')

const identity = await readStoreIdentity(sourceDirectory, 'canonical')
if (identity.storeId !== old.canonicalStoreId || identity.outletScopeId !== ANDALUCIA_SCOPE_ID || old.outletScopeId !== ANDALUCIA_SCOPE_ID) throw new Error('CANONICAL_IDENTITY_CHANGED')
const db = new PGlite(sourceDirectory)
await db.query('select 1')
let owner: any, sourceFingerprint: any, financial: any, ledger: any, evidence: any
try {
  const preflight = await runPreflight(db, sourceDirectory)
  ledger = await migrationStatus(db)
  sourceFingerprint = await createMigrationFingerprint(db)
  financial = await createFinancialFinalizationFingerprint(db)
  evidence = Object.fromEntries(await Promise.all(evidenceTables.map(async table => [table, await tableFingerprint(db, table)])))
  if (preflight.status !== 'READY' || ledger.migrations.filter((item: any) => item.state === 'applied').at(-1)?.version !== '016' || ledger.migrations.find((item: any) => item.version === targetVersion)?.state !== 'pending' || ledger.migrations.some((item: any) => item.version <= '016' && (item.state !== 'applied' || item.checksumMatches !== true))) throw new Error('MIGRATION_017_LIVE_BASELINE_INVALID')
  if (sourceFingerprint.digest !== old.sourceFingerprintDigest || financial.digest !== old.sourceFinancialFingerprintDigest || !same(ledger, old.sourceMigrationLedger) || !same(evidence, old.evidenceFingerprints)) throw new Error('MIGRATION_017_BOUND_EVIDENCE_CHANGED')
  const row = (await db.query<any>("select s.id session_id,s.expires_at::text session_expires_at,u.id user_id,u.login_identifier,u.display_name from auth_sessions s join user_accounts u on u.id=s.user_id and u.status='active' join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.active=true and r.role_key='owner' and r.global_scope=true where s.revoked_at is null and s.expires_at>now()+interval '5 minutes' order by s.last_seen_at desc limit 1")).rows[0]
  if (!row) throw new Error('AUTHENTICATED_OWNER_SESSION_REQUIRED')
  const auth = await new AuthorizationService(db).authorizationForUser(row.user_id)
  const required = ['manage_platform', 'manage_bookings']
  if (!auth.isOwner || !auth.globalScope || !required.every(key => auth.permissionKeys.includes(key as any))) throw new Error('OWNER_MIGRATION_AUTHORIZATION_REQUIRED')
  if (row.user_id !== oldOwner.userId || row.login_identifier !== oldOwner.loginIdentifier || row.display_name !== oldOwner.displayName) throw new Error('AUTHENTICATED_OWNER_CHANGED')
  owner = { sessionId: row.session_id, sessionExpiresAt: row.session_expires_at, userId: row.user_id, loginIdentifier: row.login_identifier, displayName: row.display_name, isOwner: true, globalScope: true, requiredPermissions: required }
} finally { await db.close() }

const currentSourceManifest = await createStoreManifest(sourceDirectory)
const migrationSet = await reviewedMigrationSet()
const target = migrationSet.versions.find(item => item.version === targetVersion)
if (!target || target.checksum !== expectedChecksum) throw new Error('MIGRATION_017_SOURCE_NOT_REVIEWED')
const createdAt = new Date()
const expiresAt = new Date(Math.min(createdAt.getTime() + 30 * 60_000, Date.parse(owner.sessionExpiresAt))).toISOString()
if (Date.parse(expiresAt) <= createdAt.getTime() + 5 * 60_000) throw new Error('OWNER_SESSION_TOO_CLOSE_TO_EXPIRY')
const refreshed: LiveMigrationAuthorizationArtifact = { ...old, id: randomUUID(), state: 'prepared', createdAt: createdAt.toISOString(), expiresAt, consumedAt: undefined, abandonedAt: undefined, abandonReason: undefined, preparedSourceManifest: currentSourceManifest, sourceFingerprintDigest: sourceFingerprint.digest, sourceBusinessSnapshot: sourceFingerprint.business, sourceFinancialFingerprintDigest: financial.digest, sourceMigrationLedger: ledger, evidenceFingerprints: evidence, migrationSet, targetMigration: { version: target.version, name: target.name, checksum: target.checksum }, ownerSession: owner }
const refreshedPath = join(backupFolder, `live-migration-authorization-${refreshed.id}.json`)
await writeJsonAtomic(refreshedPath, refreshed)
const abandonedAt = new Date().toISOString()
await writeJsonAtomic(oldArtifactPath, { ...old, state: 'abandoned', abandonedAt, abandonReason: `Superseded by ${refreshed.id}` })
console.log(JSON.stringify({ checksum, canonicalHealth: 'HEALTHY', schema: '016', recoveryRequired: false, migrationRequired: false, backupId: expectedBackupId, backupManifest: old.backupManifest.aggregateSha256, operationalFingerprint: sourceFingerprint.digest, evidenceFingerprints: evidence, financialFingerprint: financial.digest, owner: { userId: owner.userId, loginIdentifier: owner.loginIdentifier, displayName: owner.displayName, isOwner: owner.isOwner, globalScope: owner.globalScope, requiredPermissions: owner.requiredPermissions, outletScopeId: ANDALUCIA_SCOPE_ID }, previousArtifact: { id: old.id, state: 'abandoned', abandonedAt }, newArtifact: { id: refreshed.id, path: refreshedPath, state: refreshed.state, createdAt: refreshed.createdAt, expiresAt: refreshed.expiresAt } }, null, 2))
