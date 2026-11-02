import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { AuthPrincipal, BookingDayLockStatus } from '../src/domain.js'
import { serviceDate } from '../src/service-date.js'
import { auditActorLabel } from './authorization-service.js'

export const BOOKING_DAY_LOCK_CUTOFF = '04:00'
export const BOOKING_DAY_REOPEN_WINDOW_MINUTES = 120

const bookingDayLockGroup = 'booking_day_locks'
type Queryable = Pick<PGlite, 'query'>
type BookingDayLockMetadata = {
  state?: 'locked' | 'reopened'
  lockKind?: 'manual' | 'automatic' | 'relock'
  reason?: string
  actor?: string
  actorUserId?: string
  changedAt?: string
  reopenedAt?: string
  reopenedBy?: string
  reopenedByUserId?: string
  reopenReason?: string
  reopenedUntil?: string
}

export type BookingDayCorrectionContext = {
  date: string
  reason: string
  reopenedBy: string
  reopenedByUserId: string
  reopenedAt: string
  reopenedUntil: string
}

type BookingDayLockServiceOptions = { now?: () => Date }

const validDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3])
}

const parseMetadata = (value: unknown): BookingDayLockMetadata => {
  if (!value) return {}
  if (typeof value === 'string') { try { return JSON.parse(value) as BookingDayLockMetadata } catch { return {} } }
  return value as BookingDayLockMetadata
}

export class BookingDayLockService {
  constructor(private readonly db: PGlite, private readonly options: BookingDayLockServiceOptions = {}) {}

  private now() { return this.options.now?.() || new Date() }
  private validateDate(date: string) { if (!validDate(date)) throw new Error('Select a valid Booking service date.') }
  private cutoffAt(date: string) {
    const [year, month, day] = date.split('-').map(Number)
    // Maldives is UTC+05:00 year-round. 04:00 the following day is 23:00Z on the selected service day.
    return new Date(Date.UTC(year, month - 1, day + 1, -1, 0, 0, 0))
  }
  private async metadata(date: string, database: Queryable = this.db) {
    const result = await database.query<{ id: string; metadata: unknown }>('select id,metadata from configuration_options where group_key=$1 and value=$2', [bookingDayLockGroup, date])
    return { id: result.rows[0]?.id || null, metadata: parseMetadata(result.rows[0]?.metadata) }
  }
  private effective(date: string, metadata: BookingDayLockMetadata, now = this.now()): Omit<BookingDayLockStatus, 'canManageDayLock'> {
    const cutoff = this.cutoffAt(date)
    const reopenedUntil = metadata.state === 'reopened' && metadata.reopenedUntil ? new Date(metadata.reopenedUntil) : null
    const reopened = Boolean(reopenedUntil && reopenedUntil.getTime() > now.getTime())
    const automatic = !metadata.state && now.getTime() >= cutoff.getTime()
    const expiredReopen = metadata.state === 'reopened' && !reopened
    const locked = metadata.state === 'locked' || automatic || expiredReopen
    return {
      date,
      state: locked ? 'locked' : reopened ? 'reopened' : 'open',
      locked,
      lockKind: metadata.state === 'locked' ? metadata.lockKind || 'manual' : automatic ? 'automatic' : expiredReopen ? 'relock' : null,
      cutoffLocalTime: BOOKING_DAY_LOCK_CUTOFF,
      cutoffAt: cutoff.toISOString(),
      reason: metadata.reason || (automatic ? 'Automatic Maldives service cutoff' : expiredReopen ? 'Authorized correction window expired' : null),
      actor: metadata.actor || null,
      actorUserId: metadata.actorUserId || null,
      changedAt: metadata.changedAt || (automatic ? cutoff.toISOString() : null),
      reopenedAt: metadata.reopenedAt || null,
      reopenedBy: metadata.reopenedBy || null,
      reopenedByUserId: metadata.reopenedByUserId || null,
      reopenReason: metadata.reopenReason || null,
      reopenedUntil: metadata.reopenedUntil || null,
      correctionWindowMinutes: BOOKING_DAY_REOPEN_WINDOW_MINUTES
    }
  }
  private async write(date: string, action: 'locked' | 'reopened' | 'relocked', before: Omit<BookingDayLockStatus, 'canManageDayLock'>, metadata: BookingDayLockMetadata, actor: string) {
    await this.db.transaction(async transaction => {
      const stored = await transaction.query<{ id: string }>('insert into configuration_options(id,group_key,value,label,metadata,active,sort_order) values($1,$2,$3,$4,$5,true,0) on conflict(group_key,value) do update set label=excluded.label,metadata=excluded.metadata,active=true,updated_at=now() returning id', [randomUUID(), bookingDayLockGroup, date, `Booking service day ${date}`, JSON.stringify(metadata)])
      const after = this.effective(date, metadata)
      await transaction.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'booking_day_lock', stored.rows[0].id, action, JSON.stringify(before), JSON.stringify(after), actor])
    })
  }

  async status(date: string, canManageDayLock = false): Promise<BookingDayLockStatus> {
    this.validateDate(date)
    const stored = await this.metadata(date)
    return { ...this.effective(date, stored.metadata), canManageDayLock }
  }

  async assertEditable(date: string, database: Queryable = this.db): Promise<BookingDayCorrectionContext | null> {
    this.validateDate(date)
    const stored = await this.metadata(date, database)
    const status = this.effective(date, stored.metadata)
    if (status.locked) throw new Error(`BOOKING_DAY_LOCKED: ${date} is locked. An authorized manager must reopen it with a reason before corrections can be saved.`)
    if (status.state !== 'reopened') return null
    return {
      date,
      reason: status.reopenReason || '',
      reopenedBy: status.reopenedBy || '',
      reopenedByUserId: status.reopenedByUserId || '',
      reopenedAt: status.reopenedAt || '',
      reopenedUntil: status.reopenedUntil || ''
    }
  }

  async lock(date: string, confirmation: string, principal: AuthPrincipal) {
    this.validateDate(date)
    if (date > serviceDate(this.now())) throw new Error('Future Booking service days cannot be locked.')
    if (confirmation !== `LOCK BOOKINGS ${date}`) throw new Error(`Type LOCK BOOKINGS ${date} to confirm.`)
    const actor = auditActorLabel(principal)
    const stored = await this.metadata(date)
    const before = this.effective(date, stored.metadata)
    if (before.locked) return { ...before, canManageDayLock: true }
    const metadata: BookingDayLockMetadata = { state: 'locked', lockKind: 'manual', reason: 'Manager completed service', actor, actorUserId: principal.userId, changedAt: this.now().toISOString() }
    await this.write(date, 'locked', before, metadata, actor)
    return this.status(date, true)
  }

  async reopen(date: string, reason: string, confirmation: string, principal: AuthPrincipal) {
    this.validateDate(date)
    const trimmedReason = reason.trim()
    if (trimmedReason.length < 8) throw new Error('A clear Booking day reopening reason is required.')
    if (confirmation !== `REOPEN BOOKINGS ${date}`) throw new Error(`Type REOPEN BOOKINGS ${date} to confirm.`)
    const actor = auditActorLabel(principal)
    const stored = await this.metadata(date)
    const before = this.effective(date, stored.metadata)
    if (!before.locked) throw new Error('This Booking service day is not locked.')
    const reopenedAt = this.now()
    const metadata: BookingDayLockMetadata = {
      ...stored.metadata,
      state: 'reopened',
      reopenedAt: reopenedAt.toISOString(),
      reopenedBy: actor,
      reopenedByUserId: principal.userId,
      reopenReason: trimmedReason,
      reopenedUntil: new Date(reopenedAt.getTime() + BOOKING_DAY_REOPEN_WINDOW_MINUTES * 60_000).toISOString(),
      actor,
      actorUserId: principal.userId,
      changedAt: reopenedAt.toISOString()
    }
    await this.write(date, 'reopened', before, metadata, actor)
    return this.status(date, true)
  }

  async relock(date: string, reason: string, confirmation: string, principal: AuthPrincipal) {
    this.validateDate(date)
    const trimmedReason = reason.trim()
    if (trimmedReason.length < 8) throw new Error('A clear Booking day re-lock reason is required.')
    if (confirmation !== `RELOCK BOOKINGS ${date}`) throw new Error(`Type RELOCK BOOKINGS ${date} to confirm.`)
    const actor = auditActorLabel(principal)
    const stored = await this.metadata(date)
    const before = this.effective(date, stored.metadata)
    if (before.state !== 'reopened') throw new Error('This Booking service day is not currently reopened.')
    const metadata: BookingDayLockMetadata = { ...stored.metadata, state: 'locked', lockKind: 'relock', reason: trimmedReason, actor, actorUserId: principal.userId, changedAt: this.now().toISOString() }
    await this.write(date, 'relocked', before, metadata, actor)
    return this.status(date, true)
  }
}

export const bookingCorrectionAudit = (context: BookingDayCorrectionContext | null) => context ? { bookingDayCorrection: context } : {}
