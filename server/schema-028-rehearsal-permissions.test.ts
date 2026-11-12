import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { setBackupOriginalFilesystemProtection } from './database-backup.js'
import { copyStoreVerified, createStoreManifest, makeDisposableStoreWritable, manifestsMatch } from './migration-filesystem.js'

const root = await mkdtemp(join(tmpdir(), 'andalucia-schema-028-permissions-'))
const protectedBackup = join(root, 'protected-backup', 'postgres')
const workspace = join(root, 'disposable-workspace')
const rehearsal = join(workspace, 'rehearsal', 'postgres')
try {
  await mkdir(join(root, 'protected-backup'), { recursive: true })
  const db = new PGlite(protectedBackup); await db.query('create table rehearsal_fixture(id integer primary key, value text not null)'); await db.query("insert into rehearsal_fixture values (1, 'preserved')"); await db.close()
  const protectedManifest = await createStoreManifest(protectedBackup)
  await setBackupOriginalFilesystemProtection(protectedBackup, true)
  await copyStoreVerified(protectedBackup, rehearsal)
  await makeDisposableStoreWritable(rehearsal, workspace, [protectedBackup])
  const opened = new PGlite(rehearsal); assert.equal((await opened.query<{ value: string }>('select value from rehearsal_fixture')).rows[0].value, 'preserved'); await opened.query("insert into rehearsal_fixture values (2, 'writable')"); await opened.close()
  assert.equal(manifestsMatch(protectedManifest, await createStoreManifest(protectedBackup)), true)
  assert.equal(Boolean((await stat(join(protectedBackup, 'PG_VERSION'))).mode & 0o222), false)
  assert.equal(Boolean((await stat(join(rehearsal, 'PG_VERSION'))).mode & 0o200), true)
  await assert.rejects(makeDisposableStoreWritable(protectedBackup, workspace, [protectedBackup]), /OUTSIDE_WORKSPACE|OVERLAPS_PROTECTED_PATH/)
  await assert.rejects(makeDisposableStoreWritable(rehearsal, rehearsal, [protectedBackup]), /OUTSIDE_WORKSPACE/)
  await assert.rejects(makeDisposableStoreWritable(join(root, 'missing', 'postgres'), root, [protectedBackup]), /NOT_FOUND/)
  assert.equal((await readFile(join(protectedBackup, 'PG_VERSION'), 'utf8')).trim().length > 0, true)
  console.log(JSON.stringify({ disposableCopyWritable: true, protectedBackupImmutable: true, databaseOpenPassed: true, cleanShutdownPassed: true, unsafePathRejected: true, missingRestoreRejected: true }, null, 2))
} finally {
  await setBackupOriginalFilesystemProtection(root, false).catch(() => undefined)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
}
