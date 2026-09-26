import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { writeJsonAtomic, type StoreManifest } from './migration-filesystem.js'
import { reviewedMigrationSet } from './migration-store.js'
import { ANDALUCIA_SCOPE_ID, ANDALUCIA_SCOPE_KEY } from './outlet-membership-repository.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const canonicalStoreDirectory = resolve(projectRoot, '.data/postgres')
export const defaultBackupRoot = resolve(projectRoot, '.backups')
export const STORE_IDENTITY_VERSION = 'andalucia-store-identity-v1'
export const SUPPORTED_SCHEMA_VERSION = '018'
export const STORE_IDENTITY_AUTHORIZATION = 'YES_I_APPROVE_CANONICAL_STORE_IDENTITY'
export type DatabaseStoreRole = 'canonical' | 'backup' | 'backup_verification' | 'rehearsal' | 'test' | 'recovery_staging'
export type DatabaseHealthState = 'HEALTHY' | 'BACKUP_RECOMMENDED' | 'MIGRATION_REQUIRED' | 'DATABASE_RECOVERY_REQUIRED' | 'BACKUP_INVALID' | 'STORE_CONFIGURATION_ERROR'

export type StoreIdentity = {
  identityVersion: typeof STORE_IDENTITY_VERSION
  storeId: string
  role: DatabaseStoreRole
  databaseDirectory: string
  outletScopeId: string
  outletScopeKey: string
  createdAt: string
}

export type VerifiedBackupSummary = {
  backupId: string
  createdAt: string
  category: string
  verificationStatus: 'VERIFIED'
  openTestStatus: 'PASS'
  preflightStatus: 'READY'
  sourceDirectory: string
  backupDirectory: string
  sourceManifest: StoreManifest
  backupManifest: StoreManifest
  operationalFingerprint: Record<string, unknown>
}

export type DatabaseHealth = {
  status: DatabaseHealthState
  storeId: string
  storeRole: DatabaseStoreRole
  migrationVersion: string
  migrationRequired: boolean
  recoveryRequired: boolean
  lastVerifiedBackup: null | { backupId: string; createdAt: string; category: string; verificationStatus: string; preflightStatus: string }
  checks: Array<{ name: string; status: 'pass' | 'warning'; detail: string }>
}

export class DatabaseProtectionError extends Error {
  constructor(public readonly state: DatabaseHealthState, public readonly code: string, detail?: string) {
    super(`${code}${detail ? `:${detail}` : ''}`)
  }
}

const normalized = (value: string) => resolve(value).replaceAll('\\', '/').toLowerCase()
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const storeIdentityPath = (databaseDirectory: string) => join(dirname(resolve(databaseDirectory)), 'andalucia-store-identity.json')
export const operationMarkerPaths = (databaseDirectory: string) => ({
  migration: join(dirname(resolve(databaseDirectory)), 'migration-in-progress'),
  recovery: join(dirname(resolve(databaseDirectory)), 'recovery-in-progress'),
  postmaster: join(resolve(databaseDirectory), 'postmaster.pid')
})

export const resolveRuntimeStore = (environment: NodeJS.ProcessEnv = process.env) => {
  const configured = environment.ANDALUCIA_DATA_DIR?.trim()
  if (!configured) throw new DatabaseProtectionError('STORE_CONFIGURATION_ERROR', 'ANDALUCIA_DATA_DIR_REQUIRED')
  if (!isAbsolute(configured)) throw new DatabaseProtectionError('STORE_CONFIGURATION_ERROR', 'ANDALUCIA_DATA_DIR_MUST_BE_ABSOLUTE')
  const role = environment.ANDALUCIA_STORE_ROLE?.trim() as DatabaseStoreRole | undefined
  if (!role || !['canonical', 'backup', 'backup_verification', 'rehearsal', 'test', 'recovery_staging'].includes(role)) throw new DatabaseProtectionError('STORE_CONFIGURATION_ERROR', 'ANDALUCIA_STORE_ROLE_REQUIRED')
  const dataDirectory = resolve(configured)
  if (role === 'canonical' && normalized(dataDirectory) !== normalized(canonicalStoreDirectory)) throw new DatabaseProtectionError('STORE_CONFIGURATION_ERROR', 'CANONICAL_STORE_PATH_MISMATCH')
  if (role !== 'canonical' && normalized(dataDirectory) === normalized(canonicalStoreDirectory)) throw new DatabaseProtectionError('STORE_CONFIGURATION_ERROR', 'CANONICAL_STORE_ROLE_MISMATCH')
  if (!existsSync(join(dataDirectory, 'PG_VERSION'))) throw new DatabaseProtectionError('STORE_CONFIGURATION_ERROR', 'DATABASE_STORE_NOT_INITIALIZED')
  return { dataDirectory, role }
}

export const createStoreIdentity = async (databaseDirectoryInput: string, role: DatabaseStoreRole, options: { authorization?: string; storeId?: string; now?: Date; expectedCanonicalDirectory?: string } = {}) => {
  const databaseDirectory = resolve(databaseDirectoryInput)
  if (!existsSync(join(databaseDirectory, 'PG_VERSION'))) throw new DatabaseProtectionError('STORE_CONFIGURATION_ERROR', 'DATABASE_STORE_NOT_INITIALIZED')
  if (role === 'canonical') {
    if (normalized(databaseDirectory) !== normalized(options.expectedCanonicalDirectory || canonicalStoreDirectory)) throw new DatabaseProtectionError('STORE_CONFIGURATION_ERROR', 'CANONICAL_STORE_PATH_MISMATCH')
    if (options.authorization !== STORE_IDENTITY_AUTHORIZATION) throw new DatabaseProtectionError('STORE_CONFIGURATION_ERROR', 'STORE_IDENTITY_EXPLICIT_AUTHORIZATION_REQUIRED')
  }
  const path = storeIdentityPath(databaseDirectory)
  if (existsSync(path)) {
    const current = JSON.parse(await readFile(path, 'utf8')) as StoreIdentity
    if (current.identityVersion !== STORE_IDENTITY_VERSION || current.role !== role || normalized(current.databaseDirectory) !== normalized(databaseDirectory)) throw new DatabaseProtectionError('STORE_CONFIGURATION_ERROR', 'STORE_IDENTITY_CONFLICT')
    return current
  }
  const identity: StoreIdentity = {
    identityVersion: STORE_IDENTITY_VERSION,
    storeId: options.storeId || (role === 'canonical' ? 'andalucia-canonical-live' : `andalucia-${role}-${randomUUID()}`),
    role,
    databaseDirectory,
    outletScopeId: ANDALUCIA_SCOPE_ID,
    outletScopeKey: ANDALUCIA_SCOPE_KEY,
    createdAt: (options.now || new Date()).toISOString()
  }
  await mkdir(dirname(path), { recursive: true })
  await writeJsonAtomic(path, identity)
  return identity
}

export const readStoreIdentity = async (databaseDirectoryInput: string, expectedRole?: DatabaseStoreRole) => {
  const databaseDirectory = resolve(databaseDirectoryInput)
  const path = storeIdentityPath(databaseDirectory)
  if (!existsSync(path)) throw new DatabaseProtectionError('STORE_CONFIGURATION_ERROR', 'STORE_IDENTITY_MISSING')
  let identity: StoreIdentity
  try { identity = JSON.parse(await readFile(path, 'utf8')) as StoreIdentity } catch { throw new DatabaseProtectionError('STORE_CONFIGURATION_ERROR', 'STORE_IDENTITY_INVALID') }
  if (identity.identityVersion !== STORE_IDENTITY_VERSION || normalized(identity.databaseDirectory) !== normalized(databaseDirectory) || (expectedRole && identity.role !== expectedRole) || identity.outletScopeId !== ANDALUCIA_SCOPE_ID || identity.outletScopeKey !== ANDALUCIA_SCOPE_KEY) throw new DatabaseProtectionError('STORE_CONFIGURATION_ERROR', 'STORE_IDENTITY_MISMATCH')
  return identity
}

const classifyOpenFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  if (/checkpoint|WAL|resource manager|invalid record|could not locate|recovery/i.test(message)) return new DatabaseProtectionError('DATABASE_RECOVERY_REQUIRED', 'DATABASE_RECOVERY_REQUIRED', message)
  return new DatabaseProtectionError('STORE_CONFIGURATION_ERROR', 'DATABASE_OPEN_FAILED', message)
}

const appliedLedger = async (db: PGlite) => (await db.query<{ version: string; checksum: string; status: string }>('select version,checksum,status from schema_migrations order by version')).rows
const findLastVerifiedBackup = async (backupRoot = defaultBackupRoot) => {
  if (!existsSync(backupRoot)) return null
  const candidates: VerifiedBackupSummary[] = []
  for (const entry of await readdir(backupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const metadata = join(backupRoot, entry.name, 'backup-metadata.json')
    if (!existsSync(metadata)) continue
    try {
      const value = JSON.parse(await readFile(metadata, 'utf8')) as VerifiedBackupSummary
      if (value.verificationStatus === 'VERIFIED' && value.openTestStatus === 'PASS' && value.preflightStatus === 'READY') candidates.push(value)
    } catch { /* Invalid metadata is ignored and can never be selected as verified. */ }
  }
  return candidates.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null
}

export const openVerifiedDatabase = async (options: { dataDirectory: string; role: DatabaseStoreRole; requiredVersion?: string; backupRoot?: string }) => {
  const dataDirectory = resolve(options.dataDirectory)
  const identity = await readStoreIdentity(dataDirectory, options.role)
  const markers = operationMarkerPaths(dataDirectory)
  if (existsSync(markers.migration)) throw new DatabaseProtectionError('STORE_CONFIGURATION_ERROR', 'MIGRATION_IN_PROGRESS')
  if (existsSync(markers.recovery)) throw new DatabaseProtectionError('DATABASE_RECOVERY_REQUIRED', 'RECOVERY_IN_PROGRESS')
  if (existsSync(markers.postmaster)) throw new DatabaseProtectionError('DATABASE_RECOVERY_REQUIRED', 'DATABASE_PROCESS_MARKER_PRESENT')
  let db: PGlite
  try { db = new PGlite(dataDirectory); await db.query('select 1') } catch (error) { throw classifyOpenFailure(error) }
  try {
    const requiredTables = ['schema_migrations', 'staff', 'configuration_options', 'duty_roster_entries', 'bookings', 'outlet_scopes', 'user_accounts', 'authorization_roles', 'bill_tip_distributions']
    const tables = new Set((await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public'")).rows.map(row => row.table_name))
    const missingTables = requiredTables.filter(table => !tables.has(table))
    if (missingTables.length) throw new DatabaseProtectionError('MIGRATION_REQUIRED', 'DATABASE_MIGRATION_REQUIRED', `missing_tables=${missingTables.join(',')}`)
    const reviewed = await reviewedMigrationSet()
    const known = new Map(reviewed.versions.map(item => [item.version, item]))
    const ledger = await appliedLedger(db)
    const requiredVersion = options.requiredVersion || SUPPORTED_SCHEMA_VERSION
    const expected = reviewed.versions.filter(item => item.version <= requiredVersion)
    const missingVersions = expected.filter(item => !ledger.some(row => row.version === item.version && row.status === 'applied')).map(item => item.version)
    if (missingVersions.length) throw new DatabaseProtectionError('MIGRATION_REQUIRED', 'DATABASE_MIGRATION_REQUIRED', `missing_versions=${missingVersions.join(',')}`)
    for (const row of ledger) {
      const source = known.get(row.version)
      if (!source || row.version > requiredVersion) throw new DatabaseProtectionError('STORE_CONFIGURATION_ERROR', 'UNEXPECTED_MIGRATION_VERSION', row.version)
      if (row.checksum !== source.checksum) throw new DatabaseProtectionError('STORE_CONFIGURATION_ERROR', 'MIGRATION_CHECKSUM_MISMATCH', row.version)
    }
    const outlet = (await db.query<{ id: string; scope_key: string; active: boolean }>('select id,scope_key,active from outlet_scopes where id=$1 and scope_key=$2', [ANDALUCIA_SCOPE_ID, ANDALUCIA_SCOPE_KEY])).rows[0]
    if (!outlet?.active) throw new DatabaseProtectionError('STORE_CONFIGURATION_ERROR', 'ANDALUCIA_OUTLET_SCOPE_MISSING')
    const owners = Number((await db.query<{ count: number }>("select count(*)::int count from user_accounts u join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.active=true where u.status='active' and r.role_key='owner' and r.global_scope=true")).rows[0]?.count || 0)
    if (!owners) throw new DatabaseProtectionError('STORE_CONFIGURATION_ERROR', 'OWNER_ACCOUNT_FOUNDATION_MISSING')
    const last = await findLastVerifiedBackup(options.backupRoot)
    const latestVersion = ledger.at(-1)?.version || 'none'
    const age = last ? Date.now() - Date.parse(last.createdAt) : Number.POSITIVE_INFINITY
    const status: DatabaseHealthState = age > 24 * 60 * 60 * 1000 ? 'BACKUP_RECOMMENDED' : 'HEALTHY'
    const health: DatabaseHealth = {
      status, storeId: identity.storeId, storeRole: identity.role, migrationVersion: latestVersion,
      migrationRequired: false, recoveryRequired: false,
      lastVerifiedBackup: last ? { backupId: last.backupId, createdAt: last.createdAt, category: last.category, verificationStatus: last.verificationStatus, preflightStatus: last.preflightStatus } : null,
      checks: [
        { name: 'store_identity', status: 'pass', detail: identity.storeId },
        { name: 'migration_ledger', status: 'pass', detail: `Applied through ${latestVersion}` },
        { name: 'foundation', status: 'pass', detail: 'Andalucía OutletScope and active Owner are readable.' },
        ...(last ? [] : [{ name: 'verified_backup', status: 'warning' as const, detail: 'No DB-1 verified backup metadata is available yet.' }])
      ]
    }
    return { db, health, identity, ledgerDigest: digest(ledger) }
  } catch (error) {
    await db.close().catch(() => undefined)
    throw error
  }
}

export const publicDatabaseHealth = (health: DatabaseHealth) => ({ status: health.status, migrationVersion: health.migrationVersion, migrationRequired: health.migrationRequired, recoveryRequired: health.recoveryRequired })
