import { isAbsolute, resolve } from 'node:path'
import { prepareLiveMigration } from './migration-live-gate.js'
import { liveStore } from './migration-store.js'

const configured = process.env.ANDALUCIA_MIGRATION_DATA_DIR?.trim()
if (!configured || !isAbsolute(configured)) throw new Error('MIGRATION_DATA_DIR_REQUIRED')
if (resolve(configured).replaceAll('\\', '/').toLowerCase() !== liveStore.replaceAll('\\', '/').toLowerCase()) throw new Error('LIVE_MIGRATION_TARGET_PATH_MISMATCH')
const result = await prepareLiveMigration({ sourceDirectory: configured })
console.log(JSON.stringify({ artifactPath: result.artifactPath, backupDirectory: result.artifact.backupDirectory, sourceManifest: result.artifact.sourceManifestAtBackup.aggregateSha256, backupManifest: result.artifact.backupManifest.aggregateSha256, sourceFingerprint: result.artifact.sourceFingerprintDigest, preflight: result.artifact.preflightStatus, migrationVersions: result.artifact.migrationSet.versions.map(item => item.version) }, null, 2))
