import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { copyStoreVerified, createStoreManifest, manifestsMatch, writeJsonAtomic } from './migration-filesystem.js'
import { createMigrationFingerprint, migrationStatus, runPreflight } from './migration-store.js'
import { canonicalStoreDirectory, createStoreIdentity, openVerifiedDatabase, operationMarkerPaths, readStoreIdentity, type DatabaseStoreRole, type VerifiedBackupSummary } from './database-protection.js'

export const BACKUP_EXCLUSIVE_PHRASE = 'YES_I_CONFIRM_ANDALUCIA_APP_IS_STOPPED'
export type BackupCategory = 'automatic-daily' | 'automatic-weekly' | 'manual' | 'pre-migration' | 'pre-finalization' | 'milestone' | 'recovery' | 'post-recovery-baseline' | 'post-db1-protection-baseline' | 'post-stale-marker-recovery'

export const createOperationalFingerprint = async (db: PGlite) => {
  const scalar = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows[0] || {}
  const migration = await migrationStatus(db)
  const staff = await scalar('select count(*)::int count,md5(coalesce(string_agg(id::text||staff_number||full_name,\'|\' order by staff_number),\'\')) digest from staff')
  const membership = await scalar("select count(s.*)::int count,max(r.revision_number)::int revision_number,max(r.status) status,bool_or(r.is_current_revision) current,bool_or(r.is_authoritative) authoritative from staff_membership_baseline_reviews r left join staff_membership_baseline_selections s on s.review_id=r.id and s.included=true where r.baseline_month='2026-09'")
  const roster = await scalar("select count(*)::int count,md5(coalesce(string_agg(staff_id::text||duty_date::text||duty_code_value,'|' order by staff_id,duty_date),'')) digest from duty_roster_entries")
  const bookings = await scalar('select count(*)::int count,coalesce(sum(covers),0)::int covers from bookings')
  const occasions = await scalar('select count(*)::int count from guest_occasions')
  const chargeables = await scalar("select count(*)::int count,count(*) filter(where active and status='charged')::int realized_count,coalesce(sum(total_amount) filter(where active and status='charged'),0)::numeric(12,2)::text realized_total,count(*) filter(where active and status='pending')::int pending_count,coalesce(sum(total_amount) filter(where active and status='pending'),0)::numeric(12,2)::text pending_total from chargeable_item_records")
  const maintenance = await scalar('select count(*)::int count from maintenance_issues')
  const training = await scalar('select count(*)::int count from training_sessions')
  const owner = await scalar("select count(*)::int count from user_accounts u join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.active=true where u.status='active' and r.role_key='owner' and r.global_scope=true")
  const outlet = await scalar("select count(*)::int count,min(id::text) id from outlet_scopes where scope_key='andalucia' and active=true")
  const financial = await scalar("select (select count(*) from financial_rate_versions)::int rates,(select count(*) from incentive_rules)::int rules,(select count(*) from incentive_rule_tiers)::int tiers")
  return { generatedAt: new Date().toISOString(), migration, staff, membership, roster, bookings, occasions, chargeables, maintenance, training, owner, outlet, financial }
}

export const createFinancialFinalizationFingerprint = async (db: PGlite) => {
  const rows = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows
  const versioned = Boolean((await db.query<{ present: boolean }>("select exists(select 1 from information_schema.columns where table_name='bill_tip_distributions' and column_name='version_number') present")).rows[0]?.present)
  if (!versioned) return { generatedAt: new Date().toISOString(), schemaSupport: 'pre-012' }
  const detail = {
    rates: await rows('select outlet_scope_id::text,version,effective_from::text,effective_to::text,service_charge_rate::text,gst_rate::text,active from financial_rate_versions order by outlet_scope_id,version'),
    rules: await rows('select outlet_scope_id::text,rule_key,source_key,rule_family,version,effective_from::text,effective_to::text,rate_percent::text,active from incentive_rules order by outlet_scope_id,rule_key,version'),
    tiers: await rows('select t.rule_id::text,t.minimum_amount::text,t.maximum_amount::text,t.reward_mode,t.reward_value::text from incentive_rule_tiers t order by t.rule_id,t.minimum_amount,t.id'),
    dutyEligibility: await rows("select id::text,value,metadata->>'billTipEligible' bill_tip_eligible,active from configuration_options where group_key='duty_codes' order by id"),
    membership: await rows("select id::text,outlet_scope_id::text,baseline_month::text,status,revision_number,is_current_revision,is_authoritative from staff_membership_baseline_reviews order by outlet_scope_id,baseline_month,revision_number"),
    roster: await rows('select staff_id::text,duty_date::text,duty_code_value from duty_roster_entries order by staff_id,duty_date'),
    versions: await rows('select id::text,outlet_scope_id::text,distribution_month::text,version_number,status,is_current,previous_version_id::text,pool_amount::text,external_allocation_total::text,remaining_team_pool::text,total_eligible_days,eligible_staff_count,value_per_eligible_day::text,regular_staff_distributed::text,undistributed_remainder::text,reconciliation_total::text from bill_tip_distributions order by outlet_scope_id,distribution_month,version_number'),
    staffSnapshots: await rows('select distribution_id::text,staff_id::text,eligible_days,excluded_al_days,other_excluded_days,missing_roster_days,final_amount::text from bill_tip_staff_allocations order by distribution_id,staff_id'),
    externalSnapshots: await rows('select distribution_id::text,helper_name,staff_reference,fixed_amount::text,idempotency_key from bill_tip_manual_allocations order by distribution_id,id')
  }
  return { generatedAt: new Date().toISOString(), digest: createHash('sha256').update(JSON.stringify(detail)).digest('hex') }
}

export const setBackupOriginalFilesystemProtection = async (databaseDirectoryInput: string, readOnly: boolean) => {
  const databaseDirectory = resolve(databaseDirectoryInput)
  let files = 0
  let directories = 0
  const visit = async (directory: string): Promise<void> => {
    if (!readOnly) await chmod(directory, 0o755)
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) { await visit(path); directories += 1 }
      else if (entry.isFile()) { await chmod(path, readOnly ? 0o444 : 0o644); files += 1 }
    }
    if (readOnly) await chmod(directory, 0o555)
  }
  await visit(databaseDirectory)
  return { databaseDirectory, readOnly, files, directories: directories + 1 }
}

export const verifyBackupOriginalFilesystemProtection = async (databaseDirectoryInput: string, readOnly: boolean) => {
  const databaseDirectory = resolve(databaseDirectoryInput); let files = 0; let directories = 0; const mismatches: string[] = []
  const visit = async (directory: string): Promise<void> => {
    const directoryMode = (await stat(directory)).mode
    if (readOnly ? Boolean(directoryMode & 0o222) : !Boolean(directoryMode & 0o200)) mismatches.push(directory)
    directories += 1
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) { const mode = (await stat(path)).mode; if (readOnly ? Boolean(mode & 0o222) : !Boolean(mode & 0o200)) mismatches.push(path); files += 1 }
      else mismatches.push(path)
    }
  }
  await visit(databaseDirectory)
  return { databaseDirectory, readOnly, files, directories, verified: mismatches.length === 0, mismatchCount: mismatches.length, mismatches: mismatches.slice(0, 20) }
}

type DisposableOpenRole = Extract<DatabaseStoreRole, 'backup_verification' | 'rehearsal' | 'test' | 'recovery_staging'>

export const verifyBackupCopy = async (options: { backupDirectory: string; sourceManifest: Awaited<ReturnType<typeof createStoreManifest>>; verificationDirectory: string; copyRole?: DisposableOpenRole }) => {
  const backupManifest = await createStoreManifest(options.backupDirectory)
  if (!manifestsMatch(options.sourceManifest, backupManifest)) throw new Error('BACKUP_INVALID:MANIFEST_MISMATCH')
  if (existsSync(options.verificationDirectory)) throw new Error('BACKUP_INVALID:VERIFICATION_TARGET_EXISTS')
  await mkdir(dirname(options.verificationDirectory), { recursive: true })
  await cp(options.backupDirectory, options.verificationDirectory, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
  await setBackupOriginalFilesystemProtection(options.verificationDirectory, false)
  const verificationManifest = await createStoreManifest(options.verificationDirectory)
  if (!manifestsMatch(backupManifest, verificationManifest)) throw new Error('BACKUP_INVALID:VERIFICATION_COPY_MISMATCH')
  const role = options.copyRole || 'backup_verification'
  await createStoreIdentity(options.verificationDirectory, role, { storeId: `andalucia-${role}-${randomUUID()}` })
  let db: PGlite | null = null
  try {
    const opened = await openVerifiedDatabase({ dataDirectory: options.verificationDirectory, role })
    db = opened.db
    await db.query('select 1')
    const preflight = await runPreflight(db, options.verificationDirectory)
    if (preflight.status !== 'READY') throw new Error(`BACKUP_INVALID:PREFLIGHT:${preflight.blockers.join(',')}`)
    const migration = await migrationStatus(db)
    const fingerprint = await createOperationalFingerprint(db)
    const financialFinalizationFingerprint = await createFinancialFinalizationFingerprint(db)
    return { backupManifest, verificationManifest, preflight, migration, fingerprint, financialFinalizationFingerprint }
  } catch (error) { throw new Error(`BACKUP_INVALID:OPEN_TEST:${error instanceof Error ? error.message : String(error)}`) }
  finally { await db?.close().catch(() => undefined) }
}

export const createVerifiedBackup = async (options: { sourceDirectory: string; category: BackupCategory; backupRoot: string; exclusiveConfirmed: boolean; now?: Date; expectedCanonicalDirectory?: string }) => {
  const sourceDirectory = resolve(options.sourceDirectory)
  if (existsSync(operationMarkerPaths(sourceDirectory).recovery)) throw new Error('RECOVERY_IN_PROGRESS_OPERATION_BLOCKED')
  if (sourceDirectory !== resolve(options.expectedCanonicalDirectory || canonicalStoreDirectory)) throw new Error('BACKUP_WRONG_STORE')
  if (!options.exclusiveConfirmed) throw new Error('BACKUP_REQUIRES_OFFLINE_EXCLUSIVE_ACCESS')
  const identity = await readStoreIdentity(sourceDirectory, 'canonical')
  const opened = await openVerifiedDatabase({ dataDirectory: sourceDirectory, role: 'canonical', backupRoot: options.backupRoot })
  await opened.db.close()
  const createdAt = (options.now || new Date()).toISOString()
  const backupId = `andalucia-${options.category}-${createdAt.replaceAll(':', '').replaceAll('.', '-')}-${randomUUID().slice(0, 8)}`
  const folder = join(resolve(options.backupRoot), backupId)
  const backupDirectory = join(folder, 'postgres')
  await mkdir(folder, { recursive: true })
  try {
    await writeJsonAtomic(join(folder, 'backup-candidate.json'), { backupId, createdAt, category: options.category, state: 'CANDIDATE', sourceDirectory })
    const copied = await copyStoreVerified(sourceDirectory, backupDirectory)
    const backupStoreIdentity = await createStoreIdentity(backupDirectory, 'backup', { storeId: `${backupId}-original`, now: options.now })
    const verificationDirectory = join(folder, 'verification', 'postgres')
    const verified = await verifyBackupCopy({ backupDirectory, sourceManifest: copied.sourceManifest, verificationDirectory })
    const metadata: VerifiedBackupSummary & Record<string, unknown> = {
      backupId, createdAt, category: options.category, verificationStatus: 'VERIFIED', openTestStatus: 'PASS', preflightStatus: 'READY',
      sourceDirectory, backupDirectory, sourceManifest: copied.sourceManifest, backupManifest: copied.backupManifest,
      operationalFingerprint: verified.fingerprint,
      financialFinalizationFingerprint: verified.financialFinalizationFingerprint,
      applicationVersion: '0.1.0', schemaVersion: verified.migration.migrations.filter(item => item.state === 'applied').at(-1)?.version || 'none',
      migrationLedger: verified.migration, storeIdentity: identity, backupStoreIdentity,
      verificationCopyManifest: verified.verificationManifest
    }
    await writeJsonAtomic(join(folder, 'backup-metadata.json'), metadata)
    await writeJsonAtomic(join(folder, 'migration-preflight.json'), verified.preflight)
    await writeJsonAtomic(join(folder, 'operational-fingerprint.json'), verified.fingerprint)
    await writeJsonAtomic(join(folder, 'backup-candidate.json'), { backupId, createdAt, category: options.category, state: 'VERIFICATION_PASSED_PENDING_REHEARSAL_AND_PROTECTION', sourceDirectory })
    await rm(join(folder, 'verification'), { recursive: true, force: true })
    return { folder, backupDirectory, metadata }
  } catch (error) {
    await writeJsonAtomic(join(folder, 'backup-failure.json'), { backupId, createdAt, category: options.category, verificationStatus: 'INVALID', error: error instanceof Error ? error.message : String(error) }).catch(() => undefined)
    throw error
  }
}

export const requireRecentVerifiedBackup = async (options: { metadataPath: string; sourceDirectory: string; maximumAgeMs: number; requireSourceManifestMatch?: boolean; now?: Date }) => {
  const metadata = JSON.parse(await import('node:fs/promises').then(module => module.readFile(options.metadataPath, 'utf8'))) as VerifiedBackupSummary
  if (metadata.verificationStatus !== 'VERIFIED' || metadata.openTestStatus !== 'PASS' || metadata.preflightStatus !== 'READY') throw new Error('VERIFIED_BACKUP_REQUIRED')
  if (resolve(metadata.sourceDirectory) !== resolve(options.sourceDirectory)) throw new Error('VERIFIED_BACKUP_SOURCE_MISMATCH')
  if ((options.now || new Date()).getTime() - Date.parse(metadata.createdAt) > options.maximumAgeMs) throw new Error('VERIFIED_BACKUP_STALE')
  if (options.requireSourceManifestMatch !== false) {
    const sourceNow = await createStoreManifest(options.sourceDirectory)
    if (!manifestsMatch(sourceNow, metadata.sourceManifest)) throw new Error('VERIFIED_BACKUP_SOURCE_CHANGED')
  }
  const backupNow = await createStoreManifest(metadata.backupDirectory)
  if (!manifestsMatch(backupNow, metadata.backupManifest)) throw new Error('VERIFIED_BACKUP_MANIFEST_MISMATCH')
  return metadata
}
