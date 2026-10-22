import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createFinancialFinalizationFingerprint, createOperationalFingerprint } from './database-backup.js'
import { migrationStatus, runMigrations } from './migration-store.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const fixture = await createDisposableStoreThrough('manager-timesheet-migration', '024')
try {
  const staffId = randomUUID(); const sheetId = randomUUID(); const dayId = randomUUID(); const auditId = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'MT-MIG-001','Existing Timesheet Employee','Waiter','active','2024-01-01')", [staffId])
  await fixture.db.query("insert into employee_timesheets(id,staff_id,outlet_scope_id,month_start,status,created_by_user_id,updated_by_user_id) values($1,$2,'00000000-0000-4000-8000-00000000a001','2026-09-01','submitted',$3,$3)", [sheetId, staffId, fixture.ownerId])
  await fixture.db.query("insert into employee_timesheet_days(id,timesheet_id,work_date,state,first_time_in,first_time_out,total_minutes,revision,confirmed_at,updated_by_user_id) values($1,$2,'2026-09-01','confirmed','08:00','17:00',540,1,now(),$3)", [dayId, sheetId, fixture.ownerId])
  await fixture.db.query("insert into employee_timesheet_day_audits(id,timesheet_id,timesheet_day_id,actor_user_id,action,after_data) values($1,$2,$3,$4,'confirmed','{}'::jsonb)", [auditId, sheetId, dayId, fixture.ownerId])
  const operationalBefore = await createOperationalFingerprint(fixture.db); const financialBefore = await createFinancialFinalizationFingerprint(fixture.db)

  await assert.rejects(runMigrations(fixture.db, { throughVersion: '025', simulateFailureVersion: '025' }), /SIMULATED_MIGRATION_FAILURE:025/)
  assert.equal((await fixture.db.query<{ exists: boolean }>("select exists(select 1 from information_schema.tables where table_name='employee_timesheet_month_audits') exists")).rows[0].exists, false)
  assert.equal((await fixture.db.query<{ exists: boolean }>("select exists(select 1 from information_schema.columns where table_name='employee_timesheet_day_audits' and column_name='reason') exists")).rows[0].exists, false)
  assert.equal((await migrationStatus(fixture.db)).migrations.find(item => item.version === '025')?.state, 'pending')

  assert.deepEqual((await runMigrations(fixture.db, { throughVersion: '025' })).applied, ['025'])
  const migration = (await migrationStatus(fixture.db)).migrations.find(item => item.version === '025')!
  assert.equal(migration.state, 'applied'); assert.equal(migration.checksumMatches, true)
  assert.deepEqual((await runMigrations(fixture.db, { throughVersion: '025' })).applied, [])
  assert.equal((await fixture.db.query<{ status: string }>('select status from employee_timesheets where id=$1', [sheetId])).rows[0].status, 'submitted')
  assert.equal(Number((await fixture.db.query<{ count: number }>('select count(*)::int count from employee_timesheet_days where id=$1', [dayId])).rows[0].count), 1)
  assert.equal(Number((await fixture.db.query<{ count: number }>('select count(*)::int count from employee_timesheet_day_audits where id=$1 and reason is null', [auditId])).rows[0].count), 1)
  assert.equal(Number((await fixture.db.query<{ count: number }>('select count(*)::int count from employee_timesheet_month_audits')).rows[0].count), 0)
  for (const status of ['open','submitted','approved','locked']) await fixture.db.query('update employee_timesheets set status=$2 where id=$1', [sheetId, status])
  await assert.rejects(fixture.db.query("update employee_timesheets set status='invalid' where id=$1", [sheetId]), /employee_timesheets_status_check|check constraint/i)
  await fixture.db.query("update employee_timesheets set status='submitted' where id=$1", [sheetId])

  const operationalAfter = await createOperationalFingerprint(fixture.db)
  const { generatedAt: _beforeAt, migration: _beforeMigration, ...beforeComparable } = operationalBefore
  const { generatedAt: _afterAt, migration: _afterMigration, ...afterComparable } = operationalAfter
  assert.deepEqual(afterComparable, beforeComparable)
  assert.equal((await createFinancialFinalizationFingerprint(fixture.db)).digest, financialBefore.digest)
  console.log(JSON.stringify({ migration025: true, checksum: migration.checksum, rollbackAtomic: true, repeatable: true, existingSchema024TimesheetPreserved: true, statuses: ['open','submitted','approved','locked'], managerCorrectionReasonColumn: true, monthlyAuditTable: true, zeroAutomaticAuditRows: true, operationalFinancialPreserved: true }, null, 2))
} finally { await fixture.cleanup() }
