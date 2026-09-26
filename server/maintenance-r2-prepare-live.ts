import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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

const targetVersion = '018'
const expectedChecksum = '322b36bb10a59ec53800ec99da5ef4d1efbd5ae5399f5ca158088b907f5ded19'
const authorizationVersion = 'andalucia-live-migration-authorization-v2'
const sourceDirectory = resolve(process.env.ANDALUCIA_DATA_DIR || '')
const backupRoot = resolve('.backups')
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  return JSON.stringify(value)
}
const digest = (value: unknown) => sha256(stable(value))
const evidenceTables = ['staff', 'duty_roster_entries', 'bookings', 'guest_occasions', 'chargeable_item_records', 'training_sessions', 'daily_reports', 'daily_report_snapshots', 'monthly_report_inputs', 'report_manager_summaries'] as const
const tableFingerprint = async (db: PGlite, table: string) => {
  const rows = (await db.query<{ row: unknown }>(`select row_to_json(r) row from (select * from ${table} order by 1) r`)).rows.map(item => item.row)
  return { count: rows.length, digest: digest(rows) }
}
const evidenceFingerprints = async (db: PGlite) => Object.fromEntries(await Promise.all(evidenceTables.map(async table => [table, await tableFingerprint(db, table)])))
const maintenanceCore = async (db: PGlite) => (await db.query<Record<string, unknown>>('select id,issue,priority,assigned_to,reported_at::text,status,created_at::text,updated_at::text,issue_date::text,area_value,reported_by_staff_id,notes,created_by,updated_by from maintenance_issues order by id')).rows

if (sourceDirectory !== canonicalStoreDirectory) throw new Error('LIVE_MIGRATION_TARGET_PATH_MISMATCH')
if (process.env.ANDALUCIA_CONFIRM_LIVE_STORE_EXCLUSIVE !== 'YES_I_CONFIRM_ANDALUCIA_APP_IS_STOPPED' || !(await defaultExclusiveAccessCheck())) throw new Error('LIVE_STORE_NOT_EXCLUSIVE')
if (existsSync(operationMarkerPaths(sourceDirectory).recovery) || existsSync(operationMarkerPaths(sourceDirectory).migration)) throw new Error('LIVE_OPERATION_CONFLICT')

const migrationPath = resolve('database', 'migrations', '018_maintenance_r2_foundation.sql')
const checksum = sha256(await readFile(migrationPath))
if (checksum !== expectedChecksum) throw new Error('MIGRATION_018_SOURCE_CHANGED_REHEARSAL_REQUIRED')
const identity = await readStoreIdentity(sourceDirectory, 'canonical')
if (identity.outletScopeId !== ANDALUCIA_SCOPE_ID) throw new Error('CANONICAL_OUTLET_SCOPE_IDENTITY_MISMATCH')

const db = new PGlite(sourceDirectory)
await db.query('select 1')
let owner: NonNullable<LiveMigrationAuthorizationArtifact['ownerSession']>
let sourceFingerprint: Awaited<ReturnType<typeof createMigrationFingerprint>>
let financial: Awaited<ReturnType<typeof createFinancialFinalizationFingerprint>>
let ledger: Awaited<ReturnType<typeof migrationStatus>>
let migrationSet: Awaited<ReturnType<typeof reviewedMigrationSet>>
let evidence: Awaited<ReturnType<typeof evidenceFingerprints>>
let maintenanceBefore: Awaited<ReturnType<typeof maintenanceCore>>
try {
  ledger = await migrationStatus(db)
  const preflight = await runPreflight(db, sourceDirectory)
  sourceFingerprint = await createMigrationFingerprint(db)
  financial = await createFinancialFinalizationFingerprint(db)
  migrationSet = await reviewedMigrationSet()
  evidence = await evidenceFingerprints(db)
  maintenanceBefore = await maintenanceCore(db)
  const applied = ledger.migrations.filter(item => item.state === 'applied')
  if (preflight.status !== 'READY' || applied.at(-1)?.version !== '017' || ledger.migrations.find(item => item.version === targetVersion)?.state !== 'pending' || ledger.migrations.some(item => item.version <= '017' && (item.state !== 'applied' || item.checksumMatches !== true))) throw new Error('MIGRATION_018_LIVE_BASELINE_INVALID')
  const row = (await db.query<any>("select s.id session_id,s.expires_at::text session_expires_at,u.id user_id,u.login_identifier,u.display_name from auth_sessions s join user_accounts u on u.id=s.user_id and u.status='active' join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.active=true and r.role_key='owner' and r.global_scope=true where s.revoked_at is null and s.expires_at>now()+interval '35 minutes' order by s.last_seen_at desc limit 1")).rows[0]
  if (!row) throw new Error('AUTHENTICATED_OWNER_SESSION_REQUIRED')
  const auth = await new AuthorizationService(db).authorizationForUser(row.user_id)
  const required = ['manage_platform', 'manage_maintenance']
  if (!auth.isOwner || !auth.globalScope || !required.every(key => auth.permissionKeys.includes(key as any))) throw new Error('OWNER_MIGRATION_AUTHORIZATION_REQUIRED')
  owner = { sessionId: row.session_id, sessionExpiresAt: row.session_expires_at, userId: row.user_id, loginIdentifier: row.login_identifier, displayName: row.display_name, isOwner: true, globalScope: true, requiredPermissions: required }
} finally { await db.close() }

const backup = await createVerifiedBackup({ sourceDirectory, category: 'pre-migration', backupRoot, exclusiveConfirmed: true })
const backupId = backup.metadata.backupId
const admin = new DatabaseBackupAdminService(backupRoot, sourceDirectory)
await admin.pin(backupId, true, { userId: owner.userId, displayName: owner.displayName }, 'PRE_MIGRATION_018 protected rollback source')
const temp = await mkdtemp(join(resolve('.tmp'), 'maintenance-r2-live-readiness-'))
try {
  const rehearsalPath = join(temp, 'rehearsal', 'postgres')
  await copyStoreVerified(backup.backupDirectory, rehearsalPath)
  const rehearsal = new PGlite(rehearsalPath)
  await rehearsal.query('select 1')
  const before = await createMigrationFingerprint(rehearsal)
  const financialBefore = await createFinancialFinalizationFingerprint(rehearsal)
  const evidenceBefore = await evidenceFingerprints(rehearsal)
  const maintenanceRowsBefore = await maintenanceCore(rehearsal)
  const migration = await runMigrations(rehearsal, { throughVersion: targetVersion })
  const after = await createMigrationFingerprint(rehearsal)
  const financialAfter = await createFinancialFinalizationFingerprint(rehearsal)
  const evidenceAfter = await evidenceFingerprints(rehearsal)
  const maintenanceRowsAfter = await maintenanceCore(rehearsal)
  const afterStatus = await migrationStatus(rehearsal)
  if (JSON.stringify(migration.applied) !== JSON.stringify([targetVersion]) || afterStatus.migrations.find(item => item.version === targetVersion)?.state !== 'applied' || afterStatus.migrations.find(item => item.version === targetVersion)?.checksum !== expectedChecksum || !compareOperationalFingerprints(before, after).preserved || financialBefore.digest !== financialAfter.digest || JSON.stringify(evidenceBefore) !== JSON.stringify(evidenceAfter) || digest(maintenanceRowsBefore) !== digest(maintenanceRowsAfter)) throw new Error('MIGRATION_018_REHEARSAL_RECONCILIATION_FAILED')
  const columns = (await rehearsal.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='maintenance_issues' and column_name in ('outlet_scope_id','reference_follow_up','completed_at','completed_by_user_id','completed_by_name_snapshot','reporter_name_snapshot','reporter_number_snapshot','revision') order by column_name")).rows.map(row => row.column_name)
  if (columns.length !== 8) throw new Error('MIGRATION_018_COLUMN_FOUNDATION_INCOMPLETE')
  const constraints = (await rehearsal.query<{ conname: string }>("select conname from pg_constraint where conrelid='maintenance_issues'::regclass order by conname")).rows.map(row => row.conname)
  for (const name of ['maintenance_issue_outlet_scope_fk', 'maintenance_issue_completed_by_fk', 'maintenance_issue_revision_check', 'maintenance_issue_completion_evidence_check']) if (!constraints.includes(name)) throw new Error(`MIGRATION_018_CONSTRAINT_MISSING:${name}`)
  const indexes = (await rehearsal.query<{ indexname: string }>("select indexname from pg_indexes where schemaname='public' and tablename='maintenance_issues'")).rows.map(row => row.indexname)
  for (const name of ['maintenance_issue_outlet_date_idx', 'maintenance_issue_outlet_status_priority_idx', 'maintenance_issue_completed_at_idx']) if (!indexes.includes(name)) throw new Error(`MIGRATION_018_INDEX_MISSING:${name}`)
  const evidenceRows = (await rehearsal.query<any>('select outlet_scope_id,reference_follow_up,completed_at,completed_by_user_id,completed_by_name_snapshot,reporter_name_snapshot,reporter_number_snapshot,revision from maintenance_issues order by id')).rows
  for (const row of evidenceRows) if (row.outlet_scope_id !== ANDALUCIA_SCOPE_ID || row.reference_follow_up !== null || row.completed_at !== null || row.completed_by_user_id !== null || row.completed_by_name_snapshot !== null || row.reporter_name_snapshot !== null || row.reporter_number_snapshot !== null || Number(row.revision) !== 1) throw new Error('MIGRATION_018_HISTORICAL_EVIDENCE_FABRICATED')
  await rehearsal.close()

  const restore = await admin.rehearse(backupId, { userId: owner.userId, displayName: owner.displayName })
  if (restore.status !== 'RESTORE_TEST_PASSED' || !restore.manifestMatch || !restore.fingerprintMatch || !restore.migrationMatch || restore.preflightStatus !== 'READY') throw new Error('MIGRATION_018_ROLLBACK_REHEARSAL_FAILED')
  const sourceManifest = await createStoreManifest(sourceDirectory)
  const backupManifest = await createStoreManifest(backup.backupDirectory)
  if (!manifestsMatch(sourceManifest, backup.metadata.sourceManifest) || !manifestsMatch(backupManifest, backup.metadata.backupManifest)) throw new Error('LIVE_OR_BACKUP_CHANGED_DURING_PREPARATION')
  const target = migrationSet.versions.find(item => item.version === targetVersion)
  if (!target || target.checksum !== expectedChecksum) throw new Error('MIGRATION_018_SOURCE_NOT_REVIEWED')
  const createdAt = new Date()
  const expiresAt = new Date(Math.min(createdAt.getTime() + 30 * 60_000, Date.parse(owner.sessionExpiresAt))).toISOString()
  if (Date.parse(expiresAt) <= createdAt.getTime() + 5 * 60_000) throw new Error('OWNER_SESSION_TOO_CLOSE_TO_EXPIRY')
  const artifact: LiveMigrationAuthorizationArtifact = {
    artifactVersion: authorizationVersion, id: randomUUID(), state: 'prepared', createdAt: createdAt.toISOString(), expiresAt,
    sourceDirectory, backupDirectory: backup.backupDirectory, sourceManifestAtBackup: backup.metadata.sourceManifest,
    backupManifest: backup.metadata.backupManifest, preparedSourceManifest: sourceManifest,
    sourceFingerprintDigest: sourceFingerprint.digest, sourceBusinessSnapshot: sourceFingerprint.business,
    sourceFinancialFingerprintDigest: financial.digest, sourceMigrationLedger: ledger, evidenceFingerprints: evidence,
    preflightStatus: 'READY', migrationSet, targetMigration: { version: target.version, name: target.name, checksum: target.checksum },
    canonicalStoreId: identity.storeId, outletScopeId: ANDALUCIA_SCOPE_ID, ownerSession: owner,
    protectedBackup: { backupId, pinned: true, restoreRehearsal: 'PASS' },
    rehearsal: { status: 'PASS', migratedSchema: '018', rollbackSchema: '017', completedAt: new Date().toISOString() },
    verifiedBackupMetadataPath: join(backup.folder, 'backup-metadata.json'),
    rollbackInstructions: 'Keep the application stopped. Restore only from this protected PRE_MIGRATION_018 backup through the controlled rollback procedure.'
  }
  const artifactPath = join(backup.folder, 'live-migration-authorization.json')
  await writeJsonAtomic(artifactPath, artifact)
  console.log(JSON.stringify({ checksum, canonicalHealth: 'HEALTHY', schema: '017', recoveryRequired: false, migrationRequired: false, canonicalStoreId: identity.storeId, canonicalManifest: sourceManifest.aggregateSha256, operationalFingerprint: sourceFingerprint.digest, financialFingerprint: financial.digest, business: sourceFingerprint.business, evidenceFingerprints: evidence, maintenanceRecords: maintenanceBefore.length, backupId, backupCreatedAt: backup.metadata.createdAt, backupManifest: backup.metadata.backupManifest.aggregateSha256, backupVerification: { verificationStatus: backup.metadata.verificationStatus, openTestStatus: backup.metadata.openTestStatus, preflightStatus: backup.metadata.preflightStatus, protected: true }, rehearsal: 'PASS', rollback: 'PASS', owner: { userId: owner.userId, loginIdentifier: owner.loginIdentifier, displayName: owner.displayName, isOwner: owner.isOwner, globalScope: owner.globalScope, outletScopeId: ANDALUCIA_SCOPE_ID, requiredPermissions: owner.requiredPermissions }, artifact: { id: artifact.id, path: artifactPath, state: artifact.state, createdAt: artifact.createdAt, expiresAt: artifact.expiresAt } }, null, 2))
} finally { await rm(temp, { recursive: true, force: true }) }
