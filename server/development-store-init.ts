import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { createStoreIdentity, developmentStoreDirectory } from './database-protection.js'
import { reviewedMigrationSet } from './migration-store.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const initializeDevelopmentStore = async (directoryInput = developmentStoreDirectory) => {
  const directory = resolve(directoryInput)
  await mkdir(dirname(directory), { recursive: true })
  const database = new PGlite(directory)
  try {
    await database.exec(await readFile(resolve(projectRoot, 'database', 'schema.sql'), 'utf8'))
    await database.exec(await readFile(resolve(projectRoot, 'database', 'migrations', '001_schema_migrations.sql'), 'utf8'))
    for (const migration of (await reviewedMigrationSet()).versions) {
      await database.query("insert into schema_migrations(version,name,checksum,status,actor_source,notes) values($1,$2,$3,'applied','development-store-init','schema/reference initialization only') on conflict (version) do nothing", [migration.version, migration.name, migration.checksum])
    }
  } finally { await database.close() }
  const identity = await createStoreIdentity(directory, 'development')
  return { directory, identity }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await initializeDevelopmentStore()
  console.log(JSON.stringify({ state: 'DEVELOPMENT_STORE_READY', directory: result.directory, storeId: result.identity.storeId, role: result.identity.role }, null, 2))
}
