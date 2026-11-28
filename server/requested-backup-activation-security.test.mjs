import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseOperationCoordinator } from './database-operation-coordinator.ts'
import { RequestedBackupActivationControl, assertReviewedStoppedMainSourceSuccessor, prepareStoppedMainActivation, reviewedStoppedMainSourceSuccessor, runRequestedBackupActivationControl } from './requested-backup-activation-control.ts'

const previousLiveSha = '1'.repeat(40)
const targetSha = '2'.repeat(40)
const request = { id: 'request-1', state: 'pending', category: 'manual', requestedAt: '2026-11-06T00:00:00.000Z', requestedBy: { userId: 'manager-1', displayName: 'Manager' }, instruction: 'verified backup' }
const input = { previousLiveSha, targetSha, targetBranch: 'codex/local-ui-security', approvalManifestSha256: 'a'.repeat(64), canonicalIdentitySha256: 'b'.repeat(64), canonicalStoreId: 'store-1', request, requestAuditVerified: true }
const fixture = async (clock = { value: new Date('2026-11-06T00:00:00.000Z') }) => {
  const root = await mkdtemp(join(tmpdir(), 'andalucia-maintenance-security-'))
  const coordinator = new DatabaseOperationCoordinator(root, { now: () => clock.value })
  const control = new RequestedBackupActivationControl(coordinator, () => clock.value)
  const authorization = await control.prepare(input)
  return { root, coordinator, control, authorization, clock }
}

// Trusted manager request and exact source bindings are mandatory.
const forgedRoot = await mkdtemp(join(tmpdir(), 'andalucia-forged-'))
await assert.rejects(() => new RequestedBackupActivationControl(new DatabaseOperationCoordinator(forgedRoot)).prepare({ ...input, requestAuditVerified: false }), /REQUESTED_BACKUP_AUTHENTICATED_REQUEST_INVALID/)

// Tampering with durable journal evidence is detected before any claim.
{
  const { coordinator, authorization } = await fixture()
  const path = coordinator.maintenancePath(authorization.authorizationId)
  const forged = JSON.parse(await readFile(path, 'utf8')); forged.targetSha = '3'.repeat(40)
  await writeFile(path, JSON.stringify(forged), 'utf8')
  await assert.rejects(() => coordinator.readCanonicalMaintenanceAuthorization(authorization.authorizationId), /CANONICAL_MAINTENANCE_AUTHORIZATION_TAMPERED/)
}

// The authenticated request itself is atomically single-use, even if the authorization record is deleted.
{
  const root = await mkdtemp(join(tmpdir(), 'andalucia-request-single-use-'))
  const coordinator = new DatabaseOperationCoordinator(root)
  const control = new RequestedBackupActivationControl(coordinator)
  const attempts = await Promise.allSettled([control.prepare(input), control.prepare(input)])
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1)
  const accepted = attempts.find(item => item.status === 'fulfilled').value
  await unlink(coordinator.maintenancePath(accepted.authorizationId))
  await assert.rejects(() => control.prepare(input), /CANONICAL_MAINTENANCE_REQUEST_ALREADY_AUTHORIZED/)
}

// Request/backup identity mismatch cannot be bound.
{
  const { control, authorization } = await fixture()
  await assert.rejects(() => control.bindVerifiedBackup(authorization.authorizationId, { request: { ...request, state: 'completed', backupId: 'wrong' }, backupId: 'backup-1', backupVerified: true, restoreReady: true }), /REQUESTED_BACKUP_REQUEST_BINDING_MISMATCH/)
}

// Expired authorization fails closed.
{
  const { control, authorization, clock } = await fixture()
  clock.value = new Date('2026-11-06T02:00:00.000Z')
  await assert.rejects(() => control.backupFailed(authorization.authorizationId, 'expired'), /CANONICAL_MAINTENANCE_AUTHORIZATION_EXPIRED/)
}

const verified = async () => {
  const value = await fixture()
  const completed = { ...request, state: 'completed', backupId: 'backup-1' }
  await value.control.bindVerifiedBackup(value.authorization.authorizationId, { request: completed, backupId: 'backup-1', backupVerified: true, restoreReady: true })
  return value
}

// A stopped Schema 028 main activation is fresh, manager-bound, expiring, and single-use.
{
  const root = await mkdtemp(join(tmpdir(), 'andalucia-stopped-main-authorization-'))
  const clock = { value: new Date('2026-11-18T00:00:00.000Z') }
  const coordinator = new DatabaseOperationCoordinator(root, { now: () => clock.value })
  const control = new RequestedBackupActivationControl(coordinator, () => clock.value)
  const stoppedMainInput = {
    previousLiveSha, targetSha, approvalManifestSha256: 'a'.repeat(64), canonicalIdentitySha256: 'b'.repeat(64), canonicalStoreId: 'andalucia-canonical-live',
    recoveryAuthorizationId: 'c'.repeat(32), recoveryAuthorizationSha256: 'd'.repeat(64), recoveryIntegritySha256: 'e'.repeat(64),
    attemptId: '1'.repeat(32), backupId: 'verified-schema-028', requestedBy: { userId: 'manager-1', displayName: 'Manager' }, schemaEvidenceSha256: 'f'.repeat(64),
  }
  const authorization = await control.prepareStoppedMainActivation(stoppedMainInput)
  assert.equal(authorization.authorizationMode, 'stopped_main_runtime_activation')
  assert.equal(authorization.state, 'BACKUP_VERIFIED')
  assert.equal(authorization.schema, '028')
  assert.equal(Date.parse(authorization.expiresAt) - clock.value.getTime(), 10 * 60_000)
  await assert.rejects(() => control.prepareStoppedMainActivation(stoppedMainInput), /CANONICAL_MAINTENANCE_REQUEST_ALREADY_AUTHORIZED/)
  const claims = await Promise.allSettled([control.claimTarget(authorization.authorizationId), control.claimTarget(authorization.authorizationId)])
  assert.equal(claims.filter(item => item.status === 'fulfilled').length, 1)
}

// Atomic claim permits exactly one concurrent target activation and blocks replay.
{
  const { control, authorization } = await verified()
  const claims = await Promise.allSettled([control.claimTarget(authorization.authorizationId), control.claimTarget(authorization.authorizationId)])
  assert.equal(claims.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(claims.filter(item => item.status === 'rejected').length, 1)
  await assert.rejects(() => control.claimTarget(authorization.authorizationId), /CANONICAL_MAINTENANCE_STATE_INVALID/)
}

// Backup and target failures authorize only a single previous-SHA recovery transition.
{
  const { control, authorization } = await fixture()
  await control.backupFailed(authorization.authorizationId, 'backup failed')
  const recovery = await control.claimRecovery(authorization.authorizationId)
  assert.equal(recovery.previousLiveSha, previousLiveSha)
  assert.equal((await control.recoveryHealthy(authorization.authorizationId)).state, 'RECOVERY_HEALTHY')
  await assert.rejects(() => control.claimRecovery(authorization.authorizationId), /CANONICAL_MAINTENANCE_STATE_INVALID/)
}
{
  const { control, authorization } = await verified()
  await control.claimTarget(authorization.authorizationId)
  await control.targetFailed(authorization.authorizationId, 'startup failed')
  await control.claimRecovery(authorization.authorizationId)
  assert.equal((await control.recoveryFailed(authorization.authorizationId, 'recovery health failed')).state, 'RECOVERY_FAILED')
  await assert.rejects(() => control.claimRecovery(authorization.authorizationId), /CANONICAL_MAINTENANCE_STATE_INVALID/)
}

// The deployment path uses the protected journal and keeps ordinary startup available.
const [orchestrator, preflight, activation, startup, resolver] = await Promise.all([
  readFile('deployment/windows/Invoke-AndaluciaRequestedBackupUiActivation.ps1', 'utf8'), readFile('deployment/windows/Test-AndaluciaGuardedUiActivation.ps1', 'utf8'),
  readFile('deployment/windows/Invoke-AndaluciaApprovedUiActivation.ps1', 'utf8'), readFile('deployment/windows/Start-AndaluciaGuardedApplication.ps1', 'utf8'), readFile('deployment/windows/Resolve-AndaluciaApprovedSource.ps1', 'utf8'),
])
const stoppedMainWrapper = await readFile('deployment/windows/New-AndaluciaStoppedRuntimeActivationAuthorization.ps1', 'utf8')
const [schedulerInstaller, databaseJob, guardedStop] = await Promise.all([
  readFile('deployment/windows/Install-AndaluciaDatabaseScheduler.ps1', 'utf8'),
  readFile('deployment/windows/Invoke-AndaluciaDatabaseJob.ps1', 'utf8'),
  readFile('deployment/windows/Stop-AndaluciaGuardedApplication.ps1', 'utf8'),
])
for (const source of [orchestrator, preflight, activation]) {
  assert.doesNotMatch(source, /StoppedRuntimeEvidenceSha256|YES_I_APPROVE_ONE_GUARDED_REQUESTED_BACKUP_ACTIVATION_WINDOW|\.consumed\.json/)
  assert.match(source, /MaintenanceAuthorizationId/)
}
assert.match(orchestrator, /db:backup:job -- requested/)
assert.doesNotMatch(orchestrator, /db:backup:job -- daily/)
assert.match(orchestrator, /Invoke-GuardedPreviousRuntimeRecovery/)
assert.match(startup, /RecoveryAuthorizationId/)
assert.match(resolver, /approved_journal_bound_recovery/)
assert.match(resolver, /inspect-recovery-source/)
assert.match(preflight, /stopped_main_runtime_activation/)
assert.match(preflight, /STOPPED_MAIN_ACTIVATION_EVIDENCE_INVALID/)
const administratorGuardIndex = activation.indexOf('GUARDED_ACTIVATION_ADMINISTRATOR_REQUIRED_BEFORE_AUTHORIZATION_CLAIM')
const targetClaimIndex = activation.indexOf('claim-target')
assert.ok(administratorGuardIndex >= 0 && targetClaimIndex > administratorGuardIndex, 'administrator privilege must be proven before the single-use target claim')
assert.doesNotMatch(preflight, /evidence\.previousLiveSha\s+-ne\s+\$headSha/, 'preflight must retain the protected historical recovery SHA for an approved source successor')
assert.match(preflight, /historicalRecoverySha\s+-notmatch\s+'\^\[0-9a-f\]\{40\}\$'/, 'preflight must reject a malformed historical recovery SHA')
assert.match(preflight, /merge-base[^\n]+--is-ancestor[^\n]+\$runtimeSha[^\n]+\$headSha/, 'preflight must retain the historical-to-target ancestry gate')
assert.match(preflight, /backupAgeHours\s+-gt\s+\$MaximumBackupAgeHours\s+-and\s+-not\s+\$stoppedMainActivation/, 'only the exact stopped-main recovery path may use its immutable recovery-bound backup beyond the live-update age limit')
assert.match(stoppedMainWrapper, /Read-Host 'Manager password' -AsSecureString/)
assert.match(stoppedMainWrapper, /Invoke-AndaluciaNativeJsonControl/)
for (const source of [orchestrator, preflight, activation, schedulerInstaller, databaseJob]) {
  assert.match(source, /SourceRoot/, 'every protected activation stage must accept or propagate the approved source root')
  assert.match(source, /CanonicalProjectRoot/, 'every protected activation stage must accept or propagate the canonical data root')
}
assert.match(preflight, /--source-root\s+\$sourceRoot\s+--canonical-root\s+\$projectRoot/)
assert.match(activation, /-SourceRoot\s+\$sourceRoot\s+-CanonicalProjectRoot\s+\$projectRoot\s+-ApprovedSha\s+\$ExpectedSha/)
assert.match(schedulerInstaller, /-Job DailyBackup -SourceRoot/)
assert.match(databaseJob, /Set-Location -LiteralPath \$sourceRoot/)
assert.match(guardedStop, /\[string\]\$CanonicalProjectRoot/)
assert.match(startup, /--strictPort `"\$runtimeSourceRoot`"/)
assert.doesNotMatch(startup, /--strictPort `"\$projectRoot`"/)
assert.doesNotMatch(stoppedMainWrapper, /postmaster\.pid[^\n]+Remove-Item|Remove-Item[^\n]+postmaster\.pid/i)

// The complete stopped-main issuer revalidates exact main/runtime/recovery/backup bindings and authenticates once.
{
  const root = await mkdtemp(join(tmpdir(), 'andalucia-stopped-main-integration-'))
  const fixtureGit = (workingRoot, ...args) => execFileSync('git', ['-C', workingRoot, ...args], { encoding: 'utf8' }).trim()
  fixtureGit(root, 'init', '-b', 'main'); fixtureGit(root, 'config', 'user.email', 'security-test@example.invalid'); fixtureGit(root, 'config', 'user.name', 'Security Test')
  await writeFile(join(root, '.gitignore'), '.data\n.runtime\n.backups\n')
  await writeFile(join(root, 'approved.txt'), 'approved source')
  fixtureGit(root, 'add', '.'); fixtureGit(root, 'commit', '-m', 'approved source')
  const sha = fixtureGit(root, 'rev-parse', 'HEAD').toLowerCase(); fixtureGit(root, 'update-ref', 'refs/remotes/origin/main', sha)
  const sourceRoot = join(root, '.runtime', 'live-main-source'); await mkdir(join(root, '.runtime'), { recursive: true }); fixtureGit(root, 'worktree', 'add', '--detach', sourceRoot, sha)
  const canonicalDirectory = join(root, '.data', 'postgres'); await mkdir(canonicalDirectory, { recursive: true })
  const identityPath = join(root, '.data', 'andalucia-store-identity.json')
  await writeFile(identityPath, JSON.stringify({ role: 'canonical', storeId: 'andalucia-canonical-live', databaseDirectory: canonicalDirectory }))
  await writeFile(join(root, '.runtime', 'approved-runtime-source.json'), JSON.stringify({ version: 'andalucia-approved-runtime-source-v1', approvedSha: sha, sourceRoot }))
  const backupId = 'verified-schema-028'; const backupFolder = join(root, '.backups', backupId); await mkdir(join(backupFolder, 'postgres'), { recursive: true })
  await writeFile(join(backupFolder, 'backup-metadata.json'), JSON.stringify({ backupId, createdAt: '2026-11-18T00:00:00.000Z', category: 'automatic-daily', schemaVersion: '028', verificationStatus: 'VERIFIED', openTestStatus: 'PASS', preflightStatus: 'READY', sourceDirectory: canonicalDirectory, backupDirectory: join(backupFolder, 'postgres'), storeIdentity: { storeId: 'andalucia-canonical-live' }, backupManifest: { entries: [] } }))
  await writeFile(join(backupFolder, 'restore-test.json'), JSON.stringify({ backupId, status: 'RESTORE_TEST_PASSED', manifestMatch: true, fingerprintMatch: true, migrationMatch: true, preflightStatus: 'READY' }))
  const coordinator = new DatabaseOperationCoordinator(join(root, '.backups', '.db2', 'operations'))
  const identitySha = createHash('sha256').update(await readFile(identityPath)).digest('hex')
  const recovery = await coordinator.createCanonicalMaintenanceAuthorization({ authorizationMode: 'stale_marker_recovery', previousLiveSha: sha, targetSha: sha, targetBranch: 'main', approvalManifestSha256: '1'.repeat(64), canonicalIdentitySha256: identitySha, canonicalStoreId: 'andalucia-canonical-live', schema: '028', databaseStatus: 'HEALTHY', migrationRequired: false, recoveryRequired: false, requestId: `db3-fixture:${sha}`, requestSha256: '2'.repeat(64), requestedBy: { userId: 'manager-1', displayName: 'Manager' }, backupId, historicalRuntimeEvidenceSha256: '3'.repeat(64), schemaEvidenceSha256: '4'.repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString() }, 'RECOVERY_AUTHORIZED')
  await coordinator.transitionCanonicalMaintenanceAuthorization(recovery.authorizationId, ['RECOVERY_AUTHORIZED'], 'RECOVERY_CLAIMED')
  await coordinator.transitionCanonicalMaintenanceAuthorization(recovery.authorizationId, ['RECOVERY_CLAIMED'], 'RECOVERY_HEALTHY')
  let authentications = 0
  const authorization = await prepareStoppedMainActivation(root, sha, recovery.authorizationId, { identifier: 'owner', password: 'secret' }, { portsClosed: async () => true, authenticate: async () => { authentications += 1; return { userId: 'manager-1', displayName: 'Manager' } } })
  assert.equal(authentications, 1)
  assert.equal(authorization.state, 'BACKUP_VERIFIED')
  assert.equal(authorization.backupId, backupId)
  const inspected = await runRequestedBackupActivationControl('inspect-target', ['node', 'control', '--project-root', root, '--authorization-id', authorization.authorizationId], { portsClosed: async () => true })
  assert.equal(inspected.authorizationId, authorization.authorizationId)
}

const stoppedMainSuccessorFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'andalucia-stopped-main-successor-'))
  const fixtureGit = (workingRoot, ...args) => execFileSync('git', ['-C', workingRoot, ...args], { encoding: 'utf8' }).trim()
  fixtureGit(root, 'init', '-b', 'main'); fixtureGit(root, 'config', 'user.email', 'security-test@example.invalid'); fixtureGit(root, 'config', 'user.name', 'Security Test')
  await writeFile(join(root, '.gitignore'), '.data\n.runtime\n.backups\n')
  await writeFile(join(root, 'historical.txt'), 'healthy recovery source'); fixtureGit(root, 'add', '.'); fixtureGit(root, 'commit', '-m', 'healthy recovery source')
  const previousSha = fixtureGit(root, 'rev-parse', 'HEAD').toLowerCase()
  fixtureGit(root, 'checkout', '-b', 'reviewed-source')
  await writeFile(join(root, 'reviewed-a.txt'), 'reviewed successor a'); await writeFile(join(root, 'reviewed-b.txt'), 'reviewed successor b')
  fixtureGit(root, 'add', '.'); fixtureGit(root, 'commit', '-m', 'reviewed source successor')
  const reviewedHeadSha = fixtureGit(root, 'rev-parse', 'HEAD').toLowerCase()
  fixtureGit(root, 'checkout', 'main'); fixtureGit(root, 'merge', '--no-ff', 'reviewed-source', '-m', 'merge reviewed source successor')
  const reviewedTargetSha = fixtureGit(root, 'rev-parse', 'HEAD').toLowerCase()
  fixtureGit(root, 'checkout', '-b', 'activation-source')
  await writeFile(join(root, 'activation-a.txt'), 'activation correction a'); await writeFile(join(root, 'activation-b.txt'), 'activation correction b')
  fixtureGit(root, 'add', '.'); fixtureGit(root, 'commit', '-m', 'activation source binding correction')
  const activationHeadSha = fixtureGit(root, 'rev-parse', 'HEAD').toLowerCase()
  fixtureGit(root, 'checkout', 'main'); fixtureGit(root, 'merge', '--no-ff', 'activation-source', '-m', 'merge activation source binding correction')
  const targetSha = fixtureGit(root, 'rev-parse', 'HEAD').toLowerCase(); fixtureGit(root, 'update-ref', 'refs/remotes/origin/main', targetSha)
  const sourceRoot = join(root, '.runtime', 'live-main-source'); await mkdir(join(root, '.runtime'), { recursive: true }); fixtureGit(root, 'worktree', 'add', '--detach', sourceRoot, previousSha)
  const canonicalDirectory = join(root, '.data', 'postgres'); await mkdir(canonicalDirectory, { recursive: true })
  const identityPath = join(root, '.data', 'andalucia-store-identity.json')
  await writeFile(identityPath, JSON.stringify({ role: 'canonical', storeId: 'andalucia-canonical-live', databaseDirectory: canonicalDirectory }))
  await writeFile(join(root, '.runtime', 'approved-runtime-source.json'), JSON.stringify({ version: 'andalucia-approved-runtime-source-v1', approvedSha: previousSha, sourceRoot }))
  const backupId = 'verified-schema-028'; const backupFolder = join(root, '.backups', backupId); await mkdir(join(backupFolder, 'postgres'), { recursive: true })
  await writeFile(join(backupFolder, 'backup-metadata.json'), JSON.stringify({ backupId, createdAt: '2026-11-18T00:00:00.000Z', category: 'automatic-daily', schemaVersion: '028', verificationStatus: 'VERIFIED', openTestStatus: 'PASS', preflightStatus: 'READY', sourceDirectory: canonicalDirectory, backupDirectory: join(backupFolder, 'postgres'), storeIdentity: { storeId: 'andalucia-canonical-live' }, backupManifest: { entries: [] } }))
  await writeFile(join(backupFolder, 'restore-test.json'), JSON.stringify({ backupId, status: 'RESTORE_TEST_PASSED', manifestMatch: true, fingerprintMatch: true, migrationMatch: true, preflightStatus: 'READY' }))
  const coordinator = new DatabaseOperationCoordinator(join(root, '.backups', '.db2', 'operations'))
  const identitySha = createHash('sha256').update(await readFile(identityPath)).digest('hex')
  const recovery = await coordinator.createCanonicalMaintenanceAuthorization({ authorizationMode: 'stale_marker_recovery', previousLiveSha: previousSha, targetSha: previousSha, targetBranch: 'main', approvalManifestSha256: '1'.repeat(64), canonicalIdentitySha256: identitySha, canonicalStoreId: 'andalucia-canonical-live', schema: '028', databaseStatus: 'HEALTHY', migrationRequired: false, recoveryRequired: false, requestId: `db3-successor-fixture:${previousSha}`, requestSha256: '2'.repeat(64), requestedBy: { userId: 'manager-1', displayName: 'Manager' }, backupId, historicalRuntimeEvidenceSha256: '3'.repeat(64), schemaEvidenceSha256: '4'.repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString() }, 'RECOVERY_AUTHORIZED')
  await coordinator.transitionCanonicalMaintenanceAuthorization(recovery.authorizationId, ['RECOVERY_AUTHORIZED'], 'RECOVERY_CLAIMED')
  await coordinator.transitionCanonicalMaintenanceAuthorization(recovery.authorizationId, ['RECOVERY_CLAIMED'], 'RECOVERY_HEALTHY')
  const reviewedSourceSuccessor = { recoverySha: previousSha, transitions: [
    { previousSha, targetSha: reviewedTargetSha, reviewedHeadSha, pullRequest: 1, changedFiles: ['reviewed-a.txt', 'reviewed-b.txt'] },
    { previousSha: reviewedTargetSha, targetSha, reviewedHeadSha: activationHeadSha, pullRequest: 2, changedFiles: ['activation-a.txt', 'activation-b.txt'] },
  ] }
  const dependencies = { portsClosed: async () => true, authenticate: async () => ({ userId: 'manager-1', displayName: 'Manager' }), reviewedSourceSuccessor }
  return { root, fixtureGit, previousSha, reviewedHeadSha, reviewedTargetSha, activationHeadSha, targetSha, sourceRoot, canonicalDirectory, identityPath, backupFolder, coordinator, recovery, reviewedSourceSuccessor, dependencies }
}

// The production exception is pinned to each normal PR merge, its reviewed head tree,
// exact parents and exact changed-file set. The final registration uses a separate
// evidence-only commit so the reviewed implementation can identify itself without a
// circular commit hash.
{
  const transitions = reviewedStoppedMainSourceSuccessor.transitions
  assert.deepEqual(transitions.map(value => value.pullRequest), [113, 114, 115, 116, 117, 118])
  assert.equal(assertReviewedStoppedMainSourceSuccessor(resolve('.'), reviewedStoppedMainSourceSuccessor.recoverySha, transitions[0].targetSha), 'reviewed-transition')
  assert.equal(assertReviewedStoppedMainSourceSuccessor(resolve('.'), reviewedStoppedMainSourceSuccessor.recoverySha, transitions.at(-1).targetSha), 'reviewed-successor')
  assert.deepEqual(transitions.at(-1), {
    previousSha: 'ef557c5ecb5a0898655162f1fca235cbdd9f1270',
    targetSha: 'fde745aa0c90c0ad3528376fb3c0b3bda943f729',
    reviewedHeadSha: 'c424415d9c17488994c8aab8f12ac49ab914e582',
    pullRequest: 118,
    changedFiles: ['deployment/windows/Invoke-AndaluciaApprovedUiActivation.ps1', 'server/requested-backup-activation-control.ts', 'server/requested-backup-activation-security.test.mjs'],
  })
  assert.deepEqual(reviewedStoppedMainSourceSuccessor.registration, {
    previousSha: 'fde745aa0c90c0ad3528376fb3c0b3bda943f729',
    pullRequest: 119,
    evidencePath: 'deployment/approvals/stopped-main-successor-pr119.json',
    implementationChangedFiles: ['server/requested-backup-activation-control.ts', 'server/requested-backup-activation-security.test.mjs'],
  })
  assert.equal([...transitions.flatMap(value => value.changedFiles), reviewedStoppedMainSourceSuccessor.registration.evidencePath].some(path => /(^|\/)(\.data|migrations?|backups?)(\/|$)/i.test(path)), false)
}

// A reviewed implementation plus one evidence-only child commit can authorize its
// normal merge without trusting an unreviewed future descendant.
{
  const value = await stoppedMainSuccessorFixture()
  value.fixtureGit(value.root, 'checkout', '-b', 'registered-implementation')
  await writeFile(join(value.root, 'registered-a.txt'), 'registered implementation a')
  await writeFile(join(value.root, 'registered-b.txt'), 'registered implementation b')
  value.fixtureGit(value.root, 'add', '.'); value.fixtureGit(value.root, 'commit', '-m', 'reviewed registered implementation')
  const reviewedHeadSha = value.fixtureGit(value.root, 'rev-parse', 'HEAD').toLowerCase()
  const evidencePath = 'deployment/approvals/stopped-main-successor.json'
  await mkdir(join(value.root, 'deployment', 'approvals'), { recursive: true })
  await writeFile(join(value.root, evidencePath), JSON.stringify({ version: 'andalucia-stopped-main-successor-registration-v1', previousSha: value.targetSha, reviewedHeadSha, pullRequest: 3, implementationChangedFiles: ['registered-a.txt', 'registered-b.txt'] }))
  value.fixtureGit(value.root, 'add', evidencePath); value.fixtureGit(value.root, 'commit', '-m', 'register reviewed successor evidence')
  value.fixtureGit(value.root, 'checkout', 'main'); value.fixtureGit(value.root, 'merge', '--no-ff', 'registered-implementation', '-m', 'merge registered successor')
  const registeredTargetSha = value.fixtureGit(value.root, 'rev-parse', 'HEAD').toLowerCase()
  const registration = { previousSha: value.targetSha, pullRequest: 3, evidencePath, implementationChangedFiles: ['registered-a.txt', 'registered-b.txt'] }
  const reviewed = { ...value.reviewedSourceSuccessor, registration }
  assert.equal(assertReviewedStoppedMainSourceSuccessor(value.root, value.previousSha, registeredTargetSha, reviewed), 'reviewed-registered-successor')
  const wrongReview = structuredClone(reviewed); wrongReview.registration.pullRequest = 4
  assert.throws(() => assertReviewedStoppedMainSourceSuccessor(value.root, value.previousSha, registeredTargetSha, wrongReview), /STOPPED_MAIN_ACTIVATION_SOURCE_SUCCESSOR_INVALID/)
  await writeFile(join(value.root, 'unreviewed-after-registration.txt'), 'future source')
  value.fixtureGit(value.root, 'add', '.'); value.fixtureGit(value.root, 'commit', '-m', 'unreviewed future source')
  const futureSha = value.fixtureGit(value.root, 'rev-parse', 'HEAD').toLowerCase()
  assert.throws(() => assertReviewedStoppedMainSourceSuccessor(value.root, value.previousSha, futureSha, reviewed), /STOPPED_MAIN_ACTIVATION_SOURCE_SUCCESSOR_INVALID/)
}

// A reviewed source successor keeps the immutable recovery SHA and binds the new target before a single atomic claim.
{
  const value = await stoppedMainSuccessorFixture()
  const authorization = await prepareStoppedMainActivation(value.root, value.targetSha, value.recovery.authorizationId, { identifier: 'owner', password: 'secret' }, value.dependencies)
  assert.equal(authorization.previousLiveSha, value.previousSha)
  assert.equal(authorization.targetSha, value.targetSha)
  assert.equal(authorization.requestSha256, createHash('sha256').update(await readFile(value.coordinator.maintenancePath(value.recovery.authorizationId))).digest('hex'))
  const claimDependencies = { portsClosed: async () => true, reviewedSourceSuccessor: value.reviewedSourceSuccessor }
  const claims = await Promise.allSettled([runRequestedBackupActivationControl('claim-target', ['node', 'control', '--project-root', value.root, '--authorization-id', authorization.authorizationId], claimDependencies), runRequestedBackupActivationControl('claim-target', ['node', 'control', '--project-root', value.root, '--authorization-id', authorization.authorizationId], claimDependencies)])
  assert.equal(claims.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(claims.filter(item => item.status === 'rejected').length, 1)
  await assert.rejects(() => runRequestedBackupActivationControl('claim-target', ['node', 'control', '--project-root', value.root, '--authorization-id', authorization.authorizationId], claimDependencies), /CANONICAL_MAINTENANCE_STATE_INVALID/)

  value.fixtureGit(value.sourceRoot, 'checkout', '--detach', value.targetSha)
  await writeFile(join(value.root, '.runtime', 'approved-runtime-source.json'), JSON.stringify({ version: 'andalucia-approved-runtime-source-v1', approvedSha: value.targetSha, sourceRoot: value.sourceRoot }))
  const failed = await runRequestedBackupActivationControl('target-failed', ['node', 'control', '--project-root', value.root, '--authorization-id', authorization.authorizationId, '--failure', 'INSTALL_FAILED'], claimDependencies)
  assert.equal(failed.state, 'TARGET_FAILED')
  const retryAuthorization = await prepareStoppedMainActivation(value.root, value.targetSha, value.recovery.authorizationId, { identifier: 'owner', password: 'secret' }, value.dependencies)
  assert.equal(retryAuthorization.state, 'BACKUP_VERIFIED')
  assert.notEqual(retryAuthorization.authorizationId, authorization.authorizationId)
  assert.notEqual(retryAuthorization.requestId, authorization.requestId)
  assert.match(retryAuthorization.requestId, new RegExp(`:${value.recovery.authorizationId}:[0-9a-f]{32}$`))
}

// A stopped runtime already refreshed to the exact reviewed target can issue and inspect a fresh authorization.
{
  const value = await stoppedMainSuccessorFixture()
  value.fixtureGit(value.sourceRoot, 'checkout', '--detach', value.targetSha)
  await writeFile(join(value.root, '.runtime', 'approved-runtime-source.json'), JSON.stringify({ version: 'andalucia-approved-runtime-source-v1', approvedSha: value.targetSha, sourceRoot: value.sourceRoot }))
  const authorization = await prepareStoppedMainActivation(value.root, value.targetSha, value.recovery.authorizationId, { identifier: 'owner', password: 'secret' }, value.dependencies)
  const inspected = await runRequestedBackupActivationControl('inspect-target', ['node', 'control', '--project-root', value.root, '--authorization-id', authorization.authorizationId], { portsClosed: async () => true, reviewedSourceSuccessor: value.reviewedSourceSuccessor })
  assert.equal(inspected.state, 'BACKUP_VERIFIED')
}

// A clean approved source remains authoritative when the canonical checkout is dirty,
// while dirty/unapproved source and a wrong canonical store both fail closed.
{
  const value = await stoppedMainSuccessorFixture()
  const cleanSource = join(await mkdtemp(join(tmpdir(), 'andalucia-approved-clean-source-')), 'source')
  execFileSync('git', ['clone', '--quiet', value.root, cleanSource])
  await writeFile(join(value.root, 'unfinished-canonical-ui.tmp'), 'preserved unfinished UI work')
  const authorization = await prepareStoppedMainActivation(value.root, value.targetSha, value.recovery.authorizationId, { identifier: 'owner', password: 'secret' }, value.dependencies, cleanSource)
  assert.equal(authorization.state, 'BACKUP_VERIFIED')
  const inspected = await runRequestedBackupActivationControl('inspect-target', ['node', 'control', '--project-root', value.root, '--source-root', cleanSource, '--authorization-id', authorization.authorizationId], { portsClosed: async () => true, reviewedSourceSuccessor: value.reviewedSourceSuccessor })
  assert.equal(inspected.targetSha, value.targetSha)
  await assert.rejects(() => prepareStoppedMainActivation(value.root, value.targetSha, value.recovery.authorizationId, { identifier: 'owner', password: 'secret' }, value.dependencies, value.root), /STOPPED_MAIN_ACTIVATION_SOURCE_MISMATCH/)
  const wrongCanonicalRoot = await mkdtemp(join(tmpdir(), 'andalucia-wrong-canonical-root-'))
  await assert.rejects(() => prepareStoppedMainActivation(wrongCanonicalRoot, value.targetSha, value.recovery.authorizationId, { identifier: 'owner', password: 'secret' }, value.dependencies, cleanSource), /ENOENT|CANONICAL|RECOVERY_EVIDENCE/)
}

// Wrong ancestry, later/unrelated successors, journal tampering, identity drift, and invalid backups fail closed.
{
  const value = await stoppedMainSuccessorFixture()
  assert.throws(() => assertReviewedStoppedMainSourceSuccessor(value.root, value.targetSha, value.previousSha, { recoverySha: value.targetSha, transitions: [...value.reviewedSourceSuccessor.transitions].reverse() }), /STOPPED_MAIN_ACTIVATION_SOURCE_SUCCESSOR_INVALID/)
  const forgedReview = structuredClone(value.reviewedSourceSuccessor); forgedReview.transitions[1].reviewedHeadSha = value.reviewedHeadSha
  assert.throws(() => assertReviewedStoppedMainSourceSuccessor(value.root, value.previousSha, value.targetSha, forgedReview), /STOPPED_MAIN_ACTIVATION_SOURCE_SUCCESSOR_INVALID/)
  const widenedFiles = structuredClone(value.reviewedSourceSuccessor); widenedFiles.transitions[1].changedFiles.push('unreviewed.txt')
  assert.throws(() => assertReviewedStoppedMainSourceSuccessor(value.root, value.previousSha, value.targetSha, widenedFiles), /STOPPED_MAIN_ACTIVATION_SOURCE_SUCCESSOR_INVALID/)
  await writeFile(join(value.root, 'unreviewed.txt'), 'unreviewed successor'); value.fixtureGit(value.root, 'add', 'unreviewed.txt'); value.fixtureGit(value.root, 'commit', '-m', 'unreviewed later successor')
  const laterSha = value.fixtureGit(value.root, 'rev-parse', 'HEAD').toLowerCase()
  assert.throws(() => assertReviewedStoppedMainSourceSuccessor(value.root, value.previousSha, laterSha, value.reviewedSourceSuccessor), /STOPPED_MAIN_ACTIVATION_SOURCE_SUCCESSOR_INVALID/)
}
{
  const value = await stoppedMainSuccessorFixture(); const recoveryPath = value.coordinator.maintenancePath(value.recovery.authorizationId)
  const tampered = JSON.parse(await readFile(recoveryPath, 'utf8')); tampered.backupId = 'forged-backup'; await writeFile(recoveryPath, JSON.stringify(tampered))
  await assert.rejects(() => prepareStoppedMainActivation(value.root, value.targetSha, value.recovery.authorizationId, { identifier: 'owner', password: 'secret' }, value.dependencies), /CANONICAL_MAINTENANCE_AUTHORIZATION_TAMPERED/)
}
{
  const value = await stoppedMainSuccessorFixture(); await writeFile(value.identityPath, JSON.stringify({ role: 'canonical', storeId: 'changed-store', databaseDirectory: value.canonicalDirectory }))
  await assert.rejects(() => prepareStoppedMainActivation(value.root, value.targetSha, value.recovery.authorizationId, { identifier: 'owner', password: 'secret' }, value.dependencies), /STOPPED_MAIN_ACTIVATION_RECOVERY_EVIDENCE_INVALID/)
}
{
  const value = await stoppedMainSuccessorFixture(); await writeFile(join(value.backupFolder, 'restore-test.json'), JSON.stringify({ backupId: 'verified-schema-028', status: 'FAILED', manifestMatch: true, fingerprintMatch: true, migrationMatch: true, preflightStatus: 'READY' }))
  await assert.rejects(() => prepareStoppedMainActivation(value.root, value.targetSha, value.recovery.authorizationId, { identifier: 'owner', password: 'secret' }, value.dependencies), /DB3_VERIFIED_RESTORE_READY_BACKUP_REQUIRED/)
}

// Execute the stopped-runtime bootstrap and the real PowerShell recovery orchestrator against disposable fixtures.
const repositoryRoot = resolve('.')
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
const startupRecord = (state, detail, recordedAt) => JSON.stringify({ version: 'andalucia-guarded-startup-v1', recordedAt, state, detail })
const integrationFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'andalucia-stopped-recovery-integration-'))
  await mkdir(join(root, 'server'), { recursive: true })
  await mkdir(join(root, 'deployment', 'windows'), { recursive: true })
  await cp(join(repositoryRoot, 'server', 'database-operation-coordinator.ts'), join(root, 'server', 'database-operation-coordinator.ts'))
  await cp(join(repositoryRoot, 'server', 'requested-backup-activation-control.ts'), join(root, 'server', 'requested-backup-activation-control.ts'))
  await cp(join(repositoryRoot, 'deployment', 'windows', 'Start-AndaluciaGuardedApplication.ps1'), join(root, 'deployment', 'windows', 'Start-AndaluciaGuardedApplication.ps1'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: { 'dev:canonical': 'node -e "setInterval(()=>{},1000)"' } }))
  await writeFile(join(root, '.gitignore'), 'node_modules\n.data\n.runtime\n.backups\nresolver-*.ps1\norchestrator-*.ps1\n')
  git(root, 'init'); git(root, 'config', 'user.email', 'security-test@example.invalid'); git(root, 'config', 'user.name', 'Security Test')
  git(root, 'add', '.'); git(root, 'commit', '-m', 'previous healthy source')
  const previous = git(root, 'rev-parse', 'HEAD').toLowerCase()
  await writeFile(join(root, 'target.txt'), 'target')
  git(root, 'add', 'target.txt'); git(root, 'commit', '-m', 'approved target source')
  const target = git(root, 'rev-parse', 'HEAD').toLowerCase()
  const branch = git(root, 'branch', '--show-current')
  const storeId = 'disposable-store-security-test'
  const dataDirectory = join(root, '.data', 'postgres')
  await mkdir(dataDirectory, { recursive: true })
  await mkdir(join(root, '.runtime', 'logs'), { recursive: true })
  await mkdir(join(root, '.backups', '.db2', 'requests'), { recursive: true })
  await mkdir(join(root, '.backups', 'verified-fixture'), { recursive: true })
  await writeFile(join(root, '.data', 'andalucia-store-identity.json'), JSON.stringify({ role: 'canonical', databaseDirectory: dataDirectory, storeId }))
  await writeFile(join(root, '.runtime', 'andalucia-local-ui-approval.json'), JSON.stringify({ activeSourceSha: target, previousLiveSha: previous, branch, mode: 'approved_local_reviewed_ui_checkpoint', controlCommitSha: target }))
  await writeFile(join(root, '.runtime', 'logs', 'guarded-startup.jsonl'), '\ufeff' + [
    startupRecord('SOURCE_APPROVED', `sha=${previous};branch=${branch};mode=approved_local_reviewed_ui_checkpoint`, '2026-11-05T18:49:34.5950882Z'),
    startupRecord('EXITED', 'exitCode=0', '2026-11-05T21:00:09.0784484Z'),
  ].join('\n') + '\n')
  const pending = { ...request, id: `request-${target.slice(0, 8)}` }
  await writeFile(join(root, '.backups', '.db2', 'requests', `${pending.id}.json`), JSON.stringify(pending))
  await writeFile(join(root, '.backups', '.db2', 'audit.jsonl'), JSON.stringify({ action: 'manual_backup_requested', actor: { source: 'authenticated_user', ...pending.requestedBy }, details: { requestId: pending.id } }) + '\n')
  await writeFile(join(root, '.backups', 'verified-fixture', 'backup-metadata.json'), JSON.stringify({ schemaVersion: '027', verificationStatus: 'VERIFIED', openTestStatus: 'PASS', preflightStatus: 'READY' }))
  await writeFile(join(root, '.backups', 'verified-fixture', 'restore-test.json'), JSON.stringify({ status: 'RESTORE_TEST_PASSED', manifestMatch: true, fingerprintMatch: true, migrationMatch: true, preflightStatus: 'READY' }))
  const nodeModulesRoot = [join(repositoryRoot, 'node_modules'), resolve(repositoryRoot, '..', '..', 'node_modules')].find(existsSync)
  assert.ok(nodeModulesRoot, 'Disposable recovery fixture requires the repository dependency directory')
  await symlink(nodeModulesRoot, join(root, 'node_modules'), 'junction')
  return { root, previous, target, pending }
}

const prepareStopped = async (value, overrides = {}) => runRequestedBackupActivationControl('prepare-stopped-recovery', ['node', 'control', '--project-root', value.root, '--request-id', value.pending.id], { portsClosed: async () => true, ...overrides })
const runResolver = async (value, sourceRoot, authorizationId) => {
  const wrapper = join(value.root, `resolver-${authorizationId || 'ordinary'}-${sourceRoot.endsWith(value.target) ? 'target' : 'source'}.ps1`)
  const resolverPath = join(repositoryRoot, 'deployment', 'windows', 'Resolve-AndaluciaApprovedSource.ps1').replaceAll("'", "''")
  const canonicalArgument = authorizationId ? ` -CanonicalProjectRoot '${value.root.replaceAll("'", "''")}' -RecoveryAuthorizationId '${authorizationId}'` : ''
  await writeFile(wrapper, `$ErrorActionPreference='Stop'\n. '${resolverPath}'\n$result = Get-AndaluciaApprovedSourceState -ProjectRoot '${sourceRoot.replaceAll("'", "''")}'${canonicalArgument}\n$result | ConvertTo-Json -Compress\n`)
  return spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', wrapper], { encoding: 'utf8' })
}

// Valid stopped-runtime authorization is independently derived from protected request, audit, runtime and backup evidence.
{
  const value = await integrationFixture()
  const authorization = await prepareStopped(value)
  assert.equal(authorization.state, 'RECOVERY_AUTHORIZED')
  assert.equal(authorization.authorizationMode, 'stopped_runtime_recovery')
  assert.equal(authorization.previousLiveSha, value.previous)
}

// Ordinary branches remain supported, while detached HEAD is accepted only with a journal-bound recovery claim.
{
  const value = await integrationFixture()
  git(value.root, 'branch', '-M', 'main')
  git(value.root, 'update-ref', 'refs/remotes/origin/main', value.target)
  const result = await runResolver(value, value.root)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(JSON.parse(result.stdout).Mode, 'verified_main')
}
{
  const value = await integrationFixture()
  git(value.root, 'update-ref', 'refs/remotes/origin/main', value.target)
  const sourceRoot = join(value.root, '.runtime', 'detached-without-authorization')
  await mkdir(join(value.root, '.runtime'), { recursive: true })
  git(value.root, 'worktree', 'add', '--detach', sourceRoot, value.previous)
  const result = await runResolver(value, sourceRoot)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /ANDALUCIA_RUNTIME_SOURCE_BRANCH_NOT_APPROVED/)
  assert.doesNotMatch(result.stderr, /null-valued expression/)
}
{
  const value = await integrationFixture()
  const authorization = await prepareStopped(value)
  await runRequestedBackupActivationControl('claim-recovery', ['node', 'control', '--project-root', value.root, '--authorization-id', authorization.authorizationId])
  const sourceRoot = join(value.root, '.runtime', 'detached-recovery-source')
  await mkdir(join(value.root, '.runtime'), { recursive: true })
  git(value.root, 'worktree', 'add', '--detach', sourceRoot, value.previous)
  const result = await runResolver(value, sourceRoot, authorization.authorizationId)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const resolved = JSON.parse(result.stdout)
  assert.equal(resolved.Sha, value.previous)
  assert.equal(resolved.Mode, 'approved_journal_bound_recovery')
}
{
  const value = await integrationFixture()
  const authorization = await prepareStopped(value)
  await runRequestedBackupActivationControl('claim-recovery', ['node', 'control', '--project-root', value.root, '--authorization-id', authorization.authorizationId])
  const sourceRoot = join(value.root, '.runtime', 'detached-mismatched-source')
  await mkdir(join(value.root, '.runtime'), { recursive: true })
  git(value.root, 'worktree', 'add', '--detach', sourceRoot, value.target)
  const result = await runResolver(value, sourceRoot, authorization.authorizationId)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /ANDALUCIA_RECOVERY_SOURCE_NOT_AUTHORIZED|REQUESTED_BACKUP_RECOVERY_SOURCE_SHA_MISMATCH/)
}

// Canonical state/detail evidence rejects malformed, reordered, and incomplete lifecycles.
{
  const cases = [
    value => [startupRecord('SOURCE_APPROVED', `sha=${value.previous.slice(0, -1)};branch=${git(value.root, 'branch', '--show-current')};mode=approved_local_reviewed_ui_checkpoint`, '2026-11-05T18:49:34.5950882Z'), startupRecord('EXITED', 'exitCode=0', '2026-11-05T21:00:09.0784484Z')],
    value => [startupRecord('EXITED', 'exitCode=0', '2026-11-05T18:49:34.5950882Z'), startupRecord('SOURCE_APPROVED', `sha=${value.previous};branch=${git(value.root, 'branch', '--show-current')};mode=approved_local_reviewed_ui_checkpoint`, '2026-11-05T21:00:09.0784484Z')],
    value => [startupRecord('SOURCE_APPROVED', `sha=${value.previous};branch=${git(value.root, 'branch', '--show-current')};mode=approved_local_reviewed_ui_checkpoint`, '2026-11-05T18:49:34.5950882Z')],
  ]
  for (const records of cases) {
    const value = await integrationFixture()
    await writeFile(join(value.root, '.runtime', 'logs', 'guarded-startup.jsonl'), records(value).join('\n') + '\n')
    await assert.rejects(() => prepareStopped(value), /REQUESTED_BACKUP_HISTORICAL_RUNTIME_EVIDENCE_INVALID/)
  }
}

// Missing trusted authorization and altered protected bindings fail closed.
{
  const value = await integrationFixture()
  await unlink(join(value.root, '.backups', '.db2', 'audit.jsonl'))
  await assert.rejects(() => prepareStopped(value), /REQUESTED_BACKUP_AUTHENTICATED_REQUEST_INVALID/)
}
{
  const value = await integrationFixture()
  const authorization = await prepareStopped(value)
  const approvalPath = join(value.root, '.runtime', 'andalucia-local-ui-approval.json')
  const approval = JSON.parse(await readFile(approvalPath, 'utf8')); approval.previousLiveSha = 'f'.repeat(40)
  await writeFile(approvalPath, JSON.stringify(approval))
  await assert.rejects(() => runRequestedBackupActivationControl('claim-recovery', ['node', 'control', '--project-root', value.root, '--authorization-id', authorization.authorizationId]), /REQUESTED_BACKUP_PROTECTED_BINDING_MISMATCH/)
}

// Concurrent claims permit exactly one recovery; deleted authorization cannot be recreated from the same request.
{
  const value = await integrationFixture()
  const authorization = await prepareStopped(value)
  const args = ['node', 'control', '--project-root', value.root, '--authorization-id', authorization.authorizationId]
  const claims = await Promise.allSettled([runRequestedBackupActivationControl('claim-recovery', args), runRequestedBackupActivationControl('claim-recovery', args)])
  assert.equal(claims.filter(item => item.status === 'fulfilled').length, 1)
  await unlink(join(value.root, '.backups', '.db2', 'operations', 'maintenance', `${authorization.authorizationId}.json`))
  await assert.rejects(() => prepareStopped(value), /CANONICAL_MAINTENANCE_REQUEST_ALREADY_AUTHORIZED/)
}

// The real PowerShell orchestrator consumes a valid claim and records success/failure without starting a canonical runtime.
const runOrchestrator = async (mode) => {
  const value = await integrationFixture()
  const authorization = await prepareStopped(value)
  const wrapper = join(value.root, `orchestrator-${mode}.ps1`)
  const orchestrationPath = join(repositoryRoot, 'deployment', 'windows', 'Invoke-AndaluciaRequestedBackupUiActivation.ps1').replaceAll("'", "''")
  const success = mode === 'success'
  await writeFile(wrapper, `$ErrorActionPreference='Stop'\nfunction Start-Process { [pscustomobject]@{ HasExited = $${success ? 'false' : 'true'} } }\nfunction Start-Sleep {}\nfunction Invoke-RestMethod { ${success ? `[pscustomobject]@{ ok=$true; application=[pscustomobject]@{ sha='${value.previous}' }; database=[pscustomobject]@{ status='HEALTHY'; migrationVersion='027'; migrationRequired=$false; recoveryRequired=$false } }` : `throw 'simulated restart failure'`} }\nfunction Invoke-WebRequest { [pscustomobject]@{ StatusCode=200 } }\n& '${orchestrationPath}' -ExpectedSha '${value.target}' -RepositoryRoot '${value.root.replaceAll("'", "''")}' -StoppedRuntimeRecoveryAuthorizationId '${authorization.authorizationId}'\n`)
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', wrapper], { encoding: 'utf8' })
  const coordinator = new DatabaseOperationCoordinator(join(value.root, '.backups', '.db2', 'operations'))
  const record = await coordinator.readCanonicalMaintenanceAuthorization(authorization.authorizationId)
  return { result, record }
}
{
  const { result, record } = await runOrchestrator('success')
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(record.state, 'RECOVERY_HEALTHY')
}
{
  const { result, record } = await runOrchestrator('failure')
  assert.notEqual(result.status, 0)
  assert.equal(record.state, 'RECOVERY_FAILED')
}

console.log(JSON.stringify({ status: 'PASS', suite: 'requested-backup-activation-security', behavioralCases: 26, sourceSuccessorCases: 6, executablePowerShellRecoveryCases: 2, productionDataTouched: false }, null, 2))
