import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { AuthError, AuthService, clearSessionCookie, LoginAttemptLimiter, parseSessionToken, requireAuthenticatedUser, sessionCookie, verifyPassword } from './auth-service.js'

const folder = await mkdtemp(join(tmpdir(), 'andalucia-auth-'))
const db = new PGlite(join(folder, 'postgres'))
try {
  await db.exec(await readFile('database/schema.sql', 'utf8'))
  const auth = new AuthService(db)
  assert.equal(await auth.hasAccounts(), false)

  const account = await auth.createFirstAccount({ identifier: 'Owner.Example', displayName: 'Platform User', password: 'SafePassword2026' })
  assert.match(account.userId, /^[0-9a-f-]{36}$/)
  assert.deepEqual(account, { userId: account.userId, loginIdentifier: 'Owner.Example', displayName: 'Platform User', status: 'active', staffId: null, mustChangePassword: false })
  const stored = (await db.query<any>('select password_hash,normalized_login_identifier from user_accounts where id=$1', [account.userId])).rows[0]
  assert.notEqual(stored.password_hash, 'SafePassword2026')
  assert.match(stored.password_hash, /^scrypt\$/)
  assert.equal(stored.normalized_login_identifier, 'owner.example')
  assert.equal(await verifyPassword('SafePassword2026', stored.password_hash), true)
  assert.equal(JSON.stringify(account).includes('password'), false)
  await assert.rejects(() => auth.createFirstAccount({ identifier: 'second', displayName: 'Second', password: 'SafePassword2027' }), (error: unknown) => error instanceof AuthError && error.code === 'ACCOUNT_BOOTSTRAP_ALREADY_COMPLETED')
  await assert.rejects(() => auth.createAccount({ identifier: 'OWNER.EXAMPLE', displayName: 'Duplicate', password: 'SafePassword2028' }, account), (error: unknown) => error instanceof AuthError && error.code === 'LOGIN_IDENTIFIER_ALREADY_EXISTS')
  await assert.rejects(() => auth.createAccount({ identifier: 'weak-user', displayName: 'Weak', password: 'password' }, account), (error: unknown) => error instanceof AuthError && error.code === 'PASSWORD_REQUIREMENTS_NOT_MET')

  const invalidMessages: string[] = []
  for (const [identifier, password] of [['Owner.Example', 'WrongPassword2026'], ['unknown-user', 'WrongPassword2026']]) {
    await assert.rejects(() => auth.login(identifier, password), (error: unknown) => { assert(error instanceof AuthError); invalidMessages.push(`${error.code}|${error.message}`); return error.status === 401 })
  }
  assert.equal(new Set(invalidMessages).size, 1)
  assert.equal(Number((await db.query<{ count: number }>('select count(*)::int count from auth_sessions')).rows[0].count), 0)

  const linkedStaffId = '00000000-0000-4000-8000-000000009001'
  await db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date,nationality,division,department,outlet,identity_document_number) values($1,'AUTH-EMP','Linked Employee','Waiter','active','2026-01-01','','Food & Beverage','F&B Service','Andalucía','')", [linkedStaffId])
  const employee = await auth.createAccount({ identifier: 'linked.employee', displayName: 'Linked Employee', password: 'EmployeePassword2026', staffId: linkedStaffId }, account)
  await assert.rejects(() => auth.createAccount({ identifier: 'duplicate.employee', displayName: 'Duplicate Employee', password: 'DuplicatePassword2026', staffId: linkedStaffId }, account), (error: unknown) => error instanceof AuthError && error.code === 'STAFF_ACCOUNT_ALREADY_ACTIVE')
  const employeeSession = await auth.login('linked.employee', 'EmployeePassword2026')
  await auth.resetPassword(employee.userId, 'ReplacementPassword2026', account)
  assert.equal(await auth.principalForToken(employeeSession.token), null)
  await assert.rejects(() => auth.login('linked.employee', 'EmployeePassword2026'), (error: unknown) => error instanceof AuthError && error.code === 'INVALID_LOGIN')
  const replacementSession = await auth.login('linked.employee', 'ReplacementPassword2026')
  assert.equal(replacementSession.user.staffId, linkedStaffId)
  assert.equal(replacementSession.user.mustChangePassword, true)
  const replacementRequest = { headers: { cookie: `andalucia_session=${encodeURIComponent(replacementSession.token)}` } } as IncomingMessage
  await assert.rejects(() => requireAuthenticatedUser(replacementRequest, auth), (error: unknown) => error instanceof AuthError && error.code === 'PASSWORD_CHANGE_REQUIRED')
  assert.equal((await requireAuthenticatedUser(replacementRequest, auth, { allowPasswordChangeRequired: true })).staffId, linkedStaffId)
  await auth.changeOwnPassword(employee.userId, 'ReplacementPassword2026', 'FinalPassword2026')
  assert.equal(await auth.principalForToken(replacementSession.token), null)
  assert.equal((await auth.login('linked.employee', 'FinalPassword2026')).user.mustChangePassword, false)

  const signedIn = await auth.login(' owner.EXAMPLE ', 'SafePassword2026')
  assert.equal(signedIn.user.userId, account.userId)
  const persistedSession = (await db.query<any>('select id,token_hash,expires_at::text,revoked_at from auth_sessions where id=$1', [signedIn.sessionId])).rows[0]
  assert.notEqual(persistedSession.token_hash, signedIn.token)
  assert.equal(persistedSession.revoked_at, null)
  const principal = await auth.principalForToken(signedIn.token)
  assert.deepEqual({ userId: principal?.userId, sessionId: principal?.sessionId, displayName: principal?.displayName }, { userId: account.userId, sessionId: signedIn.sessionId, displayName: 'Platform User' })
  assert.notEqual(principal?.userId, 'client-supplied-user-id')

  const parsedToken = parseSessionToken({ headers: { cookie: `unrelated=1; andalucia_session=${encodeURIComponent(signedIn.token)}` } } as IncomingMessage)
  assert.equal(parsedToken, signedIn.token)
  assert.match(sessionCookie(signedIn.token, false), /HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800$/)
  assert.doesNotMatch(sessionCookie(signedIn.token, false), /; Secure/)
  assert.match(sessionCookie(signedIn.token, true), /; Secure$/)
  assert.match(clearSessionCookie(true), /Max-Age=0; Secure$/)

  await db.query("update auth_sessions set created_at='2020-01-01T00:00:00Z',expires_at='2020-01-01T01:00:00Z' where id=$1", [signedIn.sessionId])
  assert.equal(await auth.principalForToken(signedIn.token), null)

  const logoutSession = await auth.login('Owner.Example', 'SafePassword2026')
  await auth.logout(logoutSession.token)
  await auth.logout(logoutSession.token)
  assert.equal(await auth.principalForToken(logoutSession.token), null)

  const disabledSession = await auth.login('Owner.Example', 'SafePassword2026')
  await auth.disableAccount(account.userId, account)
  assert.equal((await auth.account(account.userId))?.status, 'disabled')
  assert.equal(await auth.principalForToken(disabledSession.token), null)
  await assert.rejects(() => auth.login('Owner.Example', 'SafePassword2026'), (error: unknown) => error instanceof AuthError && error.code === 'INVALID_LOGIN')

  const limiter = new LoginAttemptLimiter(2, 60_000)
  limiter.assertAllowed('client'); limiter.failed('client', 1000); limiter.assertAllowed('client', 1001); limiter.failed('client', 1001)
  assert.throws(() => limiter.assertAllowed('client', 1002), (error: unknown) => error instanceof AuthError && error.code === 'TOO_MANY_LOGIN_ATTEMPTS')
  limiter.succeeded('client'); limiter.assertAllowed('client', 1003)

  const events = (await db.query<{ event_type: string }>('select event_type from auth_security_events')).rows.map(row => row.event_type)
  for (const expected of ['account_created', 'login_failed', 'login_success', 'logout', 'account_disabled', 'password_reset', 'password_changed']) assert(events.includes(expected), expected)
  console.log(JSON.stringify({ stableUserUuid: true, plaintextExcluded: true, normalizedIdentifierUnique: true, oneActiveAccountPerStaffServiceBoundary: true, managerPasswordResetRevokesSessions: true, firstLoginPasswordChangeEnforced: true, firstLoginRestrictionClearedByOwnPasswordChange: true, genericInvalidLogin: true, serverSession: true, tokenHashOnly: true, expiryRejected: true, logoutIdempotent: true, disabledImmediateRevalidation: true, secureProductionCookie: true, devCookieSupported: true, trustedPrincipal: true, securityEvents: true, loginRateLimit: true }, null, 2))
} finally { await db.close(); await rm(folder, { recursive: true, force: true }) }
