import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { AuthorizationService } from './authorization-service.js'
import { DatabaseBackupAdminService } from './database-backup-admin.js'
import { createFinancialFinalizationFingerprint, createVerifiedBackup } from './database-backup.js'
import { canonicalStoreDirectory, operationMarkerPaths, readStoreIdentity } from './database-protection.js'
import { copyStoreVerified, createStoreManifest, manifestsMatch, writeJsonAtomic } from './migration-filesystem.js'
import { compareOperationalFingerprints, createMigrationFingerprint, migrationStatus, reviewedMigrationSet, runMigrations, runPreflight } from './migration-store.js'
import { defaultExclusiveAccessCheck } from './migration-live-gate.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'

const targetVersion='016', authorizationVersion='andalucia-live-migration-authorization-v2'
const sourceDirectory=resolve(process.env.ANDALUCIA_DATA_DIR||'')
const backupRoot=resolve('.backups')
if(sourceDirectory!==canonicalStoreDirectory)throw new Error('LIVE_MIGRATION_TARGET_PATH_MISMATCH')
if(process.env.ANDALUCIA_CONFIRM_LIVE_STORE_EXCLUSIVE!=='YES_I_CONFIRM_ANDALUCIA_APP_IS_STOPPED'||!(await defaultExclusiveAccessCheck()))throw new Error('LIVE_STORE_NOT_EXCLUSIVE')
if(existsSync(operationMarkerPaths(sourceDirectory).recovery)||existsSync(operationMarkerPaths(sourceDirectory).migration))throw new Error('LIVE_OPERATION_CONFLICT')

const identity=await readStoreIdentity(sourceDirectory,'canonical')
const db=new PGlite(sourceDirectory);await db.query('select 1')
let owner:any,sourceFingerprint:any,financial:any,ledger:any,preflight:any,migrationSet:any
try{
  ledger=await migrationStatus(db);preflight=await runPreflight(db,sourceDirectory);sourceFingerprint=await createMigrationFingerprint(db);financial=await createFinancialFinalizationFingerprint(db);migrationSet=await reviewedMigrationSet()
  if(preflight.status!=='READY'||ledger.migrations.filter((item:any)=>item.state==='applied').at(-1)?.version!=='015'||ledger.migrations.find((item:any)=>item.version==='016')?.state!=='pending')throw new Error('MIGRATION_016_LIVE_BASELINE_INVALID')
  const row=(await db.query<any>("select s.id session_id,s.expires_at::text session_expires_at,u.id user_id,u.login_identifier,u.display_name from auth_sessions s join user_accounts u on u.id=s.user_id and u.status='active' join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.active=true and r.role_key='owner' and r.global_scope=true where s.revoked_at is null and s.expires_at>now()+interval '5 minutes' order by s.last_seen_at desc limit 1")).rows[0]
  if(!row)throw new Error('AUTHENTICATED_OWNER_SESSION_REQUIRED')
  const auth=await new AuthorizationService(db).authorizationForUser(row.user_id);const required=['manage_platform','manage_training']
  if(!auth.isOwner||!auth.globalScope||!required.every(key=>auth.permissionKeys.includes(key as any)))throw new Error('OWNER_MIGRATION_AUTHORIZATION_REQUIRED')
  owner={sessionId:row.session_id,sessionExpiresAt:row.session_expires_at,userId:row.user_id,loginIdentifier:row.login_identifier,displayName:row.display_name,isOwner:true,globalScope:true,requiredPermissions:required}
}finally{await db.close()}

const backup=await createVerifiedBackup({sourceDirectory,category:'pre-migration',backupRoot,exclusiveConfirmed:true})
const backupId=backup.metadata.backupId
const admin=new DatabaseBackupAdminService(backupRoot,sourceDirectory)
await admin.pin(backupId,true,{userId:owner.userId,displayName:owner.displayName},'PRE_MIGRATION_016 protected rollback source')
const temp=await mkdtemp(join(resolve('.tmp'),'training-r2-live-readiness-'))
try{
  const rehearsalPath=join(temp,'rehearsal','postgres');await copyStoreVerified(backup.backupDirectory,rehearsalPath)
  const rehearsal=new PGlite(rehearsalPath);await rehearsal.query('select 1')
  const before=await createMigrationFingerprint(rehearsal),financialBefore=await createFinancialFinalizationFingerprint(rehearsal)
  const migration=await runMigrations(rehearsal,{throughVersion:targetVersion})
  const after=await createMigrationFingerprint(rehearsal),financialAfter=await createFinancialFinalizationFingerprint(rehearsal),afterStatus=await migrationStatus(rehearsal)
  if(JSON.stringify(migration.applied)!==JSON.stringify([targetVersion])||afterStatus.migrations.find(item=>item.version===targetVersion)?.state!=='applied'||!compareOperationalFingerprints(before,after).preserved||financialBefore.digest!==financialAfter.digest)throw new Error('MIGRATION_016_REHEARSAL_RECONCILIATION_FAILED')
  for(const table of ['training_session_completion_evidence','training_session_staff_evidence','training_external_source_records','training_sync_runs','training_monthly_metric_snapshots'])if(Number((await rehearsal.query<any>(`select count(*)::int count from ${table}`)).rows[0].count)!==0)throw new Error(`MIGRATION_016_FABRICATED_EVIDENCE:${table}`)
  await rehearsal.close()
  const restore=await admin.rehearse(backupId,{userId:owner.userId,displayName:owner.displayName});if(restore.status!=='RESTORE_TEST_PASSED')throw new Error('MIGRATION_016_ROLLBACK_REHEARSAL_FAILED')
  const sourceManifest=await createStoreManifest(sourceDirectory),backupManifest=await createStoreManifest(backup.backupDirectory)
  if(!manifestsMatch(sourceManifest,backup.metadata.sourceManifest)||!manifestsMatch(backupManifest,backup.metadata.backupManifest))throw new Error('LIVE_OR_BACKUP_CHANGED_DURING_PREPARATION')
  const target=migrationSet.versions.find((item:any)=>item.version===targetVersion);if(!target)throw new Error('MIGRATION_016_SOURCE_NOT_REVIEWED')
  const createdAt=new Date(),sessionExpiry=Date.parse(owner.sessionExpiresAt),expiresAt=new Date(Math.min(createdAt.getTime()+15*60_000,sessionExpiry)).toISOString()
  const artifact={artifactVersion:authorizationVersion,id:randomUUID(),state:'prepared',createdAt:createdAt.toISOString(),expiresAt,sourceDirectory,backupDirectory:backup.backupDirectory,sourceManifestAtBackup:backup.metadata.sourceManifest,backupManifest:backup.metadata.backupManifest,preparedSourceManifest:sourceManifest,sourceFingerprintDigest:sourceFingerprint.digest,sourceBusinessSnapshot:sourceFingerprint.business,sourceFinancialFingerprintDigest:financial.digest,sourceMigrationLedger:ledger,preflightStatus:'READY',migrationSet,targetMigration:{version:target.version,name:target.name,checksum:target.checksum},canonicalStoreId:identity.storeId,outletScopeId:ANDALUCIA_SCOPE_ID,ownerSession:owner,protectedBackup:{backupId,pinned:true,restoreRehearsal:'PASS'},rehearsal:{status:'PASS',migratedSchema:'016',rollbackSchema:'015',completedAt:new Date().toISOString()},verifiedBackupMetadataPath:join(backup.folder,'backup-metadata.json'),rollbackInstructions:'Keep the application stopped. Restore only from this protected PRE_MIGRATION_016 backup through the controlled rollback procedure.'}
  const artifactPath=join(backup.folder,'live-migration-authorization.json');await writeJsonAtomic(artifactPath,artifact)
  console.log(JSON.stringify({artifactPath,artifactId:artifact.id,state:artifact.state,createdAt:artifact.createdAt,expiresAt:artifact.expiresAt,backupId,checksum:target.checksum,canonicalStoreId:identity.storeId,operationalFingerprint:sourceFingerprint.digest,financialFingerprint:financial.digest,rehearsal:'PASS',rollback:'PASS'},null,2))
}finally{await rm(temp,{recursive:true,force:true})}
