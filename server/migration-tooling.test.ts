import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { liveStore, migrationStatus, requireMigrationDataDirectory, reviewedMigrationSet, runMigrations } from './migration-store.js'
import { StaffRepository } from './staff-repository.js'

const previous = process.env.ANDALUCIA_MIGRATION_DATA_DIR
delete process.env.ANDALUCIA_MIGRATION_DATA_DIR
assert.throws(requireMigrationDataDirectory, /MIGRATION_DATA_DIR_REQUIRED/)
process.env.ANDALUCIA_MIGRATION_DATA_DIR = liveStore
assert.throws(requireMigrationDataDirectory, /LIVE_STORE_MIGRATION_FORBIDDEN_WITHOUT_EXPLICIT_AUTHORIZATION/)
if (previous === undefined) delete process.env.ANDALUCIA_MIGRATION_DATA_DIR
else process.env.ANDALUCIA_MIGRATION_DATA_DIR = previous

const db = new PGlite()
await db.exec('create table staff(id uuid primary key); create table configuration_options(id uuid primary key); create table chargeable_item_records(id uuid primary key);')
await assert.rejects(runMigrations(db, { simulateFailureVersion: '002' }), /SIMULATED_MIGRATION_FAILURE:002/)
const status = await migrationStatus(db)
assert.equal(status.migrations.find(item => item.version === '001')?.state, 'applied')
assert.equal(status.migrations.find(item => item.version === '002')?.state, 'pending')
assert.equal((await db.query<{ exists: boolean }>("select exists(select 1 from information_schema.tables where table_name='user_accounts') exists")).rows[0]?.exists, false)
await db.close()

const folder = await mkdtemp(join(tmpdir(), 'andalucia-runtime-compatibility-'))
try {
  const path = join(folder, 'postgres')
  const fresh = new PGlite(path)
  try {
    const historicalMigration009Checksum = '4c01120934e27e5392561404f73118eff8716e5ae705c4f785afb2a8f8c40d04'
    const reviewed009 = (await reviewedMigrationSet()).versions.find(item => item.version === '009')
    assert.equal(reviewed009?.source, 'code:foundation-reference-data')
    assert.equal(reviewed009?.checksum, historicalMigration009Checksum)
    await fresh.exec(await readFile('database/schema.sql', 'utf8'))
    const incompatible = new StaffRepository(path, fresh)
    await assert.rejects(incompatible.assertCompatibleSchema(), /DATABASE_MIGRATION_REQUIRED/)
    await runMigrations(incompatible.getDatabase())
    await incompatible.assertCompatibleSchema()
    const applied009 = (await migrationStatus(fresh)).migrations.find(item => item.version === '009')
    assert.equal(applied009?.checksum, historicalMigration009Checksum)
    assert.equal(applied009?.checksumMatches, true)
    await runMigrations(fresh)
    await fresh.query("update schema_migrations set checksum='altered-migration-009' where version='009'")
    await assert.rejects(runMigrations(fresh), /MIGRATION_CHECKSUM_MISMATCH:009/)
  } finally { await fresh.close() }
} finally { await rm(folder, { recursive: true, force: true }) }
console.log('migration tooling guards, transactional rollback, and runtime compatibility checks passed')
