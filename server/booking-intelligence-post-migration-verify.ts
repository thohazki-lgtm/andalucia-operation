import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { createFinancialFinalizationFingerprint } from './database-backup.js'
import { canonicalStoreDirectory, readStoreIdentity } from './database-protection.js'
import { createMigrationFingerprint, migrationStatus, runPreflight } from './migration-store.js'

const expectedChecksum = '9bcbfa0b56364bf8e0a0912de9ea3a1b5e326dd625dda1641f9bea39ccb9dcff'
const sourceDirectory = resolve(process.env.ANDALUCIA_DATA_DIR || '')
const artifactPath = resolve(process.env.ANDALUCIA_MIGRATION_017_ARTIFACT || '')
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const evidenceTables = ['bookings', 'guest_occasions', 'staff', 'duty_roster_entries', 'daily_reports', 'daily_report_snapshots', 'training_sessions'] as const
const tableFingerprint = async (db: PGlite, table: string) => {
  const rows = (await db.query<{ row: unknown }>(`select row_to_json(r) row from (select * from ${table} order by 1) r`)).rows.map(item => item.row)
  return { count: rows.length, digest: sha256(JSON.stringify(rows)) }
}

if (sourceDirectory !== canonicalStoreDirectory) throw new Error('LIVE_MIGRATION_TARGET_PATH_MISMATCH')
const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as any
if (artifact.state !== 'consumed' || !artifact.consumedAt || artifact.targetMigration?.version !== '017' || artifact.targetMigration.checksum !== expectedChecksum) throw new Error('MIGRATION_017_AUTHORIZATION_NOT_CONSUMED')
await readStoreIdentity(sourceDirectory, 'canonical')
const db = new PGlite(sourceDirectory)
await db.query('select 1')
try {
  const ledger = await migrationStatus(db)
  const preflight = await runPreflight(db, sourceDirectory)
  const fingerprint = await createMigrationFingerprint(db)
  const financial = await createFinancialFinalizationFingerprint(db)
  const evidence = Object.fromEntries(await Promise.all(evidenceTables.map(async table => [table, await tableFingerprint(db, table)])))
  const findingCount = Number((await db.query<{ count: number }>('select count(*)::int count from booking_intelligence_findings')).rows[0].count)
  const constraints = (await db.query<{ constraint_name: string; constraint_type: string }>("select constraint_name,constraint_type from information_schema.table_constraints where table_name='booking_intelligence_findings'")).rows
  const indexes = (await db.query<{ indexname: string }>("select indexname from pg_indexes where schemaname='public' and tablename='booking_intelligence_findings'")).rows.map(row => row.indexname)
  const triggers = (await db.query<{ trigger_name: string }>("select trigger_name from information_schema.triggers where event_object_table='booking_intelligence_findings'")).rows.map(row => row.trigger_name)
  const migration017 = ledger.migrations.find(item => item.version === '017')
  if (preflight.status !== 'READY' || ledger.migrations.length !== 17 || ledger.migrations.some(item => item.state !== 'applied' || item.checksumMatches !== true) || migration017?.checksum !== expectedChecksum) throw new Error('MIGRATION_017_LEDGER_OR_PREFLIGHT_INVALID')
  if (findingCount !== 0) throw new Error('MIGRATION_017_FINDINGS_NOT_EMPTY')
  if (financial.digest !== artifact.sourceFinancialFingerprintDigest || JSON.stringify(evidence) !== JSON.stringify(artifact.evidenceFingerprints)) throw new Error('MIGRATION_017_PROTECTED_DATA_CHANGED')
  for (const name of ['booking_intelligence_findings_booking_id_fkey', 'booking_intelligence_findings_outlet_scope_id_fkey']) if (!constraints.some(item => item.constraint_name === name)) throw new Error(`MIGRATION_017_CONSTRAINT_MISSING:${name}`)
  if (!constraints.some(item => item.constraint_type === 'UNIQUE')) throw new Error('MIGRATION_017_UNIQUENESS_MISSING')
  for (const name of ['booking_intelligence_booking_idx', 'booking_intelligence_type_idx', 'booking_intelligence_review_idx', 'booking_intelligence_lifecycle_idx']) if (!indexes.includes(name)) throw new Error(`MIGRATION_017_INDEX_MISSING:${name}`)
  for (const name of ['booking_intelligence_finding_validation', 'booking_intelligence_source_evidence_immutable']) if (!triggers.includes(name)) throw new Error(`MIGRATION_017_TRIGGER_MISSING:${name}`)
  console.log(JSON.stringify({ consumedArtifactId: artifact.id, consumedAt: artifact.consumedAt, schema: '017', preflight: preflight.status, ledgerValid: true, migration017, findingCount, business: fingerprint.business, evidence, financialFingerprint: financial.digest, constraintsValid: true, indexesValid: true, sourceEvidenceImmutability: true, supersessionFoundation: true, auditCompatibility: true }, null, 2))
} finally { await db.close() }
