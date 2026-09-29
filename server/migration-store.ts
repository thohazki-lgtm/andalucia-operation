import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { initialRolePermissions, permissionDefinitions, roleDefinitions } from './authorization-service.js'
import { ANDALUCIA_SCOPE_ID, ANDALUCIA_SCOPE_KEY } from './outlet-membership-repository.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const liveStore = resolve(projectRoot, '.data/postgres')
const migrationsDirectory = resolve(projectRoot, 'database/migrations')
const actorSource = 'versioned migration tooling'
const operationalTables = [
  'staff', 'staff_entitlements', 'public_holidays', 'configuration_options', 'duty_roster_entries',
  'attendance_records', 'bookings', 'booking_import_batches', 'booking_guest_members', 'guest_occasions',
  'chargeable_item_records', 'maintenance_issues', 'training_records', 'training_sessions',
  'training_session_attendees', 'training_import_batches', 'audit_logs', 'report_manager_summaries'
] as const

const normalizePath = (value: string) => resolve(value).replaceAll('\\', '/').toLowerCase()
const backupRoot = resolve(projectRoot, '.backups')
const persistentStoreIdentityPath = (dataDirectory: string) => join(dirname(resolve(dataDirectory)), 'andalucia-store-identity.json')
const rejectBackupOriginal = (dataDirectory: string) => {
  const normalizedDirectory = normalizePath(dataDirectory)
  if (normalizedDirectory.startsWith(`${normalizePath(backupRoot)}/`)) throw new Error('BACKUP_ORIGINAL_MIGRATION_FORBIDDEN')
  const identityPath = persistentStoreIdentityPath(dataDirectory)
  if (!existsSync(identityPath)) return
  let role = ''
  try { role = String((JSON.parse(readFileSync(identityPath, 'utf8')) as { role?: string }).role || '') } catch { throw new Error('DATABASE_STORE_IDENTITY_INVALID') }
  if (role === 'backup') throw new Error('BACKUP_ORIGINAL_MIGRATION_FORBIDDEN')
}
export const resolveMigrationDataDirectory = (options: { allowLiveCandidate?: boolean; configuredPath?: string } = {}) => {
  const configured = options.configuredPath?.trim() || process.env.ANDALUCIA_MIGRATION_DATA_DIR?.trim()
  if (!configured) throw new Error('MIGRATION_DATA_DIR_REQUIRED')
  if (!isAbsolute(configured)) throw new Error('ANDALUCIA_MIGRATION_DATA_DIR_MUST_BE_ABSOLUTE')
  const dataDirectory = resolve(configured)
  rejectBackupOriginal(dataDirectory)
  if (normalizePath(dataDirectory) === normalizePath(liveStore) && !options.allowLiveCandidate) throw new Error('LIVE_STORE_MIGRATION_FORBIDDEN_WITHOUT_EXPLICIT_AUTHORIZATION')
  if (!existsSync(join(dataDirectory, 'PG_VERSION'))) throw new Error('MIGRATION_DATA_DIRECTORY_IS_NOT_A_PGLITE_STORE')
  return dataDirectory
}
export const requireMigrationDataDirectory = () => resolveMigrationDataDirectory()
export const isLiveStorePath = (value: string, expected = liveStore) => normalizePath(value) === normalizePath(expected)

export const artifactDirectoryFor = (dataDirectory: string) => resolve(process.env.ANDALUCIA_MIGRATION_ARTIFACT_DIR || join(dirname(dataDirectory), 'artifacts'))
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const jsonStable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(jsonStable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${jsonStable(item)}`).join(',')}}`
  return JSON.stringify(value)
}
const writeArtifact = async (directory: string, name: string, value: unknown) => {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
const tableExists = async (db: PGlite, table: string) => Boolean((await db.query<{ exists: boolean }>('select exists(select 1 from information_schema.tables where table_schema=\'public\' and table_name=$1) exists', [table])).rows[0]?.exists)
const columnExists = async (db: PGlite, table: string, column: string) => Boolean((await db.query<{ exists: boolean }>('select exists(select 1 from information_schema.columns where table_schema=\'public\' and table_name=$1 and column_name=$2) exists', [table, column])).rows[0]?.exists)
const count = async (db: PGlite, sql: string) => Number((await db.query<{ count: number }>(sql)).rows[0]?.count || 0)
const quoted = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`

export type MigrationFingerprint = {
  generatedAt: string
  schemaObjects: string[]
  tables: Record<string, { rows: number; identityDigest?: string }>
  uniqueness: Record<string, number>
  business: Record<string, number>
  dutyCodeSemantics: Array<Record<string, unknown>>
  digest: string
}

export const createMigrationFingerprint = async (db: PGlite): Promise<MigrationFingerprint> => {
  const tableRows = await db.query<{ table_name: string }>('select table_name from information_schema.tables where table_schema=\'public\' and table_type=\'BASE TABLE\' order by table_name')
  const tables: MigrationFingerprint['tables'] = {}
  for (const { table_name: table } of tableRows.rows) {
    const rows = await db.query<Record<string, unknown>>(`select * from ${quoted(table)} order by 1`)
    const hasId = await columnExists(db, table, 'id')
    tables[table] = { rows: rows.rows.length, ...(hasId ? { identityDigest: sha256(jsonStable(rows.rows.map(row => row.id))) } : {}) }
  }
  const can = async (table: string, columns: string[]) => await tableExists(db, table) && (await Promise.all(columns.map(column => columnExists(db, table, column)))).every(Boolean)
  const uniqueness: Record<string, number> = {}
  if (await can('staff', ['id', 'staff_number'])) { uniqueness.staffIds = await count(db, 'select count(distinct id)::int count from staff'); uniqueness.staffNumbers = await count(db, 'select count(distinct staff_number)::int count from staff') }
  if (await can('bookings', ['id', 'source_booking_key'])) { uniqueness.bookingIds = await count(db, 'select count(distinct id)::int count from bookings'); uniqueness.bookingSourceKeys = await count(db, 'select count(distinct source_booking_key)::int count from bookings where source_booking_key is not null') }
  const business: Record<string, number> = {}
  if (await tableExists(db, 'staff')) business.staff = await count(db, 'select count(*)::int count from staff')
  if (await tableExists(db, 'duty_roster_entries')) business.rosterAssignments = await count(db, 'select count(*)::int count from duty_roster_entries')
  if (await tableExists(db, 'attendance_records')) business.attendance = await count(db, 'select count(*)::int count from attendance_records')
  if (await can('bookings', ['covers'])) { business.bookings = await count(db, 'select count(*)::int count from bookings'); business.bookingCovers = Number((await db.query<{ total: number }>('select coalesce(sum(covers),0)::numeric total from bookings')).rows[0]?.total || 0) }
  if (await can('chargeable_item_records', ['total_amount'])) { business.chargeables = await count(db, 'select count(*)::int count from chargeable_item_records'); business.chargeableValue = Number((await db.query<{ total: number }>('select coalesce(sum(total_amount),0)::numeric total from chargeable_item_records')).rows[0]?.total || 0) }
  for (const [key, table] of [['guestOccasions', 'guest_occasions'], ['maintenance', 'maintenance_issues'], ['trainingSessions', 'training_sessions']] as const) if (await tableExists(db, table)) business[key] = await count(db, `select count(*)::int count from ${quoted(table)}`)
  const dutyCodeSemantics = await tableExists(db, 'configuration_options') ? (await db.query<Record<string, unknown>>('select value,label,color,metadata,active,sort_order from configuration_options where group_key=\'duty_codes\' order by sort_order,value')).rows : []
  const base = { schemaObjects: tableRows.rows.map(row => row.table_name), tables, uniqueness, business, dutyCodeSemantics }
  return { generatedAt: new Date().toISOString(), ...base, digest: sha256(jsonStable(base)) }
}

type Check = { name: string; status: 'pass' | 'warning' | 'blocker'; count: number; detail: string }
export type PreflightReport = { generatedAt: string; dataDirectory: string; status: 'READY' | 'BLOCKED'; checks: Check[]; blockers: string[]; warnings: string[] }
export const runPreflight = async (db: PGlite, dataDirectory: string): Promise<PreflightReport> => {
  const checks: Check[] = []
  const add = (name: string, status: Check['status'], amount: number, detail: string) => checks.push({ name, status, count: amount, detail })
  for (const table of operationalTables) add(`required_table:${table}`, await tableExists(db, table) ? 'pass' : 'blocker', await tableExists(db, table) ? 0 : 1, 'Required operational table must exist before migration.')
  const duplicateChecks: Array<[string, string, string[]]> = [
    ['staff_number', 'staff', ['staff_number']], ['roster_staff_date', 'duty_roster_entries', ['staff_id', 'duty_date']],
    ['attendance_staff_date', 'attendance_records', ['staff_id', 'attendance_date']], ['booking_source_key', 'bookings', ['source_booking_key']],
    ['booking_member_source_row', 'booking_guest_members', ['booking_id', 'source_row_order']],
    ['training_attendee', 'training_session_attendees', ['training_id', 'staff_id']],
    ['guest_occasion_booking_type', 'guest_occasions', ['booking_id', 'occasion_type']],
    ['booking_import_file_hash', 'booking_import_batches', ['file_hash']]
  ]
  for (const [name, table, columns] of duplicateChecks) {
    if (!(await tableExists(db, table)) || !(await Promise.all(columns.map(column => columnExists(db, table, column)))).every(Boolean)) continue
    const nullable = name === 'booking_source_key' || name === 'guest_occasion_booking_type' ? ` where ${columns[0]} is not null` : ''
    const amount = await count(db, `select count(*)::int count from (select ${columns.map(quoted).join(',')} from ${quoted(table)}${nullable} group by ${columns.map(quoted).join(',')} having count(*)>1) duplicates`)
    add(`duplicates:${name}`, amount ? 'blocker' : 'pass', amount, 'Constraint-target duplicate groups.')
  }
  const orphanChecks: Array<[string, string]> = [
    ['duty_roster_entries', 'staff_id'], ['attendance_records', 'staff_id'], ['training_records', 'staff_id'],
    ['training_session_attendees', 'staff_id'], ['bookings', 'waiter_id'], ['chargeable_item_records', 'waiter_id']
  ]
  for (const [table, column] of orphanChecks) {
    if (!(await tableExists(db, table)) || !(await columnExists(db, table, column))) continue
    const amount = await count(db, `select count(*)::int count from ${quoted(table)} child left join staff parent on parent.id=child.${quoted(column)} where child.${quoted(column)} is not null and parent.id is null`)
    add(`orphan:${table}.${column}`, amount ? 'blocker' : 'pass', amount, 'Foreign-key target must resolve.')
  }
  const criticalNulls: Array<[string, string, boolean]> = [
    ['bookings', 'reservation_date', true], ['chargeable_item_records', 'guest_name', false], ['chargeable_item_records', 'item_category', false],
    ['guest_occasions', 'status_value', false], ['guest_occasions', 'manual_guest_name', false], ['guest_occasions', 'occasion_date', false], ['guest_occasions', 'occasion_time', false],
    ['maintenance_issues', 'area_value', false]
  ]
  for (const [table, column, deterministic] of criticalNulls) {
    if (!(await tableExists(db, table))) continue
    if (!(await columnExists(db, table, column))) { const rows = await count(db, `select count(*)::int count from ${quoted(table)}`); add(`missing_column:${table}.${column}`, rows && !deterministic ? 'blocker' : 'warning', rows, deterministic ? 'Dedicated DDL/backfill can represent this field.' : 'Historical values cannot be inferred safely.'); continue }
    const amount = await count(db, `select count(*)::int count from ${quoted(table)} where ${quoted(column)} is null`)
    add(`null:${table}.${column}`, amount ? (deterministic ? 'warning' : 'blocker') : 'pass', amount, deterministic ? 'Dedicated deterministic backfill is available.' : 'Manager/source evidence is required; tooling will not guess.')
  }
  if (await columnExists(db, 'bookings', 'reservation_date') && await columnExists(db, 'bookings', 'arrival_date')) {
    const amount = await count(db, 'select count(*)::int count from bookings where reservation_date is null and arrival_date is null')
    add('backfill_source:bookings.reservation_date', amount ? 'blocker' : 'pass', amount, 'A missing reservation date requires a source arrival date; created_at is not treated as a service-date guess.')
  }
  if (await columnExists(db, 'bookings', 'covers')) {
    const amount = await count(db, 'select count(*)::int count from bookings where covers is null or covers<1')
    add('integrity:booking_covers', amount ? 'blocker' : 'pass', amount, 'Booking covers must be a positive source-derived value.')
  }
  if (await columnExists(db, 'chargeable_item_records', 'quantity')) {
    const amount = await count(db, 'select count(*)::int count from chargeable_item_records where quantity is null or quantity<1')
    add('integrity:chargeable_quantity', amount ? 'blocker' : 'pass', amount, 'Chargeable quantity must be positive.')
  }
  if (await tableExists(db, 'booking_guest_members')) {
    const amount = await count(db, 'select count(*)::int count from booking_guest_members member left join bookings booking on booking.id=member.booking_id where booking.id is null')
    add('orphan:booking_guest_members.booking_id', amount ? 'blocker' : 'pass', amount, 'Every imported guest member must resolve to a booking.')
  }
  if (await tableExists(db, 'guest_occasions')) {
    const amount = await count(db, 'select count(*)::int count from guest_occasions occasion left join bookings booking on booking.id=occasion.booking_id where occasion.booking_id is not null and booking.id is null')
    add('orphan:guest_occasions.booking_id', amount ? 'blocker' : 'pass', amount, 'Every linked occasion must resolve to a booking.')
  }
  if (await tableExists(db, 'configuration_options')) {
    const amount = await count(db, "select count(*)::int count from configuration_options where group_key='duty_codes' and (not (metadata ? 'countsAsWorking') or not (metadata ? 'dutyClassification'))")
    add('semantics:duty_code_metadata', amount ? 'blocker' : 'pass', amount, 'Duty Code working/classification semantics must be explicit; migration will not infer them from labels.')
  }
  if (await tableExists(db, 'training_import_batches') && await columnExists(db, 'training_import_batches', 'active')) {
    const amount = await count(db, 'select count(*)::int count from (select file_hash from training_import_batches where active=true group by file_hash having count(*)>1) duplicates')
    add('duplicates:active_training_import_hash', amount ? 'blocker' : 'pass', amount, 'Required before partial unique-index normalization.')
  }
  if (await tableExists(db, 'outlet_scopes')) {
    const otherScopes = await count(db, `select count(*)::int count from outlet_scopes where scope_key<>\'${ANDALUCIA_SCOPE_KEY}\'`)
    add('outlet_scope:only_andalucia', otherScopes ? 'blocker' : 'pass', otherScopes, 'This rehearsal stage permits exactly the Andalucía outlet scope.')
  }
  const blockers = checks.filter(check => check.status === 'blocker').map(check => `${check.name} (${check.count})`)
  const warnings = checks.filter(check => check.status === 'warning').map(check => `${check.name} (${check.count})`)
  return { generatedAt: new Date().toISOString(), dataDirectory, status: blockers.length ? 'BLOCKED' : 'READY', checks, blockers, warnings }
}

type Migration = { version: string; name: string; sqlFile?: string; seed?: boolean }
const migrations: Migration[] = [
  { version: '001', name: 'schema migrations ledger', sqlFile: '001_schema_migrations.sql' },
  { version: '002', name: 'authentication foundation', sqlFile: '002_authentication_foundation.sql' },
  { version: '003', name: 'outlet and membership foundation', sqlFile: '003_outlet_membership_foundation.sql' },
  { version: '004', name: 'authorization foundation', sqlFile: '004_authorization_foundation.sql' },
  { version: '005', name: 'financial foundation', sqlFile: '005_financial_foundation.sql' },
  { version: '006', name: 'operational compatibility DDL', sqlFile: '006_operational_compatibility_ddl.sql' },
  { version: '007', name: 'explicit deterministic historical backfills', sqlFile: '007_explicit_historical_backfills.sql' },
  { version: '008', name: 'operational constraints and indexes', sqlFile: '008_operational_constraints_indexes.sql' },
  { version: '009', name: 'foundation reference data', seed: true },
  { version: '010', name: 'staff membership baseline revisions', sqlFile: '010_staff_membership_baseline_revisions.sql' },
  { version: '011', name: 'financial outlet scope foundation', sqlFile: '011_financial_outlet_scope.sql' },
  { version: '012', name: 'Bill Tip immutable finalization versions', sqlFile: '012_bill_tip_finalization_versions.sql' },
  { version: '013', name: 'Wine and Spirits incentive transaction source', sqlFile: '013_wine_spirits_incentive_source.sql' },
  { version: '014', name: 'Daily Report snapshot foundation', sqlFile: '014_daily_report_snapshot_foundation.sql' },
  { version: '015', name: 'Monthly Report Finance foundation', sqlFile: '015_monthly_report_finance_foundation.sql' },
  { version: '016', name: 'Training R2 evidence and synchronization foundation', sqlFile: '016_training_r2_foundation.sql' },
  { version: '017', name: 'Booking Intelligence Engine R1 persistence foundation', sqlFile: '017_booking_intelligence_foundation.sql' },
  { version: '018', name: 'Maintenance R2 scoped evidence foundation', sqlFile: '018_maintenance_r2_foundation.sql' }
]
const migrationSource = async (migration: Migration) => migration.sqlFile ? await readFile(join(migrationsDirectory, migration.sqlFile), 'utf8') : jsonStable({ roleDefinitions, permissionDefinitions, initialRolePermissions, outlet: { id: ANDALUCIA_SCOPE_ID, key: ANDALUCIA_SCOPE_KEY } })
export const reviewedMigrationSet = async () => {
  const { readdir } = await import('node:fs/promises')
  const declaredFiles = migrations.flatMap(migration => migration.sqlFile ? [migration.sqlFile] : []).sort()
  const directoryFiles = (await readdir(migrationsDirectory)).filter(file => /^\d{3}_.+\.sql$/.test(file)).sort()
  const unexpected = directoryFiles.filter(file => !declaredFiles.includes(file)); const missing = declaredFiles.filter(file => !directoryFiles.includes(file))
  if (unexpected.length || missing.length) throw new Error(`UNREVIEWED_MIGRATION_VERSION:unexpected=${unexpected.join(',')}:missing=${missing.join(',')}`)
  const versions = []
  for (const migration of migrations) versions.push({ version: migration.version, name: migration.name, checksum: sha256(await migrationSource(migration)), source: migration.sqlFile || 'code:foundation-reference-data' })
  return { toolVersion: 'andalucia-versioned-migration-v1', versions }
}
const seedFoundation = async (transaction: any) => {
  await transaction.query('insert into outlet_scopes(id,scope_key,display_name,active,outlet_type,created_by,updated_by) values($1,$2,$3,true,$4,$5,$5) on conflict(scope_key) do nothing', [ANDALUCIA_SCOPE_ID, ANDALUCIA_SCOPE_KEY, 'Andalucía', 'restaurant', actorSource])
  for (const role of roleDefinitions) await transaction.query('insert into authorization_roles(id,role_key,display_name,active,global_scope,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$6) on conflict(role_key) do nothing', [role.id, role.key, role.displayName, role.active, role.globalScope, actorSource])
  for (const permission of permissionDefinitions) await transaction.query('insert into authorization_permissions(id,permission_key,display_name,description,active,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$6) on conflict(permission_key) do nothing', [permission.id, permission.key, permission.displayName, permission.description, permission.active, actorSource])
  for (const [roleKey, keys] of Object.entries(initialRolePermissions)) {
    const role = roleDefinitions.find(item => item.key === roleKey)
    if (!role) continue
    for (const key of keys) { const permission = permissionDefinitions.find(item => item.key === key); if (permission) await transaction.query('insert into authorization_role_permissions(role_id,permission_id,created_by) values($1,$2,$3) on conflict(role_id,permission_id) do nothing', [role.id, permission.id, actorSource]) }
  }
}
export const migrationStatus = async (db: PGlite) => {
  const ledgerExists = await tableExists(db, 'schema_migrations')
  const applied = ledgerExists ? (await db.query<{ version: string; name: string; checksum: string; applied_at: string }>('select version,name,checksum,applied_at::text from schema_migrations order by version')).rows : []
  const items = []
  for (const migration of migrations) { const source = await migrationSource(migration); const row = applied.find(item => item.version === migration.version); items.push({ version: migration.version, name: migration.name, state: row ? 'applied' : 'pending', checksum: sha256(source), appliedAt: row?.applied_at || null, checksumMatches: row ? row.checksum === sha256(source) : null }) }
  return { ledgerExists, migrations: items }
}
export const runMigrations = async (db: PGlite, options: { simulateFailureVersion?: string; throughVersion?: string } = {}) => {
  const applied: string[] = []
  for (const migration of migrations) {
    if (options.throughVersion && migration.version > options.throughVersion) break
    const source = await migrationSource(migration); const checksum = sha256(source)
    const ledgerExists = await tableExists(db, 'schema_migrations')
    if (ledgerExists) {
      const existing = (await db.query<{ checksum: string }>('select checksum from schema_migrations where version=$1', [migration.version])).rows[0]
      if (existing) { if (existing.checksum !== checksum) throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${migration.version}`); continue }
    }
    await db.transaction(async transaction => {
      if (migration.sqlFile) await transaction.exec(source); else await seedFoundation(transaction)
      if (options.simulateFailureVersion === migration.version) throw new Error(`SIMULATED_MIGRATION_FAILURE:${migration.version}`)
      await transaction.query('insert into schema_migrations(version,name,checksum,status,actor_source,notes) values($1,$2,$3,\'applied\',$4,$5)', [migration.version, migration.name, checksum, actorSource, 'Rehearsal migration'])
    })
    applied.push(migration.version)
  }
  return { applied, status: await migrationStatus(db) }
}
export const compareOperationalFingerprints = (before: MigrationFingerprint, after: MigrationFingerprint) => {
  const differences: string[] = []
  for (const table of operationalTables) {
    if (before.tables[table]?.rows !== after.tables[table]?.rows) differences.push(`${table}:row_count`)
    if (before.tables[table]?.identityDigest !== after.tables[table]?.identityDigest) differences.push(`${table}:identity_digest`)
  }
  for (const [key, value] of Object.entries(before.business)) if (after.business[key] !== value) differences.push(`business:${key}`)
  if (jsonStable(before.dutyCodeSemantics) !== jsonStable(after.dutyCodeSemantics)) differences.push('configuration:duty_code_semantics')
  return { preserved: differences.length === 0, differences }
}
export const runMigrationCommand = async (command: 'preflight' | 'status' | 'migrate', options: { configuredPath?: string; expectedLiveStore?: string; liveAuthorization?: string; liveArtifactPath?: string; exclusiveCheck?: () => Promise<boolean> } = {}) => {
  const dataDirectory = resolveMigrationDataDirectory({ configuredPath: options.configuredPath, allowLiveCandidate: command === 'migrate' })
  const expectedLiveStore = options.expectedLiveStore || liveStore; const live = isLiveStorePath(dataDirectory, expectedLiveStore)
  let db: PGlite; let liveAuthorization: Awaited<ReturnType<typeof import('./migration-live-gate.js')['authorizeLiveExecution']>> | null = null
  if (live) {
    const { authorizeLiveExecution } = await import('./migration-live-gate.js')
    liveAuthorization = await authorizeLiveExecution({ sourceDirectory: dataDirectory, expectedLiveStore, authorizationPhrase: options.liveAuthorization, artifactPath: options.liveArtifactPath, exclusiveCheck: options.exclusiveCheck })
    db = liveAuthorization.db
  } else db = new PGlite(dataDirectory)
  const artifacts = liveAuthorization ? dirname(liveAuthorization.artifactPath) : artifactDirectoryFor(dataDirectory)
  try {
    if (command === 'status') return { command, dataDirectory, status: await migrationStatus(db) }
    const preflight = await runPreflight(db, dataDirectory); await writeArtifact(artifacts, 'migration-preflight.json', preflight)
    if (command === 'preflight') return { command, dataDirectory, preflight }
    if (preflight.status !== 'READY') throw new Error(`MIGRATION_PREFLIGHT_BLOCKED:${preflight.blockers.join(',')}`)
    const before = await createMigrationFingerprint(db); await writeArtifact(artifacts, 'migration-before-fingerprint.json', before)
    try {
      const migration = await runMigrations(db, liveAuthorization?.artifact.targetMigration ? { throughVersion: liveAuthorization.artifact.targetMigration.version } : {})
      const after = await createMigrationFingerprint(db); await writeArtifact(artifacts, 'migration-after-fingerprint.json', after)
      const comparison = compareOperationalFingerprints(before, after)
      const result = { generatedAt: new Date().toISOString(), dataDirectory, success: comparison.preserved, migration, comparison }
      await writeArtifact(artifacts, 'migration-result.json', result)
      if (!comparison.preserved) throw new Error(`MIGRATION_FINGERPRINT_MISMATCH:${comparison.differences.join(',')}`)
      if (liveAuthorization) { const { consumeLiveAuthorization } = await import('./migration-live-gate.js'); await consumeLiveAuthorization(liveAuthorization.artifactPath, after.digest) }
      return { command, ...result }
    } catch (error) {
      const failure = { generatedAt: new Date().toISOString(), dataDirectory, success: false, error: error instanceof Error ? error.message : String(error), status: await migrationStatus(db) }
      await writeArtifact(artifacts, 'migration-result.json', failure)
      throw error
    }
  } finally { await db.close(); await liveAuthorization?.release() }
}

export { liveStore, operationalTables, writeArtifact }
