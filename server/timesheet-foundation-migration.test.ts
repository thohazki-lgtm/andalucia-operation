import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createFinancialFinalizationFingerprint, createOperationalFingerprint } from './database-backup.js'
import { migrationStatus, runMigrations } from './migration-store.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const fixture = await createDisposableStoreThrough('timesheet-foundation-migration', '023')
try {
  await fixture.db.query('drop table if exists employee_timesheet_reopenings,employee_timesheet_day_audits,employee_timesheet_days,employee_timesheets cascade')
  await fixture.db.query("delete from authorization_role_permissions where permission_id in (select id from authorization_permissions where permission_key='manage_timesheets')")
  await fixture.db.query("delete from authorization_permissions where permission_key='manage_timesheets'")
  const operationalBefore = await createOperationalFingerprint(fixture.db); const financialBefore = await createFinancialFinalizationFingerprint(fixture.db)

  await assert.rejects(runMigrations(fixture.db, { throughVersion: '024', simulateFailureVersion: '024' }), /SIMULATED_MIGRATION_FAILURE:024/)
  assert.equal((await fixture.db.query<{ exists: boolean }>("select exists(select 1 from information_schema.tables where table_name='employee_timesheets') exists")).rows[0].exists, false)
  assert.equal((await migrationStatus(fixture.db)).migrations.find(item => item.version === '024')?.state, 'pending')

  assert.deepEqual((await runMigrations(fixture.db, { throughVersion: '024' })).applied, ['024'])
  const migration = (await migrationStatus(fixture.db)).migrations.find(item => item.version === '024')!
  assert.equal(migration.state, 'applied'); assert.equal(migration.checksumMatches, true)
  assert.deepEqual((await runMigrations(fixture.db, { throughVersion: '024' })).applied, [])
  for (const table of ['employee_timesheets','employee_timesheet_days','employee_timesheet_day_audits','employee_timesheet_reopenings']) assert.equal((await fixture.db.query<{ exists: boolean }>('select exists(select 1 from information_schema.tables where table_name=$1) exists', [table])).rows[0].exists, true)
  assert.equal(Number((await fixture.db.query<{ count: number }>('select count(*)::int count from employee_timesheets')).rows[0].count), 0)
  assert.equal(Number((await fixture.db.query<{ count: number }>("select count(*)::int count from authorization_role_permissions rp join authorization_roles r on r.id=rp.role_id join authorization_permissions p on p.id=rp.permission_id where r.role_key='outlet_manager' and p.permission_key='manage_timesheets'")).rows[0].count), 1)

  const operationalAfter = await createOperationalFingerprint(fixture.db)
  const { generatedAt: _beforeAt, migration: _beforeMigration, ...beforeOperational } = operationalBefore
  const { generatedAt: _afterAt, migration: _afterMigration, ...afterOperational } = operationalAfter
  assert.deepEqual(afterOperational, beforeOperational)
  assert.equal((await createFinancialFinalizationFingerprint(fixture.db)).digest, financialBefore.digest)

  const staffId = randomUUID(); const outletId = (await fixture.db.query<{ id: string }>("select id from outlet_scopes where scope_key='andalucia'")).rows[0].id
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'TS-MIG-1','Timesheet Migration Staff','Waiter','active','2026-01-01')", [staffId])
  await fixture.db.query("insert into employee_timesheets(id,staff_id,outlet_scope_id,month_start) values($1,$2,$3,'2026-10-01')", [randomUUID(), staffId, outletId])
  await assert.rejects(fixture.db.query("insert into employee_timesheets(id,staff_id,outlet_scope_id,month_start) values($1,$2,$3,'2026-10-01')", [randomUUID(), staffId, outletId]), /unique|duplicate/i)
  await assert.rejects(fixture.db.query("insert into employee_timesheets(id,staff_id,outlet_scope_id,month_start) values($1,$2,$3,'2026-10-02')", [randomUUID(), staffId, outletId]), /check/i)

  console.log(JSON.stringify({ migration024: true, checksum: migration.checksum, additiveTables: 4, zeroAutomaticRows: true, staffMonthUnique: true, monthBoundaryConstraint: true, rollbackAtomic: true, repeatable: true, managerPermission: true, operationalFinancialPreserved: true }, null, 2))
} finally { await fixture.cleanup() }
