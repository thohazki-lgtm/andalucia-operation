import { PGlite } from '@electric-sql/pglite'
import { artifactDirectoryFor, createMigrationFingerprint, requireMigrationDataDirectory, writeArtifact } from './migration-store.js'

const output = process.argv[2] || 'migration-current-fingerprint.json'
if (!/^migration-[a-z-]+-fingerprint\.json$/.test(output)) throw new Error('MIGRATION_FINGERPRINT_OUTPUT_NAME_INVALID')
const dataDirectory = requireMigrationDataDirectory()
const db = new PGlite(dataDirectory)
try {
  const fingerprint = await createMigrationFingerprint(db)
  await writeArtifact(artifactDirectoryFor(dataDirectory), output, fingerprint)
  console.log(JSON.stringify({ dataDirectory, output, digest: fingerprint.digest, tables: fingerprint.schemaObjects.length }, null, 2))
} finally { await db.close() }
