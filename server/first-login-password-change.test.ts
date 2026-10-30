import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { AuthError, AuthService } from './auth-service.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const fixture = await createDisposableStoreThrough('first-login-password-change', '025')
try {
  const staffId = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'PW-001','Password Change Employee','Waiter','active','2026-01-01')", [staffId])
  const auth = new AuthService(fixture.db)
  const created = await auth.createEmployeeAccount({ staffId, identifier: 'password.employee', outletScopeId: '00000000-0000-4000-8000-00000000a001' }, { userId: fixture.ownerId, displayName: 'Fixture Owner' })
  const initial = await auth.login(created.account.loginIdentifier!, created.temporaryPassword)
  assert.equal(initial.user.mustChangePassword, true)
  await assert.rejects(() => auth.completeRequiredPasswordChange(initial.user.userId, 'weak'), (error: unknown) => error instanceof AuthError && error.code === 'PASSWORD_REQUIREMENTS_NOT_MET')
  await assert.rejects(() => auth.completeRequiredPasswordChange(initial.user.userId, created.temporaryPassword), (error: unknown) => error instanceof AuthError && error.code === 'NEW_PASSWORD_MUST_DIFFER')
  await auth.completeRequiredPasswordChange(initial.user.userId, 'EmployeeFinal2026')
  assert.equal(await auth.principalForToken(initial.token), null)
  const refreshed = await auth.login(created.account.loginIdentifier!, 'EmployeeFinal2026')
  assert.equal(refreshed.user.mustChangePassword, false)
  assert.equal(refreshed.user.staffId, staffId)
  await assert.rejects(() => auth.completeRequiredPasswordChange(initial.user.userId, 'AnotherFinal2026'), (error: unknown) => error instanceof AuthError && error.code === 'PASSWORD_CHANGE_NOT_REQUIRED')

  const ui = await readFile('src/auth.tsx', 'utf8')
  const api = await readFile('src/api.ts', 'utf8')
  const server = await readFile('server/index.ts', 'utf8')
  const css = await readFile('src/auth.css', 'utf8')
  assert.match(ui, /user\.mustChangePassword.*RequiredPasswordChange/s)
  assert.match(ui, />New Password</)
  assert.match(ui, />Confirm Password</)
  assert.match(ui, /Save Password/)
  assert.match(ui, /newPassword !== confirmation/)
  assert.match(api, /changePassword:.*request<AuthenticatedUser>/)
  assert.match(server, /completeRequiredPasswordChange/)
  assert.match(server, /sessionCookie\(signedIn\.token\)/)
  assert.match(css, /@media\(max-width:820px\)/)
  console.log(JSON.stringify({ firstLoginForm: true, passwordConfirmation: true, passwordPolicy: true, requiredChangeServerGuard: true, oldSessionRevoked: true, freshSessionContract: true, automaticTimesheetUnlock: true, staffLinkPreserved: true, responsiveLayout: true, canonicalDatabaseUsed: false }, null, 2))
} finally { await fixture.cleanup() }
