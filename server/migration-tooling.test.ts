import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { liveStore, migrationStatus, requireMigrationDataDirectory, runMigrations } from './migration-store.js'
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
  const fresh = new PGlite(path); await fresh.exec(await readFile('database/schema.sql', 'utf8')); await fresh.close()
  const incompatible = new StaffRepository(path)
  await assert.rejects(incompatible.assertCompatibleSchema(), /DATABASE_MIGRATION_REQUIRED/)
  await runMigrations(incompatible.getDatabase())
  await incompatible.assertCompatibleSchema()
  await incompatible.getDatabase().close()
} finally { await rm(folder, { recursive: true, force: true }) }
console.log('migration tooling guards, transactional rollback, and runtime compatibility checks passed')
