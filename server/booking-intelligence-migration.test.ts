import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { validateOperationalCovers, type ProtectedZeroCoverEvidence } from './booking-cover-validation.js'
import { createFinancialFinalizationFingerprint } from './database-backup.js'
import { copyStoreVerified } from './migration-filesystem.js'
import { compareOperationalFingerprints, createMigrationFingerprint, migrationStatus, runMigrations, runPreflight } from './migration-store.js'

const sourceStore = process.env.ANDALUCIA_BOOKING_INTELLIGENCE_SOURCE_STORE
if (!sourceStore) throw new Error('ANDALUCIA_BOOKING_INTELLIGENCE_SOURCE_STORE_REQUIRED')

const root = await mkdtemp(join(resolve('.tmp'), 'booking-intelligence-migration-'))
const migratedPath = join(root, 'migrated', 'postgres')
const rollbackPath = join(root, 'rollback', 'postgres')
const preservedTables = [
  'bookings', 'booking_import_batches', 'booking_guest_members', 'guest_occasions',
  'daily_reports', 'daily_report_snapshots', 'weekly_report_commentary', 'monthly_report_inputs',
  'staff', 'duty_roster_entries', 'chargeable_item_records', 'wine_spirit_sales',
  'maintenance_issues', 'training_sessions'
]
const tableExists = async (db: PGlite, table: string) => Boolean((await db.query<{ present: boolean }>("select exists(select 1 from information_schema.tables where table_schema='public' and table_name=$1) present", [table])).rows[0]?.present)
const counts = async (db: PGlite) => Object.fromEntries(await Promise.all(preservedTables.map(async table => [table, await tableExists(db, table) ? Number((await db.query<{ count: number }>(`select count(*)::int count from ${table}`)).rows[0].count) : 0])))
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const contentDigests = async (db: PGlite) => Object.fromEntries(await Promise.all(preservedTables.map(async table => {
  if (!await tableExists(db, table)) return [table, sha256('[]')]
  const rows = (await db.query<{ row: unknown }>(`select row_to_json(r) row from (select * from ${table} order by 1) r`)).rows.map(item => item.row)
  return [table, sha256(JSON.stringify(rows))]
})))

try {
  const copied = await copyStoreVerified(sourceStore, migratedPath)
  assert.equal(copied.sourceManifest.aggregateSha256, copied.backupManifest.aggregateSha256)
  const db = new PGlite(migratedPath)
  await db.query('select 1')
  const before = await createMigrationFingerprint(db)
  const financialBefore = await createFinancialFinalizationFingerprint(db)
  const countsBefore = await counts(db)
  const contentBefore = await contentDigests(db)
  const pending = await migrationStatus(db)
  assert.equal(pending.migrations.find(item => item.version === '017')?.state, 'pending')

  const migrated = await runMigrations(db, { throughVersion: '017' })
  assert.deepEqual(migrated.applied, ['017'])
  const applied = await migrationStatus(db)
  const migration017 = applied.migrations.find(item => item.version === '017')
  assert.equal(migration017?.state, 'applied')
  assert.equal(migration017?.checksumMatches, true)
  assert.equal(applied.migrations.filter(item => item.version <= '017').every(item => item.state === 'applied' && item.checksumMatches === true), true)
  assert.equal((await runPreflight(db, migratedPath)).status, 'READY')
  assert.equal(Number((await db.query<{ count: number }>('select count(*)::int count from booking_intelligence_findings')).rows[0].count), 0)

  const after = await createMigrationFingerprint(db)
  const financialAfter = await createFinancialFinalizationFingerprint(db)
  assert.equal(compareOperationalFingerprints(before, after).preserved, true)
  assert.deepEqual(await counts(db), countsBefore)
  assert.deepEqual(await contentDigests(db), contentBefore)
  assert.equal(financialAfter.digest, financialBefore.digest)

  const constraints = (await db.query<{ constraint_name: string }>("select constraint_name from information_schema.table_constraints where table_name='booking_intelligence_findings'")).rows.map(row => row.constraint_name)
  const indexes = (await db.query<{ indexname: string }>("select indexname from pg_indexes where schemaname='public' and tablename='booking_intelligence_findings'")).rows.map(row => row.indexname)
  assert.ok(constraints.includes('booking_intelligence_findings_booking_id_fkey'))
  assert.ok(constraints.includes('booking_intelligence_findings_outlet_scope_id_fkey'))
  assert.ok(indexes.includes('booking_intelligence_booking_idx'))
  assert.ok(indexes.includes('booking_intelligence_type_idx'))
  assert.ok(indexes.includes('booking_intelligence_review_idx'))
  assert.ok(indexes.includes('booking_intelligence_lifecycle_idx'))

  const booking = (await db.query<any>("select id, imported_batch_id from bookings where venue_key='andalucia' order by reservation_date,id limit 1")).rows[0]
  const actor = (await db.query<any>("select id,display_name from user_accounts where status='active' order by created_at limit 1")).rows[0]
  const outlet = (await db.query<any>("select id from outlet_scopes where scope_key='andalucia'")).rows[0]
  assert.ok(booking && actor && outlet)

  const insertFinding = async (input: { type: string; key: string; evidence: string; rule?: string; ruleVersion?: string; source?: unknown; detected?: unknown; effective?: unknown; reviewRequired?: boolean }) => {
    const id = randomUUID()
    await db.query(`insert into booking_intelligence_findings(
      id,outlet_scope_id,booking_id,import_batch_id,finding_type,normalized_key,
      raw_evidence_text,detected_phrase,evidence_location,evidence_sha256,rule_key,rule_version,
      source_payload,detected_payload,effective_payload,resolution_method,confidence,
      review_state,review_required,created_by_user_id,created_by_actor,updated_by_user_id,updated_by_actor
    ) values($1,$2,$3,$4,$5,$6,$7,$7,'booking_source_notes',$8,$9,$10,$11,$12,$13,'deterministic_rule',1,$14,$15,$16,$17,$16,$17)`, [
      id, outlet.id, booking.id, booking.imported_batch_id, input.type, input.key, input.evidence,
      sha256(input.evidence), input.rule || `${input.type}.${input.key.toLowerCase()}`,
      input.ruleVersion || 'booking-intelligence-r1',
      JSON.stringify(input.source || {}), JSON.stringify(input.detected || {}), JSON.stringify(input.effective || {}),
      input.reviewRequired ? 'required' : 'not_required', Boolean(input.reviewRequired), actor.id, actor.display_name
    ])
    return id
  }

  const findingIds = []
  findingIds.push(await insertFinding({ type: 'occasion', key: 'HONEYMOON', evidence: 'HM table' }))
  findingIds.push(await insertFinding({ type: 'allergy', key: 'ALLERGY', evidence: 'Guest has a nut allergy' }))
  findingIds.push(await insertFinding({ type: 'guest_attention', key: 'TLC', evidence: 'TLC - service recovery required' }))
  findingIds.push(await insertFinding({ type: 'group', key: 'GROUP', evidence: 'Joining with 15 pax', source: { sourcePax: 4 }, detected: { groupPax: 15 }, effective: { operationalPax: 15 } }))
  findingIds.push(await insertFinding({ type: 'pax_review', key: 'PAX_REVIEW_REQUIRED', evidence: 'Confirmed (1 pax)', source: { sourcePax: 1 }, effective: { operationalPax: 1 }, reviewRequired: true }))
  assert.equal(Number((await db.query<{ count: number }>('select count(*)::int count from booking_intelligence_findings where booking_id=$1', [booking.id])).rows[0].count), 5)

  await assert.rejects(insertFinding({ type: 'occasion', key: 'HONEYMOON', evidence: 'HM table' }), /duplicate key|unique constraint/i)
  await insertFinding({ type: 'occasion', key: 'HONEYMOON', evidence: 'HM table', ruleVersion: 'booking-intelligence-r2' })
  assert.equal(Number((await db.query<{ count: number }>("select count(*)::int count from booking_intelligence_findings where booking_id=$1 and normalized_key='HONEYMOON' and raw_evidence_text='HM table'", [booking.id])).rows[0].count), 2)

  const honeymoonId = findingIds[0]
  const rawBefore = (await db.query<any>('select raw_evidence_text,source_payload from booking_intelligence_findings where id=$1', [honeymoonId])).rows[0]
  await db.query("update booking_intelligence_findings set effective_payload=$2,manager_override_payload=$3,manager_correction_reason=$4,review_state='resolved',review_required=false,updated_by_user_id=$5,updated_by_actor=$6,updated_at=now() where id=$1", [honeymoonId, JSON.stringify({ classification: 'HONEYMOON' }), JSON.stringify({ classification: 'HONEYMOON' }), 'Manager confirmed source wording.', actor.id, actor.display_name])
  const corrected = (await db.query<any>('select raw_evidence_text,source_payload,manager_override_payload,manager_correction_reason from booking_intelligence_findings where id=$1', [honeymoonId])).rows[0]
  assert.equal(corrected.raw_evidence_text, rawBefore.raw_evidence_text)
  assert.deepEqual(corrected.source_payload, rawBefore.source_payload)
  assert.equal(corrected.manager_override_payload.classification, 'HONEYMOON')
  await assert.rejects(db.query("update booking_intelligence_findings set raw_evidence_text='changed' where id=$1", [honeymoonId]), /source and detection evidence is immutable/i)

  const replacementId = await insertFinding({ type: 'occasion', key: 'HONEYMOON', evidence: 'Honeymoon couple', rule: 'occasion.honeymoon' })
  await db.query('update booking_intelligence_findings set active=false,superseded_by_id=$2,updated_by_user_id=$3,updated_by_actor=$4,updated_at=now() where id=$1', [honeymoonId, replacementId, actor.id, actor.display_name])
  assert.equal(Number((await db.query<{ count: number }>("select count(*)::int count from booking_intelligence_findings where booking_id=$1 and normalized_key='HONEYMOON' and rule_version='booking-intelligence-r1'", [booking.id])).rows[0].count), 2)
  assert.equal(Number((await db.query<{ count: number }>("select count(*)::int count from booking_intelligence_findings where booking_id=$1 and normalized_key='HONEYMOON' and rule_version='booking-intelligence-r1' and active=true", [booking.id])).rows[0].count), 1)

  const blockedEvidence: ProtectedZeroCoverEvidence = { findingType: 'blocked_capacity', normalizedKey: 'BLOCKED_CAPACITY', validated: true, sourcePax: 7, effectiveOperationalPax: 0, reviewRequired: false }
  validateOperationalCovers(0, blockedEvidence)
  assert.throws(() => validateOperationalCovers(0), /unless validated BLOCKED-capacity evidence/)
  const blockedId = await insertFinding({ type: 'blocked_capacity', key: 'BLOCKED_CAPACITY', evidence: 'BLOCKED due to high numbers', source: { sourcePax: 7, sourceStatus: 'pending' }, detected: { capacityBlock: true }, effective: { operationalPax: 0 } })
  const blocked = (await db.query<any>('select source_payload,effective_payload,raw_evidence_text from booking_intelligence_findings where id=$1', [blockedId])).rows[0]
  assert.equal(blocked.source_payload.sourcePax, 7)
  assert.equal(blocked.effective_payload.operationalPax, 0)
  assert.equal(blocked.raw_evidence_text, 'BLOCKED due to high numbers')

  for (const action of ['created', 'reviewed', 'manager_corrected', 'superseded']) await db.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'booking_intelligence_finding', honeymoonId, action, JSON.stringify(rawBefore), JSON.stringify(corrected), actor.display_name])
  assert.equal(Number((await db.query<{ count: number }>("select count(*)::int count from audit_logs where entity_type='booking_intelligence_finding' and entity_id=$1", [honeymoonId])).rows[0].count), 4)
  await db.close()

  await copyStoreVerified(sourceStore, rollbackPath)
  const rollback = new PGlite(rollbackPath)
  await rollback.query('select 1')
  const rollbackStatus = await migrationStatus(rollback)
  assert.equal(rollbackStatus.migrations.find(item => item.version === '017')?.state, 'pending')
  assert.equal(compareOperationalFingerprints(before, await createMigrationFingerprint(rollback)).preserved, true)
  assert.deepEqual(await counts(rollback), countsBefore)
  assert.deepEqual(await contentDigests(rollback), contentBefore)
  assert.equal((await createFinancialFinalizationFingerprint(rollback)).digest, financialBefore.digest)
  await rollback.close()

  console.log(JSON.stringify({
    migration017: true,
    checksum: migration017?.checksum,
    sourceCopyVerified: true,
    emptyAfterMigration: true,
    operationalPreserved: true,
    existingRowContentPreserved: true,
    financialPreserved: true,
    foreignKeys: true,
    indexes: true,
    simultaneousFindings: 5,
    deterministicDuplicateRejected: true,
    ruleVersionCreatesDistinctFinding: true,
    sourceEvidenceImmutable: true,
    managerCorrectionSeparated: true,
    supersessionPreservesHistory: true,
    blockedContract: { sourcePax: 7, effectiveOperationalPax: 0 },
    ordinaryZeroRejected: true,
    existingAuditStorage: true,
    rollbackSchema016: true,
    rollbackFingerprintMatched: true
  }, null, 2))
} finally {
  await rm(root, { recursive: true, force: true })
}
