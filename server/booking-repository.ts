import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { BookingGuestMemberPreview, BookingImportPreview, BookingImportPreviewRecord, BookingImportResult, BookingImportReviewChanges, BookingImportReviewDecision, BookingImportReviewValidation, BookingRecord, BookingSummary, ConfigOption, WalkInBookingInput, WalkInFieldMode } from '../src/domain.js'
import { reconcileAnalyzedBookingCovers } from './booking-intelligence-engine.js'

export type BookingConfigGroup = 'statuses' | 'sources' | 'tables' | 'tableRanges' | 'walkInFields'

const groupKeys: Record<BookingConfigGroup, string> = { statuses: 'booking_statuses', sources: 'booking_sources', tables: 'restaurant_tables', tableRanges: 'restaurant_table_ranges', walkInFields: 'booking_walk_in_fields' }
const protectedStatusColors: Record<string, string> = { confirmed: '#1b6288', waiting: '#c18f32', arrived: '#2f8063', no_show: '#b74b45' }
const protectedStatusMetadata: Record<string, NonNullable<ConfigOption['metadata']>> = { confirmed: { serviceStage: 'remaining' }, waiting: { serviceStage: 'remaining', operationalAction: 'waiting' }, arrived: { serviceStage: 'arrived', bookingMetric: 'arrived', operationalAction: 'arrived' }, no_show: { serviceStage: 'noShow', bookingMetric: 'noShow', operationalAction: 'noShow', excludesFromExpectedCovers: true } }
const walkInFieldSeeds: Array<Omit<ConfigOption, 'id'>> = [
  ['guestName', 'Guest Name', 'optional'], ['roomNumber', 'Room Number', 'optional'], ['reservationDate', 'Reservation Date', 'required'], ['reservationTime', 'Reservation Time', 'required'], ['covers', 'Covers', 'required'], ['mealPeriod', 'Meal Period', 'required'], ['tableNumber', 'Table Number', 'optional'], ['waiterId', 'Waiter', 'optional'], ['bookingStatus', 'Booking Status', 'system'], ['bookingSource', 'Booking Source', 'system'], ['bookingNumber', 'Booking Number', 'hidden'], ['bookedBy', 'Booked By', 'system'], ['birthDate', 'Birth Date', 'hidden'], ['arrivalDate', 'Arrival Date', 'hidden'], ['departureDate', 'Departure Date', 'hidden'], ['guestNotes', 'Guest Notes', 'optional']
].map(([value, label, mode]) => ({ value, label, active: true, metadata: { walkInFieldMode: mode as WalkInFieldMode, recommendedMode: mode as WalkInFieldMode, protected: ['reservationDate', 'reservationTime', 'covers', 'mealPeriod'].includes(value), systemControlled: mode === 'system' } }))
const seeds: Record<BookingConfigGroup, Array<Omit<ConfigOption, 'id'>>> = {
  statuses: [
    { value: 'confirmed', label: 'Confirmed', color: '#1b6288', active: true, metadata: { serviceStage: 'remaining' } },
    { value: 'waiting', label: 'Waiting', color: '#c18f32', active: true, metadata: { serviceStage: 'remaining', operationalAction: 'waiting' } },
    { value: 'arrived', label: 'Arrived', color: '#2f8063', active: true, metadata: { bookingMetric: 'arrived', serviceStage: 'arrived', operationalAction: 'arrived' } },
    { value: 'no_show', label: 'No-Show', color: '#b74b45', active: true, metadata: { bookingMetric: 'noShow', excludesFromExpectedCovers: true, serviceStage: 'noShow', operationalAction: 'noShow' } },
    { value: 'cancelled', label: 'Cancelled', color: '#a7b0ba', active: true, metadata: { excludesFromExpectedCovers: true, serviceStage: 'excluded' } },
    { value: 'completed', label: 'Completed', color: '#5d7180', active: true, metadata: { serviceStage: 'completed' } }
  ],
  sources: [...['Activity Program', 'Guest', 'Chat Agent', 'Reception', 'Manual', 'Other'].map(label => ({ value: label.toLowerCase().replaceAll(' ', '_'), label, active: true })), { value: 'walk_in', label: 'Walk-In', active: true, metadata: { systemControlled: true, protected: true } }],
  tables: Array.from({ length: 12 }, (_, index) => ({ value: `T${String(index + 1).padStart(2, '0')}`, label: `Table ${index + 1}`, active: true })),
  tableRanges: [[10, 29], [30, 39], [40, 49], [60, 69], [70, 79]].map(([start, end]) => ({ value: `${start}-${end}`, label: `${start}–${end}`, active: true, metadata: { tableRangeStart: start, tableRangeEnd: end } })),
  walkInFields: walkInFieldSeeds
}

const mapOption = (row: any): ConfigOption => ({ ...row, metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata })
const sourceKeyFor = (booking: BookingImportPreviewRecord) => `${booking.venue}|${booking.reservationDate}|${booking.reservationTime}|${booking.bookingNumber}`
const validDate = (value: unknown) => { const match = typeof value === 'string' ? value.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null; if (!match) return false; const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))); return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) }
const validTime = (value: unknown) => { const match = typeof value === 'string' ? value.match(/^(\d{2}):(\d{2})$/) : null; return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60) }

export class BookingRepository {
  constructor(private readonly db: PGlite) {}

  async initialize() {
    for (const group of Object.keys(groupKeys) as BookingConfigGroup[]) {
      const existing = await this.db.query<{ count: number }>('select count(*)::int as count from configuration_options where group_key=$1', [groupKeys[group]])
      if (existing.rows[0].count === 0) for (let index = 0; index < seeds[group].length; index++) {
        const option = seeds[group][index]
        await this.db.query('insert into configuration_options (id, group_key, value, label, color, metadata, active, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), groupKeys[group], option.value, option.label, option.color || null, JSON.stringify(option.metadata || {}), option.active, index])
      }
    }
    await this.db.query("insert into configuration_options (id,group_key,value,label,metadata,active,sort_order) values ($1,$2,'walk_in','Walk-In',$3,true,90) on conflict (group_key,value) do update set label='Walk-In',metadata=configuration_options.metadata || excluded.metadata,active=true,updated_at=now()", [randomUUID(), groupKeys.sources, JSON.stringify({ systemControlled: true, protected: true })])
    await this.db.query("insert into configuration_options (id,group_key,value,label,color,metadata,active,sort_order) values ($1,$2,'waiting','Waiting',$3,$4,true,15) on conflict (group_key,value) do nothing", [randomUUID(), groupKeys.statuses, protectedStatusColors.waiting, JSON.stringify({ serviceStage: 'remaining', operationalAction: 'waiting' })])
    const stages: Array<[string, string]> = [['confirmed', 'remaining'], ['arrived', 'arrived'], ['no_show', 'noShow'], ['cancelled', 'excluded'], ['completed', 'completed']]
    for (const [value, stage] of stages) await this.db.query("update configuration_options set metadata=metadata || jsonb_build_object('serviceStage',$3::text) where group_key=$1 and value=$2 and not (metadata ? 'serviceStage')", [groupKeys.statuses, value, stage])
    for (const [index, value] of ['confirmed', 'waiting', 'arrived', 'no_show'].entries()) await this.db.query("update configuration_options set color=$3,active=true,sort_order=$4,metadata=metadata || $5::jsonb || jsonb_build_object('systemControlled',true,'protected',true) where group_key=$1 and value=$2", [groupKeys.statuses, value, protectedStatusColors[value], index, JSON.stringify(protectedStatusMetadata[value])])
  }

  async configuration(): Promise<Record<BookingConfigGroup, ConfigOption[]>> {
    const output = {} as Record<BookingConfigGroup, ConfigOption[]>
    for (const group of Object.keys(groupKeys) as BookingConfigGroup[]) {
      const result = await this.db.query<any>('select id, value, label, color, metadata, active, sort_order "sortOrder" from configuration_options where group_key=$1 order by sort_order, label', [groupKeys[group]])
      output[group] = result.rows.map(mapOption)
    }
    const expanded = output.tableRanges.filter(option => option.active).flatMap(option => {
      const start = Number(option.metadata?.tableRangeStart); const end = Number(option.metadata?.tableRangeEnd)
      return Number.isInteger(start) && Number.isInteger(end) && start <= end && end - start <= 100 ? Array.from({ length: end - start + 1 }, (_, index) => ({ id: `${option.id}:${start + index}`, value: String(start + index), label: `Table ${start + index}`, active: true, metadata: { systemControlled: true } } as ConfigOption)) : []
    })
    const existingValues = new Set(output.tables.map(option => option.value))
    output.tables = [...output.tables, ...expanded.filter(option => !existingValues.has(option.value))]
    return output
  }

  async saveConfiguration(group: BookingConfigGroup, option: ConfigOption, actor = 'Venue Manager'): Promise<ConfigOption> {
    if (group === 'sources' && option.value === 'walk_in') throw new Error('The canonical Walk-In source is system controlled.')
    if (group === 'walkInFields') {
      const current = await this.db.query<any>('select id,value,label,metadata,active from configuration_options where id=$1 and group_key=$2', [option.id, groupKeys.walkInFields])
      if (!current.rows[0]) throw new Error('Walk-in form field not found.')
      const savedMetadata = mapOption(current.rows[0]).metadata || {}
      const requestedMode = option.metadata?.walkInFieldMode
      if (savedMetadata.protected && requestedMode !== 'required') throw new Error('Protected Walk-in fields must remain required.')
      if (savedMetadata.systemControlled && requestedMode !== 'system') throw new Error('System-controlled Walk-in fields cannot be changed.')
      option = { ...option, value: current.rows[0].value, label: current.rows[0].label, active: true, metadata: { ...savedMetadata, walkInFieldMode: requestedMode } }
    }
    if (group === 'tableRanges') {
      const start = Number(option.metadata?.tableRangeStart); const end = Number(option.metadata?.tableRangeEnd)
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end - start > 100) throw new Error('Enter a valid table range of no more than 101 tables.')
      const overlaps = await this.db.query<{ count: number }>("select count(*)::int count from configuration_options where group_key=$1 and id<>$2 and active=true and coalesce((metadata->>'tableRangeStart')::int,0)<=$4 and coalesce((metadata->>'tableRangeEnd')::int,0)>=$3", [groupKeys.tableRanges, option.id, start, end])
      if (overlaps.rows[0].count > 0) throw new Error('This table range overlaps an existing active range.')
      option = { ...option, value: `${start}-${end}`, label: `${start}–${end}`, metadata: { ...option.metadata, tableRangeStart: start, tableRangeEnd: end } }
    }
    if (group === 'statuses' && protectedStatusColors[option.value]) option = { ...option, color: protectedStatusColors[option.value], active: true, metadata: { ...option.metadata, ...protectedStatusMetadata[option.value], systemControlled: true, protected: true } }
    const beforeResult = await this.db.query<any>('select id,value,label,color,metadata,active from configuration_options where id=$1 and group_key=$2', [option.id, groupKeys[group]])
    const before = beforeResult.rows[0] ? mapOption(beforeResult.rows[0]) : null
    const result = await this.db.query<any>('insert into configuration_options (id, group_key, value, label, color, metadata, active, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do update set value=excluded.value, label=excluded.label, color=excluded.color, metadata=excluded.metadata, active=excluded.active, updated_at=now() returning id, value, label, color, metadata, active, sort_order "sortOrder"', [option.id || randomUUID(), groupKeys[group], option.value, option.label, option.color || null, JSON.stringify(option.metadata || {}), option.active, option.sortOrder ?? 100])
    const saved = mapOption(result.rows[0])
    await this.db.query('insert into audit_logs (id,entity_type,entity_id,action,before_data,after_data,actor) values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'booking_configuration', saved.id, before ? 'updated' : 'created', before ? JSON.stringify(before) : null, JSON.stringify(saved), actor])
    return saved
  }

  async resetWalkInFields(actor = 'Venue Manager'): Promise<ConfigOption[]> {
    for (const seed of walkInFieldSeeds) {
      const existing = await this.db.query<any>('select id,value,label,color,metadata,active from configuration_options where group_key=$1 and value=$2', [groupKeys.walkInFields, seed.value])
      if (!existing.rows[0]) continue
      await this.saveConfiguration('walkInFields', { ...mapOption(existing.rows[0]), metadata: seed.metadata }, actor)
    }
    return (await this.configuration()).walkInFields
  }

  async validateWalkIn(input: WalkInBookingInput) {
    const configuration = await this.configuration()
    const mode = (field: string) => configuration.walkInFields.find(option => option.value === field)?.metadata?.walkInFieldMode || 'hidden'
    const requiredText = (field: keyof WalkInBookingInput, label: string) => { if (mode(field) === 'required' && !String(input[field] ?? '').trim()) throw new Error(`${label} is required for this Walk-in.`) }
    requiredText('guestName', 'Guest name'); requiredText('roomNumber', 'Room number'); requiredText('reservationDate', 'Reservation date'); requiredText('reservationTime', 'Reservation time'); requiredText('mealPeriod', 'Meal period'); requiredText('tableNumber', 'Table number'); requiredText('waiterId', 'Waiter'); requiredText('guestNotes', 'Guest notes')
    if (!validDate(input.reservationDate)) throw new Error('Select a valid Walk-in reservation date.')
    if (!validTime(input.reservationTime)) throw new Error('Select a valid Walk-in reservation time.')
    if (!Number.isInteger(Number(input.covers)) || Number(input.covers) < 1) throw new Error('Walk-in covers must be a whole number greater than zero.')
    if (input.tableNumber && !configuration.tables.some(option => option.active && option.value === input.tableNumber)) throw new Error('Select an active configured restaurant table.')
  }

  private mapBooking(row: any): BookingRecord {
    let payload: any = row.raw_import_payload
    if (typeof payload === 'string') { try { payload = JSON.parse(payload) } catch { payload = null } }
    const coverResolution = payload?.effective?.coverResolution || payload?.coverResolution
    return { id: row.id, guestName: row.guest_name, roomNumber: row.room_number || '', birthDate: row.birth_date, arrivalDate: row.arrival_date, departureDate: row.departure_date, mealPeriod: row.meal_period || '', reservationDate: row.reservation_date, reservationTime: row.reservation_time ? row.reservation_time.slice(0, 5) : '', bookingNumber: row.booking_number || '', covers: row.covers, bookingStatus: row.booking_status, bookingSource: row.booking_source || '', bookedBy: row.booked_by || '', guestNotes: row.guest_notes || '', tableNumber: row.table_number || '', waiterId: row.waiter_id, waiter: row.waiter_id ? { name: row.waiter_name, number: row.waiter_number, position: row.waiter_position, employmentStatus: row.waiter_employment_status } : null, importedBatchId: row.imported_batch_id, importSource: row.import_source, sourceActivityLabel: row.source_activity_label, sourceBookingStatus: row.source_booking_status, sourceFilename: row.source_filename, sourceReportDate: row.source_report_date, sourceParserVersion: row.source_parser_version, sourceGuestNotes: row.source_guest_notes, coverResolution, memberSearchText: row.member_search_text || '', createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by, updatedBy: row.updated_by }
  }

  async list(date: string): Promise<BookingRecord[]> {
    const result = await this.db.query<any>("select b.id, b.room_number, b.guest_name, b.birth_date::text, b.arrival_date::text, b.departure_date::text, b.meal_period, b.reservation_date::text, b.reservation_time::text, b.booking_number, b.booking_status, b.covers, b.booking_source, b.booked_by, b.guest_notes, b.table_number, b.waiter_id, b.imported_batch_id, b.import_source, b.source_activity_label, b.source_booking_status, b.source_filename, b.source_report_date::text, b.source_parser_version, b.source_guest_notes, b.raw_import_payload, coalesce((select string_agg(g.guest_name || ' ' || coalesce(g.room_number,'') || ' ' || coalesce(g.guest_notes,''), ' ') from booking_guest_members g where g.booking_id=b.id),'') member_search_text, b.created_at::text, b.updated_at::text, b.created_by, b.updated_by, s.full_name waiter_name, s.staff_number waiter_number, s.position_key waiter_position, s.employment_status_key waiter_employment_status from bookings b left join staff s on s.id=b.waiter_id where b.reservation_date=$1 order by b.reservation_time, b.guest_name", [date])
    return result.rows.map((row: any) => this.mapBooking(row))
  }

  async find(id: string): Promise<BookingRecord | null> {
    const result = await this.db.query<any>("select b.id, b.room_number, b.guest_name, b.birth_date::text, b.arrival_date::text, b.departure_date::text, b.meal_period, b.reservation_date::text, b.reservation_time::text, b.booking_number, b.booking_status, b.covers, b.booking_source, b.booked_by, b.guest_notes, b.table_number, b.waiter_id, b.imported_batch_id, b.import_source, b.source_activity_label, b.source_booking_status, b.source_filename, b.source_report_date::text, b.source_parser_version, b.source_guest_notes, b.raw_import_payload, coalesce((select string_agg(g.guest_name || ' ' || coalesce(g.room_number,'') || ' ' || coalesce(g.guest_notes,''), ' ') from booking_guest_members g where g.booking_id=b.id),'') member_search_text, b.created_at::text, b.updated_at::text, b.created_by, b.updated_by, s.full_name waiter_name, s.staff_number waiter_number, s.position_key waiter_position, s.employment_status_key waiter_employment_status from bookings b left join staff s on s.id=b.waiter_id where b.id=$1", [id])
    return result.rows[0] ? this.mapBooking(result.rows[0]) : null
  }

  async save(booking: BookingRecord, actor = 'Venue Manager'): Promise<BookingRecord> {
    const previous = await this.find(booking.id)
    if (booking.waiterId && booking.waiterId !== previous?.waiterId) {
      const waiter = await this.db.query<{ eligible: boolean }>("select coalesce((select (c.metadata->>'eligibleForAssignments')::boolean from configuration_options c where c.group_key='employment_statuses' and c.value=s.employment_status_key),s.employment_status_key='active') and coalesce((select (p.metadata->>'serviceAssignmentEligible')::boolean from configuration_options p where p.group_key='staff_positions' and p.value=s.position_key),lower(s.position_key) in ('venue manager','assistant restaurant manager','restaurant supervisor','f&b attendant','waiter')) eligible from staff s where s.id=$1", [booking.waiterId])
      if (!waiter.rows[0]) throw new Error('The selected waiter no longer exists.')
      if (!waiter.rows[0].eligible) throw new Error('This staff member is not eligible for new booking assignments.')
    }
    if (previous) {
      await this.db.query('update bookings set room_number=$2, guest_name=$3, birth_date=$4, arrival_date=$5, departure_date=$6, meal_period=$7, reservation_date=$8, reservation_time=$9, booking_number=$10, booking_status=$11, covers=$12, booking_source=$13, booked_by=$14, guest_notes=$15, table_number=$16, waiter_id=$17, import_source=$18, updated_by=$19, updated_at=now() where id=$1', [booking.id, booking.roomNumber || null, booking.guestName, booking.birthDate || null, booking.arrivalDate || null, booking.departureDate || null, booking.mealPeriod || null, booking.reservationDate, booking.reservationTime, booking.bookingNumber || null, booking.bookingStatus, booking.covers, booking.bookingSource || null, booking.bookedBy || null, booking.guestNotes || null, booking.tableNumber || null, booking.waiterId || null, booking.importSource || 'manual', actor])
    } else {
      await this.db.query('insert into bookings (id, room_number, guest_name, birth_date, arrival_date, departure_date, meal_period, reservation_date, reservation_time, booking_number, booking_status, covers, booking_source, booked_by, guest_notes, table_number, waiter_id, import_source, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)', [booking.id, booking.roomNumber || null, booking.guestName, booking.birthDate || null, booking.arrivalDate || null, booking.departureDate || null, booking.mealPeriod || null, booking.reservationDate, booking.reservationTime, booking.bookingNumber || null, booking.bookingStatus, booking.covers, booking.bookingSource || null, booking.bookedBy || null, booking.guestNotes || null, booking.tableNumber || null, booking.waiterId || null, booking.importSource || 'manual', actor])
    }
    const saved = await this.find(booking.id)
    await this.db.query('insert into audit_logs (id, entity_type, entity_id, action, before_data, after_data, actor) values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'booking', booking.id, previous ? 'updated' : 'created', previous ? JSON.stringify(previous) : null, JSON.stringify(saved), actor])
    if (!saved) throw new Error('Booking could not be saved.')
    return saved
  }

  async summary(date: string): Promise<BookingSummary> {
    const bookings = await this.list(date)
    const statuses = (await this.configuration()).statuses
    const metadata = (status: string) => statuses.find(option => option.value === status)?.metadata
    const stage = (booking: BookingRecord) => metadata(booking.bookingStatus)?.serviceStage || (metadata(booking.bookingStatus)?.bookingMetric === 'arrived' ? 'arrived' : metadata(booking.bookingStatus)?.bookingMetric === 'noShow' ? 'noShow' : 'remaining')
    const expected = bookings.filter(booking => !metadata(booking.bookingStatus)?.excludesFromExpectedCovers)
    const arrived = bookings.filter(booking => ['arrived', 'completed'].includes(stage(booking)))
    const remaining = expected.filter(booking => stage(booking) === 'remaining')
    const noShows = bookings.filter(booking => stage(booking) === 'noShow')
    const requiringAssignment = expected.filter(booking => !['completed'].includes(stage(booking)))
    return {
      totalBookings: bookings.length,
      expectedCovers: expected.reduce((total, booking) => total + booking.covers, 0),
      arrived: arrived.length,
      arrivedCovers: arrived.reduce((total, booking) => total + booking.covers, 0),
      remainingBookings: remaining.length,
      remainingCovers: remaining.reduce((total, booking) => total + booking.covers, 0),
      noShows: noShows.length,
      noShowCovers: noShows.reduce((total, booking) => total + booking.covers, 0),
      unassignedTables: requiringAssignment.filter(booking => !booking.tableNumber).length,
      unassignedWaiters: requiringAssignment.filter(booking => !booking.waiterId).length
    }
  }

  async prepareImportPreview(input: Omit<BookingImportPreview, 'batchId' | 'duplicateFile'>, actor = 'Venue Manager'): Promise<BookingImportPreview> {
    const existingBatch = await this.db.query<{ id: string; import_status: string }>('select id, import_status from booking_import_batches where file_hash=$1', [input.fileHash])
    const duplicateFile = Boolean(existingBatch.rows[0])
    const batchId = existingBatch.rows[0]?.id || randomUUID()
    const keys = input.bookings.filter(booking => booking.bookingNumber && booking.reservationDate && booking.reservationTime)
    const existingBookings = new Map<string, string>()
    for (const booking of keys) {
      const result = await this.db.query<{ id: string }>('select id from bookings where venue_key=$1 and reservation_date=$2 and reservation_time=$3 and booking_number=$4 limit 1', [booking.venue, booking.reservationDate, booking.reservationTime, booking.bookingNumber])
      if (result.rows[0]) existingBookings.set(`${booking.venue}|${booking.reservationDate}|${booking.reservationTime}|${booking.bookingNumber}`, result.rows[0].id)
    }
    const previewBookings: BookingImportPreviewRecord[] = input.bookings.map(booking => {
      const duplicateBookingId = existingBookings.get(`${booking.venue}|${booking.reservationDate}|${booking.reservationTime}|${booking.bookingNumber}`)
      if (!duplicateBookingId) return booking
      return { ...booking, duplicateBookingId, readiness: 'DUPLICATE', warnings: [...booking.warnings, 'A live booking already has this venue, date, time and booking number.'] }
    })
    const possibleDuplicates = previewBookings.filter(booking => booking.readiness === 'DUPLICATE').length
    const coverReconciliation = reconcileAnalyzedBookingCovers(previewBookings, input.validation.declaredCovers)
    const result: BookingImportPreview = { ...input, batchId, duplicateFile, bookings: previewBookings, summary: { ...input.summary, totalCovers: coverReconciliation.effectiveOperationalTotal, possibleDuplicates, warnings: previewBookings.filter(booking => booking.warnings.length > 0).length }, validation: { ...input.validation, reconciled: input.validation.reconciled && coverReconciliation.reconciled, coverReconciliation } }
    // Schema 017 findings are now the authoritative post-confirmation interpretation source.
    // Retain the reviewed preview findings so confirmImport can persist exactly what the manager approved.
    const persistenceBookings = input.bookings
    const priorStatus = existingBatch.rows[0]?.import_status
    const previewStatus = priorStatus === 'imported' || priorStatus === 'partially_imported' ? priorStatus : input.validation.reconciled ? 'preview_ready' : 'preview_validation_failed'
    await this.db.query('insert into booking_import_batches (id, original_filename, file_hash, report_date, parser_version, import_status, summary, warnings, preview_payload, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (file_hash) do update set last_seen_at=now(), summary=excluded.summary, warnings=excluded.warnings, preview_payload=excluded.preview_payload', [batchId, input.fileName, input.fileHash, input.reportDate || null, input.parserVersion, previewStatus, JSON.stringify(result.summary), JSON.stringify(input.validation.messages), JSON.stringify(persistenceBookings), actor])
    return result
  }

  async duplicateReanalysisCandidates(batchId: string): Promise<Array<{ index: number; source: BookingImportPreviewRecord; existing: BookingImportPreviewRecord; existingOccasionKeys: string[] }>> {
    const { preview } = await this.importBatch(batchId)
    const matches: Array<{ index: number; source: BookingImportPreviewRecord; existing: BookingImportPreviewRecord; existingOccasionKeys: string[] }> = []
    for (const [index, source] of preview.entries()) {
      const duplicateBookingId = await this.duplicateId(source)
      if (!duplicateBookingId) continue
      const [booking, guestMembers, payloadResult, occasionResult] = await Promise.all([this.find(duplicateBookingId), this.guestMembers(duplicateBookingId), this.db.query<{ raw_import_payload: unknown }>('select raw_import_payload from bookings where id=$1', [duplicateBookingId]), this.db.query<{ occasion_type: string }>('select occasion_type from guest_occasions where booking_id=$1 and active=true order by occasion_type', [duplicateBookingId])])
      if (!booking) continue
      let rawPayload: any = payloadResult.rows[0]?.raw_import_payload
      if (typeof rawPayload === 'string') { try { rawPayload = JSON.parse(rawPayload) } catch { rawPayload = null } }
      const persistedSource = rawPayload?.effective || rawPayload?.original || rawPayload
      matches.push({
        index,
        source: { ...source, duplicateBookingId, readiness: 'DUPLICATE' },
        existing: {
          venue: 'andalucia', reservationDate: booking.reservationDate, reservationTime: booking.reservationTime,
          bookingNumber: booking.bookingNumber, primaryGuest: booking.guestName,
          rooms: booking.roomNumber.split(',').map(value => value.trim()).filter(Boolean), covers: booking.covers,
          sourceStatus: booking.sourceBookingStatus || booking.bookingStatus, bookedBy: booking.bookedBy,
          sourceNotes: persistedSource?.sourceNotes || booking.sourceGuestNotes || booking.guestNotes, activityLabel: booking.sourceActivityLabel || booking.mealPeriod,
          walkIn: booking.bookingSource === 'walk_in', guestMembers, warnings: [], readiness: 'DUPLICATE',
          coverResolution: booking.coverResolution, duplicateBookingId
        },
        existingOccasionKeys: occasionResult.rows.map(item => item.occasion_type)
      })
    }
    return matches
  }

  private async importBatch(batchId: string) {
    const result = await this.db.query<any>('select id, original_filename, file_hash, report_date::text, parser_version, preview_payload from booking_import_batches where id=$1', [batchId])
    const batch = result.rows[0]
    if (!batch) throw new Error('Import preview batch was not found. Upload and parse the PDF again.')
    const preview = (typeof batch.preview_payload === 'string' ? JSON.parse(batch.preview_payload) : batch.preview_payload) as BookingImportPreviewRecord[]
    if (!Array.isArray(preview) || preview.length === 0) throw new Error('This preview batch has no parsed records. Upload and parse the PDF again.')
    return { batch, preview }
  }

  private applyReviewChanges(original: BookingImportPreviewRecord, changes: BookingImportReviewChanges, activeStatuses: string[]): BookingImportPreviewRecord {
    const reservationDate = changes.reservationDate?.trim()
    const reservationTime = changes.reservationTime?.trim()
    const primaryGuest = changes.primaryGuest?.trim()
    const room = changes.room?.trim()
    const sourceStatus = changes.sourceStatus?.trim().toLowerCase()
    const covers = Number(changes.covers)
    if (!validDate(reservationDate)) throw new Error('Select a valid reservation date.')
    if (!validTime(reservationTime)) throw new Error('Select a valid reservation time.')
    if (!primaryGuest) throw new Error('Primary guest is required.')
    if (!room) throw new Error('Room information is required for an edited import.')
    if (!Number.isInteger(covers) || covers < 1) throw new Error('Covers must be a whole number greater than zero.')
    if (!activeStatuses.includes(sourceStatus)) throw new Error('Select an active configured booking status.')
    const rooms = room.split(',').map(value => value.trim()).filter(Boolean)
    const guestMembers = original.guestMembers.length
      ? original.guestMembers.map((member, index) => index === 0 ? { ...member, guestName: primaryGuest, roomNumber: rooms[0] || member.roomNumber } : member)
      : [{ guestName: primaryGuest, roomNumber: rooms[0] || '', accommodationCode: '', birthDate: null, arrivalDate: null, departureDate: null, mealPlan: '', guestNotes: '', sourceRowOrder: 1 }]
    const warnings = original.warnings.filter(warning => !(/missing room information/i.test(warning) && rooms.length) && !(/primary guest/i.test(warning) && primaryGuest) && !(/pax|covers/i.test(warning) && covers > 0) && !(/reservation time/i.test(warning) && reservationTime))
    return { ...original, reservationDate, reservationTime, primaryGuest, rooms, covers, sourceStatus, sourceNotes: changes.sourceNotes?.trim() || '', guestMembers, warnings, readiness: 'REVIEW_REQUIRED', duplicateBookingId: undefined }
  }

  private async duplicateId(booking: BookingImportPreviewRecord): Promise<string | undefined> {
    if (!booking.bookingNumber || !booking.reservationDate || !booking.reservationTime) return undefined
    const duplicate = await this.db.query<{ id: string }>('select id from bookings where source_booking_key=$1 or (venue_key=$2 and reservation_date=$3 and reservation_time=$4 and booking_number=$5) limit 1', [sourceKeyFor(booking), booking.venue, booking.reservationDate, booking.reservationTime, booking.bookingNumber])
    return duplicate.rows[0]?.id
  }

  async validateImportReview(batchId: string, index: number, changes: BookingImportReviewChanges): Promise<BookingImportReviewValidation> {
    const { preview } = await this.importBatch(batchId)
    if (!Number.isInteger(index) || index < 0 || index >= preview.length) throw new Error('The review item was not found in this import preview.')
    const activeStatuses = (await this.configuration()).statuses.filter(option => option.active).map(option => option.value)
    const record = this.applyReviewChanges(preview[index], changes, activeStatuses)
    const duplicateBookingId = await this.duplicateId(record)
    return { record: duplicateBookingId ? { ...record, readiness: 'DUPLICATE', duplicateBookingId, warnings: [...record.warnings, 'A live booking already has this venue, date, time and booking number.'] } : record, duplicateBookingId }
  }

  async confirmImport(batchId: string, selectedIndexes: number[], reviewDecisions: BookingImportReviewDecision[] = [], actor = 'Venue Manager', actorUserId?: string, outletScopeId?: string): Promise<BookingImportResult> {
    const { batch, preview } = await this.importBatch(batchId)
    const indexes = [...new Set(selectedIndexes)].filter(index => Number.isInteger(index) && index >= 0 && index < preview.length)
    const activeStatuses = (await this.configuration()).statuses.filter(option => option.active).map(option => option.value)
    const decisions = new Map(reviewDecisions.filter(decision => Number.isInteger(decision.index) && decision.index >= 0 && decision.index < preview.length).map(decision => [decision.index, decision]))
    for (const [index, decision] of decisions) if (preview[index].readiness !== 'REVIEW_REQUIRED' || !['IMPORT_ANYWAY', 'EDIT_BEFORE_IMPORT', 'SKIP'].includes(decision.action)) throw new Error('A review decision does not match this import preview.')
    const importIndexes = [...new Set([...indexes.filter(index => preview[index].readiness !== 'REVIEW_REQUIRED'), ...[...decisions].filter(([, decision]) => decision.action !== 'SKIP').map(([index]) => index)])].sort((a, b) => a - b)
    const importedBookingIds: string[] = []
    const failedRecords: Array<{ bookingNumber: string; reason: string }> = []
    let importedCovers = 0
    let skippedDuplicates = 0
    let warnings = 0
    let managerApprovedReviewItems = 0
    const skippedByManager = [...decisions.values()].filter(decision => decision.action === 'SKIP').length
    await this.db.transaction(async tx => {
      for (const [index, decision] of decisions) if (decision.action === 'SKIP') {
        const original = preview[index]
        await tx.query('insert into audit_logs (id, entity_type, entity_id, action, before_data, after_data, actor) values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'booking_import_review', batchId, 'skipped_by_manager', JSON.stringify({ fileName: batch.original_filename, fileHash: batch.file_hash, originalSourceBookingKey: sourceKeyFor(original), reviewReasons: original.warnings, sourceRecord: original }), JSON.stringify({ reviewIndex: index, managerAction: decision.action, reviewedAt: new Date().toISOString(), resultingBookingId: null }), actor])
      }
      for (const index of importIndexes) {
        const original = preview[index]
        const decision = decisions.get(index)
        let booking = original
        try {
          if (decision?.action === 'EDIT_BEFORE_IMPORT') {
            if (!decision.changes) throw new Error('Edited review values are required.')
            booking = this.applyReviewChanges(original, decision.changes, activeStatuses)
          }
        } catch (error) {
          failedRecords.push({ bookingNumber: original.bookingNumber || 'Missing', reason: error instanceof Error ? error.message : 'The review correction is invalid.' })
          continue
        }
        if (booking.warnings.length) warnings++
        if (!booking.bookingNumber || !booking.reservationDate || !booking.reservationTime) { failedRecords.push({ bookingNumber: booking.bookingNumber || 'Missing', reason: 'Booking number, report date and reservation time are required for safe duplicate protection.' }); continue }
        if (!booking.covers || booking.covers < 1 || !booking.primaryGuest) { failedRecords.push({ bookingNumber: booking.bookingNumber, reason: 'Primary guest and explicit pax are required.' }); continue }
        const sourceKey = sourceKeyFor(booking)
        const duplicate = await tx.query<{ id: string }>('select id from bookings where source_booking_key=$1 or (venue_key=$2 and reservation_date=$3 and reservation_time=$4 and booking_number=$5) limit 1', [sourceKey, booking.venue, booking.reservationDate, booking.reservationTime, booking.bookingNumber])
        if (duplicate.rows[0]) {
          skippedDuplicates++
          if (decision) await tx.query('insert into audit_logs (id, entity_type, entity_id, action, before_data, after_data, actor) values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'booking_import_review', batchId, 'duplicate_skipped', JSON.stringify({ fileName: batch.original_filename, fileHash: batch.file_hash, originalSourceBookingKey: sourceKeyFor(original), reviewReasons: original.warnings, sourceRecord: original }), JSON.stringify({ reviewIndex: index, managerAction: decision.action, reviewedAt: new Date().toISOString(), resultingBookingId: duplicate.rows[0].id, effectiveRecord: booking }), actor])
          continue
        }
        const primary = booking.guestMembers[0]
        const bookingId = randomUUID()
        const operationalStatus = activeStatuses.includes(booking.sourceStatus.toLowerCase()) ? booking.sourceStatus.toLowerCase() : activeStatuses.includes('confirmed') ? 'confirmed' : activeStatuses[0]
        const sourceGuestNotes = [booking.sourceNotes, ...booking.guestMembers.map(member => member.guestNotes)].filter(Boolean).join(' | ')
        await tx.query('insert into bookings (id, room_number, guest_name, birth_date, arrival_date, departure_date, meal_period, reservation_date, reservation_time, booking_number, booking_status, covers, booking_source, booked_by, guest_notes, table_number, waiter_id, imported_batch_id, import_source, venue_key, source_activity_label, source_booking_key, parse_confidence, review_required, raw_import_payload, source_booking_status, source_filename, source_report_date, source_parser_version, source_guest_notes, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$31)', [bookingId, booking.rooms.join(', ') || primary?.roomNumber || null, booking.primaryGuest, primary?.birthDate || null, primary?.arrivalDate || null, primary?.departureDate || null, 'Dinner', booking.reservationDate, booking.reservationTime, booking.bookingNumber, operationalStatus, booking.covers, 'activity_program', booking.bookedBy || null, '', null, null, batchId, 'activity_program', booking.venue, booking.activityLabel, sourceKey, booking.readiness === 'READY' ? 1 : booking.readiness === 'WARNING' ? 0.8 : 0.5, original.readiness === 'REVIEW_REQUIRED', JSON.stringify(decision ? { original, effective: booking, reviewDecision: decision } : booking), booking.sourceStatus || null, batch.original_filename, batch.report_date, batch.parser_version, sourceGuestNotes || null, actor])
        const memberIds = new Map<number, string>()
        for (const member of booking.guestMembers) { const memberId = randomUUID(); memberIds.set(member.sourceRowOrder, memberId); await tx.query('insert into booking_guest_members (id, booking_id, guest_name, room_number, accommodation_code, birth_date, arrival_date, departure_date, meal_plan, guest_notes, source_row_order, raw_source) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [memberId, bookingId, member.guestName, member.roomNumber || null, member.accommodationCode || null, member.birthDate, member.arrivalDate, member.departureDate, member.mealPlan || null, member.guestNotes || null, member.sourceRowOrder, JSON.stringify(member)]) }
        if (outletScopeId && actorUserId) for (const finding of booking.intelligence?.findings || []) {
          const memberOrder = finding.memberIdentity?.match(/^source-row-(\d+)$/)?.[1]
          const reviewRequired = finding.reviewState === 'REVIEW_REQUIRED'
          await tx.query(`insert into booking_intelligence_findings(id,outlet_scope_id,booking_id,import_batch_id,guest_member_id,finding_type,normalized_key,raw_evidence_text,detected_phrase,evidence_location,evidence_sha256,rule_key,rule_version,source_payload,detected_payload,effective_payload,resolution_method,confidence,review_state,review_required,created_by_user_id,created_by_actor,updated_by_user_id,updated_by_actor)
            values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$21,$22)
            on conflict(booking_id,finding_type,normalized_key,evidence_sha256,rule_version) do nothing`, [randomUUID(), outletScopeId, bookingId, batchId, memberOrder ? memberIds.get(Number(memberOrder)) || null : null, finding.findingType, finding.normalizedKey, finding.rawEvidence, finding.detectedPhrase || null, finding.evidenceLocation, finding.evidenceSha256, finding.ruleKey, finding.ruleVersion, JSON.stringify({ value: finding.sourceValue, sourceCandidateIdentity: finding.sourceCandidateIdentity }), JSON.stringify({ value: finding.detectedValue, displayLabel: finding.displayLabel }), JSON.stringify({ value: finding.effectiveCandidate, classification: finding.normalizedKey }), finding.resolutionMethod, finding.confidence, reviewRequired ? 'required' : 'not_required', reviewRequired, actorUserId, actor])
        }
        await tx.query('insert into audit_logs (id, entity_type, entity_id, action, before_data, after_data, actor) values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'booking', bookingId, 'imported', null, JSON.stringify({ batchId, bookingNumber: booking.bookingNumber, sourceKey }), actor])
        if (decision) {
          managerApprovedReviewItems++
          await tx.query('insert into audit_logs (id, entity_type, entity_id, action, before_data, after_data, actor) values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'booking_import_review', batchId, decision.action === 'EDIT_BEFORE_IMPORT' ? 'edited_before_import' : 'imported_anyway', JSON.stringify({ fileName: batch.original_filename, fileHash: batch.file_hash, originalSourceBookingKey: sourceKeyFor(original), reviewReasons: original.warnings, sourceRecord: original }), JSON.stringify({ reviewIndex: index, managerAction: decision.action, reviewedAt: new Date().toISOString(), resultingBookingId: bookingId, effectiveRecord: booking }), actor])
        }
        importedBookingIds.push(bookingId)
        importedCovers += booking.covers
      }
      const skippedReviewRecords = preview.filter((booking, index) => booking.readiness === 'REVIEW_REQUIRED' && !importIndexes.includes(index)).length
      const result: BookingImportResult = { batchId, reservationDate: batch.report_date, importedBookings: importedBookingIds.length, importedCovers, managerApprovedReviewItems, skippedDuplicates, skippedReviewRecords, skippedByManager, warnings, failedRecords, importedBookingIds }
      const status = failedRecords.length || skippedDuplicates || skippedReviewRecords ? 'partially_imported' : 'imported'
      await tx.query('update booking_import_batches set import_status=$2, import_result=$3, confirmed_at=now(), confirmed_by=$4 where id=$1', [batchId, status, JSON.stringify(result), actor])
    })
    return { batchId, reservationDate: batch.report_date, importedBookings: importedBookingIds.length, importedCovers, managerApprovedReviewItems, skippedDuplicates, skippedReviewRecords: preview.filter((booking, index) => booking.readiness === 'REVIEW_REQUIRED' && !importIndexes.includes(index)).length, skippedByManager, warnings, failedRecords, importedBookingIds }
  }

  async guestMembers(bookingId: string): Promise<BookingGuestMemberPreview[]> {
    const result = await this.db.query<any>('select guest_name, room_number, accommodation_code, birth_date::text, arrival_date::text, departure_date::text, meal_plan, guest_notes, source_row_order from booking_guest_members where booking_id=$1 order by source_row_order', [bookingId])
    return result.rows.map((row: any) => ({ guestName: row.guest_name, roomNumber: row.room_number || '', accommodationCode: row.accommodation_code || '', birthDate: row.birth_date, arrivalDate: row.arrival_date, departureDate: row.departure_date, mealPlan: row.meal_plan || '', guestNotes: row.guest_notes || '', sourceRowOrder: row.source_row_order }))
  }
}
