import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { createStoreIdentity, developmentStoreDirectory } from './database-protection.js'
import { runMigrations } from './migration-store.js'

if (existsSync(developmentStoreDirectory)) throw new Error('DEVELOPMENT_STORE_ALREADY_EXISTS')

await mkdir(dirname(developmentStoreDirectory), { recursive: true })
const database = new PGlite(developmentStoreDirectory)
try {
  await database.exec(await readFile('database/schema.sql', 'utf8'))
  const migration = await runMigrations(database)
  const latest = migration.status.migrations.filter(item => item.state === 'applied').at(-1)?.version || 'none'
  if (latest !== '018') throw new Error(`DEVELOPMENT_STORE_SCHEMA_INCOMPLETE:${latest}`)
} finally { await database.close() }

const identity = await createStoreIdentity(developmentStoreDirectory, 'development', { storeId: 'andalucia-development-local' })
console.log(JSON.stringify({ initialized: true, dataDirectory: developmentStoreDirectory, role: identity.role, storeId: identity.storeId, operationalRowsCopied: 0 }, null, 2))
