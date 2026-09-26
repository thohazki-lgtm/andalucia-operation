import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { ChargeableDuplicateWarning, ChargeableRecord, ChargeableSummary, ChargeableWriteRequest, ConfigOption } from '../src/domain.js'

export type ChargeableConfigGroup = 'items' | 'statuses'
export type ChargeableWriteContext = { outletScopeId: string; actor: string }
export type ChargeableConfigurationWriteContext = ChargeableWriteContext

const groupKeys: Record<ChargeableConfigGroup, string> = { items: 'chargeable_items', statuses: 'chargeable_statuses' }
const seeds: Record<ChargeableConfigGroup, Array<Omit<ConfigOption, 'id'>>> = {
  items: [
    { value: 'lobster_paella', label: 'Lobster Paella', active: true, metadata: { category: 'Food', price: 85 } },
    { value: 'birthday_basic', label: 'Birthday Basic', active: true, metadata: { category: 'Celebration', price: 75 } },
    { value: 'birthday_premium', label: 'Birthday Premium', active: true, metadata: { category: 'Celebration', price: 135 } },
    { value: 'anniversary_basic', label: 'Anniversary Basic', active: true, metadata: { category: 'Celebration', price: 75 } },
    { value: 'anniversary_premium', label: 'Anniversary Premium', active: true, metadata: { category: 'Celebration', price: 135 } }
  ],
  statuses: [
    { value: 'pending', label: 'Pending', color: '#b38b3a', active: true, metadata: { chargeableStage: 'pending', countsAsRealizedRevenue: false, countsAsPendingValue: true, excludesFromChargeableTotals: false } },
    { value: 'charged', label: 'Charged', color: '#2f8063', active: true, metadata: { chargeableStage: 'charged', countsAsRealizedRevenue: true, countsAsPendingValue: false, excludesFromChargeableTotals: false } },
    { value: 'cancelled', label: 'Cancelled', color: '#a7b0ba', active: true, metadata: { chargeableStage: 'cancelled', countsAsRealizedRevenue: false, countsAsPendingValue: false, excludesFromChargeableTotals: true } }
  ]
}

const mapOption = (row: any): ConfigOption => ({ ...row, metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata })

export class ChargeableRepository {
  private outletScopedSchema: boolean | undefined
  private financialProofSchema: boolean | undefined
  constructor(private readonly db: PGlite) {}

  private async hasOutletScopeColumn() {
    if (this.outletScopedSchema === undefined) this.outletScopedSchema = Boolean((await this.db.query<{ present: boolean }>("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='chargeable_item_records' and column_name='outlet_scope_id') present")).rows[0]?.present)
    return this.outletScopedSchema
  }

  private async hasFinancialProofColumn() {
    if (this.financialProofSchema === undefined) this.financialProofSchema = Boolean((await this.db.query<{ present: boolean }>("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='chargeable_item_records' and column_name='check_invoice_number') present")).rows[0]?.present)
    return this.financialProofSchema
  }

  async initialize() {
    for (const group of Object.keys(groupKeys) as ChargeableConfigGroup[]) {
      const existing = await this.db.query<{ count: number }>('select count(*)::int as count from configuration_options where group_key=$1', [groupKeys[group]])
      if (existing.rows[0].count === 0) for (let index = 0; index < seeds[group].length; index++) {
        const option = seeds[group][index]
        await this.db.query('insert into configuration_options (id, group_key, value, label, color, metadata, active, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), groupKeys[group], option.value, option.label, option.color || null, JSON.stringify(option.metadata || {}), option.active, index])
      }
    }
    const stages: Array<[string, 'pending' | 'charged' | 'cancelled']> = [['pending', 'pending'], ['charged', 'charged'], ['cancelled', 'cancelled']]
    for (const [value, stage] of stages) await this.db.query("update configuration_options set metadata=metadata || jsonb_build_object('chargeableStage',$3::text) where group_key=$1 and value=$2 and not (metadata ? 'chargeableStage')", [groupKeys.statuses, value, stage])
    const statusRows = await this.db.query<any>('select id, metadata from configuration_options where group_key=$1', [groupKeys.statuses])
    for (const row of statusRows.rows) {
      const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {}
      if ('countsAsRealizedRevenue' in metadata && 'countsAsPendingValue' in metadata && 'excludesFromChargeableTotals' in metadata) continue
      const stage = metadata.chargeableStage || 'pending'
      await this.db.query('update configuration_options set metadata=$2, updated_at=now() where id=$1', [row.id, JSON.stringify({ ...metadata, countsAsRealizedRevenue: stage === 'charged', countsAsPendingValue: stage === 'pending', excludesFromChargeableTotals: stage === 'cancelled' })])
    }
  }

  async configuration(): Promise<Record<ChargeableConfigGroup, ConfigOption[]>> {
    const output = {} as Record<ChargeableConfigGroup, ConfigOption[]>
    for (const group of Object.keys(groupKeys) as ChargeableConfigGroup[]) {
      const result = await this.db.query<any>('select id, value, label, color, metadata, active, sort_order from configuration_options where group_key=$1 order by sort_order, label', [groupKeys[group]])
      output[group] = result.rows.map((row: any) => ({ ...mapOption(row), sortOrder: row.sort_order }))
    }
    return output
  }

  async saveConfiguration(group: ChargeableConfigGroup, option: ConfigOption, context: ChargeableConfigurationWriteContext): Promise<ConfigOption> {
    const existingRow = (await this.db.query<any>('select id,value,label,color,metadata,active,sort_order from configuration_options where id=$1 and group_key=$2', [option.id, groupKeys[group]])).rows[0]
    const existing = existingRow ? mapOption(existingRow) : null
    if (group === 'statuses' && !existing) throw new Error('Protected Chargeable status semantics cannot be created through ordinary manager configuration.')
    const next: ConfigOption = {
      ...option,
      id: option.id || randomUUID(),
      value: existing?.value || option.value,
      label: group === 'statuses' ? existing!.label : option.label,
      active: group === 'statuses' ? true : option.active,
      metadata: group === 'statuses' ? existing!.metadata : option.metadata,
    }
    const result = await this.db.query<any>('insert into configuration_options (id, group_key, value, label, color, metadata, active, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do update set value=excluded.value, label=excluded.label, color=excluded.color, metadata=excluded.metadata, active=excluded.active, updated_at=now() returning id, value, label, color, metadata, active, sort_order', [next.id, groupKeys[group], next.value, next.label, next.color || null, JSON.stringify(next.metadata || {}), next.active, existingRow?.sort_order ?? option.sortOrder ?? 100])
    const saved = mapOption(result.rows[0])
    await this.db.query('insert into audit_logs (id, entity_type, entity_id, action, before_data, after_data, actor) values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'chargeable_configuration', saved.id, existing ? 'updated' : 'created', existing ? JSON.stringify({ ...existing, outletScopeId: context.outletScopeId }) : null, JSON.stringify({ ...saved, outletScopeId: context.outletScopeId }), context.actor])
    return saved
  }

  private mapRecord(row: any): ChargeableRecord {
    return { id: row.id, date: row.charge_date, bookingId: row.booking_id, guestName: row.guest_name, roomNumber: row.room_number || '', checkInvoiceNumber: row.check_invoice_number || '', tableNumber: row.table_number || '', itemValue: row.item_value, itemLabel: row.item_label, itemCategory: row.item_category, quantity: Number(row.quantity), unitPrice: Number(row.unit_price), totalAmount: Number(row.total_amount), waiterId: row.waiter_id, waiter: row.waiter_id ? { name: row.waiter_name, number: row.waiter_number, position: row.waiter_position, employmentStatus: row.waiter_employment_status } : null, status: row.status, notes: row.notes || '', active: row.active, bookingNumber: row.booking_number, covers: row.booking_covers == null ? undefined : Number(row.booking_covers), reservationDate: row.booking_reservation_date || undefined, reservationTime: row.booking_reservation_time ? row.booking_reservation_time.slice(0, 5) : undefined, bookingSource: row.booking_source, importSource: row.import_source, sourceGuestNotes: row.source_guest_notes, createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by, updatedBy: row.updated_by }
  }

  private select(scoped: boolean, financialProof: boolean) { return `select c.id, ${scoped ? 'c.outlet_scope_id,' : ''} c.charge_date::text, c.booking_id, coalesce(b.guest_name,c.guest_name) guest_name, coalesce(b.room_number,c.room_number) room_number, ${financialProof ? 'c.check_invoice_number' : "''::text check_invoice_number"}, c.table_number, c.item_value, c.item_label, c.item_category, c.quantity, c.unit_price, c.total_amount, c.waiter_id, c.status, c.notes, c.active, c.created_at::text, c.updated_at::text, c.created_by, c.updated_by, b.booking_number, b.covers booking_covers, b.reservation_date::text booking_reservation_date, b.reservation_time::text booking_reservation_time, b.booking_source, b.import_source, b.source_guest_notes, coalesce((select al.after_data->'waiter'->>'name' from audit_logs al where al.entity_type='chargeable_item' and al.entity_id=c.id and al.after_data->'waiter'->>'name' is not null order by al.created_at asc limit 1),s.full_name) waiter_name, coalesce((select al.after_data->'waiter'->>'number' from audit_logs al where al.entity_type='chargeable_item' and al.entity_id=c.id and al.after_data->'waiter'->>'number' is not null order by al.created_at asc limit 1),s.staff_number) waiter_number, s.position_key waiter_position, s.employment_status_key waiter_employment_status from chargeable_item_records c left join bookings b on b.id=c.booking_id left join staff s on s.id=c.waiter_id` }

  async list(date: string, outletScopeId?: string): Promise<ChargeableRecord[]> {
    const scoped = await this.hasOutletScopeColumn()
    const financialProof = await this.hasFinancialProofColumn()
    if (scoped && !outletScopeId) throw new Error('The authorized Chargeable Item outlet could not be resolved.')
    const result = scoped ? await this.db.query<any>(`${this.select(scoped, financialProof)} where c.charge_date=$1 and c.outlet_scope_id=$2 order by c.active desc, c.created_at desc`, [date, outletScopeId]) : await this.db.query<any>(`${this.select(scoped, financialProof)} where c.charge_date=$1 order by c.active desc, c.created_at desc`, [date])
    return result.rows.map((row: any) => this.mapRecord(row))
  }

  async find(id: string, outletScopeId?: string): Promise<ChargeableRecord | null> {
    const scoped = await this.hasOutletScopeColumn()
    const financialProof = await this.hasFinancialProofColumn()
    if (scoped && !outletScopeId) throw new Error('The authorized Chargeable Item outlet could not be resolved.')
    const result = scoped ? await this.db.query<any>(`${this.select(scoped, financialProof)} where c.id=$1 and c.outlet_scope_id=$2`, [id, outletScopeId]) : await this.db.query<any>(`${this.select(scoped, financialProof)} where c.id=$1`, [id])
    return result.rows[0] ? this.mapRecord(result.rows[0]) : null
  }

  private async statusMetadata(value: string) {
    const row = (await this.db.query<any>('select metadata from configuration_options where group_key=$1 and value=$2', [groupKeys.statuses, value])).rows[0]
    return typeof row?.metadata === 'string' ? JSON.parse(row.metadata) : row?.metadata || {}
  }

  private sameCreateRequest(record: ChargeableWriteRequest, existing: ChargeableRecord) {
    const normalized = (value: unknown) => value == null ? '' : String(value).trim()
    return record.date === existing.date && normalized(record.bookingId) === normalized(existing.bookingId)
      && normalized(record.guestName) === normalized(existing.guestName) && normalized(record.roomNumber) === normalized(existing.roomNumber)
      && normalized(record.checkInvoiceNumber) === normalized(existing.checkInvoiceNumber) && normalized(record.tableNumber) === normalized(existing.tableNumber)
      && record.itemValue === existing.itemValue && Number(record.quantity) === existing.quantity
      && normalized(record.waiterId) === normalized(existing.waiterId) && record.status === existing.status
      && normalized(record.notes) === normalized(existing.notes)
  }

  async create(record: ChargeableWriteRequest, context: ChargeableWriteContext): Promise<ChargeableRecord> {
    const existing = await this.find(record.id, context.outletScopeId)
    if (!existing) return this.save(record, context)
    if (this.sameCreateRequest(record, existing)) return existing
    throw new Error('Chargeable request identity already belongs to a different transaction.')
  }

  async duplicateWarnings(record: ChargeableWriteRequest, outletScopeId: string): Promise<ChargeableDuplicateWarning[]> {
    const item = (await this.db.query<any>('select metadata from configuration_options where group_key=$1 and value=$2', [groupKeys.items, record.itemValue])).rows[0]
    const itemMetadata = typeof item?.metadata === 'string' ? JSON.parse(item.metadata) : item?.metadata || {}
    const unitPrice = Number(itemMetadata.price)
    const result = await this.db.query<any>(`select id,charge_date::text,coalesce(check_invoice_number,'') check_invoice_number,coalesce(room_number,'') room_number,coalesce(table_number,'') table_number,item_label,quantity,waiter_id
      from chargeable_item_records where outlet_scope_id=$1 and charge_date=$2 and coalesce(check_invoice_number,'')=$3 and coalesce(room_number,'')=$4 and coalesce(table_number,'')=$5 and item_value=$6 and waiter_id is not distinct from $7 and quantity=$8 and unit_price=$9 and active=true and id<>$10 order by created_at`, [outletScopeId, record.date, record.checkInvoiceNumber?.trim() || '', record.roomNumber?.trim() || '', record.tableNumber?.trim() || '', record.itemValue, record.waiterId || null, Number(record.quantity), unitPrice, record.id])
    return result.rows.map((row: any) => ({ id: row.id, date: row.charge_date, checkInvoiceNumber: row.check_invoice_number, roomNumber: row.room_number, tableNumber: row.table_number, itemLabel: row.item_label, quantity: Number(row.quantity), waiterId: row.waiter_id }))
  }

  async save(record: ChargeableWriteRequest, context?: ChargeableWriteContext): Promise<ChargeableRecord> {
    const scoped = await this.hasOutletScopeColumn()
    const financialProof = await this.hasFinancialProofColumn()
    if (scoped && !context?.outletScopeId) throw new Error('The authorized Chargeable Item outlet could not be resolved.')
    const actor = context?.actor || 'Venue Manager'
    const persistedScope = scoped ? (await this.db.query<{ outlet_scope_id: string }>('select outlet_scope_id from chargeable_item_records where id=$1', [record.id])).rows[0]?.outlet_scope_id : undefined
    if (persistedScope && persistedScope !== context?.outletScopeId) throw new Error('A Chargeable Item cannot be moved to another outlet through normal editing.')
    const previous = await this.find(record.id, context?.outletScopeId)
    const previousStatusMetadata = previous ? await this.statusMetadata(previous.status) : {}
    const nextStatusMetadata = await this.statusMetadata(record.status)
    if (previous && (previousStatusMetadata.countsAsRealizedRevenue === true || previousStatusMetadata.excludesFromChargeableTotals === true)) {
      if (this.sameCreateRequest(record, previous)) return previous
      const correctionOnly = this.sameCreateRequest({ ...record, status: previous.status }, previous)
      const correctionReason = record.correctionReason?.trim() || ''
      if (previousStatusMetadata.countsAsRealizedRevenue === true && nextStatusMetadata.excludesFromChargeableTotals === true && correctionOnly) {
        if (correctionReason.length < 8) throw new Error('A clear correction reason is required to cancel a realized chargeable transaction.')
        if (scoped) await this.db.query('update chargeable_item_records set status=$3, updated_by=$4, updated_at=now() where id=$1 and outlet_scope_id=$2', [record.id, context!.outletScopeId, record.status, actor])
        else await this.db.query('update chargeable_item_records set status=$2, updated_by=$3, updated_at=now() where id=$1', [record.id, record.status, actor])
        const corrected = await this.find(record.id, context?.outletScopeId)
        if (!corrected) throw new Error('Chargeable correction could not be saved.')
        const scope = scoped ? { outletScopeId: context!.outletScopeId } : {}
        await this.db.query('insert into audit_logs (id, entity_type, entity_id, action, before_data, after_data, actor) values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'chargeable_item', record.id, 'corrected', JSON.stringify({ ...previous, ...scope }), JSON.stringify({ ...corrected, ...scope, correctionReason }), actor])
        return corrected
      }
      throw new Error('Realized and cancelled chargeable transactions are immutable. Use the audited correction workflow.')
    }
    if (record.waiterId && record.waiterId !== previous?.waiterId) {
      const waiter = await this.db.query<{ employment_status_key: string }>('select employment_status_key from staff where id=$1', [record.waiterId])
      if (!waiter.rows[0]) throw new Error('The selected waiter no longer exists.')
      if (waiter.rows[0].employment_status_key !== 'active') throw new Error('Inactive staff cannot be assigned to new chargeable records.')
    }
    if (record.bookingId) {
      const booking = await this.db.query<{ id: string }>('select id from bookings where id=$1', [record.bookingId])
      if (!booking.rows[0]) throw new Error('The selected booking no longer exists.')
    }
    const itemChanged = !previous || previous.itemValue !== record.itemValue
    let itemLabel = previous?.itemLabel || record.itemLabel
    let itemCategory = previous?.itemCategory || record.itemCategory
    let unitPrice = previous?.unitPrice ?? record.unitPrice
    if (itemChanged) {
      const itemResult = await this.db.query<any>('select label, metadata, active from configuration_options where group_key=$1 and value=$2', [groupKeys.items, record.itemValue])
      const item = itemResult.rows[0]
      if (!item) throw new Error('The selected chargeable item no longer exists.')
      if (!item.active) throw new Error('Inactive chargeable items cannot be used for new records.')
      const metadata = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata
      unitPrice = Number(metadata?.price)
      if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('The selected chargeable item does not have a valid price.')
      itemLabel = item.label
      itemCategory = metadata?.category || 'Uncategorized'
    }
    const quantity = Number(record.quantity)
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Quantity must be a whole number of at least 1.')
    const statusMetadata = nextStatusMetadata
    if (statusMetadata.countsAsRealizedRevenue === true) {
      if (!record.roomNumber?.trim() || !record.checkInvoiceNumber?.trim()) throw new Error('Room Number and Check / Invoice Number are required for a charged financial record.')
      if (!financialProof) throw new Error('Migration 013 is required before Check / Invoice financial proof can be saved.')
    }
    const totalAmount = Number((quantity * unitPrice).toFixed(2))
    if (previous) {
      const parameters = [record.id, record.bookingId || null, record.date, record.guestName.trim(), record.roomNumber || null, record.tableNumber || null, record.itemValue, itemLabel, itemCategory, quantity, unitPrice, totalAmount, record.waiterId || null, record.status, record.notes || '', record.active, actor]
      if (scoped && financialProof) await this.db.query('update chargeable_item_records set booking_id=$2, charge_date=$3, guest_name=$4, room_number=$5, table_number=$6, item_value=$7, item_label=$8, item_category=$9, quantity=$10, unit_price=$11, total_amount=$12, amount=$12, waiter_id=$13, status=$14, notes=$15, active=$16, updated_by=$17, updated_at=now(), check_invoice_number=$19 where id=$1 and outlet_scope_id=$18', [...parameters, context!.outletScopeId, record.checkInvoiceNumber || ''])
      else if (scoped) await this.db.query('update chargeable_item_records set booking_id=$2, charge_date=$3, guest_name=$4, room_number=$5, table_number=$6, item_value=$7, item_label=$8, item_category=$9, quantity=$10, unit_price=$11, total_amount=$12, amount=$12, waiter_id=$13, status=$14, notes=$15, active=$16, updated_by=$17, updated_at=now() where id=$1 and outlet_scope_id=$18', [...parameters, context!.outletScopeId])
      else if (financialProof) await this.db.query('update chargeable_item_records set booking_id=$2, charge_date=$3, guest_name=$4, room_number=$5, table_number=$6, item_value=$7, item_label=$8, item_category=$9, quantity=$10, unit_price=$11, total_amount=$12, amount=$12, waiter_id=$13, status=$14, notes=$15, active=$16, updated_by=$17, updated_at=now(), check_invoice_number=$18 where id=$1', [...parameters, record.checkInvoiceNumber || ''])
      else await this.db.query('update chargeable_item_records set booking_id=$2, charge_date=$3, guest_name=$4, room_number=$5, table_number=$6, item_value=$7, item_label=$8, item_category=$9, quantity=$10, unit_price=$11, total_amount=$12, amount=$12, waiter_id=$13, status=$14, notes=$15, active=$16, updated_by=$17, updated_at=now() where id=$1', parameters)
    } else {
      if (scoped && financialProof) await this.db.query('insert into chargeable_item_records (id, outlet_scope_id, booking_id, charge_date, guest_name, room_number, check_invoice_number, table_number, item_value, item_label, item_category, quantity, unit_price, total_amount, amount, waiter_id, status, notes, active, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16,$17,true,$18,$18)', [record.id, context!.outletScopeId, record.bookingId || null, record.date, record.guestName.trim(), record.roomNumber || null, record.checkInvoiceNumber || '', record.tableNumber || null, record.itemValue, itemLabel, itemCategory, quantity, unitPrice, totalAmount, record.waiterId || null, record.status, record.notes || '', actor])
      else if (scoped) await this.db.query('insert into chargeable_item_records (id, outlet_scope_id, booking_id, charge_date, guest_name, room_number, table_number, item_value, item_label, item_category, quantity, unit_price, total_amount, amount, waiter_id, status, notes, active, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15,$16,true,$17,$17)', [record.id, context!.outletScopeId, record.bookingId || null, record.date, record.guestName.trim(), record.roomNumber || null, record.tableNumber || null, record.itemValue, itemLabel, itemCategory, quantity, unitPrice, totalAmount, record.waiterId || null, record.status, record.notes || '', actor])
      else if (financialProof) await this.db.query('insert into chargeable_item_records (id, booking_id, charge_date, guest_name, room_number, check_invoice_number, table_number, item_value, item_label, item_category, quantity, unit_price, total_amount, amount, waiter_id, status, notes, active, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15,$16,true,$17,$17)', [record.id, record.bookingId || null, record.date, record.guestName.trim(), record.roomNumber || null, record.checkInvoiceNumber || '', record.tableNumber || null, record.itemValue, itemLabel, itemCategory, quantity, unitPrice, totalAmount, record.waiterId || null, record.status, record.notes || '', actor])
      else await this.db.query('insert into chargeable_item_records (id, booking_id, charge_date, guest_name, room_number, table_number, item_value, item_label, item_category, quantity, unit_price, total_amount, amount, waiter_id, status, notes, active, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14,$15,true,$16,$16)', [record.id, record.bookingId || null, record.date, record.guestName.trim(), record.roomNumber || null, record.tableNumber || null, record.itemValue, itemLabel, itemCategory, quantity, unitPrice, totalAmount, record.waiterId || null, record.status, record.notes || '', actor])
    }
    const saved = await this.find(record.id, context?.outletScopeId)
    if (!saved) throw new Error('Chargeable record could not be saved.')
    const auditable = (value: ChargeableRecord) => scoped ? { ...value, outletScopeId: context!.outletScopeId } : value
    await this.db.query('insert into audit_logs (id, entity_type, entity_id, action, before_data, after_data, actor) values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'chargeable_item', record.id, previous ? 'updated' : 'created', previous ? JSON.stringify(auditable(previous)) : null, JSON.stringify(auditable(saved)), actor])
    return saved
  }

  async archive(id: string, context?: ChargeableWriteContext): Promise<ChargeableRecord> {
    const scoped = await this.hasOutletScopeColumn()
    if (scoped && !context?.outletScopeId) throw new Error('The authorized Chargeable Item outlet could not be resolved.')
    const actor = context?.actor || 'Venue Manager'
    const previous = await this.find(id, context?.outletScopeId)
    if (!previous) throw new Error('Chargeable record not found.')
    const statusMetadata = await this.statusMetadata(previous.status)
    if (statusMetadata.countsAsRealizedRevenue === true || statusMetadata.excludesFromChargeableTotals === true) throw new Error('Realized and cancelled chargeable transactions cannot be archived. Use the audited correction workflow.')
    if (scoped) await this.db.query('update chargeable_item_records set active=false, updated_by=$3, updated_at=now() where id=$1 and outlet_scope_id=$2', [id, context!.outletScopeId, actor])
    else await this.db.query('update chargeable_item_records set active=false, updated_by=$2, updated_at=now() where id=$1', [id, actor])
    const saved = await this.find(id, context?.outletScopeId)
    if (!saved) throw new Error('Chargeable record could not be archived.')
    const auditable = (value: ChargeableRecord) => scoped ? { ...value, outletScopeId: context!.outletScopeId } : value
    await this.db.query('insert into audit_logs (id, entity_type, entity_id, action, before_data, after_data, actor) values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'chargeable_item', id, 'archived', JSON.stringify(auditable(previous)), JSON.stringify(auditable(saved)), actor])
    return saved
  }

  async summary(date: string, outletScopeId?: string): Promise<ChargeableSummary> {
    const records = (await this.list(date, outletScopeId)).filter(record => record.active)
    const statuses = (await this.configuration()).statuses
    const metadata = (record: ChargeableRecord) => statuses.find(option => option.value === record.status)?.metadata || {}
    const included = records.filter(record => !metadata(record).excludesFromChargeableTotals)
    const realized = records.filter(record => metadata(record).countsAsRealizedRevenue)
    const pending = records.filter(record => metadata(record).countsAsPendingValue)
    const sellerTotals = new Map<string, number>()
    for (const record of realized) {
      const cleanLabel = record.itemLabel.replace(/\s+(Basic|Premium)$/i, '')
      sellerTotals.set(cleanLabel, (sellerTotals.get(cleanLabel) || 0) + record.totalAmount)
    }
    const topSeller = [...sellerTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—'
    const guests = new Set(records.map(record => record.bookingId || `${record.guestName.toLowerCase()}|${record.roomNumber}`)).size
    return { totalCharges: records.length, totalValue: Number(included.reduce((total, record) => total + record.totalAmount, 0).toFixed(2)), realizedRevenue: Number(realized.reduce((total, record) => total + record.totalAmount, 0).toFixed(2)), pendingValue: Number(pending.reduce((total, record) => total + record.totalAmount, 0).toFixed(2)), charged: realized.length, pending: pending.length, itemsSold: realized.reduce((total, record) => total + record.quantity, 0), topSeller, guests }
  }
}
