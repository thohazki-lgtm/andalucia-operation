import { createHash, randomBytes, randomInt, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { PGlite } from '@electric-sql/pglite'
import type { AuthPrincipal, AuthenticatedUser, AuditActor, StaffAccountSummary, UserAccountIdentity } from '../src/domain.js'
import { AuthorizationService } from './authorization-service.js'

const SESSION_COOKIE = 'andalucia_session'
const SESSION_SECONDS = 8 * 60 * 60
const SCRYPT_COST = 16384
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELISM = 1
const HASH_BYTES = 32
const DUMMY_SALT = Buffer.from('andalucia-auth-dummy-salt')

export class AuthError extends Error {
  constructor(public readonly code: string, public readonly status: 400 | 401 | 403 | 409 | 429, message: string) { super(message) }
}

const normalizeIdentifier = (value: string) => value.normalize('NFKC').trim().toLowerCase()
const safeUser = (row: any): UserAccountIdentity => ({ userId: row.id, loginIdentifier: row.login_identifier, displayName: row.display_name, status: row.status, staffId: row.staff_id || null, mustChangePassword: Boolean(row.must_change_password) })
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
const identifierHash = (identifier: string) => createHash('sha256').update(normalizeIdentifier(identifier)).digest('hex')
const passwordPolicy = (password: string) => password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)
const derivePassword = (password: string, salt: Buffer, length: number, cost = SCRYPT_COST, blockSize = SCRYPT_BLOCK_SIZE, parallelization = SCRYPT_PARALLELISM) => new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, length, { cost, blockSize, parallelization, maxmem: 64 * 1024 * 1024 }, (error, derived) => error ? reject(error) : resolve(derived)))

export async function hashPassword(password: string) {
  if (!passwordPolicy(password)) throw new AuthError('PASSWORD_REQUIREMENTS_NOT_MET', 400, 'Password must be at least 12 characters and include upper-case, lower-case and numeric characters.')
  const salt = randomBytes(16)
  const derived = await derivePassword(password, salt, HASH_BYTES)
  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELISM}$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, cost, blockSize, parallelization, salt, expected] = encoded.split('$')
  if (algorithm !== 'scrypt' || !cost || !blockSize || !parallelization || !salt || !expected) return false
  try {
    const expectedBuffer = Buffer.from(expected, 'base64url')
    const derived = await derivePassword(password, Buffer.from(salt, 'base64url'), expectedBuffer.length, Number(cost), Number(blockSize), Number(parallelization))
    return expectedBuffer.length === derived.length && timingSafeEqual(expectedBuffer, derived)
  } catch { return false }
}

export function generateTemporaryPassword() {
  // Avoid characters that are easily confused when the one-time credential is
  // handed to an employee (0/O, 1/I/l). Each required character class is
  // included explicitly; the remaining characters and their positions are
  // selected with cryptographically secure randomness.
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const digits = '23456789'
  const alphabet = `${upper}${lower}${digits}`
  const pick = (characters: string) => characters[randomInt(characters.length)]
  const characters = [pick(upper), pick(lower), pick(digits), ...Array.from({ length: 15 }, () => pick(alphabet))]
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1)
    ;[characters[index], characters[swap]] = [characters[swap], characters[index]]
  }
  return characters.join('')
}

async function consumeUnknownPassword(password: string) {
  await derivePassword(password, DUMMY_SALT, HASH_BYTES)
}

export class LoginAttemptLimiter {
  private attempts = new Map<string, number[]>()
  constructor(private readonly maximum = 5, private readonly windowMs = 15 * 60 * 1000) {}
  assertAllowed(key: string, now = Date.now()) { const recent = (this.attempts.get(key) || []).filter(value => value > now - this.windowMs); this.attempts.set(key, recent); if (recent.length >= this.maximum) throw new AuthError('TOO_MANY_LOGIN_ATTEMPTS', 429, 'Too many login attempts. Please try again later.') }
  failed(key: string, now = Date.now()) { const recent = (this.attempts.get(key) || []).filter(value => value > now - this.windowMs); recent.push(now); this.attempts.set(key, recent) }
  succeeded(key: string) { this.attempts.delete(key) }
}

export class AuthService {
  private readonly authorization: AuthorizationService
  constructor(private readonly db: PGlite, authorization?: AuthorizationService) { this.authorization = authorization || new AuthorizationService(db) }

  async hasAccounts() { return Number((await this.db.query<{ count: number }>('select count(*)::int count from user_accounts')).rows[0].count) > 0 }

  async createFirstAccount(input: { identifier: string; displayName: string; password: string; staffId?: string | null }) {
    if (await this.hasAccounts()) throw new AuthError('ACCOUNT_BOOTSTRAP_ALREADY_COMPLETED', 409, 'The first platform account has already been created.')
    return this.createAccount(input, { userId: 'bootstrap', displayName: 'Explicit account bootstrap' })
  }

  async createAccount(input: { identifier: string; displayName: string; password: string; staffId?: string | null; mustChangePassword?: boolean }, actor: AuditActor) {
    const normalized = normalizeIdentifier(input.identifier)
    if (normalized.length < 3 || normalized.length > 254 || /\s/.test(normalized)) throw new AuthError('INVALID_LOGIN_IDENTIFIER', 400, 'Enter a valid username or email address.')
    if (!input.displayName.trim()) throw new AuthError('DISPLAY_NAME_REQUIRED', 400, 'Display name is required.')
    if (input.staffId) {
      const staff = await this.db.query('select id from staff where id=$1', [input.staffId]); if (!staff.rows[0]) throw new AuthError('STAFF_ACCOUNT_LINK_NOT_FOUND', 409, 'The linked Staff record was not found.')
    }
    const id = randomUUID(); const passwordHash = await hashPassword(input.password)
    try {
      await this.db.transaction(async transaction => {
        if (input.staffId) {
          const linked = await transaction.query("select id from user_accounts where staff_id=$1 and status='active' limit 1", [input.staffId])
          if (linked.rows[0]) throw new AuthError('STAFF_ACCOUNT_ALREADY_ACTIVE', 409, 'That Staff profile already has an active account.')
        }
        const mustChangePassword = input.staffId ? true : Boolean(input.mustChangePassword)
        await transaction.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status,staff_id,must_change_password,created_by,updated_by) values($1,$2,$3,$4,$5,'active',$6,$7,$8,$8)", [id, input.identifier.trim(), normalized, input.displayName.trim(), passwordHash, input.staffId || null, mustChangePassword, actor.userId])
        await transaction.query("insert into auth_security_events(id,user_id,event_type,success,details,actor_user_id) values($1,$2,'account_created',true,$3,$4)", [randomUUID(), id, JSON.stringify({ displayName: input.displayName.trim(), linkedStaffId: input.staffId || null }), actor.userId === 'bootstrap' ? null : actor.userId])
      })
    } catch (error) {
      if (error instanceof AuthError) throw error
      if (error instanceof Error && /user_accounts_one_active_per_staff/i.test(error.message)) throw new AuthError('STAFF_ACCOUNT_ALREADY_ACTIVE', 409, 'That Staff profile already has an active account.')
      if (error instanceof Error && /unique|duplicate/i.test(error.message)) throw new AuthError('LOGIN_IDENTIFIER_ALREADY_EXISTS', 409, 'That login identifier is already in use.')
      throw error
    }
    return (await this.account(id))!
  }

  async account(id: string): Promise<UserAccountIdentity | null> { const result = await this.db.query<any>('select id,login_identifier,display_name,status,staff_id,must_change_password from user_accounts where id=$1', [id]); return result.rows[0] ? safeUser(result.rows[0]) : null }

  async staffAccounts(): Promise<StaffAccountSummary[]> {
    const result = await this.db.query<any>(`select s.id staff_id,s.full_name staff_name,s.staff_number,coalesce((select (c.metadata->>'eligibleForAssignments')::boolean from configuration_options c where c.group_key='employment_statuses' and c.value=s.employment_status_key),s.employment_status_key='active') staff_eligible,
      a.id user_id,a.login_identifier,a.status,a.last_login_at,a.must_change_password,a.updated_at
      from staff s left join user_accounts a on a.staff_id=s.id
      order by s.full_name asc,case when a.status='active' then 0 else 1 end,a.updated_at desc nulls last`)
    const accounts = new Map<string, StaffAccountSummary>()
    for (const row of result.rows) {
      if (accounts.has(row.staff_id)) continue
      accounts.set(row.staff_id, {
        staffId: row.staff_id,
        staffName: row.staff_name,
        staffNumber: row.staff_number,
        staffEligible: Boolean(row.staff_eligible),
        userId: row.user_id || null,
        loginIdentifier: row.login_identifier || null,
        status: row.user_id ? row.status : 'not_created',
        lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
        mustChangePassword: Boolean(row.must_change_password)
      })
    }
    return [...accounts.values()]
  }

  private async staffAccount(staffId: string) {
    const account = (await this.staffAccounts()).find(item => item.staffId === staffId)
    if (!account) throw new AuthError('STAFF_ACCOUNT_LINK_NOT_FOUND', 409, 'The linked Staff record was not found.')
    return account
  }

  async createEmployeeAccount(input: { staffId: string; identifier: string; outletScopeId: string }, actor: AuditActor) {
    const staff = (await this.db.query<any>(`select s.id,s.full_name,coalesce((select (c.metadata->>'eligibleForAssignments')::boolean from configuration_options c where c.group_key='employment_statuses' and c.value=s.employment_status_key),s.employment_status_key='active') assignment_eligible from staff s where s.id=$1`, [input.staffId])).rows[0]
    if (!staff) throw new AuthError('STAFF_ACCOUNT_LINK_NOT_FOUND', 409, 'The linked Staff record was not found.')
    if (!staff.assignment_eligible) throw new AuthError('STAFF_ACCOUNT_INACTIVE', 409, 'Archived or inactive staff cannot receive an employee account.')
    const normalized = normalizeIdentifier(input.identifier)
    if (normalized.length < 3 || normalized.length > 254 || /\s/.test(normalized)) throw new AuthError('INVALID_LOGIN_IDENTIFIER', 400, 'Enter a valid username or email address.')
    const temporaryPassword = generateTemporaryPassword()
    const passwordHash = await hashPassword(temporaryPassword)
    const userId = randomUUID()
    try {
      await this.db.transaction(async transaction => {
        const linked = await transaction.query("select id from user_accounts where staff_id=$1 and status='active' limit 1", [input.staffId])
        if (linked.rows[0]) throw new AuthError('STAFF_ACCOUNT_ALREADY_ACTIVE', 409, 'That Staff profile already has an active account.')
        const role = await transaction.query<any>("select id from authorization_roles where role_key='employee_self_service' and active=true")
        const outlet = await transaction.query<any>('select id from outlet_scopes where id=$1 and active=true', [input.outletScopeId])
        if (!role.rows[0] || !outlet.rows[0]) throw new AuthError('EMPLOYEE_ACCOUNT_SECURITY_UNAVAILABLE', 409, 'Employee account permissions are not available.')
        await transaction.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status,staff_id,must_change_password,created_by,updated_by) values($1,$2,$3,$4,$5,'active',$6,true,$7,$7)", [userId, input.identifier.trim(), normalized, staff.full_name, passwordHash, input.staffId, actor.userId])
        await transaction.query('insert into authorization_user_roles(id,user_id,role_id,active,created_by,updated_by) values($1,$2,$3,true,$4,$4)', [randomUUID(), userId, role.rows[0].id, actor.userId])
        await transaction.query('insert into authorization_user_outlet_scopes(id,user_id,outlet_scope_id,active,created_by,updated_by) values($1,$2,$3,true,$4,$4)', [randomUUID(), userId, input.outletScopeId, actor.userId])
        await transaction.query("insert into auth_security_events(id,user_id,event_type,success,details,actor_user_id) values($1,$2,'employee_account_created',true,$3,$4)", [randomUUID(), userId, JSON.stringify({ linkedStaffId: input.staffId, roleKey: 'employee_self_service', outletScopeId: input.outletScopeId }), actor.userId])
      })
    } catch (error) {
      if (error instanceof AuthError) throw error
      if (error instanceof Error && /user_accounts_one_active_per_staff/i.test(error.message)) throw new AuthError('STAFF_ACCOUNT_ALREADY_ACTIVE', 409, 'That Staff profile already has an active account.')
      if (error instanceof Error && /unique|duplicate/i.test(error.message)) throw new AuthError('LOGIN_IDENTIFIER_ALREADY_EXISTS', 409, 'That login identifier is already in use.')
      throw error
    }
    return { account: await this.staffAccount(input.staffId), temporaryPassword }
  }

  async resetEmployeePassword(staffId: string, actor: AuditActor) {
    const current = await this.staffAccount(staffId)
    if (!current.userId || current.status !== 'active') throw new AuthError('ACTIVE_ACCOUNT_NOT_FOUND', 409, 'The active account was not found.')
    const temporaryPassword = generateTemporaryPassword()
    await this.resetPassword(current.userId, temporaryPassword, actor)
    return { account: await this.staffAccount(staffId), temporaryPassword }
  }

  async setEmployeeAccountEnabled(staffId: string, enabled: boolean, actor: AuditActor) {
    const current = await this.staffAccount(staffId)
    if (!current.userId) throw new AuthError('EMPLOYEE_ACCOUNT_NOT_FOUND', 409, 'Create the employee account before changing its status.')
    if (!enabled) {
      await this.disableAccount(current.userId, actor)
      return this.staffAccount(staffId)
    }
    const staff = (await this.db.query<{ assignment_eligible: boolean }>(`select coalesce((select (c.metadata->>'eligibleForAssignments')::boolean from configuration_options c where c.group_key='employment_statuses' and c.value=s.employment_status_key),s.employment_status_key='active') assignment_eligible from staff s where s.id=$1`, [staffId])).rows[0]
    if (!staff?.assignment_eligible) throw new AuthError('STAFF_ACCOUNT_INACTIVE', 409, 'Archived or inactive staff accounts cannot be enabled.')
    if (current.status === 'active') return current
    try {
      await this.db.transaction(async transaction => {
        const conflict = await transaction.query("select id from user_accounts where staff_id=$1 and status='active' and id<>$2 limit 1", [staffId, current.userId])
        if (conflict.rows[0]) throw new AuthError('STAFF_ACCOUNT_ALREADY_ACTIVE', 409, 'That Staff profile already has an active account.')
        await transaction.query("update user_accounts set status='active',updated_by=$2,updated_at=now() where id=$1", [current.userId, actor.userId])
        await transaction.query("insert into auth_security_events(id,user_id,event_type,success,details,actor_user_id) values($1,$2,'account_enabled',true,'{}',$3)", [randomUUID(), current.userId, actor.userId])
      })
    } catch (error) {
      if (error instanceof AuthError) throw error
      if (error instanceof Error && /user_accounts_one_active_per_staff|unique|duplicate/i.test(error.message)) throw new AuthError('STAFF_ACCOUNT_ALREADY_ACTIVE', 409, 'That Staff profile already has an active account.')
      throw error
    }
    return this.staffAccount(staffId)
  }

  async disableLinkedAccountForInactiveStaff(staffId: string, actor: AuditActor) {
    const active = await this.db.query<{ id: string }>("select id from user_accounts where staff_id=$1 and status='active'", [staffId])
    if (!active.rows.length) return false
    await this.db.transaction(async transaction => {
      for (const account of active.rows) {
        await transaction.query("update user_accounts set status='disabled',updated_by=$2,updated_at=now() where id=$1", [account.id, actor.userId])
        await transaction.query('update auth_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=$1 and revoked_at is null', [account.id])
        await transaction.query("insert into auth_security_events(id,user_id,event_type,success,details,actor_user_id) values($1,$2,'account_disabled',true,$3,$4)", [randomUUID(), account.id, JSON.stringify({ reason: 'linked_staff_inactive', staffId }), actor.userId])
      }
    })
    return true
  }

  async currentUser(id: string): Promise<AuthenticatedUser | null> {
    const account = await this.account(id)
    return account ? { ...account, ...await this.authorization.authorizationForUser(id) } : null
  }

  private async securityEvent(eventType: string, success: boolean, input: { userId?: string | null; sessionId?: string | null; identifier?: string; actorUserId?: string | null; details?: Record<string, unknown> } = {}) {
    await this.db.query('insert into auth_security_events(id,user_id,session_id,event_type,success,identifier_hash,details,actor_user_id) values($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), input.userId || null, input.sessionId || null, eventType, success, input.identifier ? identifierHash(input.identifier) : null, JSON.stringify(input.details || {}), input.actorUserId || null])
  }

  async login(identifier: string, password: string) {
    const normalized = normalizeIdentifier(identifier)
    const result = await this.db.query<any>(`select u.id,u.login_identifier,u.display_name,u.password_hash,u.status,u.staff_id,u.must_change_password,
      case when u.staff_id is null then true else coalesce((select (c.metadata->>'eligibleForAssignments')::boolean from configuration_options c where c.group_key='employment_statuses' and c.value=s.employment_status_key),s.employment_status_key='active') end staff_eligible
      from user_accounts u left join staff s on s.id=u.staff_id where u.normalized_login_identifier=$1`, [normalized])
    const row = result.rows[0]
    const valid = row ? await verifyPassword(password, row.password_hash) : (await consumeUnknownPassword(password), false)
    if (!row || !valid || row.status !== 'active' || !row.staff_eligible) { await this.securityEvent('login_failed', false, { userId: row?.id, identifier, details: { reason: 'invalid_credentials_or_account_status' } }); throw new AuthError('INVALID_LOGIN', 401, 'Invalid username/email or password.') }
    const sessionId = randomUUID(); const token = randomBytes(32).toString('base64url'); const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString()
    await this.db.transaction(async transaction => {
      await transaction.query('insert into auth_sessions(id,token_hash,user_id,expires_at) values($1,$2,$3,$4)', [sessionId, tokenHash(token), row.id, expiresAt])
      await transaction.query('update user_accounts set last_login_at=now(),updated_at=now() where id=$1', [row.id])
      await transaction.query("insert into auth_security_events(id,user_id,session_id,event_type,success,identifier_hash,details,actor_user_id) values($1,$2,$3,'login_success',true,$4,'{}',$2)", [randomUUID(), row.id, sessionId, identifierHash(identifier)])
    })
    return { user: (await this.currentUser(row.id))!, token, sessionId, expiresAt }
  }

  async principalForToken(token: string | null | undefined): Promise<AuthPrincipal | null> {
    if (!token) return null
    const result = await this.db.query<any>("select s.id session_id,u.id,u.login_identifier,u.display_name,u.staff_id,u.must_change_password from auth_sessions s join user_accounts u on u.id=s.user_id left join staff st on st.id=u.staff_id where s.token_hash=$1 and s.revoked_at is null and s.expires_at>now() and u.status='active' and (u.staff_id is null or coalesce((select (c.metadata->>'eligibleForAssignments')::boolean from configuration_options c where c.group_key='employment_statuses' and c.value=st.employment_status_key),st.employment_status_key='active')=true)", [tokenHash(token)])
    const row = result.rows[0]; if (!row) return null
    await this.db.query('update auth_sessions set last_seen_at=now() where id=$1', [row.session_id])
    return { userId: row.id, sessionId: row.session_id, loginIdentifier: row.login_identifier, displayName: row.display_name, staffId: row.staff_id || null, mustChangePassword: Boolean(row.must_change_password), ...await this.authorization.authorizationForUser(row.id) }
  }

  async logout(token: string | null | undefined) {
    if (!token) return
    const session = await this.db.query<any>('select id,user_id from auth_sessions where token_hash=$1', [tokenHash(token)])
    if (!session.rows[0]) return
    const revoked = await this.db.query<any>('update auth_sessions set revoked_at=coalesce(revoked_at,now()) where id=$1 and revoked_at is null returning id', [session.rows[0].id])
    if (revoked.rows[0]) await this.securityEvent('logout', true, { userId: session.rows[0].user_id, sessionId: session.rows[0].id, actorUserId: session.rows[0].user_id })
  }

  async disableAccount(userId: string, actor: AuditActor) {
    const updated = await this.db.query<any>("update user_accounts set status='disabled',updated_by=$2,updated_at=now() where id=$1 and status<>'disabled' returning id", [userId, actor.userId])
    if (!updated.rows[0]) return this.account(userId)
    await this.db.query('update auth_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=$1 and revoked_at is null', [userId])
    await this.securityEvent('account_disabled', true, { userId, actorUserId: actor.userId })
    return this.account(userId)
  }

  async resetPassword(userId: string, password: string, actor: AuditActor) {
    const passwordHash = await hashPassword(password)
    await this.db.transaction(async transaction => {
      const updated = await transaction.query<any>("update user_accounts set password_hash=$2,must_change_password=true,updated_by=$3,updated_at=now() where id=$1 and status='active' returning id", [userId, passwordHash, actor.userId])
      if (!updated.rows[0]) throw new AuthError('ACTIVE_ACCOUNT_NOT_FOUND', 409, 'The active account was not found.')
      await transaction.query('update auth_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=$1 and revoked_at is null', [userId])
      await transaction.query("insert into auth_security_events(id,user_id,event_type,success,details,actor_user_id) values($1,$2,'password_reset',true,$3,$4)", [randomUUID(), userId, JSON.stringify({ sessionsRevoked: true }), actor.userId])
    })
    return this.account(userId)
  }

  async changeOwnPassword(userId: string, currentPassword: string, replacementPassword: string) {
    const row = (await this.db.query<any>("select id,password_hash from user_accounts where id=$1 and status='active'", [userId])).rows[0]
    if (!row || !await verifyPassword(currentPassword, row.password_hash)) throw new AuthError('CURRENT_PASSWORD_INVALID', 401, 'The current password is incorrect.')
    if (await verifyPassword(replacementPassword, row.password_hash)) throw new AuthError('NEW_PASSWORD_MUST_DIFFER', 400, 'Choose a password that differs from the current password.')
    const passwordHash = await hashPassword(replacementPassword)
    await this.db.transaction(async transaction => {
      await transaction.query('update user_accounts set password_hash=$2,must_change_password=false,updated_by=$1,updated_at=now() where id=$1', [userId, passwordHash])
      await transaction.query('update auth_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=$1 and revoked_at is null', [userId])
      await transaction.query("insert into auth_security_events(id,user_id,event_type,success,details,actor_user_id) values($1,$2,'password_changed',true,$3,$2)", [randomUUID(), userId, JSON.stringify({ sessionsRevoked: true, firstLoginRequirementCleared: true })])
    })
    return this.account(userId)
  }

  async completeRequiredPasswordChange(userId: string, replacementPassword: string) {
    const row = (await this.db.query<any>("select id,password_hash,must_change_password from user_accounts where id=$1 and status='active'", [userId])).rows[0]
    if (!row) throw new AuthError('ACTIVE_ACCOUNT_NOT_FOUND', 409, 'The active account was not found.')
    if (!row.must_change_password) throw new AuthError('PASSWORD_CHANGE_NOT_REQUIRED', 409, 'The temporary-password change has already been completed.')
    if (await verifyPassword(replacementPassword, row.password_hash)) throw new AuthError('NEW_PASSWORD_MUST_DIFFER', 400, 'Choose a password that differs from the temporary password.')
    const passwordHash = await hashPassword(replacementPassword)
    await this.db.transaction(async transaction => {
      const updated = await transaction.query<any>("update user_accounts set password_hash=$2,must_change_password=false,updated_by=$1,updated_at=now() where id=$1 and status='active' and must_change_password=true returning id", [userId, passwordHash])
      if (!updated.rows[0]) throw new AuthError('PASSWORD_CHANGE_NOT_REQUIRED', 409, 'The temporary-password change has already been completed.')
      await transaction.query('update auth_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=$1 and revoked_at is null', [userId])
      await transaction.query("insert into auth_security_events(id,user_id,event_type,success,details,actor_user_id) values($1,$2,'password_changed',true,$3,$2)", [randomUUID(), userId, JSON.stringify({ sessionsRevoked: true, firstLoginRequirementCleared: true, requiredChangeFlow: true })])
    })
    return this.account(userId)
  }

  async revokeSession(sessionId: string, actor: AuditActor) {
    const row = await this.db.query<any>('update auth_sessions set revoked_at=coalesce(revoked_at,now()) where id=$1 returning user_id', [sessionId])
    if (row.rows[0]) await this.securityEvent('session_revoked', true, { userId: row.rows[0].user_id, sessionId, actorUserId: actor.userId })
  }
}

export function parseSessionToken(request: IncomingMessage) {
  const cookies = (request.headers.cookie || '').split(';').map(value => value.trim())
  const found = cookies.find(value => value.startsWith(`${SESSION_COOKIE}=`))
  return found ? decodeURIComponent(found.slice(SESSION_COOKIE.length + 1)) : null
}

export function sessionCookie(token: string, production = process.env.NODE_ENV === 'production') { return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${production ? '; Secure' : ''}` }
export function clearSessionCookie(production = process.env.NODE_ENV === 'production') { return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${production ? '; Secure' : ''}` }

export function assertTrustedOrigin(request: IncomingMessage) {
  const origin = request.headers.origin
  if (!origin) return
  const configured = (process.env.APP_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean)
  if (configured.includes(origin)) return
  if (process.env.NODE_ENV !== 'production' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return
  throw new AuthError('UNTRUSTED_ORIGIN', 401, 'Request origin is not allowed.')
}

export async function requireAuthenticatedUser(request: IncomingMessage, auth: AuthService, options: { allowPasswordChangeRequired?: boolean } = {}) {
  const principal = await auth.principalForToken(parseSessionToken(request))
  if (!principal) throw new AuthError('UNAUTHORIZED', 401, 'Authentication is required.')
  if (principal.mustChangePassword && !options.allowPasswordChangeRequired) throw new AuthError('PASSWORD_CHANGE_REQUIRED', 403, 'Change the temporary password before continuing.')
  return principal
}
