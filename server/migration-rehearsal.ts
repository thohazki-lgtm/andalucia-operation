import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { artifactDirectoryFor, liveStore, writeArtifact } from './migration-store.js'
import { copyStoreVerified } from './migration-filesystem.js'

const configured = process.env.ANDALUCIA_MIGRATION_DATA_DIR?.trim()
if (!configured) throw new Error('ANDALUCIA_MIGRATION_DATA_DIR_REQUIRED')
if (!isAbsolute(configured)) throw new Error('ANDALUCIA_MIGRATION_DATA_DIR_MUST_BE_ABSOLUTE')
const destination = resolve(configured)
const allowedRoot = `${resolve('.tmp').replaceAll('\\', '/').toLowerCase()}/`
const source = process.env.ANDALUCIA_REHEARSAL_SOURCE_DIR ? resolve(process.env.ANDALUCIA_REHEARSAL_SOURCE_DIR) : liveStore
if (process.env.ANDALUCIA_REHEARSAL_SOURCE_DIR && !source.replaceAll('\\', '/').toLowerCase().startsWith(allowedRoot)) throw new Error('ISOLATED_REHEARSAL_SOURCE_MUST_BE_UNDER_PROJECT_TMP')
if (!destination.replaceAll('\\', '/').toLowerCase().startsWith(allowedRoot)) throw new Error('REHEARSAL_DESTINATION_MUST_BE_UNDER_PROJECT_TMP')
if (destination === liveStore) throw new Error('LIVE_STORE_MIGRATION_FORBIDDEN_IN_REHEARSAL_STAGE')
if (!existsSync(join(source, 'PG_VERSION'))) throw new Error('REHEARSAL_SOURCE_STORE_NOT_FOUND')
if (existsSync(destination)) throw new Error('REHEARSAL_DESTINATION_ALREADY_EXISTS')
await mkdir(dirname(destination), { recursive: true })
const artifacts = artifactDirectoryFor(destination)
const { sourceManifest, backupManifest: rehearsalManifest } = await copyStoreVerified(source, destination)
await writeArtifact(artifacts, 'source-manifest.json', sourceManifest); await writeArtifact(artifacts, 'rehearsal-manifest.json', rehearsalManifest)
console.log(JSON.stringify({ source, rehearsal: destination, artifacts, files: sourceManifest.files, bytes: sourceManifest.bytes, aggregateSha256: sourceManifest.aggregateSha256, verified: true }, null, 2))
