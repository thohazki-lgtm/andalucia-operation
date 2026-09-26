import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { PGlite } from '@electric-sql/pglite'
import type { AuthPrincipal, AuthenticatedUser, AuditActor, UserAccountIdentity } from '../src/domain.js'
import { AuthorizationService } from './authorization-service.js'

const SESSION_COOKIE = 'andalucia_session'
const SESSION_SECONDS = 8 * 60 * 60
const SCRYPT_COST = 16384
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELISM = 1
const HASH_BYTES = 32
const DUMMY_SALT = Buffer.from('andalucia-auth-dummy-salt')

export class AuthError extends Error {
  constructor(public readonly code: string, public readonly status: 400 | 401 | 409 | 429, message: string) { super(message) }
}

const normalizeIdentifier = (value: string) => value.normalize('NFKC').trim().toLowerCase()
const safeUser = (row: any): UserAccountIdentity => ({ userId: row.id, loginIdentifier: row.login_identifier, displayName: row.display_name, status: row.status, staffId: row.staff_id || null })
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

  async createAccount(input: { identifier: string; displayName: string; password: string; staffId?: string | null }, actor: AuditActor) {
    const normalized = normalizeIdentifier(input.identifier)
    if (normalized.length < 3 || normalized.length > 254 || /\s/.test(normalized)) throw new AuthError('INVALID_LOGIN_IDENTIFIER', 400, 'Enter a valid username or email address.')
    if (!input.displayName.trim()) throw new AuthError('DISPLAY_NAME_REQUIRED', 400, 'Display name is required.')
    if (input.staffId) { const staff = await this.db.query('select id from staff where id=$1', [input.staffId]); if (!staff.rows[0]) throw new AuthError('STAFF_ACCOUNT_LINK_NOT_FOUND', 409, 'The linked Staff record was not found.') }
    const id = randomUUID(); const passwordHash = await hashPassword(input.password)
    try {
      await this.db.transaction(async transaction => {
        await transaction.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status,staff_id,created_by,updated_by) values($1,$2,$3,$4,$5,'active',$6,$7,$7)", [id, input.identifier.trim(), normalized, input.displayName.trim(), passwordHash, input.staffId || null, actor.userId])
        await transaction.query("insert into auth_security_events(id,user_id,event_type,success,details,actor_user_id) values($1,$2,'account_created',true,$3,$4)", [randomUUID(), id, JSON.stringify({ displayName: input.displayName.trim(), linkedStaffId: input.staffId || null }), actor.userId === 'bootstrap' ? null : actor.userId])
      })
    } catch (error) { if (error instanceof Error && /unique|duplicate/i.test(error.message)) throw new AuthError('LOGIN_IDENTIFIER_ALREADY_EXISTS', 409, 'That login identifier is already in use.'); throw error }
    return (await this.account(id))!
  }

  async account(id: string): Promise<UserAccountIdentity | null> { const result = await this.db.query<any>('select id,login_identifier,display_name,status,staff_id from user_accounts where id=$1', [id]); return result.rows[0] ? safeUser(result.rows[0]) : null }

  async currentUser(id: string): Promise<AuthenticatedUser | null> {
    const account = await this.account(id)
    return account ? { ...account, ...await this.authorization.authorizationForUser(id) } : null
  }

  private async securityEvent(eventType: string, success: boolean, input: { userId?: string | null; sessionId?: string | null; identifier?: string; actorUserId?: string | null; details?: Record<string, unknown> } = {}) {
    await this.db.query('insert into auth_security_events(id,user_id,session_id,event_type,success,identifier_hash,details,actor_user_id) values($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), input.userId || null, input.sessionId || null, eventType, success, input.identifier ? identifierHash(input.identifier) : null, JSON.stringify(input.details || {}), input.actorUserId || null])
  }

  async login(identifier: string, password: string) {
    const normalized = normalizeIdentifier(identifier)
    const result = await this.db.query<any>('select id,login_identifier,display_name,password_hash,status,staff_id from user_accounts where normalized_login_identifier=$1', [normalized])
    const row = result.rows[0]
    const valid = row ? await verifyPassword(password, row.password_hash) : (await consumeUnknownPassword(password), false)
    if (!row || !valid || row.status !== 'active') { await this.securityEvent('login_failed', false, { userId: row?.id, identifier, details: { reason: 'invalid_credentials_or_account_status' } }); throw new AuthError('INVALID_LOGIN', 401, 'Invalid username/email or password.') }
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
    const result = await this.db.query<any>("select s.id session_id,u.id,u.login_identifier,u.display_name,u.staff_id from auth_sessions s join user_accounts u on u.id=s.user_id where s.token_hash=$1 and s.revoked_at is null and s.expires_at>now() and u.status='active'", [tokenHash(token)])
    const row = result.rows[0]; if (!row) return null
    await this.db.query('update auth_sessions set last_seen_at=now() where id=$1', [row.session_id])
    return { userId: row.id, sessionId: row.session_id, loginIdentifier: row.login_identifier, displayName: row.display_name, staffId: row.staff_id || null, ...await this.authorization.authorizationForUser(row.id) }
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

export async function requireAuthenticatedUser(request: IncomingMessage, auth: AuthService) {
  const principal = await auth.principalForToken(parseSessionToken(request))
  if (!principal) throw new AuthError('UNAUTHORIZED', 401, 'Authentication is required.')
  return principal
}
