import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { createStoreIdentity, developmentStoreDirectory, SUPPORTED_SCHEMA_VERSION } from './database-protection.js'
import { runMigrations } from './migration-store.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const initializeDevelopmentStore = async (directoryInput = developmentStoreDirectory) => {
  const directory = resolve(directoryInput)
  if (existsSync(directory)) throw new Error('DEVELOPMENT_STORE_ALREADY_EXISTS')
  await mkdir(dirname(directory), { recursive: true })
  const database = new PGlite(directory)
  let migration: Awaited<ReturnType<typeof runMigrations>>
  try {
    await database.exec(await readFile(resolve(projectRoot, 'database', 'schema.sql'), 'utf8'))
    migration = await runMigrations(database)
    const latest = migration.status.migrations.filter(item => item.state === 'applied').at(-1)?.version || 'none'
    if (latest !== SUPPORTED_SCHEMA_VERSION) throw new Error(`DEVELOPMENT_STORE_SCHEMA_INCOMPLETE:${latest}`)
  } finally { await database.close() }
  const identity = await createStoreIdentity(directory, 'development', { storeId: 'andalucia-development-local' })
  return { directory, identity, migration }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await initializeDevelopmentStore()
  console.log(JSON.stringify({ state: 'DEVELOPMENT_STORE_READY', initialized: true, dataDirectory: result.directory, role: result.identity.role, storeId: result.identity.storeId, operationalRowsCopied: 0 }, null, 2))
}
