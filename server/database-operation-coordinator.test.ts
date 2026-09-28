import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DATABASE_OPERATION_JOURNAL_VERSION, DatabaseOperationCoordinator, assessStorageHeadroom,
  assertBackupSourceEvidenceUnchanged, backupSourceEvidenceMatches, databaseOperationPeriodKey,
  classifyDatabaseOperationFailure, deriveEffectiveBackupState, retentionDependencyBlockers
} from './database-operation-coordinator.js'
import { setBackupOriginalFilesystemProtection, verifyBackupOriginalFilesystemProtection } from './database-backup.js'

const root = await mkdtemp(join(tmpdir(), 'andalucia-r24b-coordinator-'))
try {
  const canonical = 'fixture-canonical'
  const coordinator = new DatabaseOperationCoordinator(join(root, 'operations'), { host: 'TEST-HOST', pid: 4242, processAlive: pid => pid === 4242 })

  const dailyKey = databaseOperationPeriodKey('daily', new Date('2026-09-29T00:00:00+05:00'))
  const weeklyKey = databaseOperationPeriodKey('weekly', new Date('2026-09-29T00:00:00+05:00'))
  assert.equal(dailyKey, 'daily:2026-09-29:Indian/Maldives')
  assert.match(weeklyKey, /^weekly:2026-W40:Indian\/Maldives$/)

  const scheduled = await coordinator.acquire({ operationType: 'scheduled_backup', resource: { kind: 'canonical', id: canonical }, periodKey: dailyKey })
  await assert.rejects(coordinator.acquire({ operationType: 'manual_backup', resource: { kind: 'canonical', id: canonical } }), /DATABASE_OPERATION_LEASE_CONFLICT/)
  await assert.rejects(coordinator.acquire({ operationType: 'migration', resource: { kind: 'canonical', id: canonical } }), /DATABASE_OPERATION_LEASE_CONFLICT/)
  await assert.rejects(coordinator.acquire({ operationType: 'recovery', resource: { kind: 'canonical', id: canonical } }), /DATABASE_OPERATION_LEASE_CONFLICT/)
  await scheduled.succeed({ backupId: 'fixture-backup' })
  assert.equal((await import('node:fs/promises').then(module => module.readdir(join(root, 'operations', 'journal')))).some(name => name.endsWith('.tmp')), false)
  await assert.rejects(coordinator.acquire({ operationType: 'scheduled_backup', resource: { kind: 'canonical', id: canonical }, periodKey: dailyKey }), /PERIOD_ALREADY_SUCCEEDED/)
  assert.equal(classifyDatabaseOperationFailure(new Error('TEMPORARY_PROCESS_CONTENTION')), 'RETRYABLE')
  assert.equal(classifyDatabaseOperationFailure(new Error('PROTECTED_BACKUP_SOURCE_CHANGED')), 'REQUIRES_REVIEW')
  assert.equal(classifyDatabaseOperationFailure(new Error('POLICY_REJECTION')), 'NON_RETRYABLE')

  const backupLease = await coordinator.acquire({ operationType: 'restore_rehearsal', resource: { kind: 'backup', id: 'backup-a' }, backupId: 'backup-a' })
  await assert.rejects(coordinator.acquire({ operationType: 'encrypted_export', resource: { kind: 'backup', id: 'backup-a' }, backupId: 'backup-a' }), /DATABASE_OPERATION_LEASE_CONFLICT/)
  const unrelated = await coordinator.acquire({ operationType: 'verification', resource: { kind: 'backup', id: 'backup-b' }, backupId: 'backup-b' })
  await unrelated.succeed(); await backupLease.succeed()

  const verificationLease = await coordinator.acquire({ operationType: 'verification', resource: { kind: 'backup', id: 'verification-delete' }, backupId: 'verification-delete' })
  await assert.rejects(coordinator.acquire({ operationType: 'local_retention', resource: { kind: 'backup', id: 'verification-delete' }, backupId: 'verification-delete' }), /DATABASE_OPERATION_LEASE_CONFLICT/)
  await verificationLease.succeed()
  const protectionLease = await coordinator.acquire({ operationType: 'protection_change', resource: { kind: 'backup', id: 'protection-verify' }, backupId: 'protection-verify' })
  await assert.rejects(coordinator.acquire({ operationType: 'verification', resource: { kind: 'backup', id: 'protection-verify' }, backupId: 'protection-verify' }), /DATABASE_OPERATION_LEASE_CONFLICT/)
  await protectionLease.succeed()

  const ownership = await coordinator.acquire({ operationType: 'verification', resource: { kind: 'backup', id: 'owner-check' } })
  const lease = JSON.parse(await readFile(ownership.leasePath, 'utf8')); lease.operationId = 'tampered'
  await writeFile(ownership.leasePath, JSON.stringify(lease), 'utf8')
  await assert.rejects(ownership.succeed(), /LEASE_OWNERSHIP_MISMATCH/)

  const interruptedRoot = join(root, 'interrupted')
  const interruptedCoordinator = new DatabaseOperationCoordinator(interruptedRoot, { host: 'TEST-HOST', pid: 9999, processAlive: () => false })
  const interruptedOperation = await interruptedCoordinator.acquire({ operationType: 'manual_backup', resource: { kind: 'canonical', id: 'dead-owner' } })
  const interruptedTemporary = interruptedCoordinator.temporaryPath(interruptedOperation.operationId, 'candidate.partial')
  await mkdir(join(interruptedRoot, 'temporary', interruptedOperation.operationId), { recursive: true }); await writeFile(interruptedTemporary, 'incomplete', 'utf8')
  const interrupted = await interruptedCoordinator.reconcile(); assert.equal(interrupted[0]?.classification, 'INTERRUPTED'); assert.equal((await readFile(interruptedTemporary, 'utf8')), 'incomplete')

  const remoteRoot = join(root, 'remote')
  const remoteOwner = new DatabaseOperationCoordinator(remoteRoot, { host: 'REMOTE-HOST', pid: 7, processAlive: () => true })
  await remoteOwner.acquire({ operationType: 'manual_backup', resource: { kind: 'canonical', id: 'remote-owner' } })
  const localObserver = new DatabaseOperationCoordinator(remoteRoot, { host: 'LOCAL-HOST', pid: 8, processAlive: () => false })
  assert.equal((await localObserver.reconcile())[0]?.classification, 'REQUIRES_REVIEW')

  const corruptRoot = join(root, 'corrupt'); await mkdir(join(corruptRoot, 'journal'), { recursive: true }); await writeFile(join(corruptRoot, 'journal', 'bad.json'), '{not-json', 'utf8')
  await assert.rejects(new DatabaseOperationCoordinator(corruptRoot).reconcile(), /JOURNAL_CORRUPT/)

  const enough = assessStorageHeadroom({ operationType: 'backup', sourceBytes: 1000, availableBytes: 1024 * 1024 * 1024 }); assert.equal(enough.sufficient, true)
  const insufficient = assessStorageHeadroom({ operationType: 'backup', sourceBytes: 1024 * 1024 * 1024, availableBytes: 1024 }); assert.equal(insufficient.sufficient, false)

  const evidence = { backupId: 'b', role: 'backup', state: 'VERIFIED_REHEARSED', schema: '018', manifestSha256: 'abc', fileCount: 1301, byteCount: 65151016, pinned: true, protectedReadOnly: true }
  assert.equal(backupSourceEvidenceMatches(evidence, { ...evidence }), true)
  assert.throws(() => assertBackupSourceEvidenceUnchanged(evidence, { ...evidence, byteCount: evidence.byteCount + 1 }), /SOURCE_CHANGED/)

  const reconciled = deriveEffectiveBackupState({ candidateState: 'VERIFICATION_PASSED_PENDING_REHEARSAL_AND_PROTECTION', verificationStatus: 'VERIFIED', openTestStatus: 'PASS', preflightStatus: 'READY', restoreStatus: 'RESTORE_TEST_PASSED', pinned: false })
  assert.equal(reconciled.effectiveState, 'VERIFIED_REHEARSED'); assert.equal(reconciled.discrepancy, true)
  assert.deepEqual(retentionDependencyBlockers({ protected: true, latestRecoverable: true, unresolvedRecovery: false, activeOperations: ['encrypted_export'], cloudVerificationRequired: true }), ['PROTECTED_BACKUP', 'LATEST_REQUIRED_RECOVERABLE_GENERATION', 'CLOUD_VERIFICATION_DEPENDENCY', 'ACTIVE_ENCRYPTED_EXPORT'])

  const protectionRoot = join(root, 'protection'); await mkdir(protectionRoot); await writeFile(join(protectionRoot, 'one'), 'one'); await writeFile(join(protectionRoot, 'two'), 'two')
  await setBackupOriginalFilesystemProtection(protectionRoot, true); assert.equal((await verifyBackupOriginalFilesystemProtection(protectionRoot, true)).verified, true)
  await chmod(join(protectionRoot, 'two'), 0o644); assert.equal((await verifyBackupOriginalFilesystemProtection(protectionRoot, true)).verified, false)

  const successJournal = JSON.parse(await readFile(scheduled.journalPath, 'utf8')); assert.equal(successJournal.version, DATABASE_OPERATION_JOURNAL_VERSION); assert.equal(successJournal.state, 'SUCCEEDED')
  console.log(JSON.stringify({ stateTransitions: true, journalAtomicity: true, retryClassification: true, atomicLeaseCollision: true, ownershipVerification: true, periodKeys: [dailyKey, weeklyKey], duplicatePeriodBlocked: true, scheduledManualCollision: true, backupMigrationCollision: true, backupRecoveryCollision: true, rehearsalExportCollision: true, verificationDeletionCollision: true, protectionVerificationCollision: true, unrelatedBackupsCanCoexist: true, interruptedDetected: true, interruptedTemporaryPreservedForReview: true, ambiguousRemoteOwnerRequiresReview: true, corruptJournalFailsClosed: true, storageGate: true, sourceDriftBlocked: true, historicalStateDerivedWithoutRewrite: true, retentionDependencies: true, partialProtectionDetected: true }, null, 2))
} finally { await rm(root, { recursive: true, force: true }) }
