import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { bookingApi, chargeableApi } from './api'
import type { BookingRecord, ChargeableDuplicateWarning, ChargeableRecord, ChargeableSummary, ChargeableWriteRequest, ConfigOption, Staff } from './domain'
import './chargeables.css'
import { addCalendarDays, serviceDate } from './service-date'
import { consumeWorkflow } from './workflow-intent'

export interface ChargeableConfiguration { items: ConfigOption[]; statuses: ConfigOption[]; tables: ConfigOption[] }

const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`))
const statusLabel = (configuration: ChargeableConfiguration, value: string) => configuration.statuses.find(option => option.value === value)?.label || value
type ChargeableFamily = { value: string; label: string; options: ConfigOption[] }
const familyForItem = (option?: Pick<ConfigOption, 'value' | 'label'>) => option ? { value: option.value.replace(/_(basic|premium)$/i, ''), label: option.label.replace(/\s+(Basic|Premium)$/i, '') } : undefined
const familyLabelForRecord = (record: ChargeableRecord, configuration: ChargeableConfiguration) => familyForItem(configuration.items.find(option => option.value === record.itemValue))?.label || record.itemLabel.replace(/\s+(Basic|Premium)$/i, '')
const transactionLocked = (record: ChargeableRecord, configuration: ChargeableConfiguration) => { const metadata = configuration.statuses.find(option => option.value === record.status)?.metadata; return metadata?.countsAsRealizedRevenue === true || metadata?.excludesFromChargeableTotals === true }

export function ChargeableItemsPage({ staff, configuration, onToast }: { staff: Staff[]; configuration: ChargeableConfiguration; onToast: (message: string) => void }) {
  const [date, setDate] = useState(serviceDate())
  const [records, setRecords] = useState<ChargeableRecord[]>([])
  const [bookings, setBookings] = useState<BookingRecord[]>([])
  const [summary, setSummary] = useState<ChargeableSummary>({ totalCharges: 0, totalValue: 0, realizedRevenue: 0, pendingValue: 0, charged: 0, pending: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [item, setItem] = useState('all')
  const [waiter, setWaiter] = useState('all')
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<ChargeableRecord | 'new' | null>(null)
  const [viewing, setViewing] = useState<ChargeableRecord | null>(null)
  const itemFamilies = useMemo<ChargeableFamily[]>(() => {
    const groups = new Map<string, ChargeableFamily>()
    configuration.items.filter(option => option.active).forEach(option => {
      const family = familyForItem(option)
      if (!family) return
      const existing = groups.get(family.value)
      if (existing) existing.options.push(option)
      else groups.set(family.value, { ...family, options: [option] })
    })
    return [...groups.values()]
  }, [configuration.items])

  useEffect(() => { if (consumeWorkflow('chargeable-add')) setEditing('new') }, [])

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [nextRecords, nextBookings, nextSummary] = await Promise.all([chargeableApi.list(date), bookingApi.list(date), chargeableApi.summary(date)])
      setRecords(nextRecords); setBookings(nextBookings); setSummary(nextSummary)
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load chargeable records.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [date])

  const visible = useMemo(() => records.filter(record => {
    const search = `${record.guestName} ${record.roomNumber} ${record.checkInvoiceNumber || ''} ${familyLabelForRecord(record, configuration)} ${record.itemLabel} ${record.waiter?.name || ''}`.toLowerCase()
    const family = familyForItem(configuration.items.find(option => option.value === record.itemValue))?.value
    return (showArchived || record.active) && (status === 'all' || record.status === status) && (item === 'all' || family === item) && (waiter === 'all' || (waiter === 'unassigned' ? !record.waiterId : record.waiterId === waiter)) && search.includes(query.toLowerCase())
  }), [records, query, status, item, waiter, showArchived, configuration])

  const save = async (record: ChargeableWriteRequest) => {
    const saved = records.some(existing => existing.id === record.id) ? await chargeableApi.update(record) : await chargeableApi.create(record)
    setRecords(current => current.some(existing => existing.id === saved.id) ? current.map(existing => existing.id === saved.id ? saved : existing) : [saved, ...current]); setViewing(current => current?.id === saved.id ? saved : current)
    setSummary(await chargeableApi.summary(date)); onToast('Chargeable record saved.')
  }
  const quickUpdate = async (record: ChargeableRecord, changes: Partial<ChargeableWriteRequest>, message: string) => { try { await save({ ...record, ...changes }); onToast(message) } catch (saveError) { onToast(saveError instanceof Error ? saveError.message : 'Unable to update chargeable record.') } }
  const archive = async (record: ChargeableRecord) => { if (!window.confirm(`Archive ${record.itemLabel} for ${record.guestName}?`)) return; try { const saved = await chargeableApi.archive(record.id); setRecords(current => current.map(item => item.id === saved.id ? saved : item)); setSummary(await chargeableApi.summary(date)); onToast('Chargeable record archived.') } catch (archiveError) { onToast(archiveError instanceof Error ? archiveError.message : 'Unable to archive record.') } }

  return <>
    <section className="chargeable-toolbar">
<div>
<button className="secondary" onClick={() => setDate(value => addCalendarDays(value, -1))}>← Previous</button>
<label>Charge date<input aria-label="Chargeable date" type="date" value={date} onChange={event => setDate(event.target.value)} />
</label>
<button className="secondary" onClick={() => setDate(value => addCalendarDays(value, 1))}>Next →</button>
<button className="secondary" onClick={() => setDate(serviceDate())}>Today</button>
</div>
<div>
<span>{dateLabel(date)}</span>
<button className="primary" onClick={() => setEditing('new')}>＋ Add Chargeable Item</button>
</div>
</section>
    <section className="chargeable-summary">
<article className="panel">
<span>Today Revenue</span>
<strong>{money(summary.realizedRevenue)}</strong>
</article>
<article className="panel">
<span>Items Sold</span>
<strong>{summary.itemsSold || 0}</strong>
</article>
<article className="panel">
<span>Top Item</span>
<strong className="summary-text">{summary.topSeller || '—'}</strong>
</article>
<article className="panel">
<span>Guests</span>
<strong>{summary.guests || 0}</strong>
</article>
</section>
    <section className="panel chargeable-panel">
<nav className="chargeable-tabs" aria-label="Chargeable items"><button className={item === 'all' ? 'active' : ''} onClick={() => setItem('all')}>All <b>{records.filter(record => record.active).length}</b></button>{itemFamilies.map(family => <button key={family.value} className={item === family.value ? 'active' : ''} onClick={() => setItem(family.value)}>{family.label} <b>{records.filter(record => record.active && familyForItem(configuration.items.find(option => option.value === record.itemValue))?.value === family.value).length}</b></button>)}</nav>
<div className="chargeable-filters">
<input aria-label="Search chargeable records" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search guest, room, check / invoice, item or waiter" />
<select aria-label="Filter chargeable status" value={status} onChange={event => setStatus(event.target.value)}>
<option value="all">All statuses</option>{configuration.statuses.map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select>
<select aria-label="Filter chargeable item" value={item} onChange={event => setItem(event.target.value)}>
<option value="all">All items</option>{itemFamilies.map(family => <option key={family.value} value={family.value}>{family.label}</option>)}</select>
<select aria-label="Filter chargeable waiter" value={waiter} onChange={event => setWaiter(event.target.value)}>
<option value="all">All waiters</option>
<option value="unassigned">Unassigned waiter</option>{staff.map(person => <option key={person.id} value={person.id}>{person.name}{person.employmentStatus !== 'active' ? ' (Inactive)' : ''}</option>)}</select>
<label className="check-label archive-toggle">
<input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} /> Show archived</label>
</div>
      {loading && <div className="inline-state">Loading chargeable records…</div>}{error && <div className="inline-state error-state">
<p>{error}</p>
<button className="secondary" onClick={() => void load()}>Try again</button>
</div>}{!loading && !error && <div className="chargeable-table-wrap" tabIndex={0} aria-label="Chargeable items table">
<table className="chargeable-table">
<thead>
<tr>
<th>Time</th>
<th>Guest / Room</th>
<th>Item</th>
<th>Qty</th>
<th>Unit Price</th>
<th>Total</th>
<th>Table</th>
<th>Waiter</th>
<th>Status</th>
<th>
</th>
</tr>
</thead>
<tbody>{visible.map(record => <ChargeableRow key={record.id} record={record} staff={staff} configuration={configuration} onUpdate={quickUpdate} onView={() => setViewing(record)} onEdit={() => setEditing(record)} onArchive={() => void archive(record)} />)}</tbody>
</table>
<div className="mobile-chargeable-list">{visible.map(record => <MobileChargeableCard key={record.id} record={record} staff={staff} configuration={configuration} onUpdate={quickUpdate} onView={() => setViewing(record)} onEdit={() => setEditing(record)} onArchive={() => void archive(record)} />)}</div>
{visible.length === 0 && <div className="inline-empty">No chargeable records match this date and filters.</div>}</div>}
    </section>
    {editing && <ChargeableForm record={editing === 'new' ? undefined : editing} date={date} bookings={bookings} staff={staff} configuration={configuration} onClose={() => setEditing(null)} onSave={async record => { await save(record); setEditing(null) }} />}
    {viewing && <ChargeableDetails record={viewing} configuration={configuration} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null) }} onStatus={(nextStatus, correctionReason) => void quickUpdate(viewing, { status: nextStatus, correctionReason }, 'Chargeable status saved.')} />}
  </>
}

function ChargeableRow({ record, staff, configuration, onUpdate, onView, onEdit, onArchive }: { record: ChargeableRecord; staff: Staff[]; configuration: ChargeableConfiguration; onUpdate: (record: ChargeableRecord, changes: Partial<ChargeableWriteRequest>, message: string) => Promise<void>; onView: () => void; onEdit: () => void; onArchive: () => void }) {
  const waiters = staff.filter(person => person.employmentStatus === 'active' || person.id === record.waiterId)
  const status = configuration.statuses.find(option => option.value === record.status)
  const locked = transactionLocked(record, configuration)
  return <tr className={!record.active ? 'archived-row' : ''}>
<td className="chargeable-time"><b>{record.reservationTime || '—'}</b></td>
<td>
<b>{record.guestName}</b>
<small>Room {record.roomNumber || '—'} · Check / Invoice {record.checkInvoiceNumber || 'Historical · not recorded'}</small>
</td>
<td>
<b>{familyLabelForRecord(record, configuration)}</b>
<small>{money(record.unitPrice)} package</small>
</td>
<td>{record.quantity}</td>
<td>{money(record.unitPrice)}</td>
<td>
<b>{money(record.totalAmount)}</b>
</td>
<td>
<select aria-label={`Table for ${record.guestName}`} disabled={!record.active || locked} value={record.tableNumber} onChange={event => void onUpdate(record, { tableNumber: event.target.value }, 'Table assignment saved.')}>
<option value="">Unassigned</option>{configuration.tables.filter(option => option.active || option.value === record.tableNumber).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select>
</td>
<td>
<select aria-label={`Waiter for ${record.guestName}`} disabled={!record.active || locked} value={record.waiterId || ''} onChange={event => void onUpdate(record, { waiterId: event.target.value || null }, 'Waiter assignment saved.')}>
<option value="">Unassigned</option>{waiters.map(person => <option key={person.id} value={person.id} disabled={person.employmentStatus !== 'active'}>{person.name}{person.employmentStatus !== 'active' ? ' (Inactive – historical)' : ''}</option>)}</select>
</td>
<td>
{locked ? <span className="badge" style={{ borderColor: status?.color }}>{status?.label || record.status}</span> : <select aria-label={`Status for ${record.guestName}`} disabled={!record.active} value={record.status} style={{ borderColor: status?.color }} onChange={event => void onUpdate(record, { status: event.target.value }, 'Chargeable status saved.')} >{configuration.statuses.filter(option => option.active || option.value === record.status).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select>}
</td>
<td className="row-actions">
<button className="link" onClick={onView}>View</button>{record.active && !locked && <>
<button className="link" onClick={onEdit}>Edit</button>
<button className="link danger" onClick={onArchive}>Archive</button>
</>}</td>
</tr>
}

function MobileChargeableCard({ record, staff, configuration, onUpdate, onView, onEdit, onArchive }: { record: ChargeableRecord; staff: Staff[]; configuration: ChargeableConfiguration; onUpdate: (record: ChargeableRecord, changes: Partial<ChargeableWriteRequest>, message: string) => Promise<void>; onView: () => void; onEdit: () => void; onArchive: () => void }) {
  const waiters = staff.filter(person => person.employmentStatus === 'active' || person.id === record.waiterId)
  const status = configuration.statuses.find(option => option.value === record.status)
  const locked = transactionLocked(record, configuration)
  return <article className={`mobile-operation-card mobile-chargeable-card${!record.active ? ' archived-row' : ''}`}>
    <header className="mobile-card-heading">
      <div><span className="mobile-card-kicker">Chargeable item</span><h4>{familyLabelForRecord(record, configuration)}</h4><small>Qty {record.quantity} · Unit {money(record.unitPrice)}</small></div>
      <strong className="mobile-card-total">{money(record.totalAmount)}</strong>
    </header>
    <div className="mobile-card-facts">
      <span><small>Guest</small><b>{record.guestName}</b></span>
      <span><small>Room</small><b>{record.roomNumber || '—'}</b></span>
      <span><small>Check / Invoice</small><b>{record.checkInvoiceNumber || 'Historical · not recorded'}</b></span>
    </div>
    <div className="mobile-card-fields">
      <label>Table<select aria-label={`Mobile table for ${record.guestName}`} disabled={!record.active || locked} value={record.tableNumber} onChange={event => void onUpdate(record, { tableNumber: event.target.value }, 'Table assignment saved.')}><option value="">Unassigned</option>{configuration.tables.filter(option => option.active || option.value === record.tableNumber).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select></label>
      <label>Waiter<select aria-label={`Mobile waiter for ${record.guestName}`} disabled={!record.active || locked} value={record.waiterId || ''} onChange={event => void onUpdate(record, { waiterId: event.target.value || null }, 'Waiter assignment saved.')}><option value="">Unassigned</option>{waiters.map(person => <option key={person.id} value={person.id} disabled={person.employmentStatus !== 'active'}>{person.name}{person.employmentStatus !== 'active' ? ' (Inactive – historical)' : ''}</option>)}</select></label>
      <label>Status{locked ? <span className="badge" style={{ borderColor: status?.color }}>{status?.label || record.status}</span> : <select aria-label={`Mobile status for ${record.guestName}`} disabled={!record.active} value={record.status} style={{ borderColor: status?.color }} onChange={event => void onUpdate(record, { status: event.target.value }, 'Chargeable status saved.')}>{configuration.statuses.filter(option => option.active || option.value === record.status).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select>}</label>
    </div>
    <div className="mobile-card-actions"><button className="secondary" onClick={onView}>View</button>{record.active && !locked && <><button className="secondary" onClick={onEdit}>Edit</button><button className="secondary danger" onClick={onArchive}>Archive</button></>}</div>
  </article>
}

function ChargeableForm({ record, date, bookings, staff, configuration, onClose, onSave }: { record?: ChargeableRecord; date: string; bookings: BookingRecord[]; staff: Staff[]; configuration: ChargeableConfiguration; onClose: () => void; onSave: (record: ChargeableWriteRequest) => Promise<void> }) {
  const firstItem = configuration.items.find(option => option.active)
  const itemFamilies = useMemo<ChargeableFamily[]>(() => {
    const groups = new Map<string, ChargeableFamily>()
    configuration.items.filter(option => option.active || option.value === record?.itemValue).forEach(option => {
      const family = familyForItem(option)
      if (!family) return
      const existing = groups.get(family.value)
      if (existing) existing.options.push(option)
      else groups.set(family.value, { ...family, options: [option] })
    })
    return [...groups.values()]
  }, [configuration.items, record?.itemValue])
  const firstStatus = configuration.statuses.find(option => option.active && option.metadata?.chargeableStage === 'pending') || configuration.statuses.find(option => option.active)
  const [form, setForm] = useState<ChargeableRecord>(record || { id: crypto.randomUUID(), date, bookingId: null, guestName: '', roomNumber: '', tableNumber: '', itemValue: firstItem?.value || '', itemLabel: firstItem?.label || '', itemCategory: firstItem?.metadata?.category || '', quantity: 1, unitPrice: Number(firstItem?.metadata?.price || 0), totalAmount: Number(firstItem?.metadata?.price || 0), waiterId: null, waiter: null, status: firstStatus?.value || '', notes: '', active: true })
  const [familyValue, setFamilyValue] = useState(familyForItem(configuration.items.find(option => option.value === (record?.itemValue || firstItem?.value)))?.value || '')
  const [saving, setSaving] = useState(false); const [error, setError] = useState('')
  const [duplicateWarnings, setDuplicateWarnings] = useState<ChargeableDuplicateWarning[]>([])
  const [duplicateReviewed, setDuplicateReviewed] = useState(false)
  const selectedItem = configuration.items.find(option => option.value === form.itemValue)
  const selectedFamily = itemFamilies.find(family => family.value === familyValue) || itemFamilies.find(family => family.options.some(option => option.value === form.itemValue))
  const availableStaff = staff.filter(person => person.employmentStatus === 'active' || person.id === form.waiterId)
  const update = <K extends keyof ChargeableRecord>(field: K, value: ChargeableRecord[K]) => setForm(current => ({ ...current, [field]: value }))
  const selectBooking = (bookingId: string) => { const booking = bookings.find(item => item.id === bookingId); if (!booking) return setForm(current => ({ ...current, bookingId: null })); setForm(current => ({ ...current, bookingId: booking.id, date: booking.reservationDate, guestName: booking.guestName, roomNumber: booking.roomNumber, tableNumber: booking.tableNumber, waiterId: booking.waiterId, covers: booking.covers, reservationDate: booking.reservationDate, reservationTime: booking.reservationTime, bookingNumber: booking.bookingNumber, bookingSource: booking.bookingSource, importSource: booking.importSource, sourceGuestNotes: booking.sourceGuestNotes })) }
  const selectItem = (value: string) => { const option = configuration.items.find(item => item.value === value); const price = Number(option?.metadata?.price || 0); setForm(current => ({ ...current, itemValue: value, itemLabel: option?.label || '', itemCategory: option?.metadata?.category || '', unitPrice: price, totalAmount: Number((current.quantity * price).toFixed(2)) })) }
  const selectFamily = (value: string) => { const family = itemFamilies.find(candidate => candidate.value === value); setFamilyValue(value); if (family?.options[0]) selectItem(family.options[0].value) }
  const selectQuantity = (quantity: number) => setForm(current => ({ ...current, quantity, totalAmount: Number((quantity * current.unitPrice).toFixed(2)) }))
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!form.date || !form.guestName.trim() || !form.itemValue || form.quantity < 1 || !form.status) return setError('Date, guest, item, quantity and status are required.'); const realized = configuration.statuses.find(option => option.value === form.status)?.metadata?.countsAsRealizedRevenue === true; if (realized && (!form.roomNumber.trim() || !form.checkInvoiceNumber?.trim())) return setError('Room Number and Check / Invoice Number are required for a charged financial record.'); setSaving(true); setError(''); try { const candidate = { ...form, guestName: form.guestName.trim() }; if (!record && !duplicateReviewed) { const matches = await chargeableApi.duplicateReview(candidate); if (matches.length) { setDuplicateWarnings(matches); setSaving(false); return } } await onSave(candidate) } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save chargeable record.') } finally { setSaving(false) } }
  return <ChargeableModal title={record ? 'Edit Chargeable Record' : 'Add Chargeable Item'} onClose={onClose} wide>
<form className="staff-form chargeable-form" onSubmit={event => void submit(event)}>
<div className="chargeable-form-grid">
<label>Related booking<select value={form.bookingId || ''} onChange={event => selectBooking(event.target.value)}>
<option value="">Manual entry / walk-in</option>{bookings.map(booking => <option key={booking.id} value={booking.id}>{booking.reservationTime} · {booking.guestName} · Room {booking.roomNumber || '—'}</option>)}</select>
</label>
<label>Date<input type="date" value={form.date} onChange={event => update('date', event.target.value)} />
</label>
<label>Guest<input value={form.guestName} readOnly={Boolean(form.bookingId)} onChange={event => update('guestName', event.target.value)} placeholder="Guest name" />
</label>
<label>Room number<input value={form.roomNumber} readOnly={Boolean(form.bookingId)} onChange={event => update('roomNumber', event.target.value)} />
</label>
<label>Table number<select value={form.tableNumber} onChange={event => update('tableNumber', event.target.value)}>
<option value="">Unassigned</option>{configuration.tables.filter(option => option.active || option.value === form.tableNumber).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select>
</label>
<label>Check / Invoice Number<input value={form.checkInvoiceNumber || ''} onChange={event => update('checkInvoiceNumber', event.target.value)} placeholder="Enter exactly as shown on the check" /></label>
<label>Covers<input readOnly value={form.covers ?? ''} placeholder="—" /></label>
<label>Reservation time<input readOnly value={form.reservationTime || ''} placeholder="—" /></label>
<label>Waiter<select value={form.waiterId || ''} onChange={event => update('waiterId', event.target.value || null)}>
<option value="">Unassigned</option>{availableStaff.map(person => <option key={person.id} value={person.id} disabled={person.employmentStatus !== 'active'}>{person.name} · {person.number}{person.employmentStatus !== 'active' ? ' (Inactive – historical)' : ''}</option>)}</select>
</label>
<label>Item<select value={selectedFamily?.value || ''} onChange={event => selectFamily(event.target.value)}>{itemFamilies.map(family => <option key={family.value} value={family.value}>{family.label}</option>)}</select>
</label>
<label>Package / price<select value={form.itemValue} onChange={event => selectItem(event.target.value)}>{(selectedFamily?.options || [selectedItem]).filter(Boolean).map(option => <option key={option!.id} value={option!.value}>{money(Number(option!.metadata?.price || 0))}</option>)}</select>
</label>
<label>Quantity<select value={form.quantity} onChange={event => selectQuantity(Number(event.target.value))}>{Array.from({ length: 20 }, (_, index) => index + 1).map(quantity => <option key={quantity} value={quantity}>{quantity}</option>)}</select>
</label>
<label>Unit price<input readOnly value={money(form.unitPrice)} />
</label>
<label>Total amount<input readOnly value={money(form.quantity * form.unitPrice)} />
</label>
<label>Status<select value={form.status} onChange={event => update('status', event.target.value)}>{configuration.statuses.filter(option => option.active || option.value === form.status).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select>
</label>
</div>
<label>Notes<textarea rows={3} value={form.notes} onChange={event => update('notes', event.target.value)} placeholder="Optional operational note" />
</label>{duplicateWarnings.length > 0 && <div className="chargeable-duplicate-warning" role="alert"><b>Possible duplicate transaction</b><p>{duplicateWarnings.length} matching active record{duplicateWarnings.length === 1 ? '' : 's'} use the same service date, check, room, table, item, seller, quantity and price. Review before saving another transaction.</p><label className="check-label"><input type="checkbox" checked={duplicateReviewed} onChange={event => setDuplicateReviewed(event.target.checked)} /> I reviewed the possible duplicate and intend to create a separate transaction.</label></div>}{error && <p className="save-error">{error}</p>}<div className="form-actions">
<button type="button" className="secondary" onClick={onClose}>Cancel</button>
<button type="submit" className="primary" disabled={saving || (duplicateWarnings.length > 0 && !duplicateReviewed)}>{saving ? 'Saving…' : 'Save chargeable record'}</button>
</div>
</form>
</ChargeableModal>
}

function ChargeableDetails({ record, configuration, onClose, onEdit, onStatus }: { record: ChargeableRecord; configuration: ChargeableConfiguration; onClose: () => void; onEdit: () => void; onStatus: (status: string, correctionReason?: string) => void }) {
  const pending = configuration.statuses.find(option => option.active && option.metadata?.chargeableStage === 'pending')
  const charged = configuration.statuses.find(option => option.active && option.metadata?.chargeableStage === 'charged')
  const cancelled = configuration.statuses.find(option => option.active && option.metadata?.excludesFromChargeableTotals === true)
  const locked = transactionLocked(record, configuration)
  const realized = configuration.statuses.find(option => option.value === record.status)?.metadata?.countsAsRealizedRevenue === true
  const correct = () => { if (!cancelled) return; const reason = window.prompt('Enter the correction reason. The original realized transaction remains in the audit history.'); if (reason?.trim()) onStatus(cancelled.value, reason.trim()) }
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [onClose])
  return <div className="chargeable-drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><aside className="chargeable-drawer" role="dialog" aria-modal="true" aria-label="Chargeable Item Details">
<header><div><p className="eyebrow">SERVICE REVENUE</p><h2>{record.itemLabel}</h2><span className="chargeable-item-chip">{statusLabel(configuration, record.status)}</span></div><button className="close" aria-label="Close chargeable details" title="Close" onClick={onClose}>×</button></header>
<div className="chargeable-drawer-body"><ChargeableDrawerSection title="Financial Proof"><ChargeableDetail label="Guest" value={record.guestName} /><ChargeableDetail label="Room Number" value={record.roomNumber || '—'} /><ChargeableDetail label="Check / Invoice Number" value={record.checkInvoiceNumber || 'Historical · not recorded'} /><ChargeableDetail label="Covers" value={record.covers ? String(record.covers) : '—'} /></ChargeableDrawerSection>
<ChargeableDrawerSection title="Item Details"><ChargeableDetail label="Item" value={record.itemLabel} /><ChargeableDetail label="Quantity" value={String(record.quantity)} /><ChargeableDetail label="Unit price" value={money(record.unitPrice)} /><ChargeableDetail label="Total" value={money(record.totalAmount)} /></ChargeableDrawerSection>
<ChargeableDrawerSection title="Booking Information"><ChargeableDetail label="Date / time" value={`${dateLabel(record.reservationDate || record.date)}${record.reservationTime ? ` · ${record.reservationTime}` : ''}`} /><ChargeableDetail label="Table" value={configuration.tables.find(option => option.value === record.tableNumber)?.label || record.tableNumber || 'Unassigned'} /><ChargeableDetail label="Waiter" value={record.waiter ? `${record.waiter.name}${record.waiter.employmentStatus !== 'active' ? ' · Inactive historical assignment' : ''}` : 'Unassigned'} /><ChargeableDetail label="Source" value={record.importSource === 'activity_program' ? 'Activity Program booking' : record.bookingId ? 'Booking' : 'Manual'} />{record.sourceGuestNotes && <ChargeableDetail label="Source note" value={record.sourceGuestNotes} />}</ChargeableDrawerSection>
<ChargeableDrawerSection title="Record Details"><ChargeableDetail label="Status" value={statusLabel(configuration, record.status)} /><ChargeableDetail label="Created" value={`${record.createdAt ? new Date(record.createdAt).toLocaleString() : '—'} · ${record.createdBy || '—'}`} /><ChargeableDetail label="Updated" value={`${record.updatedAt ? new Date(record.updatedAt).toLocaleString() : '—'} · ${record.updatedBy || '—'}`} /><ChargeableDetail label="Manager notes" value={record.notes || '—'} /></ChargeableDrawerSection></div>
<footer>{!locked && <button className="secondary" onClick={onEdit}>Edit</button>}{!locked && pending && record.status !== pending.value && <button className="secondary" onClick={() => onStatus(pending.value)}>Mark as Pending</button>}{!locked && charged && record.status !== charged.value && <button className="primary" onClick={() => onStatus(charged.value)}>Mark as Charged</button>}{realized && cancelled && <button className="secondary danger" onClick={correct}>Cancel with reason</button>}</footer>
</aside></div>
}

function ChargeableDrawerSection({ title, children }: { title: string; children: ReactNode }) { return <section className="chargeable-drawer-section"><h3>{title}</h3><div>{children}</div></section> }
function ChargeableDetail({ label, value }: { label: string; value: string }) { return <div className="chargeable-drawer-detail"><span>{label}</span><b>{value}</b></div> }

export function ChargeableConfigurationManager({ configuration, onSave }: { configuration: Pick<ChargeableConfiguration, 'items' | 'statuses'> & { wineCatalog: ConfigOption[] }; onSave: (group: 'items' | 'statuses' | 'wine-catalog', option: ConfigOption) => Promise<void> }) {
  const [editing, setEditing] = useState<{ group: 'items' | 'statuses' | 'wine-catalog'; option: ConfigOption } | null>(null)
  return <section className="panel chargeable-config">
<div className="panel-title">
<div>
<p className="eyebrow">CHARGEABLE CONFIGURATION</p>
<h3>Items and statuses</h3>
</div>
</div>
<div className="chargeable-config-grid">
<div>
<div className="config-heading">
<h4>Chargeable items</h4>
<button className="primary compact" onClick={() => setEditing({ group: 'items', option: { id: crypto.randomUUID(), value: '', label: '', active: true, metadata: { category: '', price: 0 } } })}>Add item</button>
</div>{configuration.items.map(option => <div className="chargeable-config-row" key={option.id}>
<div>
<b>{option.label}</b>
<small>{option.metadata?.category || 'Uncategorized'} · {money(Number(option.metadata?.price || 0))}</small>
</div>
<span className={option.active ? 'badge blue' : 'badge'}>{option.active ? 'Active' : 'Inactive'}</span>
<button className="link" onClick={() => setEditing({ group: 'items', option })}>Edit</button>
<button className="link" onClick={() => void onSave('items', { ...option, active: !option.active })}>{option.active ? 'Deactivate' : 'Activate'}</button>
</div>)}</div>
<div>
<div className="config-heading">
<h4>Chargeable statuses</h4>
</div><div className="chargeable-status-header" aria-hidden="true"><span>Status</span><span>Protected</span><span>Edit color</span></div>{configuration.statuses.map(option => <div className="chargeable-config-row chargeable-status-protected" key={option.id}>
<div>
<span className="status-dot" style={{ background: option.color }}>
</span>
<b>{option.label}</b>
<small>{option.metadata?.countsAsRealizedRevenue ? 'Realized revenue' : option.metadata?.countsAsPendingValue ? 'Pending value' : option.metadata?.excludesFromChargeableTotals ? 'Excluded' : 'Not counted'}</small>
</div>
<span className="config-protected-state" title="Status identity, availability and financial semantics are system protected">Protected</span>
<button className="link" onClick={() => setEditing({ group: 'statuses', option })}>Edit color</button>
</div>)}</div>
</div>
<div className="wine-catalog-foundation">
<div className="config-heading"><div><h4>Wine / bottle catalog</h4><small>Optional approved definitions. Existing manually entered sales and stored incentive snapshots remain unchanged.</small></div><button className="primary compact" onClick={() => setEditing({ group: 'wine-catalog', option: { id: crypto.randomUUID(), value: '', label: '', active: true, metadata: {} } })}>Add approved bottle</button></div>
{configuration.wineCatalog.length === 0 ? <p className="inline-empty">No approved bottle catalog has been provided. Wine / Spirits entry remains exact signed-check entry.</p> : configuration.wineCatalog.map(option => { const metadata = option.metadata as Record<string, unknown> | undefined; return <div className="chargeable-config-row" key={option.id}><div><b>{option.label}</b><small>Selling {metadata?.sellingPrice == null ? '—' : money(Number(metadata.sellingPrice))} · Eligible {metadata?.eligiblePrice == null ? '—' : money(Number(metadata.eligiblePrice))} · Rule {String(metadata?.incentiveRuleKey || 'Awaiting approved association')}</small></div><span className={option.active ? 'badge blue' : 'badge'}>{option.active ? 'Active' : 'Archived'}</span><button className="link" onClick={() => setEditing({ group: 'wine-catalog', option })}>Edit</button><button className="link" onClick={() => void onSave('wine-catalog', { ...option, active: !option.active })}>{option.active ? 'Archive' : 'Activate'}</button></div> })}
</div>{editing && <ChargeableConfigForm group={editing.group} option={editing.option} onClose={() => setEditing(null)} onSave={async option => { await onSave(editing.group, option); setEditing(null) }} />}</section>
}

function ChargeableConfigForm({ group, option, onClose, onSave }: { group: 'items' | 'statuses' | 'wine-catalog'; option: ConfigOption; onClose: () => void; onSave: (option: ConfigOption) => Promise<void> }) {
  const [form, setForm] = useState(option); const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!form.label.trim()) return setError('Name is required.'); if (group === 'items' && (!form.metadata?.category?.trim() || !Number.isFinite(Number(form.metadata?.price)) || Number(form.metadata?.price) < 0)) return setError('Category and a valid non-negative price are required.'); const generatedValue = form.value || `${form.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}_${form.id.slice(0, 8)}`; try { await onSave({ ...form, value: generatedValue }) } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save configuration.') } }
  const catalog = form.metadata as Record<string, unknown> | undefined
  return <ChargeableModal title={group === 'items' ? `${option.value ? 'Edit' : 'Add'} Chargeable Item` : group === 'statuses' ? 'Edit Chargeable Status Color' : `${option.value ? 'Edit' : 'Add'} Approved Bottle`} onClose={onClose}>
<form className="staff-form" onSubmit={event => void submit(event)}>
<label>Name<input value={form.label} readOnly={group === 'statuses'} aria-readonly={group === 'statuses'} onChange={event => setForm({ ...form, label: event.target.value })} />
</label>{group === 'items' ? <>
<label>Category<input value={form.metadata?.category || ''} onChange={event => setForm({ ...form, metadata: { ...form.metadata, category: event.target.value } })} />
</label>
<label>Price (USD)<input type="number" min="0" step="0.01" value={form.metadata?.price ?? 0} onChange={event => setForm({ ...form, metadata: { ...form.metadata, price: Number(event.target.value) } })} />
</label>
</> : group === 'wine-catalog' ? <>
<label>Current selling price (USD)<input type="number" min="0" step="0.01" value={String(catalog?.sellingPrice ?? '')} onChange={event => setForm({ ...form, metadata: { ...form.metadata, sellingPrice: event.target.value === '' ? undefined : Number(event.target.value) } } as ConfigOption)} /></label>
<label>Eligible price, if approved (USD)<input type="number" min="0" step="0.01" value={String(catalog?.eligiblePrice ?? '')} onChange={event => setForm({ ...form, metadata: { ...form.metadata, eligiblePrice: event.target.value === '' ? undefined : Number(event.target.value) } } as ConfigOption)} /></label>
<label>Approved incentive rule key<input value={String(catalog?.incentiveRuleKey || '')} onChange={event => setForm({ ...form, metadata: { ...form.metadata, incentiveRuleKey: event.target.value } } as ConfigOption)} placeholder="Leave blank until an approved rule is supplied" /></label>
<p className="config-protected-note">Adding a catalog item does not invent or replace incentive tiers. Any rule key must resolve to an existing approved, versioned Andalucía rule.</p>
</> : <>
<label>Color<input type="color" value={form.color || '#1b6288'} onChange={event => setForm({ ...form, color: event.target.value })} />
</label>
<p className="config-protected-note">Status name, availability and financial reporting behavior are protected by the system. Only the display color may be changed.</p>
</>}{group !== 'statuses' && <label className="check-label">
<input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} /> Active</label>}{error && <p className="save-error">{error}</p>}<div className="form-actions">
<button type="button" className="secondary" onClick={onClose}>Cancel</button>
<button className="primary">Save configuration</button>
</div>
</form>
</ChargeableModal>
}

function ChargeableModal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) { return <div className="modal-backdrop">
<section className={`modal${wide ? ' booking-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
<button type="button" className="close" aria-label="Close dialog" title="Close" onClick={onClose}>×</button>
<h2>{title}</h2>{children}</section>
</div> }

