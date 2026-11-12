import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { resolveRuntimeSchemaActivation } from './runtime-schema-activation-control.js'
import { requireApprovedMigrationSource } from './migration-live-gate.js'

const testRoot = resolve('.tmp-tests')
await mkdir(testRoot, { recursive: true })
const root = await mkdtemp(join(testRoot, 'schema-028-activation-'))
const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
const write = async (path: string, value: unknown) => { await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(value, null, 2), 'utf8') }
try {
  git('init'); git('config', 'user.email', 'schema-test@andalucia.invalid'); git('config', 'user.name', 'Schema Test')
  await writeFile(join(root, 'README.md'), 'schema activation fixture', 'utf8'); git('add', 'README.md'); git('commit', '-m', 'migration source')
  const migrationSourceSha = git('rev-parse', 'HEAD').toLowerCase()
  await mkdir(join(root, 'server'), { recursive: true })
  for (const path of ['runtime-schema-activation-control.ts', 'schema-028-activation-control.test.ts', 'schema-028-migration-activation-bridge.test.ts']) await writeFile(join(root, 'server', path), 'reviewed activation correction', 'utf8')
  git('add', 'server'); git('commit', '-m', 'reviewed activation correction')
  const sourceSha = git('rev-parse', 'HEAD').toLowerCase(); git('update-ref', 'refs/remotes/origin/main', sourceSha)
  const canonical = join(root, '.data', 'postgres'); await mkdir(canonical, { recursive: true })
  await write(join(root, '.data', 'andalucia-store-identity.json'), { role: 'canonical', storeId: 'andalucia-canonical-live', databaseDirectory: canonical, outletScopeId: '00000000-0000-4000-8000-00000000a001' })
  assert.deepEqual(await resolveRuntimeSchemaActivation(root, sourceSha), { requiredSchemaVersion: '027', mode: 'pre-migration', approvedSourceSha: sourceSha })

  const backupId = 'andalucia-pre-migration-schema-028-test'; const folder = join(root, '.backups', backupId)
  const targetChecksum = 'a'.repeat(64)
  const ledger = { migrations: [{ version: '027', state: 'applied', checksumMatches: true }, { version: '028', state: 'pending', checksum: targetChecksum, checksumMatches: null }] }
  const artifact = { artifactVersion: 'andalucia-live-migration-authorization-v2', id: 'authorization-028', state: 'consumed', approvedSourceSha: migrationSourceSha, sourceDirectory: canonical, canonicalStoreId: 'andalucia-canonical-live', outletScopeId: '00000000-0000-4000-8000-00000000a001', targetMigration: { version: '028', checksum: targetChecksum }, sourceMigrationLedger: ledger, protectedBackup: { backupId, pinned: true, restoreRehearsal: 'PASS' }, rehearsal: { status: 'PASS', rollbackSchema: '027', migratedSchema: '028' }, consumedPostMigrationFingerprint: 'post-028' }
  assert.doesNotThrow(() => requireApprovedMigrationSource({ ...artifact, approvedSourceSha: sourceSha } as any, sourceSha))
  assert.throws(() => requireApprovedMigrationSource({ ...artifact, approvedSourceSha: sourceSha } as any, 'f'.repeat(40)), /LIVE_MIGRATION_APPROVED_SOURCE_MISMATCH/)
  const metadata = { backupId, schemaVersion: '027', verificationStatus: 'VERIFIED', openTestStatus: 'PASS', preflightStatus: 'READY' }
  const restore = { backupId, status: 'RESTORE_TEST_PASSED', manifestMatch: true, fingerprintMatch: true, migrationMatch: true, preflightStatus: 'READY' }
  const result = { success: true, migration: { applied: ['028'] }, comparison: { preserved: true } }
  await write(join(folder, 'live-migration-authorization.json'), artifact); await write(join(folder, 'backup-metadata.json'), metadata); await write(join(folder, 'restore-test.json'), restore); await write(join(folder, 'migration-result.json'), result); await write(join(folder, 'migration-after-fingerprint.json'), { digest: 'post-028' })
  const valid = await resolveRuntimeSchemaActivation(root, sourceSha); assert.equal(valid.requiredSchemaVersion, '028'); assert.equal(valid.mode, 'approved-027-to-028')

  await write(join(folder, 'live-migration-authorization.json'), { ...artifact, state: 'prepared' })
  await assert.rejects(resolveRuntimeSchemaActivation(root, sourceSha), /SCHEMA_ACTIVATION_MIGRATION_INCOMPLETE/)
  await write(join(folder, 'live-migration-authorization.json'), { ...artifact, approvedSourceSha: 'invalid' })
  await assert.rejects(resolveRuntimeSchemaActivation(root, sourceSha), /SCHEMA_ACTIVATION_AUTHORIZATION_BINDING_INVALID/)
  await write(join(folder, 'live-migration-authorization.json'), { ...artifact, approvedSourceSha: '0'.repeat(40) })
  await assert.rejects(resolveRuntimeSchemaActivation(root, sourceSha), /SCHEMA_ACTIVATION_SOURCE_SUCCESSOR_INVALID/)
  await write(join(folder, 'live-migration-authorization.json'), artifact); await write(join(folder, 'backup-metadata.json'), { ...metadata, verificationStatus: 'FAILED' })
  await assert.rejects(resolveRuntimeSchemaActivation(root, sourceSha), /SCHEMA_ACTIVATION_BACKUP_EVIDENCE_INVALID/)
  await write(join(folder, 'backup-metadata.json'), metadata); await write(join(folder, 'restore-test.json'), { ...restore, fingerprintMatch: false })
  await assert.rejects(resolveRuntimeSchemaActivation(root, sourceSha), /SCHEMA_ACTIVATION_RESTORE_EVIDENCE_INVALID/)
  await write(join(folder, 'restore-test.json'), restore); await write(join(folder, 'migration-result.json'), { ...result, success: false })
  await assert.rejects(resolveRuntimeSchemaActivation(root, sourceSha), /SCHEMA_ACTIVATION_MIGRATION_RESULT_INVALID/)
  await write(join(folder, 'migration-result.json'), result); await write(join(folder, 'live-migration-authorization.json'), { ...artifact, sourceMigrationLedger: { migrations: [{ version: '027', state: 'applied', checksumMatches: true }, { version: '028', state: 'pending', checksum: targetChecksum, checksumMatches: true }] } })
  await assert.rejects(resolveRuntimeSchemaActivation(root, sourceSha), /SCHEMA_ACTIVATION_TRANSITION_INVALID/)
  await write(join(folder, 'live-migration-authorization.json'), { ...artifact, sourceMigrationLedger: { migrations: [{ version: '027', state: 'applied', checksumMatches: true }, { version: '028', state: 'pending', checksum: 'b'.repeat(64), checksumMatches: null }] } })
  await assert.rejects(resolveRuntimeSchemaActivation(root, sourceSha), /SCHEMA_ACTIVATION_TRANSITION_INVALID/)
  await write(join(folder, 'migration-result.json'), result); await write(join(folder, 'live-migration-authorization.json'), { ...artifact, targetMigration: { version: '029' } })
  await assert.rejects(resolveRuntimeSchemaActivation(root, sourceSha), /SCHEMA_ACTIVATION_VERSION_UNSUPPORTED/)
  await write(join(folder, 'live-migration-authorization.json'), artifact)
  await assert.rejects(resolveRuntimeSchemaActivation(root, 'f'.repeat(40)), /SCHEMA_ACTIVATION_SOURCE_MISMATCH/)
  await mkdir(join(root, 'src'), { recursive: true }); await writeFile(join(root, 'src', 'unrelated.ts'), 'unreviewed successor', 'utf8'); git('add', 'src'); git('commit', '-m', 'unreviewed successor')
  const unrelatedSha = git('rev-parse', 'HEAD').toLowerCase(); git('update-ref', 'refs/remotes/origin/main', unrelatedSha)
  await assert.rejects(resolveRuntimeSchemaActivation(root, unrelatedSha), /SCHEMA_ACTIVATION_SOURCE_SUCCESSOR_INVALID/)

  const launcher = await readFile('deployment/windows/Start-AndaluciaGuardedApplication.ps1', 'utf8'); const preflight = await readFile('deployment/windows/Test-AndaluciaGuardedUiActivation.ps1', 'utf8'); const activation = await readFile('deployment/windows/Invoke-AndaluciaApprovedUiActivation.ps1', 'utf8'); const scheduler = await readFile('deployment/windows/Install-AndaluciaDatabaseScheduler.ps1', 'utf8'); const prepare = await readFile('server/schema-028-prepare-live.ts', 'utf8')
  assert.match(launcher, /runtime-schema-activation-control\.ts/); assert.match(launcher, /RecoveryAuthorizationId[\s\S]*ANDALUCIA_REQUIRED_SCHEMA_VERSION = '027'/); assert.doesNotMatch(launcher, /if \(-not \$env:ANDALUCIA_REQUIRED_SCHEMA_VERSION\).*'027'/)
  assert.match(preflight, /targetSchema[\s\S]*'027'[\s\S]*'028'/); assert.match(activation, /migrationVersion -eq \$preflight\.targetSchema/); assert.doesNotMatch(scheduler, /ANDALUCIA_REQUIRED_SCHEMA_VERSION/)
  assert.match(prepare, /1ce391e1c705ea4f014d7e903bc367ebf0f1eab7/); assert.match(prepare, /merge-base[\s\S]*--is-ancestor/)
  console.log(JSON.stringify({ schema027BeforeMigration: true, schema028AfterConsumedAuthorization: true, reviewedActivationSuccessorAllowed: true, unrelatedSuccessorRejected: true, exactSourceRequired: true, canonicalIdentityRequired: true, verifiedBackupRequired: true, restoreRehearsalRequired: true, failedMigrationRejected: true, unsupportedVersionRejected: true, recoveryPinnedTo027: true, schedulerUnchanged: true }, null, 2))
} finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
