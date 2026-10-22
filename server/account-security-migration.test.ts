import assert from 'node:assert/strict'
import type { IncomingMessage } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createFinancialFinalizationFingerprint, createOperationalFingerprint } from './database-backup.js'
import { AuthError, AuthService, hashPassword, requireAuthenticatedUser } from './auth-service.js'
import { migrationStatus, runMigrations, runPreflight } from './migration-store.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const makeSchema022Shape = async (db: import('@electric-sql/pglite').PGlite) => {
  await db.query('drop index if exists user_accounts_one_active_per_staff')
  await db.query('alter table user_accounts drop column if exists must_change_password')
}

const fixture = await createDisposableStoreThrough('account-security-migration', '022')
try {
  await makeSchema022Shape(fixture.db)
  const owner = (await fixture.db.query<{ id: string; login_identifier: string }>('select id,login_identifier from user_accounts where id=$1', [fixture.ownerId])).rows[0]
  const ownerPassword = 'ExistingManagerPassword2026'
  await fixture.db.query('update user_accounts set password_hash=$2 where id=$1', [owner.id, await hashPassword(ownerPassword)])
  const managerStaffId = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'SEC-MGR','Existing Manager','Manager','active','2020-01-01')", [managerStaffId])
  await fixture.db.query('update user_accounts set staff_id=$2 where id=$1', [owner.id, managerStaffId])
  const employeeStaffId = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'SEC-EMP','Employee Account','Waiter','active','2026-01-01')", [employeeStaffId])

  const operationalBefore = await createOperationalFingerprint(fixture.db)
  const financialBefore = await createFinancialFinalizationFingerprint(fixture.db)
  const ownerBefore = (await fixture.db.query<{ password_hash: string; status: string; staff_id: string }>('select password_hash,status,staff_id from user_accounts where id=$1', [owner.id])).rows[0]

  await assert.rejects(runMigrations(fixture.db, { throughVersion: '023', simulateFailureVersion: '023' }), /SIMULATED_MIGRATION_FAILURE:023/)
  assert.equal((await fixture.db.query<{ exists: boolean }>("select exists(select 1 from information_schema.columns where table_name='user_accounts' and column_name='must_change_password') exists")).rows[0].exists, false)
  assert.equal((await migrationStatus(fixture.db)).migrations.find(item => item.version === '023')?.state, 'pending')

  assert.deepEqual((await runMigrations(fixture.db, { throughVersion: '023' })).applied, ['023'])
  const migration = (await migrationStatus(fixture.db)).migrations.find(item => item.version === '023')!
  assert.equal(migration.state, 'applied')
  assert.equal(migration.checksumMatches, true)
  assert.deepEqual((await runMigrations(fixture.db, { throughVersion: '023' })).applied, [])

  assert.equal((await fixture.db.query<{ must_change_password: boolean }>('select must_change_password from user_accounts where id=$1', [owner.id])).rows[0].must_change_password, false)
  const auth = new AuthService(fixture.db)
  const ownerLogin = await auth.login(owner.login_identifier, ownerPassword)
  assert.equal(ownerLogin.user.mustChangePassword, false)
  assert.equal((await auth.principalForToken(ownerLogin.token))?.userId, owner.id)

  const employeeRole = Number((await fixture.db.query<{ count: number }>("select count(*)::int count from authorization_roles where role_key='employee_self_service' and active=true")).rows[0].count)
  const employeePermissions = Number((await fixture.db.query<{ count: number }>("select count(*)::int count from authorization_role_permissions rp join authorization_roles r on r.id=rp.role_id join authorization_permissions p on p.id=rp.permission_id where r.role_key='employee_self_service' and p.permission_key in ('view_own_roster','view_own_timesheet','edit_own_timesheet','confirm_own_timesheet_days','submit_own_timesheet_month')")).rows[0].count)
  assert.equal(employeeRole, 1); assert.equal(employeePermissions, 5)

  const actor = { userId: owner.id, displayName: 'Existing Manager' }
  const attempts = await Promise.allSettled([
    auth.createAccount({ identifier: 'employee.one', displayName: 'Employee One', password: 'EmployeePassword2026', staffId: employeeStaffId }, actor),
    auth.createAccount({ identifier: 'employee.two', displayName: 'Employee Two', password: 'EmployeePassword2027', staffId: employeeStaffId }, actor)
  ])
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(Number((await fixture.db.query<{ count: number }>("select count(*)::int count from user_accounts where staff_id=$1 and status='active'", [employeeStaffId])).rows[0].count), 1)
  const employee = attempts.find((item): item is PromiseFulfilledResult<Awaited<ReturnType<AuthService['createAccount']>>> => item.status === 'fulfilled')!.value
  assert.equal(employee.mustChangePassword, true)

  const initialPassword = employee.loginIdentifier === 'employee.one' ? 'EmployeePassword2026' : 'EmployeePassword2027'
  const employeeLogin = await auth.login(employee.loginIdentifier, initialPassword)
  const request = { headers: { cookie: `andalucia_session=${encodeURIComponent(employeeLogin.token)}` } } as IncomingMessage
  await assert.rejects(() => requireAuthenticatedUser(request, auth), (error: unknown) => error instanceof AuthError && error.code === 'PASSWORD_CHANGE_REQUIRED')
  await requireAuthenticatedUser(request, auth, { allowPasswordChangeRequired: true })
  await auth.changeOwnPassword(employee.userId, initialPassword, 'EmployeeFinalPassword2026')
  assert.equal(await auth.principalForToken(employeeLogin.token), null)
  assert.equal((await auth.login(employee.loginIdentifier, 'EmployeeFinalPassword2026')).user.mustChangePassword, false)

  await auth.resetPassword(employee.userId, 'EmployeeResetPassword2026', actor)
  const resetLogin = await auth.login(employee.loginIdentifier, 'EmployeeResetPassword2026')
  assert.equal(resetLogin.user.mustChangePassword, true)
  await auth.disableAccount(employee.userId, actor)
  assert.equal(await auth.principalForToken(resetLogin.token), null)
  const replacement = await auth.createAccount({ identifier: 'employee.replacement', displayName: 'Employee Replacement', password: 'ReplacementPassword2026', staffId: employeeStaffId }, actor)
  assert.equal(replacement.mustChangePassword, true)
  await assert.rejects(fixture.db.query("update user_accounts set status='active' where id=$1", [employee.userId]), /unique|duplicate|user_accounts_one_active_per_staff/i)

  const ownerAfter = (await fixture.db.query<{ password_hash: string; status: string; staff_id: string; must_change_password: boolean }>('select password_hash,status,staff_id,must_change_password from user_accounts where id=$1', [owner.id])).rows[0]
  assert.deepEqual(ownerAfter, { ...ownerBefore, must_change_password: false })
  const operationalAfter = await createOperationalFingerprint(fixture.db)
  const { generatedAt: _beforeAt, migration: _beforeMigration, ...beforeOperational } = operationalBefore
  const { generatedAt: _afterAt, migration: _afterMigration, ...afterOperational } = operationalAfter
  assert.deepEqual(afterOperational, beforeOperational)
  assert.equal((await createFinancialFinalizationFingerprint(fixture.db)).digest, financialBefore.digest)

  console.log(JSON.stringify({
    migration023: true,
    migrationChecksum: migration.checksum,
    rollbackAtomic: true,
    repeatable: true,
    existingAccountPasswordPreserved: true,
    existingManagerLoginCompatible: true,
    existingAccountResetNotForced: true,
    firstLoginPasswordChangeEnforced: true,
    passwordResetRevokesSessionsAndRequiresChange: true,
    databaseUniqueActiveStaffAccount: true,
    concurrentCreationProtected: true,
    disabledAccountReplacementSupported: true,
    employeeRoleUnassigned: true,
    operationalFinancialPreserved: true
  }, null, 2))
} finally { await fixture.cleanup() }

const conflict = await createDisposableStoreThrough('account-security-conflict', '022')
try {
  await makeSchema022Shape(conflict.db)
  const staffId = randomUUID()
  await conflict.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'SEC-CONFLICT','Conflicting Employee','Waiter','active','2026-01-01')", [staffId])
  for (const suffix of ['a','b']) await conflict.db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status,staff_id) values($1,$2,$2,$3,'test-only','active',$4)", [randomUUID(), `conflict.${suffix}`, `Conflict ${suffix}`, staffId])
  const preflight = await runPreflight(conflict.db, conflict.store)
  assert.equal(preflight.status, 'BLOCKED')
  assert(preflight.blockers.some(value => value.startsWith('duplicates:active_user_staff')))
  await assert.rejects(runMigrations(conflict.db, { throughVersion: '023' }), /unique|duplicate/i)
  assert.equal((await conflict.db.query<{ exists: boolean }>("select exists(select 1 from information_schema.columns where table_name='user_accounts' and column_name='must_change_password') exists")).rows[0].exists, false)
  assert.equal((await migrationStatus(conflict.db)).migrations.find(item => item.version === '023')?.state, 'pending')
  console.log(JSON.stringify({ conflictingLiveShapeBlockedByPreflight: true, failedConstraintMigrationRolledBack: true }, null, 2))
} finally { await conflict.cleanup() }
