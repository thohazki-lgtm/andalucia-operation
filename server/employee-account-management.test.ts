import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { AuthError, AuthService, hashPassword, verifyPassword } from './auth-service.js'
import { AuthorizationError, AuthorizationService } from './authorization-service.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { requireOwnWorkforcePermission } from './workforce-authorization.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const fixture = await createDisposableStoreThrough('employee-account-management', '023')
try {
  const auth = new AuthService(fixture.db)
  const authorization = new AuthorizationService(fixture.db)
  const managerPassword = 'ExistingManagerPassword2026'
  await fixture.db.query('update user_accounts set password_hash=$2 where id=$1', [fixture.ownerId, await hashPassword(managerPassword)])
  const managerBefore = (await fixture.db.query<any>('select id,login_identifier,password_hash,status,staff_id,must_change_password from user_accounts where id=$1', [fixture.ownerId])).rows[0]
  const actor = { userId: fixture.ownerId, displayName: 'Test Manager' }
  const staffOne = randomUUID(); const staffTwo = randomUUID(); const inactiveStaff = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'TEST-EMP-1','Test Employee One','Waiter','active','2025-01-01'),($2,'TEST-EMP-2','Test Employee Two','Waiter','active','2025-02-01'),($3,'TEST-EMP-3','Inactive Test Employee','Waiter','inactive','2025-03-01')", [staffOne, staffTwo, inactiveStaff])

  const initial = await auth.staffAccounts()
  assert.equal(initial.find(item => item.staffId === staffOne)?.status, 'not_created')
  assert.equal(initial.find(item => item.staffId === staffTwo)?.status, 'not_created')
  assert.equal(initial.find(item => item.staffId === inactiveStaff)?.staffEligible, false)
  await assert.rejects(auth.createEmployeeAccount({ staffId: inactiveStaff, identifier: 'inactive.employee', outletScopeId: ANDALUCIA_SCOPE_ID }, actor), (error: unknown) => error instanceof AuthError && error.code === 'STAFF_ACCOUNT_INACTIVE')

  const created = await auth.createEmployeeAccount({ staffId: staffOne, identifier: 'employee.one', outletScopeId: ANDALUCIA_SCOPE_ID }, actor)
  assert.equal(created.account.staffId, staffOne)
  assert.equal(created.account.status, 'active')
  assert.equal(created.account.mustChangePassword, true)
  assert.match(created.temporaryPassword, /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,}$/)
  const stored = (await fixture.db.query<any>('select password_hash from user_accounts where id=$1', [created.account.userId])).rows[0]
  assert.notEqual(stored.password_hash, created.temporaryPassword)
  assert(!JSON.stringify((await fixture.db.query<any>('select details from auth_security_events where user_id=$1', [created.account.userId])).rows).includes(created.temporaryPassword))

  const employeeLogin = await auth.login('employee.one', created.temporaryPassword)
  assert.equal(employeeLogin.user.mustChangePassword, true)
  assert.deepEqual(employeeLogin.user.roleKeys, ['employee_self_service'])
  assert.deepEqual(employeeLogin.user.permissionKeys, ['confirm_own_timesheet_days', 'edit_own_timesheet', 'submit_own_timesheet_month', 'view_own_roster', 'view_own_timesheet'])
  assert.deepEqual(employeeLogin.user.allowedOutletScopeIds, [ANDALUCIA_SCOPE_ID])
  assert.equal(employeeLogin.user.permissionKeys.includes('manage_duty_roster' as any), false)
  assert.equal(employeeLogin.user.permissionKeys.includes('manage_staff' as any), false)
  assert.equal(employeeLogin.user.permissionKeys.includes('manage_entitlements' as any), false)

  const employeePrincipal = (await auth.principalForToken(employeeLogin.token))!
  await requireOwnWorkforcePermission(authorization, employeePrincipal, 'view_own_roster', ANDALUCIA_SCOPE_ID, staffOne)
  await assert.rejects(() => requireOwnWorkforcePermission(authorization, employeePrincipal, 'view_own_roster', ANDALUCIA_SCOPE_ID, staffTwo), (error: unknown) => error instanceof AuthorizationError && error.code === 'FORBIDDEN')
  await assert.rejects(() => authorization.requireOutletPermission(employeePrincipal, 'manage_duty_roster', ANDALUCIA_SCOPE_ID), (error: unknown) => error instanceof AuthorizationError && error.code === 'INSUFFICIENT_PERMISSION')

  await assert.rejects(auth.createEmployeeAccount({ staffId: staffOne, identifier: 'employee.duplicate', outletScopeId: ANDALUCIA_SCOPE_ID }, actor), (error: unknown) => error instanceof AuthError && error.code === 'STAFF_ACCOUNT_ALREADY_ACTIVE')
  assert.equal(Number((await fixture.db.query<{ count: number }>("select count(*)::int count from user_accounts where staff_id=$1 and status='active'", [staffOne])).rows[0].count), 1)

  const reset = await auth.resetEmployeePassword(staffOne, actor)
  assert.notEqual(reset.temporaryPassword, created.temporaryPassword)
  assert.doesNotMatch(reset.temporaryPassword, /[01OIl]/)
  assert.equal(await verifyPassword(reset.temporaryPassword, (await fixture.db.query<any>('select password_hash from user_accounts where id=$1', [created.account.userId])).rows[0].password_hash), true)
  assert.equal(await auth.principalForToken(employeeLogin.token), null)
  await assert.rejects(auth.login('employee.one', created.temporaryPassword), (error: unknown) => error instanceof AuthError && error.code === 'INVALID_LOGIN')
  const resetLogin = await auth.login('employee.one', reset.temporaryPassword)
  assert.equal(resetLogin.user.mustChangePassword, true)

  await auth.setEmployeeAccountEnabled(staffOne, false, actor)
  assert.equal(await auth.principalForToken(resetLogin.token), null)
  await assert.rejects(auth.login('employee.one', reset.temporaryPassword), (error: unknown) => error instanceof AuthError && error.code === 'INVALID_LOGIN')
  assert.equal((await auth.staffAccounts()).find(item => item.staffId === staffOne)?.status, 'disabled')
  await auth.setEmployeeAccountEnabled(staffOne, true, actor)
  assert.equal((await auth.staffAccounts()).find(item => item.staffId === staffOne)?.status, 'active')

  const attempts = await Promise.allSettled([
    auth.createEmployeeAccount({ staffId: staffTwo, identifier: 'employee.two.a', outletScopeId: ANDALUCIA_SCOPE_ID }, actor),
    auth.createEmployeeAccount({ staffId: staffTwo, identifier: 'employee.two.b', outletScopeId: ANDALUCIA_SCOPE_ID }, actor)
  ])
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(Number((await fixture.db.query<{ count: number }>("select count(*)::int count from user_accounts where staff_id=$1 and status='active'", [staffTwo])).rows[0].count), 1)

  const enabledLogin = await auth.login('employee.one', reset.temporaryPassword)
  await fixture.db.query("update staff set employment_status_key='inactive' where id=$1", [staffOne])
  assert.equal(await auth.principalForToken(enabledLogin.token), null)
  await assert.rejects(auth.login('employee.one', reset.temporaryPassword), (error: unknown) => error instanceof AuthError && error.code === 'INVALID_LOGIN')
  assert.equal(await auth.disableLinkedAccountForInactiveStaff(staffOne, actor), true)
  assert.equal((await auth.staffAccounts()).find(item => item.staffId === staffOne)?.status, 'disabled')
  await assert.rejects(auth.setEmployeeAccountEnabled(staffOne, true, actor), (error: unknown) => error instanceof AuthError && error.code === 'STAFF_ACCOUNT_INACTIVE')

  const managerLogin = await auth.login(managerBefore.login_identifier, managerPassword)
  const managerAfter = (await fixture.db.query<any>('select id,login_identifier,password_hash,status,staff_id,must_change_password from user_accounts where id=$1', [fixture.ownerId])).rows[0]
  assert.deepEqual(managerAfter, managerBefore)
  assert.equal(managerLogin.user.isOwner, true)

  const serverSource = await readFile('server/index.ts', 'utf8')
  const uiSource = await readFile('src/staff-account-management.tsx', 'utf8')
  const appSource = await readFile('src/App.tsx', 'utf8')
  const styles = await readFile('src/styles.css', 'utf8')
  assert.match(serverSource, /authorizedAccountManagementContext/)
  assert.match(serverSource, /requirePermission\(principal, 'manage_users'\)/)
  assert.match(serverSource, /assertTrustedOrigin\(request\).*createEmployeeAccount/s)
  assert.match(serverSource, /disableLinkedAccountForInactiveStaff/)
  assert.match(uiSource, /Create Account/)
  assert.match(uiSource, /Reset Password/)
  assert.match(uiSource, /Copy Temporary Password/)
  assert.match(uiSource, /Disable/)
  assert.match(uiSource, /staff-account-cards/)
  assert.match(uiSource, /Search employees/)
  assert.match(uiSource, /Account status/)
  assert.match(uiSource, /visibleAccounts/)
  assert.doesNotMatch(uiSource, /console\.(log|error).*temporaryPassword/)
  assert.match(appSource, /permissionKeys\.includes\('manage_users'\)/)
  assert.match(appSource, /operationalStaff = staff\.filter\(person => person\.assignmentEligible\)/)
  assert.match(uiSource, /Archived or inactive staff cannot receive an employee account/)
  assert.match(styles, /\.staff-account-cards\{display:none\}/)
  assert.match(styles, /@media\(max-width:700px\).*\.staff-account-cards\{display:grid/s)
  assert.match(styles, /\.staff-account-table\{width:100%;min-width:840px/)
  assert.match(styles, /\.staff-account-tools\{display:grid/)
  assert.match(styles, /\.staff-account-panel \.staff-account-table th\{[^}]*font-size:9px;font-weight:750;line-height:1\.25/)
  assert.match(styles, /\.staff-account-panel \.staff-account-table td\{[^}]*font-size:10\.5px;font-weight:400;line-height:1\.35/)
  assert.match(styles, /\.staff-account-panel \.staff-account-table td:first-child b\{[^}]*font-size:10\.5px;font-weight:700;line-height:1\.35/)
  assert.match(styles, /\.staff-account-cards header b\{[^}]*font-size:13px;font-weight:650;line-height:normal/)

  console.log(JSON.stringify({
    managerAccountCreationAuthorized: true,
    staffProfileLinked: true,
    oneActiveAccountPerStaff: true,
    concurrentCreationProtected: true,
    temporaryPasswordHashedAndNotAudited: true,
    firstLoginPasswordChangeRequired: true,
    passwordResetRevokesSessions: true,
    disabledAccountImmediatelyRevoked: true,
    employeePermissionsExact: true,
    crossEmployeeAccessRejected: true,
    dutyRosterAndManagementWritesRejected: true,
    managerAccountPreserved: true,
    inactiveStaffAccountCreationRejected: true,
    archivedStaffSessionRejected: true,
    archivedStaffAccountDisabled: true,
    inactiveStaffExcludedFromTodaySummary: true,
    responsiveAccountInterfacePresent: true,
    canonicalDatabaseUsed: false
  }, null, 2))
} finally { await fixture.cleanup() }
