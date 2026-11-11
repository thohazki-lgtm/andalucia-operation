import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createDisposableStoreThrough } from './test-store-fixture.js'
import { runMigrations } from './migration-store.js'
import { StaffRepository } from './staff-repository.js'
import { OperationsRepository } from './operations-repository.js'
import { canManageRosterMonthLock } from './roster-month-authorization.js'

const fixture = await createDisposableStoreThrough('duty-roster-month-lock', '027')
const rollbackFixture = await createDisposableStoreThrough('duty-roster-month-lock-rollback', '027')
try {
  const staffRepository = new StaffRepository(fixture.store, fixture.db)
  await staffRepository.initialize()
  const person = (await staffRepository.list()).find(item => item.assignmentEligible)!
  const options = (await staffRepository.configuration()).dutyCodes.filter(item => item.active && item.metadata?.displayCode !== 'SK')
  const annual = options.find(item => item.metadata?.dutyClassification === 'annualLeave')!
  const working = options.find(item => item.metadata?.countsAsWorking)!
  assert.ok(person && annual && working)
  await fixture.db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), person.id, '2026-10-05', annual.value])
  const beforeMigration = await fixture.db.query<{ count: number }>('select count(*)::int count from duty_roster_entries')
  const migration = await runMigrations(fixture.db, { throughVersion: '028' })
  assert.deepEqual(migration.applied, ['028'])
  assert.equal(migration.status.migrations.find(item => item.version === '028')?.state, 'applied')
  assert.equal((await fixture.db.query<{ count: number }>('select count(*)::int count from duty_roster_entries')).rows[0].count, beforeMigration.rows[0].count, 'the additive migration must preserve roster history')

  const now = () => new Date('2026-11-12T07:00:00.000Z')
  const operations = new OperationsRepository(fixture.db, undefined, now)
  const owner = { userId: fixture.ownerId, displayName: 'Roster Owner' }
  const october = (await operations.rosterMonthStates('2026-10-01', '2026-10-31'))[0]
  assert.deepEqual({ status: october.status, locked: october.locked, automatic: october.automatic, lockedBy: october.lockedBy }, { status: 'locked', locked: true, automatic: true, lockedBy: 'Automatic month-end lock' })
  assert.equal((await operations.roster('2026-10-01', '2026-10-31')).length, 1, 'automatic locking must not change historical assignments')
  await assert.rejects(operations.updateRoster(person.id, '2026-10-05', working.value, 'Unauthorized edit'), /DUTY_ROSTER_MONTH_LOCKED/)

  const reopened = await operations.reopenRosterMonth('2026-10', owner)
  assert.equal(reopened.status, 'reopened'); assert.equal(reopened.locked, false); assert.equal(reopened.reopenedBy, owner.displayName)
  assert.equal((await operations.roster('2026-10-01', '2026-10-31'))[0].dutyCode, annual.value, 'reopening alone must not alter confirmed leave evidence')
  const existing = (await operations.roster('2026-10-01', '2026-10-31'))[0]
  await operations.updateRosterBatch([{ staffId: person.id, date: '2026-10-05', dutyCode: working.value, expectedUpdatedAt: existing.updatedAt }], owner.displayName)
  assert.equal((await operations.roster('2026-10-01', '2026-10-31'))[0].dutyCode, working.value)
  await operations.lockRosterMonth('2026-10', owner)
  await assert.rejects(operations.updateRoster(person.id, '2026-10-05', annual.value, owner.displayName), /DUTY_ROSTER_MONTH_LOCKED/)

  const november = await operations.lockRosterMonth('2026-11', owner)
  assert.equal(november.status, 'locked'); assert.equal(november.automatic, false)
  const concurrent = await Promise.allSettled([
    operations.updateRoster(person.id, '2026-11-12', working.value, owner.displayName),
    operations.lockRosterMonth('2026-11', owner)
  ])
  assert.ok(concurrent.some(result => result.status === 'rejected'), 'a write racing a locked month must not bypass the month lock')
  await assert.rejects(operations.updateRoster(person.id, '2026-11-12', working.value, owner.displayName), /DUTY_ROSTER_MONTH_LOCKED/)
  await operations.reopenRosterMonth('2026-11', owner)
  await operations.updateRoster(person.id, '2026-11-12', working.value, owner.displayName)

  const audits = await fixture.db.query<any>('select action,previous_status,new_status,actor_name_snapshot from duty_roster_month_audits order by created_at,id')
  assert.ok(audits.rows.some(row => row.action === 'automatic_lock' && row.actor_name_snapshot === 'Automatic month-end lock'))
  assert.ok(audits.rows.some(row => row.action === 'reopen' && row.actor_name_snapshot === owner.displayName))
  assert.ok(audits.rows.filter(row => row.action === 'manual_lock').length >= 2)
  const octoberRow = (await fixture.db.query<any>("select * from duty_roster_month_states where month_start='2026-10-01'")).rows[0]
  assert.equal('reopened_until' in octoberRow, false, 'historical reopening must have no arbitrary expiry')

  assert.equal(canManageRosterMonthLock({ isOwner: true, roleKeys: ['owner'] }), true)
  assert.equal(canManageRosterMonthLock({ isOwner: false, roleKeys: ['outlet_manager'] }), true)
  assert.equal(canManageRosterMonthLock({ isOwner: false, roleKeys: ['operational_user'] }), false)
  const serverSource = await import('node:fs/promises').then(fs => fs.readFile('server/index.ts', 'utf8'))
  assert.match(serverSource, /rosterMonthActionMatch[\s\S]*canManageRosterMonthLock\(context\.principal\)/)
  assert.match(serverSource, /\/api\/roster\/batch[\s\S]*operations\.updateRosterBatch/)
  assert.match(serverSource, /request\.method === 'PUT' && rosterMatch[\s\S]*operations\.updateRoster/)

  const uiSource = await import('node:fs/promises').then(fs => fs.readFile('src/App.tsx', 'utf8'))
  const uiStyles = await import('node:fs/promises').then(fs => fs.readFile('src/duty-roster.css', 'utf8'))
  assert.match(uiSource, /const canManageMonth = user\.isOwner \|\| user\.roleKeys\.includes\('outlet_manager'\)/, 'Only Owner and Outlet Manager users may see the month action.')
  assert.match(uiSource, /actionState\.locked \? 'Reopen Month' : 'Lock Month'/, 'The bottom action must switch between Lock Month and Reopen Month.')
  assert.match(uiSource, /disabled=\{inactive \|\| saving \|\| stateForDate\(date\)\?\.locked\}/, 'Desktop roster duty controls must be disabled for locked months.')
  assert.match(uiSource, /disabled=\{inactive \|\| saving \|\| stateForDate\(mobileDate\)\?\.locked\}/, 'Mobile roster duty controls must be disabled for locked months.')
  assert.match(uiSource, /roster-month-lock[\s\S]*Export PDF[\s\S]*Save Changes/, 'The month action must remain beside Export PDF and Save Changes in the bottom action bar.')
  assert.match(uiStyles, /\.duty-roster-page \.roster-month-lock \{[\s\S]*?background: var\(--roster-teal-dark\);/, 'The manager month action must retain the approved Duty Roster module styling.')
  assert.match(uiStyles, /\.roster-view-switch\.roster-view-switch-standalone \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/, 'The mobile Weekly and Monthly switch must remain the approved two-column layout.')
  assert.doesNotMatch(`${serverSource}\n${uiSource}`, /reopened_until|24[- ]hour|24\s*\*\s*60\s*\*\s*60/i, 'Historical reopening must not acquire a 24-hour expiry.')

  await assert.rejects(runMigrations(rollbackFixture.db, { throughVersion: '028', simulateFailureVersion: '028' }), /SIMULATED_MIGRATION_FAILURE:028/)
  assert.equal((await rollbackFixture.db.query<{ table_name: string | null }>("select to_regclass('public.duty_roster_month_states')::text table_name")).rows[0].table_name, null, 'a failed Schema 028 migration must roll back its table creation')
  assert.equal(Number((await rollbackFixture.db.query<{ count: number }>("select count(*)::int count from schema_migrations where version='028'")).rows[0].count), 0, 'a failed Schema 028 migration must not advance the ledger')

  console.log(JSON.stringify({ schema028: true, additiveMigrationPreservesRoster: true, failedMigrationRollsBack: true, automaticMonthEndLock: true, managerLockReopen: true, noReopenExpiry: true, managerRoleAuthorization: true, lockedWriteProtection: true, concurrentLockSerialization: true, historicalLeavePreservedOnReopen: true, auditHistory: true, canonicalDatabaseTouched: false }, null, 2))
} finally {
  await fixture.cleanup()
  await rollbackFixture.cleanup()
}
