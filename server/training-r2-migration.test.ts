import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rm, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { createFinancialFinalizationFingerprint } from './database-backup.js'
import { copyStoreVerified } from './migration-filesystem.js'
import { compareOperationalFingerprints, createMigrationFingerprint, migrationStatus, runMigrations, runPreflight } from './migration-store.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'

const sourceStore = process.env.ANDALUCIA_TRAINING_R2_SOURCE_STORE
if (!sourceStore) throw new Error('ANDALUCIA_TRAINING_R2_SOURCE_STORE_REQUIRED')

const root = await mkdtemp(join(resolve('.tmp'), 'training-r2-migration-'))
const migratedPath = join(root, 'migrated', 'postgres')
const rollbackPath = join(root, 'rollback', 'postgres')
const counts = async (db:PGlite, tables:string[]) => Object.fromEntries(await Promise.all(tables.map(async table => [table, Number((await db.query<{count:number}>(`select count(*)::int count from ${table}`)).rows[0].count)])))
const preservedTables = ['staff','duty_roster_entries','training_sessions','training_session_attendees','training_import_batches','bookings','guest_occasions','chargeable_item_records','maintenance_issues','daily_reports','daily_report_snapshots','monthly_report_inputs']

try {
  const copied = await copyStoreVerified(sourceStore, migratedPath)
  assert.equal(copied.sourceManifest.aggregateSha256, copied.backupManifest.aggregateSha256)
  const db = new PGlite(migratedPath)
  await db.query('select 1')
  const before = await createMigrationFingerprint(db)
  const financialBefore = await createFinancialFinalizationFingerprint(db)
  const countsBefore = await counts(db, preservedTables)
  const pending = await migrationStatus(db)
  assert.equal(pending.migrations.find(item => item.version === '016')?.state, 'pending')

  const migrated = await runMigrations(db, { throughVersion:'016' })
  assert.deepEqual(migrated.applied, ['016'])
  const applied = await migrationStatus(db)
  const migration016 = applied.migrations.find(item => item.version === '016')
  assert.equal(migration016?.state, 'applied')
  assert.equal(migration016?.checksumMatches, true)
  assert.equal(applied.migrations.filter(item => item.version <= '016').every(item => item.state === 'applied' && item.checksumMatches === true), true)
  const after = await createMigrationFingerprint(db)
  const financialAfter = await createFinancialFinalizationFingerprint(db)
  assert.equal(compareOperationalFingerprints(before, after).preserved, true)
  assert.deepEqual(await counts(db, preservedTables), countsBefore)
  assert.equal(financialAfter.digest, financialBefore.digest)
  assert.equal((await runPreflight(db, migratedPath)).status, 'READY')

  const target = (await db.query<any>('select * from training_target_versions where outlet_scope_id=$1', [ANDALUCIA_SCOPE_ID])).rows[0]
  assert.equal(target.monthly_target_credited_minutes, 3600)
  assert.equal(target.per_head_target_minutes, 216)
  assert.equal(target.participant_credit_cap_minutes, 30)
  assert.equal(target.calculation_policy_version, 'training-credit-v1')
  const actor = (await db.query<any>("select id,display_name from user_accounts where status='active' order by created_at limit 1")).rows[0]
  assert.ok(actor)
  const staff = (await db.query<any>("select id,full_name,staff_number from staff where employment_status_key='active' order by full_name limit 12")).rows
  assert.equal(staff.length, 12)

  const session = async (name:string, date:string, start='17:30', end='18:00') => {
    const id=randomUUID()
    await db.query("insert into training_sessions(id,title,category_value,training_date,training_time,end_time,trainer,location,status_value,notes,active,source,outlet_scope_id,created_by,updated_by) values($1,$2,'service_standards',$3,$4,$5,'Test Manager','Andalucía','planned','',true,'manual',$6,'isolated','isolated')", [id,name,date,start,end,ANDALUCIA_SCOPE_ID])
    return id
  }
  const completion = async (trainingId:string, outcome:string, actual:number|null, credit:number) => {
    const id=randomUUID()
    await db.query('insert into training_session_completion_evidence(id,training_session_id,outlet_scope_id,revision_number,outcome,actual_duration_minutes,credited_minutes_per_participant,calculation_policy_version,confirmed_by_user_id,confirmed_by_name_snapshot,confirmed_at) values($1,$2,$3,1,$4,$5,$6,$7,$8,$9,now())', [id,trainingId,ANDALUCIA_SCOPE_ID,outcome,actual,credit,'training-credit-v1',actor.id,actor.display_name])
    return id
  }
  const evidence = async (completionId:string, trainingId:string, person:any, eligibility:string, participation:string, credited:number, duty:string|null=null) => {
    await db.query('insert into training_session_staff_evidence(id,completion_evidence_id,training_session_id,staff_id,staff_name_snapshot,staff_number_snapshot,duty_code_value_snapshot,duty_metadata_snapshot,eligibility_state,participation_state,credited_minutes,confirmed_by_user_id,confirmed_by_name_snapshot,confirmed_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())', [randomUUID(),completionId,trainingId,person.id,person.full_name,person.staff_number,duty,duty?JSON.stringify({displayCode:duty}):null,eligibility,participation,credited,actor.id,actor.display_name])
  }
  const metric = async (trainingId:string) => (await db.query<any>('select * from training_completed_session_metrics where training_session_id=$1',[trainingId])).rows[0]

  // A: 12 active, 1 OFF, 1 AL, 10 eligible, 9 participants.
  const a=await session('Fixture A','2026-09-10'), ac=await completion(a,'completed',30,30)
  await evidence(ac,a,staff[0],'excluded_off','not_applicable',0,'OFF')
  await evidence(ac,a,staff[1],'excluded_annual_leave','not_applicable',0,'AL')
  for(let i=2;i<12;i++) await evidence(ac,a,staff[i],'eligible',i<11?'participated':'did_not_participate',i<11?30:0)
  const am=await metric(a)
  assert.equal(am.eligible_staff_count,10); assert.equal(am.participant_count,9); assert.equal(am.credited_minutes,270)
  assert.equal(Number(am.credited_minutes)/60,4.5); assert.equal(Number(am.participant_count)/Number(am.eligible_staff_count),0.9)

  // B: 11 eligible and 11 participants.
  const b=await session('Fixture B','2026-09-11'), bc=await completion(b,'completed',30,30)
  for(let i=0;i<11;i++) await evidence(bc,b,staff[i],'eligible','participated',30)
  const bm=await metric(b)
  assert.equal(bm.eligible_staff_count,11); assert.equal(bm.participant_count,11); assert.equal(bm.credited_minutes,330); assert.equal(Number(bm.credited_minutes)/60,5.5)

  // C: actual 60 minutes, participant credit remains capped at 30.
  const c=await session('Fixture C','2026-09-12','17:00','18:00'), cc=await completion(c,'completed',60,30)
  for(let i=0;i<10;i++) await evidence(cc,c,staff[i],'eligible','participated',30)
  const cm=await metric(c)
  assert.equal(cm.actual_duration_minutes,60); assert.equal(cm.credited_minutes_per_participant,30); assert.equal(cm.credited_minutes,300); assert.equal(Number(cm.credited_minutes)/60,5)

  // D/E: unresolved or zero eligibility produces no credit and unavailable coverage.
  const d=await session('Fixture D','2026-09-13'), dc=await completion(d,'requires_review',null,0)
  for(const person of staff) await evidence(dc,d,person,'requires_review','requires_review',0)
  const dm=await metric(d)
  assert.equal(dm.eligible_staff_count,0); assert.equal(dm.credited_minutes,0); assert.equal(dm.requires_review_count,12)
  const coverage = dm.eligible_staff_count ? dm.participant_count/dm.eligible_staff_count : null
  assert.equal(coverage,null)

  // Scheduled has no evidence; Awaiting and Cancelled are explicit zero-credit outcomes.
  const scheduled=await session('Scheduled Fixture','2026-09-14')
  assert.equal(await metric(scheduled),undefined)
  const awaiting=await session('Awaiting Fixture','2026-09-15'), awaitingCompletion=await completion(awaiting,'awaiting_confirmation',null,0)
  const cancelled=await session('Cancelled Fixture','2026-09-16'), cancelledCompletion=await completion(cancelled,'cancelled',null,0)
  assert.equal((await metric(awaiting)).credited_minutes,0); assert.equal((await metric(cancelled)).credited_minutes,0)
  await assert.rejects(completion(await session('Invalid Duration Fixture','2026-09-17'),'completed',null,0), /training_completion_credit_check/)
  await assert.rejects(completion(await session('Zero Duration Fixture','2026-09-18'),'completed',0,0), /training_completion_credit_check/)
  await assert.rejects(evidence(awaitingCompletion,awaiting,staff[0],'eligible','participated',30), /Training credit requires completed evidence/)
  await assert.rejects(evidence(cancelledCompletion,cancelled,staff[0],'eligible','participated',30), /Training credit requires completed evidence/)
  await assert.rejects(db.query('update training_session_completion_evidence set actual_duration_minutes=20 where id=$1',[ac]), /immutable/)
  await assert.rejects(db.query('delete from training_session_staff_evidence where completion_evidence_id=$1',[ac]), /immutable/)

  const snapshotId=randomUUID()
  await db.query("insert into training_monthly_metric_snapshots(id,outlet_scope_id,month_start,snapshot_revision,target_version_id,calculation_policy_version,sessions_scheduled,sessions_completed,confirmed_participants,credited_minutes,eligible_headcount,staff_covered,requires_review,evidence_sha256,staff_coverage_payload,frozen_by_user_id,frozen_by_name_snapshot,frozen_at) values($1,$2,'2026-09-01',1,$3,'training-credit-v1',7,3,30,900,12,11,false,$4,'[]',$5,$6,now())",[snapshotId,ANDALUCIA_SCOPE_ID,target.id,'a'.repeat(64),actor.id,actor.display_name])
  await assert.rejects(db.query('update training_monthly_metric_snapshots set credited_minutes=901 where id=$1',[snapshotId]),/immutable/)
  await assert.rejects(db.query("insert into training_monthly_metric_snapshots(id,outlet_scope_id,month_start,snapshot_revision,target_version_id,calculation_policy_version,sessions_scheduled,sessions_completed,confirmed_participants,credited_minutes,eligible_headcount,staff_covered,requires_review,evidence_sha256,staff_coverage_payload,frozen_by_user_id,frozen_by_name_snapshot,frozen_at) values($1,$2,'2026-10-01',1,$3,'training-credit-v1',0,0,0,0,0,0,false,$4,'[]',$5,$6,now())",[randomUUID(),ANDALUCIA_SCOPE_ID,target.id,'b'.repeat(64),actor.id,actor.display_name]),/training_monthly_headcount_check/)
  await db.close()

  // Rollback rehearsal: restore the unchanged schema-015 source into a new disposable path.
  await copyStoreVerified(sourceStore, rollbackPath)
  const rollback=new PGlite(rollbackPath); await rollback.query('select 1')
  const rollbackStatus=await migrationStatus(rollback)
  assert.equal(rollbackStatus.migrations.find(item=>item.version==='016')?.state,'pending')
  const rollbackFingerprint=await createMigrationFingerprint(rollback)
  assert.equal(compareOperationalFingerprints(before,rollbackFingerprint).preserved,true)
  assert.deepEqual(await counts(rollback,preservedTables),countsBefore)
  assert.equal((await createFinancialFinalizationFingerprint(rollback)).digest,financialBefore.digest)
  await rollback.close()

  console.log(JSON.stringify({
    migration016:true, checksum:migration016?.checksum, sourceCopyVerified:true,
    dataPreserved:true, financialPreserved:true, targetMinutes:3600, perHeadMinutes:216,
    fixtureA:{eligible:10,participants:9,minutes:270,hours:4.5,coveragePercent:90},
    fixtureB:{eligible:11,participants:11,minutes:330,hours:5.5},
    fixtureC:{actualMinutes:60,creditedPerParticipant:30,participants:10,minutes:300,hours:5},
    zeroEligibleRequiresReview:true,unknownEligibilityRequiresReview:true,offExcluded:true,annualLeaveExcluded:true,
    scheduledZero:true,awaitingZero:true,cancelledZero:true,invalidDurationRejected:true,immutableEvidence:true,
    monthlySnapshotFoundation:true,rollbackSchema015:true,rollbackFingerprintMatched:true
  },null,2))
} finally {
  await rm(root,{recursive:true,force:true})
}
