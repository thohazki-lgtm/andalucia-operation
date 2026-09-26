import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { createOperationalFingerprint, createVerifiedBackup } from './database-backup.js'
import { DatabaseRecoveryService, RECOVERY_PREPARATION_CONFIRMATION, RECOVERY_PROMOTION_CONFIRMATION, assertRecoveryInactive } from './database-recovery.js'
import { STORE_IDENTITY_AUTHORIZATION, createStoreIdentity, openVerifiedDatabase, operationMarkerPaths, type DatabaseHealth } from './database-protection.js'
import { acquireDatabaseSchedulerLock } from './database-scheduler.js'
import { prepareLiveMigration } from './migration-live-gate.js'
import { reviewedMigrationSet } from './migration-store.js'
import { BillTipFinalizationService } from './bill-tip-finalization-service.js'
import { IncentivesCalculationService } from './incentives-calculation-service.js'

const root = await mkdtemp(join(tmpdir(), 'andalucia-db3-'))
const canonical = join(root, 'data', 'postgres'); const backupRoot = join(root, 'backups'); const recoveryRoot = join(root, 'recovery')
const actor = { userId: randomUUID(), displayName: 'Isolated Platform Owner' }
const health = (recoveryRequired = true): DatabaseHealth => ({ status: recoveryRequired ? 'DATABASE_RECOVERY_REQUIRED' : 'HEALTHY', storeId: 'isolated-db3-canonical', storeRole: 'canonical', migrationVersion: '018', migrationRequired: false, recoveryRequired, lastVerifiedBackup: null, checks: [] })
const initialize = async () => {
  await mkdir(dirname(canonical), { recursive: true }); const db = new PGlite(canonical); await db.exec(await readFile('database/schema.sql', 'utf8')); await db.exec(await readFile('database/migrations/001_schema_migrations.sql', 'utf8'))
  for (const migration of (await reviewedMigrationSet()).versions.filter(item => item.version <= '018')) await db.query("insert into schema_migrations(version,name,checksum,status,actor_source,notes) values($1,$2,$3,'applied','isolated DB-3 test','')", [migration.version, migration.name, migration.checksum])
  await db.query("insert into outlet_scopes(id,scope_key,display_name,active,outlet_type) values('00000000-0000-4000-8000-00000000a001','andalucia','Andalucía',true,'restaurant')")
  await db.query("insert into authorization_roles(id,role_key,display_name,active,global_scope) values('00000000-0000-4000-8000-000000001001','owner','Owner / Super Admin',true,true)")
  await db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status) values('00000000-0000-4000-8000-000000009001','isolated.owner','isolated.owner','Isolated Owner','not-a-secret','active')")
  await db.query("insert into authorization_user_roles(id,user_id,role_id,active) values('00000000-0000-4000-8000-000000009002','00000000-0000-4000-8000-000000009001','00000000-0000-4000-8000-000000001001',true)")
  await db.close(); await createStoreIdentity(canonical, 'canonical', { authorization: STORE_IDENTITY_AUTHORIZATION, expectedCanonicalDirectory: canonical, storeId: 'isolated-db3-canonical' })
}
const service = () => new DatabaseRecoveryService({ recoveryRoot, backupRoot, canonicalDirectory: canonical, expectedCanonicalDirectory: canonical })
const fingerprintStore = async () => { const value = new PGlite(canonical); try { return await createOperationalFingerprint(value) } finally { await value.close() } }
const prepare = async (svc: DatabaseRecoveryService, latest: Record<string, unknown>, candidate: string, rollback = candidate) => {
  const incident = await svc.detect({ failureClass: 'DATABASE_RECOVERY_REQUIRED', health: health(), latestHealthyFingerprint: latest }); await svc.selectCandidate(incident.id, candidate, actor); await svc.rehearse(incident.id, actor)
  const authorized = await svc.authorize(incident.id, { confirmation: RECOVERY_PREPARATION_CONFIRMATION, rollbackBackupId: rollback }, actor)
  return { incidentId: incident.id, artifactFile: authorized.incident.authorization!.artifactFile }
}

try {
  await initialize()
  const oldBackup = await createVerifiedBackup({ sourceDirectory: canonical, category: 'manual', backupRoot, exclusiveConfirmed: true, expectedCanonicalDirectory: canonical, now: new Date('2026-09-10T01:00:00Z') })
  const db = new PGlite(canonical); await db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'DB3-1','DB3 Test Member','Waiter','active','2026-09-01')", [randomUUID()]); const latestFingerprint = await createOperationalFingerprint(db); await db.close()
  const currentBackup = await createVerifiedBackup({ sourceDirectory: canonical, category: 'recovery', backupRoot, exclusiveConfirmed: true, expectedCanonicalDirectory: canonical, now: new Date('2026-09-11T01:00:00Z') })
  await mkdir(join(backupRoot, 'invalid-candidate'), { recursive: true }); await writeFile(join(backupRoot, 'invalid-candidate', 'backup-failure.json'), JSON.stringify({ verificationStatus: 'INVALID' }))
  const svc = service(); const missingSvc = new DatabaseRecoveryService({ recoveryRoot: join(root, 'missing-recovery'), backupRoot, canonicalDirectory: join(root, 'missing', 'postgres'), expectedCanonicalDirectory: join(root, 'missing', 'postgres') })
  assert.equal((await missingSvc.detect({ failureClass: 'STARTUP_INTEGRITY_FAILURE', health: health(), latestHealthyFingerprint: latestFingerprint })).state, 'RECOVERY_REQUIRED')
  const candidates = await svc.discoverCandidates(); assert.equal(candidates[0].backupId, currentBackup.metadata.backupId); assert.equal(candidates.some(item => item.backupId === 'invalid-candidate'), false)

  const gapIncident = await svc.detect({ failureClass: 'DATABASE_RECOVERY_REQUIRED', health: health(), latestHealthyFingerprint: latestFingerprint }); const gapPreview = await svc.selectCandidate(gapIncident.id, oldBackup.metadata.backupId, actor)
  assert.equal(gapPreview.gaps.find(item => item.area === 'staff')?.material, true)
  await assert.rejects(svc.authorize(gapIncident.id, { confirmation: RECOVERY_PREPARATION_CONFIRMATION, rollbackBackupId: oldBackup.metadata.backupId }, actor), /FRESH_RECOVERY_REHEARSAL_REQUIRED/)

  const success = await prepare(svc, latestFingerprint, currentBackup.metadata.backupId, oldBackup.metadata.backupId)
  const artifact = JSON.parse(await readFile(success.artifactFile, 'utf8')); assert.equal(artifact.actor.userId, actor.userId); assert.equal(artifact.selectedBackupId, currentBackup.metadata.backupId); assert.equal(Date.parse(artifact.expiresAt) - Date.parse(artifact.createdAt), 30 * 60_000)
  await writeFile(join(canonical, 'simulated-startup-failure.txt'), 'isolated failure')
  const changed = await readFile(success.artifactFile, 'utf8').then(JSON.parse); changed.canonicalManifestAtAuthorization = await import('./migration-filesystem.js').then(module => module.createStoreManifest(canonical)); await writeFile(success.artifactFile, `${JSON.stringify(changed, null, 2)}\n`)
  const promoted = await svc.promoteOffline({ artifactFile: success.artifactFile, confirmation: RECOVERY_PROMOTION_CONFIRMATION, exclusiveCheck: async () => true }); assert.equal(promoted.state, 'RECOVERY_PROMOTED_AWAITING_ACCEPTANCE'); assert.equal(existsSync(operationMarkerPaths(canonical).recovery), false)
  const opened = await openVerifiedDatabase({ dataDirectory: canonical, role: 'canonical', backupRoot }); const promotedFingerprint = await createOperationalFingerprint(opened.db); const requiredTables = ['staff','staff_membership_baseline_reviews','duty_roster_entries','training_sessions','bookings','guest_occasions','chargeable_item_records','maintenance_issues','configuration_options']; const tables = await opened.db.query<{ table_name: string }>('select table_name from information_schema.tables where table_schema=\'public\''); assert.equal(requiredTables.every(name => tables.rows.some(row => row.table_name === name)), true); await opened.db.close()
  assert.equal((await svc.accept(success.incidentId, actor, promotedFingerprint)).state, 'RECOVERY_ACCEPTED')

  const restartFailure = await prepare(svc, latestFingerprint, currentBackup.metadata.backupId, oldBackup.metadata.backupId)
  await assert.rejects(svc.promoteOffline({ artifactFile: restartFailure.artifactFile, confirmation: RECOVERY_PROMOTION_CONFIRMATION, exclusiveCheck: async () => true, simulateFailure: 'restart' }), /SIMULATED_APPLICATION_RESTART_FAILURE/)
  assert.equal(existsSync(operationMarkerPaths(canonical).recovery), true); assert.throws(() => assertRecoveryInactive(canonical, recoveryRoot), /RECOVERY_IN_PROGRESS_OPERATION_BLOCKED/)
  await assert.rejects(acquireDatabaseSchedulerLock({ backupRoot, canonicalDirectory: canonical, job: 'daily-backup' }), /DATABASE_SCHEDULER_RECOVERY_IN_PROGRESS/)
  await assert.rejects(svc.backupAdmin.rehearse(currentBackup.metadata.backupId, actor), /RECOVERY_IN_PROGRESS_OPERATION_BLOCKED/)
  await assert.rejects(createVerifiedBackup({ sourceDirectory: canonical, category: 'manual', backupRoot, exclusiveConfirmed: true, expectedCanonicalDirectory: canonical }), /RECOVERY_IN_PROGRESS_OPERATION_BLOCKED/)
  await assert.rejects(prepareLiveMigration({ sourceDirectory: canonical, expectedLiveStore: canonical, backupRoot, exclusiveCheck: async () => true }), /RECOVERY_IN_PROGRESS_OPERATION_BLOCKED/)
  const blockFinancial = () => { throw new Error('RECOVERY_IN_PROGRESS_OPERATION_BLOCKED') }; await assert.rejects(new BillTipFinalizationService({} as PGlite, () => '2026-09-11', blockFinancial).finalizeInitial({} as any, {} as any), /RECOVERY_IN_PROGRESS_OPERATION_BLOCKED/); await assert.rejects(new IncentivesCalculationService({} as PGlite, blockFinancial).finalizeEarning('isolated'), /RECOVERY_IN_PROGRESS_OPERATION_BLOCKED/)
  assert.equal((await svc.rollbackOffline({ incidentId: restartFailure.incidentId, confirmation: RECOVERY_PROMOTION_CONFIRMATION, exclusiveCheck: async () => true })).state, 'ROLLBACK_COMPLETED'); assert.equal(existsSync(operationMarkerPaths(canonical).recovery), false); const reopenedRollback = await openVerifiedDatabase({ dataDirectory: canonical, role: 'canonical', backupRoot }); await reopenedRollback.db.close()

  const promotionFailure = await prepare(svc, await fingerprintStore(), oldBackup.metadata.backupId)
  await assert.rejects(svc.promoteOffline({ artifactFile: promotionFailure.artifactFile, confirmation: RECOVERY_PROMOTION_CONFIRMATION, exclusiveCheck: async () => true, simulateFailure: 'promotion' }), /SIMULATED_PROMOTION_FAILURE/); assert.equal(existsSync(operationMarkerPaths(canonical).recovery), false)

  const expiring = await prepare(svc, oldBackup.metadata.operationalFingerprint as Record<string, unknown>, oldBackup.metadata.backupId); const expired = JSON.parse(await readFile(expiring.artifactFile, 'utf8')); expired.expiresAt = '2000-01-01T00:00:00.000Z'; await writeFile(expiring.artifactFile, `${JSON.stringify(expired, null, 2)}\n`); await assert.rejects(svc.promoteOffline({ artifactFile: expiring.artifactFile, confirmation: RECOVERY_PROMOTION_CONFIRMATION, exclusiveCheck: async () => true }), /RECOVERY_AUTHORIZATION_EXPIRED/)
  const rollbackFailure = await prepare(svc, await fingerprintStore(), oldBackup.metadata.backupId); await assert.rejects(svc.promoteOffline({ artifactFile: rollbackFailure.artifactFile, confirmation: RECOVERY_PROMOTION_CONFIRMATION, exclusiveCheck: async () => true, simulateFailure: 'restart' }), /SIMULATED_APPLICATION_RESTART_FAILURE/); await assert.rejects(svc.rollbackOffline({ incidentId: rollbackFailure.incidentId, confirmation: RECOVERY_PROMOTION_CONFIRMATION, exclusiveCheck: async () => true, simulateFailure: true }), /SIMULATED_ROLLBACK_FAILURE/); assert.equal(existsSync(operationMarkerPaths(canonical).recovery), true)
  const history = await svc.history(); assert.equal(history.some(item => item.state === 'RECOVERY_ACCEPTED'), true); assert.equal(history.some(item => item.state === 'ROLLBACK_COMPLETED'), true); const audit = await readFile(join(recoveryRoot, 'recovery-audit.jsonl'), 'utf8'); for (const event of ['recovery_detected','recovery_candidate_inspected','recovery_candidate_selected','recovery_rehearsal_started','recovery_rehearsal_completed','recovery_authorization_created','recovery_promotion_started','recovery_canonical_quarantined','recovery_promotion_completed','recovery_promotion_failed','recovery_rollback_started','recovery_rollback_completed','recovery_rollback_failed','recovery_accepted']) assert.match(audit, new RegExp(event))
  const routeSource = await readFile('server/index.ts', 'utf8'); assert.match(routeSource, /if \(!principal\.isOwner\).*Owner authority is required for database recovery/); assert.doesNotMatch(routeSource, /input\.actor|input\.isOwner|input\.permission/); const uiSource = await readFile('src/database-health.tsx', 'utf8'); assert.match(uiSource, /Database recovery required/); assert.match(uiSource, /Known operational differences/); assert.doesNotMatch(uiSource, /promoteOffline|RECOVERY_PROMOTION_CONFIRMATION/)
  assert.equal((await readFile('server/database-recovery.ts', 'utf8')).match(/pg_resetwal|pg_control editing|WAL deletion|checkpoint rewriting/g), null)
  console.log(JSON.stringify({ detection: true, missingCanonical: true, invalidCandidateExcluded: true, ranking: true, dataGap: true, rehearsalRequired: true, authorizationBoundToServerActor: true, ownerAuthorization: true, clientImpersonationRejected: true, authorizationFreshness: true, quarantine: true, promotionFailureIsolation: true, promotion: true, manifestVerification: true, guardedStartup: true, moduleTables: true, reconciliation: true, acceptance: true, restartFailure: true, rollback: true, rollbackFailureIsolation: true, recoveryLock: true, backupExclusion: true, restoreRehearsalExclusion: true, schedulerExclusion: true, migrationExclusion: true, financialFinalizationExclusion: true, recoveryHistory: true, ownerUi: true, audit: true, rawWalRepairAbsent: true }, null, 2))
} finally { await rm(root, { recursive: true, force: true }) }
