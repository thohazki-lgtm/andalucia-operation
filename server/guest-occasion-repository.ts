import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { AuthPrincipal, ConfigOption, GuestExperienceView, GuestOccasionRecord, GuestOccasionSummary } from '../src/domain.js'
import { interpretBookingOccasions, type BookingOccasionEvidence } from './booking-occasion-interpreter.js'

export type GuestOccasionConfigGroup = 'types' | 'statuses'
const groupKeys: Record<GuestOccasionConfigGroup, string> = { types: 'occasion_types', statuses: 'occasion_statuses' }
const protectedTypeValues = new Set(['honeymoon','birthday','anniversary','see_you_soon','siyam_family','famtrip','presstrip'])
const protectedTypeLabels = new Set(['honeymoon','see you soon','birthday','anniversary','siyam family','famtrip','presstrip'])
const protectedWorkflowValues = new Set(['pending','ready','completed'])
const normalizedLabel = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ')
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
const seeds: Record<GuestOccasionConfigGroup, Array<Omit<ConfigOption, 'id'>>> = {
  types: [
    { value: 'honeymoon', label: 'Honeymoon', color: '#b36f8d', active: true, metadata: { detectionKeywords: ['honeymoon', 'honeymooners'], defaultStatus: 'pending', occasionCategory: 'honeymoon', protected: true, systemControlled: true } },
    { value: 'birthday', label: 'Birthday', color: '#b38b3a', active: true, metadata: { detectionKeywords: ['birthday', 'birthday celebration'], defaultStatus: 'pending', occasionCategory: 'birthday', protected: true, systemControlled: true } },
    { value: 'anniversary', label: 'Anniversary', color: '#7d6399', active: true, metadata: { detectionKeywords: ['anniversary', 'wedding anniversary'], defaultStatus: 'pending', occasionCategory: 'anniversary', protected: true, systemControlled: true } },
    { value: 'see_you_soon', label: 'See You Soon', color: '#4d7fa0', active: true, metadata: { detectionKeywords: ['see you soon'], defaultStatus: 'pending', occasionCategory: 'seeYouSoon', protected: true, systemControlled: true } },
    { value: 'siyam_family', label: 'Siyam Family', color: '#2e6f68', active: true, metadata: { detectionKeywords: ['siyam world family members'], defaultStatus: 'pending', occasionCategory: 'siyamFamily', countsAsVipSpecial: true, protected: true, systemControlled: true } },
    { value: 'famtrip', label: 'Famtrip', color: '#6c63a8', active: true, metadata: { detectionKeywords: ['famtrip', 'fam trip'], defaultStatus: 'pending', occasionCategory: 'famtrip', countsAsVipSpecial: true, protected: true, systemControlled: true } },
    { value: 'presstrip', label: 'Presstrip', color: '#9b5f53', active: true, metadata: { detectionKeywords: ['presstrip', 'press trip'], defaultStatus: 'pending', occasionCategory: 'presstrip', countsAsVipSpecial: true, protected: true, systemControlled: true } }
  ],
  statuses: [
    { value: 'pending', label: 'Attention', color: '#b38b3a', active: true, metadata: { countsAsOccasionAttention: true, occasionStage: 'active', occasionWorkflow: 'attention' } },
    { value: 'ready', label: 'Prepared', color: '#2f8063', active: true, metadata: { countsAsOccasionAttention: false, occasionStage: 'active', occasionWorkflow: 'prepared' } },
    { value: 'completed', label: 'Completed', color: '#647680', active: true, metadata: { countsAsOccasionAttention: false, occasionStage: 'completed', occasionWorkflow: 'completed' } }
  ]
}

const mapOption = (row: any): ConfigOption => ({ ...row, metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata })
export class GuestOccasionRepository {
  constructor(private readonly db: PGlite) {}

  async initialize() {
    for (const group of Object.keys(groupKeys) as GuestOccasionConfigGroup[]) {
      for (let index = 0; index < seeds[group].length; index++) {
        const option = seeds[group][index]
        await this.db.query('insert into configuration_options (id, group_key, value, label, color, metadata, active, sort_order) select $1,$2,$3,$4,$5,$6,$7,$8 where not exists (select 1 from configuration_options where group_key=$2 and value=$3)', [randomUUID(), groupKeys[group], option.value, option.label, option.color || null, JSON.stringify(option.metadata || {}), option.active, index])
      }
    }
    for (const option of seeds.types) await this.db.query('update configuration_options set label=$1, metadata=metadata || $2::jsonb, active=true where group_key=$3 and value=$4', [option.label, JSON.stringify(option.metadata || {}), groupKeys.types, option.value])
    for (const option of seeds.statuses) await this.db.query('update configuration_options set label=$1, metadata=metadata || $2::jsonb, active=true where group_key=$3 and value=$4', [option.label, JSON.stringify(option.metadata || {}), groupKeys.statuses, option.value])
    await this.db.query("update configuration_options set active=false where group_key=$1 and value='preparing'", [groupKeys.statuses])
  }

  async configuration(): Promise<Record<GuestOccasionConfigGroup, ConfigOption[]>> {
    const output = {} as Record<GuestOccasionConfigGroup, ConfigOption[]>
    for (const group of Object.keys(groupKeys) as GuestOccasionConfigGroup[]) {
      const result = await this.db.query<any>('select id, value, label, color, metadata, active, sort_order from configuration_options where group_key=$1 order by sort_order, label', [groupKeys[group]])
      output[group] = result.rows.map((row: any) => ({ ...mapOption(row), sortOrder: row.sort_order }))
    }
    return output
  }

  async saveConfiguration(group: GuestOccasionConfigGroup, option: ConfigOption, actor = 'Venue Manager'): Promise<ConfigOption> {
    const beforeResult = option.id ? await this.db.query<any>('select id, value, label, color, metadata, active, sort_order from configuration_options where id=$1 and group_key=$2', [option.id, groupKeys[group]]) : { rows: [] }
    const before = beforeResult.rows[0] ? { ...mapOption(beforeResult.rows[0]), sortOrder: beforeResult.rows[0].sort_order } : null
    if (group === 'statuses' && !before) throw new Error('Guest Experience workflow statuses are system-controlled.')
    const protectedType = group === 'types' && before && protectedTypeValues.has(before.value)
    if (protectedType && (option.value !== before.value || option.label !== before.label || option.active !== before.active || stableJson(option.metadata || {}) !== stableJson(before.metadata || {}))) throw new Error('Protected Guest Experience types allow display color changes only.')
    if (group === 'statuses' && before) {
      if (!protectedWorkflowValues.has(before.value)) throw new Error('Historical Guest Experience statuses are read-only.')
      if (option.value !== before.value || option.label !== before.label || option.active !== before.active || stableJson(option.metadata || {}) !== stableJson(before.metadata || {})) throw new Error('Guest Experience workflow statuses allow display color changes only.')
    }
    if (group === 'types' && before && !protectedType && option.value !== before.value) throw new Error('Guest Experience type identity is immutable.')
    if (group === 'types' && !protectedType && protectedTypeLabels.has(normalizedLabel(option.label))) throw new Error('That name is reserved for a protected Guest Experience type.')
    const value = before ? before.value : group === 'types' ? `manual_${randomUUID().replaceAll('-', '')}` : option.value
    const metadata = group === 'types'
      ? before
        ? protectedType
          ? before.metadata
          : { ...before.metadata, detectionKeywords: [], countsAsVipSpecial: false, systemControlled: false, manualOnly: true }
        : { ...option.metadata, detectionKeywords: [], occasionCategory: 'other', countsAsVipSpecial: false, protected: true, systemControlled: false, manualOnly: true }
      : before
        ? before.metadata
        : option.metadata
    const label = protectedType || group === 'statuses' ? before!.label : option.label
    const active = protectedType || group === 'statuses' ? before!.active : option.active
    const result = await this.db.query<any>('insert into configuration_options (id, group_key, value, label, color, metadata, active, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do update set value=excluded.value, label=excluded.label, color=excluded.color, metadata=excluded.metadata, active=excluded.active, updated_at=now() returning id, value, label, color, metadata, active', [option.id || randomUUID(), groupKeys[group], value, label, option.color || null, JSON.stringify(metadata || {}), active, 100])
    const saved = mapOption(result.rows[0])
    await this.db.query('insert into audit_logs (id, entity_type, entity_id, action, before_data, after_data, actor) values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'guest_occasion_configuration', saved.id, before ? 'updated' : 'created', before ? JSON.stringify(before) : null, JSON.stringify(saved), actor])
    return saved
  }

  private readonly select = "select g.id, g.occasion_type, g.booking_id, coalesce(b.guest_name,g.manual_guest_name) guest_name, coalesce(b.room_number,g.manual_room_number) room_number, coalesce(b.reservation_date,g.occasion_date)::text reservation_date, coalesce(b.reservation_time,g.occasion_time)::text reservation_time, coalesce(b.table_number,g.manual_table_number) table_number, coalesce(b.waiter_id,g.manual_waiter_id) waiter_id, g.status_value, g.source, g.source_text, g.notes, g.active, b.booking_number, b.covers, b.booking_source, b.import_source, b.source_filename, g.created_at::text, g.updated_at::text, g.created_by, g.updated_by, s.full_name waiter_name, s.staff_number waiter_number, s.position_key waiter_position, s.employment_status_key waiter_employment_status, (select count(*)::int from guest_occasions gh left join bookings bh on bh.id=gh.booking_id where gh.active=true and gh.occasion_type='siyam_family' and gh.id<>g.id and coalesce(bh.reservation_date,gh.occasion_date)<coalesce(b.reservation_date,g.occasion_date) and lower(regexp_replace(trim(coalesce(bh.guest_name,gh.manual_guest_name)), '\\s+', ' ', 'g'))=lower(regexp_replace(trim(coalesce(b.guest_name,g.manual_guest_name)), '\\s+', ' ', 'g'))) previous_andalucia_visits from guest_occasions g left join bookings b on b.id=g.booking_id left join staff s on s.id=coalesce(b.waiter_id,g.manual_waiter_id)"

  private mapRecord(row: any): GuestOccasionRecord {
    const visitMatch = String(row.source_text || '').match(/\b(\d{1,3})(?:st|nd|rd|th)\s+visit\b/i)
    const visitNumber = visitMatch ? Number(visitMatch[1]) : null
    const previousAndaluciaVisits = Number(row.previous_andalucia_visits || 0)
    return { id: row.id, occasionType: row.occasion_type, bookingId: row.booking_id, guestName: row.guest_name, roomNumber: row.room_number || '', reservationDate: row.reservation_date, reservationTime: row.reservation_time ? row.reservation_time.slice(0, 5) : '', tableNumber: row.table_number || '', waiterId: row.waiter_id, waiter: row.waiter_id ? { name: row.waiter_name, number: row.waiter_number, position: row.waiter_position, employmentStatus: row.waiter_employment_status } : null, status: row.status_value, source: row.source, sourceText: row.source_text || '', notes: row.notes || '', active: row.active, bookingNumber: row.booking_number, covers: Number(row.covers || 0), bookingSource: row.booking_source, importSource: row.import_source, sourceFilename: row.source_filename, visitNumber, previousAndaluciaVisits, knownVisits: visitNumber ?? (previousAndaluciaVisits ? previousAndaluciaVisits + 1 : null), createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by, updatedBy: row.updated_by }
  }

  async list(date: string, outletKey = 'andalucia'): Promise<GuestOccasionRecord[]> {
    const result = await this.db.query<any>(`${this.select} where coalesce(b.reservation_date,g.occasion_date)=$1 and (g.booking_id is null or b.venue_key=$2) order by coalesce(b.reservation_time,g.occasion_time), coalesce(b.guest_name,g.manual_guest_name)`, [date, outletKey])
    return result.rows.map((row: any) => this.mapRecord(row))
  }

  async find(id: string): Promise<GuestOccasionRecord | null> {
    const result = await this.db.query<any>(`${this.select} where g.id=$1`, [id])
    return result.rows[0] ? this.mapRecord(result.rows[0]) : null
  }

  async save(record: GuestOccasionRecord, actor = 'Venue Manager', outletKey = 'andalucia'): Promise<GuestOccasionRecord> {
    const previous = await this.find(record.id)
    const configuration = await this.configuration()
    const selectedType = configuration.types.find(option => option.value === record.occasionType)
    const selectedStatus = configuration.statuses.find(option => option.value === record.status)
    if (!selectedType || ((!previous || previous.occasionType !== record.occasionType) && !selectedType.active)) throw new Error('Inactive occasion types cannot be used for new occasions.')
    if (!selectedStatus || ((!previous || previous.status !== record.status) && !selectedStatus.active)) throw new Error('Inactive occasion statuses cannot be used for new occasions.')
    if (record.bookingId) {
      const booking = await this.db.query<{ id: string }>('select id from bookings where id=$1 and venue_key=$2', [record.bookingId, outletKey])
      if (!booking.rows[0]) throw new Error('The selected booking no longer exists.')
      const duplicate = await this.db.query<{ id: string }>('select id from guest_occasions where booking_id=$1 and occasion_type=$2 and id<>$3 limit 1', [record.bookingId, record.occasionType, record.id])
      if (duplicate.rows[0]) throw new Error('This booking already has that occasion type.')
      const normalizedKey = new Map([['honeymoon','HONEYMOON'],['birthday','BIRTHDAY'],['anniversary','ANNIVERSARY'],['see_you_soon','SEE_YOU_SOON'],['siyam_family','SIYAM_FAMILY'],['famtrip','FAMTRIP'],['presstrip','PRESSTRIP']]).get(record.occasionType)
      const intelligenceAvailable = Number((await this.db.query<{ count: number }>("select count(*)::int count from information_schema.tables where table_schema='public' and table_name='booking_intelligence_findings'")).rows[0].count) > 0
      if (!previous && normalizedKey && intelligenceAvailable && (await this.db.query('select id from booking_intelligence_findings where booking_id=$1 and normalized_key=$2 and active=true and superseded_by_id is null limit 1', [record.bookingId, normalizedKey])).rows[0]) throw new Error('This booking already has an active Booking Intelligence finding for that Guest Experience type.')
    } else if (!previous) {
      const duplicate = await this.db.query('select id from guest_occasions where booking_id is null and active=true and occasion_type=$1 and occasion_date=$2 and occasion_time=$3 and lower(trim(manual_guest_name))=lower(trim($4)) and coalesce(lower(trim(manual_room_number)),\'\')=lower(trim($5)) limit 1', [record.occasionType, record.reservationDate, record.reservationTime, record.guestName, record.roomNumber || ''])
      if (duplicate.rows[0]) throw new Error('An equivalent manual Guest Experience record already exists.')
    }
    if (!record.bookingId && record.waiterId && record.waiterId !== previous?.waiterId) {
      const waiter = await this.db.query<{ employment_status_key: string }>('select employment_status_key from staff where id=$1', [record.waiterId])
      if (!waiter.rows[0]) throw new Error('The selected waiter no longer exists.')
      if (waiter.rows[0].employment_status_key !== 'active') throw new Error('Inactive staff cannot be assigned to new occasions.')
    }
    const source = previous?.source || 'manager_created'
    if (previous) await this.db.query('update guest_occasions set booking_id=$2, occasion_type=$3, status_value=$4, source=$5, source_text=$6, notes=$7, manual_guest_name=$8, manual_room_number=$9, occasion_date=$10, occasion_time=$11, manual_table_number=$12, manual_waiter_id=$13, active=$14, updated_by=$15, updated_at=now() where id=$1', [record.id, record.bookingId || null, record.occasionType, record.status, source, record.sourceText || '', record.notes || '', record.guestName.trim(), record.roomNumber || null, record.reservationDate, record.reservationTime, record.tableNumber || null, record.waiterId || null, record.active, actor])
    else await this.db.query('insert into guest_occasions (id, booking_id, occasion_type, status_value, source, source_text, notes, manual_guest_name, manual_room_number, occasion_date, occasion_time, manual_table_number, manual_waiter_id, active, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14,$14)', [record.id, record.bookingId || null, record.occasionType, record.status, source, record.sourceText || 'Manager-created Guest Experience record', record.notes || '', record.guestName.trim(), record.roomNumber || null, record.reservationDate, record.reservationTime, record.tableNumber || null, record.waiterId || null, actor])
    const saved = await this.find(record.id)
    if (!saved) throw new Error('Guest occasion could not be saved.')
    await this.db.query('insert into audit_logs (id, entity_type, entity_id, action, before_data, after_data, actor) values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'guest_occasion', record.id, previous ? 'updated' : 'created', previous ? JSON.stringify(previous) : null, JSON.stringify(saved), actor])
    return saved
  }

  async detectForBooking(bookingId: string, outletScopeIdOrLegacyActor?: string, actor = 'Automatic Detection'): Promise<GuestOccasionRecord[]> {
    if (!outletScopeIdOrLegacyActor || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(outletScopeIdOrLegacyActor)) return this.detectLegacyForBooking(bookingId, outletScopeIdOrLegacyActor || actor)
    const outletScopeId = outletScopeIdOrLegacyActor
    const bookingResult = await this.db.query<any>('select id, guest_name, room_number, reservation_date::text, reservation_time::text, table_number, waiter_id from bookings where id=$1 and venue_key=(select scope_key from outlet_scopes where id=$2)', [bookingId, outletScopeId])
    const booking = bookingResult.rows[0]
    if (!booking) return []
    const findingResult = await this.db.query<any>(`select id,normalized_key,raw_evidence_text,detected_phrase,evidence_location,rule_key,rule_version,effective_payload from booking_intelligence_findings where booking_id=$1 and outlet_scope_id=$2 and active=true and superseded_by_id is null and normalized_key=any($3::text[]) order by created_at`, [bookingId, outletScopeId, ['HONEYMOON','BIRTHDAY','ANNIVERSARY','SEE_YOU_SOON','SIYAM_FAMILY','FAMTRIP','PRESSTRIP']])
    if (!findingResult.rows.length) return []
    const configuration = await this.configuration()
    const activeStatuses = configuration.statuses.filter(option => option.active)
    const created: GuestOccasionRecord[] = []
    const findingType = new Map([['HONEYMOON','honeymoon'],['BIRTHDAY','birthday'],['ANNIVERSARY','anniversary'],['SEE_YOU_SOON','see_you_soon'],['SIYAM_FAMILY','siyam_family'],['FAMTRIP','famtrip'],['PRESSTRIP','presstrip']])
    for (const finding of findingResult.rows) {
      const value = findingType.get(finding.normalized_key)
      const type = configuration.types.find(option => option.value === value && option.active)
      if (!type) continue
      const existing = await this.db.query<{ id: string }>('select id from guest_occasions where booking_id=$1 and occasion_type=$2 limit 1', [bookingId, type.value])
      if (existing.rows[0]) continue
      const defaultStatus = activeStatuses.find(option => option.value === type.metadata?.defaultStatus)?.value || activeStatuses[0]?.value
      if (!defaultStatus) continue
      const id = randomUUID()
      const sourceText = `${finding.evidence_location} · matched “${finding.detected_phrase || finding.normalized_key}”: ${finding.raw_evidence_text}`
      await this.db.query('insert into guest_occasions (id, booking_id, occasion_type, status_value, source, source_text, notes, manual_guest_name, manual_room_number, occasion_date, occasion_time, manual_table_number, manual_waiter_id, active, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,\'\',$7,$8,$9,$10,$11,$12,true,$13,$13) on conflict do nothing', [id, bookingId, type.value, defaultStatus, 'booking_intelligence', sourceText, booking.guest_name, booking.room_number || null, booking.reservation_date, booking.reservation_time, booking.table_number || null, booking.waiter_id || null, actor])
      const saved = await this.find(id)
      if (saved) {
        created.push(saved)
        await this.db.query('insert into audit_logs (id, entity_type, entity_id, action, before_data, after_data, actor) values ($1,$2,$3,$4,null,$5,$6)', [randomUUID(), 'guest_occasion', id, 'intelligence_projected', JSON.stringify({ ...saved, findingId: finding.id, ruleKey: finding.rule_key, ruleVersion: finding.rule_version }), actor])
      }
    }
    return created
  }

  private async detectLegacyForBooking(bookingId: string, actor: string): Promise<GuestOccasionRecord[]> {
    const bookingResult = await this.db.query<any>('select id,guest_name,room_number,reservation_date::text,reservation_time::text,table_number,waiter_id,guest_notes,source_guest_notes from bookings where id=$1', [bookingId])
    const booking = bookingResult.rows[0]; if (!booking) return []
    const members = await this.db.query<any>("select guest_name,room_number,guest_notes from booking_guest_members where booking_id=$1 and coalesce(guest_notes,'')<>'' order by source_row_order", [bookingId])
    const evidence: BookingOccasionEvidence[] = []
    if (booking.guest_notes?.trim()) evidence.push({ location: 'Booking guest notes', text: booking.guest_notes.trim() })
    if (booking.source_guest_notes?.trim()) evidence.push({ location: 'Booking source annotations', text: booking.source_guest_notes.trim() })
    for (const member of members.rows) evidence.push({ location: `Guest member ${member.guest_name}${member.room_number ? ` · Room ${member.room_number}` : ''}`, text: member.guest_notes.trim() })
    const interpretations = interpretBookingOccasions(evidence); if (!interpretations.length) return []
    const configuration = await this.configuration(); const activeStatuses = configuration.statuses.filter(option => option.active); const created: GuestOccasionRecord[] = []
    for (const match of interpretations) {
      const type = configuration.types.find(option => option.active && option.value === match.value); if (!type) continue
      if ((await this.db.query('select id from guest_occasions where booking_id=$1 and occasion_type=$2 limit 1', [bookingId, type.value])).rows[0]) continue
      const defaultStatus = activeStatuses.find(option => option.value === type.metadata?.defaultStatus)?.value || activeStatuses[0]?.value; if (!defaultStatus) continue
      const id = randomUUID(); const sourceText = `${match.location} · matched “${match.detectedPhrase}”: ${match.text}`
      await this.db.query("insert into guest_occasions(id,booking_id,occasion_type,status_value,source,source_text,notes,manual_guest_name,manual_room_number,occasion_date,occasion_time,manual_table_number,manual_waiter_id,active,created_by,updated_by) values($1,$2,$3,$4,'legacy_booking_detection',$5,'',$6,$7,$8,$9,$10,$11,true,$12,$12) on conflict do nothing", [id, bookingId, type.value, defaultStatus, sourceText, booking.guest_name, booking.room_number || null, booking.reservation_date, booking.reservation_time, booking.table_number || null, booking.waiter_id || null, actor])
      const saved = await this.find(id); if (saved) created.push(saved)
    }
    return created
  }

  async experience(date: string, outletScopeId: string, outletKey = 'andalucia'): Promise<GuestExperienceView> {
    const occasions = (await this.list(date, outletKey)).filter(record => record.active)
    const result = await this.db.query<any>(`select f.id,f.booking_id,f.finding_type,f.normalized_key,coalesce(f.detected_payload->>'displayLabel',f.normalized_key) label,b.guest_name,b.room_number,b.reservation_date::text,b.reservation_time::text,b.table_number,b.waiter_id,b.booking_number,b.covers,f.raw_evidence_text,f.detected_phrase,f.evidence_location,f.rule_key,f.rule_version from booking_intelligence_findings f join bookings b on b.id=f.booking_id where f.outlet_scope_id=$1 and b.reservation_date=$2 and f.active=true and f.superseded_by_id is null and f.normalized_key=any($3::text[]) order by b.reservation_time,b.guest_name`, [outletScopeId, date, ['GUEST_ATTENTION_TLC','ALLERGY']])
    const attention = [...result.rows.reduce((items: Map<string, any>, row: any) => {
      const key = `${row.booking_id}|${row.normalized_key}`; const existing = items.get(key)
      if (existing) { if (!existing.rawEvidence.includes(row.raw_evidence_text)) existing.rawEvidence += `\n${row.raw_evidence_text}`; return items }
      items.set(key, { id: row.id, bookingId: row.booking_id, findingType: row.finding_type, normalizedKey: row.normalized_key, label: row.label, guestName: row.guest_name, roomNumber: row.room_number || '', reservationDate: row.reservation_date, reservationTime: row.reservation_time.slice(0,5), tableNumber: row.table_number || '', waiterId: row.waiter_id, bookingNumber: row.booking_number || '', covers: Number(row.covers || 0), rawEvidence: row.raw_evidence_text, detectedPhrase: row.detected_phrase || '', evidenceLocation: row.evidence_location, ruleKey: row.rule_key, ruleVersion: row.rule_version, operationalStatus: 'attention' as const, source: 'booking_intelligence' as const }); return items
    }, new Map<string, any>()).values()]
    const configuration = await this.configuration()
    const identity = (record: GuestOccasionRecord) => record.bookingId ? `booking:${record.bookingId}` : `occasion:${record.id}`
    const countDistinct = (records: GuestOccasionRecord[]) => new Set(records.map(identity)).size
    const attentionIdentities = new Set(attention.map(record => `booking:${record.bookingId}`))
    return { occasions, attention, groups: {
      celebrations: countDistinct(occasions.filter(record => ['honeymoon','birthday','anniversary','see_you_soon'].includes(record.occasionType))),
      vipSpecial: countDistinct(occasions.filter(record => configuration.types.find(option => option.value === record.occasionType)?.metadata?.countsAsVipSpecial)),
      attentionNeeded: attentionIdentities.size,
      completed: countDistinct(occasions.filter(record => configuration.statuses.find(option => option.value === record.status)?.metadata?.occasionWorkflow === 'completed'))
    } }
  }

  async correctFinding(findingId: string, effectiveClassification: string, reason: string, principal: AuthPrincipal, outletScopeId: string) {
    if (!reason.trim()) throw new Error('A manager correction reason is required.')
    const before = await this.db.query<any>('select * from booking_intelligence_findings where id=$1 and outlet_scope_id=$2 and active=true and superseded_by_id is null', [findingId, outletScopeId])
    if (!before.rows[0]) throw new Error('The active Booking Intelligence finding was not found.')
    const result = await this.db.query<any>(`update booking_intelligence_findings set effective_payload=jsonb_set(effective_payload,'{classification}',to_jsonb($3::text),true),manager_override_payload=$4,manager_correction_reason=$5,review_state='resolved',review_required=false,updated_by_user_id=$6,updated_by_actor=$7,updated_at=now() where id=$1 and outlet_scope_id=$2 returning *`, [findingId, outletScopeId, effectiveClassification, JSON.stringify({ classification: effectiveClassification }), reason.trim(), principal.userId, principal.displayName])
    await this.db.query('insert into audit_logs(id,entity_type,entity_id,action,before_data,after_data,actor) values($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'booking_intelligence_finding', findingId, 'manager_corrected', JSON.stringify(before.rows[0]), JSON.stringify(result.rows[0]), `${principal.displayName} [${principal.userId}]`])
    return result.rows[0]
  }

  async summary(date: string): Promise<GuestOccasionSummary> {
    const records = (await this.list(date)).filter(record => record.active)
    const configuration = await this.configuration()
    return {
      totalOccasions: records.length,
      attentionRequired: records.filter(record => configuration.statuses.find(option => option.value === record.status)?.metadata?.occasionWorkflow === 'attention').length,
      vipSpecialGuests: records.filter(record => configuration.types.find(option => option.value === record.occasionType)?.metadata?.countsAsVipSpecial).length,
      completed: records.filter(record => configuration.statuses.find(option => option.value === record.status)?.metadata?.occasionWorkflow === 'completed').length
    }
  }
}
