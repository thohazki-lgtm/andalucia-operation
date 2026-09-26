import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { bookingApi, guestOccasionApi } from './api'
import type { BookingRecord, ConfigOption, GuestExperienceAttentionRecord, GuestOccasionRecord, Staff } from './domain'
import './guest-occasions.css'
import { addCalendarDays, serviceDate } from './service-date'

export interface GuestOccasionConfiguration { types: ConfigOption[]; statuses: ConfigOption[]; tables: ConfigOption[] }
const optionLabel = (options: ConfigOption[], value: string) => options.find(option => option.value === value)?.label || value || '—'
const formatDate = (value: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`))
const ordinal = (value: number) => value % 100 >= 11 && value % 100 <= 13 ? 'th' : value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th'
const sourceLabel = (record: GuestOccasionRecord) => ['manual', 'manager_created'].includes(record.source) ? 'Manual' : record.source === 'booking_intelligence' ? 'Booking Intelligence' : record.importSource === 'activity_program' ? 'Booking Import' : 'Booking'
const celebrationTypes = new Set(['honeymoon', 'see_you_soon', 'birthday', 'anniversary'])
type ExperienceGroup = 'all' | 'celebrations' | 'vip' | 'attention'
const evidencePreview = (value: string, maximum = 120) => { const compact = value.replace(/\s+/g, ' ').trim(); return compact.length > maximum ? `${compact.slice(0, maximum - 1).trimEnd()}…` : compact || 'No source evidence recorded.' }

export function GuestOccasionsPage({ staff, configuration, onToast }: { staff: Staff[]; configuration: GuestOccasionConfiguration; onToast: (message: string) => void }) {
  const [date, setDate] = useState(serviceDate())
  const [records, setRecords] = useState<GuestOccasionRecord[]>([])
  const [attention, setAttention] = useState<GuestExperienceAttentionRecord[]>([])
  const [bookings, setBookings] = useState<BookingRecord[]>([])
  const [groups, setGroups] = useState({ celebrations: 0, vipSpecial: 0, attentionNeeded: 0, completed: 0 })
  const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  const [query, setQuery] = useState(''); const [group, setGroup] = useState<ExperienceGroup>('all'); const [status, setStatus] = useState('all'); const [waiter, setWaiter] = useState('all')
  const [editing, setEditing] = useState<GuestOccasionRecord | 'new' | null>(null); const [viewing, setViewing] = useState<GuestOccasionRecord | null>(null); const [viewingAttention, setViewingAttention] = useState<GuestExperienceAttentionRecord | null>(null)
  const load = async () => { setLoading(true); setError(''); try { const [experience, nextBookings] = await Promise.all([guestOccasionApi.experience(date), bookingApi.list(date)]); setRecords(experience.occasions); setAttention(experience.attention); setGroups(experience.groups); setBookings(nextBookings) } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load guest occasions.') } finally { setLoading(false) } }
  useEffect(() => { void load() }, [date])
  const attentionStatus = configuration.statuses.find(option => option.metadata?.occasionWorkflow === 'attention')
  const isVip = (record: GuestOccasionRecord) => Boolean(configuration.types.find(option => option.value === record.occasionType)?.metadata?.countsAsVipSpecial)
  const visible = useMemo(() => records.filter(record => record.active && group !== 'attention' && (group === 'all' || (group === 'celebrations' && celebrationTypes.has(record.occasionType)) || (group === 'vip' && isVip(record))) && (status === 'all' || record.status === status) && (waiter === 'all' || (waiter === 'unassigned' ? !record.waiterId : record.waiterId === waiter)) && `${record.guestName} ${record.roomNumber} ${record.bookingNumber || ''} ${record.sourceText} ${record.notes}`.toLowerCase().includes(query.trim().toLowerCase())), [records, group, status, waiter, query, configuration.types])
  const visibleAttention = useMemo(() => attention.filter(record => (group === 'all' || group === 'attention') && (status === 'all' || status === attentionStatus?.value) && (waiter === 'all' || (waiter === 'unassigned' ? !record.waiterId : record.waiterId === waiter)) && `${record.guestName} ${record.roomNumber} ${record.bookingNumber} ${record.rawEvidence} ${record.label}`.toLowerCase().includes(query.trim().toLowerCase())), [attention, group, status, waiter, query, attentionStatus?.value])
  const allCount = useMemo(() => new Set([...records.filter(record => record.active).map(record => record.bookingId ? `booking:${record.bookingId}` : `occasion:${record.id}`), ...attention.map(record => `booking:${record.bookingId}`)]).size, [records, attention])
  const save = async (record: GuestOccasionRecord) => { const saved = records.some(item => item.id === record.id) ? await guestOccasionApi.update(record) : await guestOccasionApi.create(record); await load(); setViewing(current => current?.id === saved.id ? saved : current) }
  const quickStatus = async (record: GuestOccasionRecord, nextStatus: string) => { try { await save({ ...record, status: nextStatus }) } catch (saveError) { onToast(saveError instanceof Error ? saveError.message : 'Unable to update occasion status.') } }
  return <>
    <section className="occasion-toolbar">
<div>
<button className="secondary" onClick={() => setDate(value => addCalendarDays(value, -1))}>← Previous</button>
<label>Occasion date<input aria-label="Guest occasion date" type="date" value={date} onChange={event => setDate(event.target.value)} />
</label>
<button className="secondary" onClick={() => setDate(value => addCalendarDays(value, 1))}>Next →</button>
<button className="secondary" onClick={() => setDate(serviceDate())}>Today</button>
</div>
<div>
<span>{formatDate(date)}</span>
<button className="primary" onClick={() => setEditing('new')}>＋ Add Manual Occasion</button>
</div>
</section>
    <section className="occasion-summary">
<article className="panel">
<span>Celebrations</span>
<strong>{groups.celebrations}</strong>
</article>
<article className="panel attention">
<span>Attention Needed</span>
<strong>{groups.attentionNeeded}</strong>
</article>
<article className="panel vip"><span>VIP / Special Guests</span><strong>{groups.vipSpecial}</strong></article>
<article className="panel complete"><span>Completed</span><strong>{groups.completed}</strong></article>
</section>
    <section className="panel occasion-panel">
<nav className="occasion-tabs" aria-label="Guest Experience groups"><button className={group === 'all' ? 'active' : ''} onClick={() => setGroup('all')}>All <b>{allCount}</b></button><button className={group === 'celebrations' ? 'active' : ''} onClick={() => setGroup('celebrations')}>Celebrations <b>{groups.celebrations}</b></button><button className={group === 'vip' ? 'active' : ''} onClick={() => setGroup('vip')}>VIP / Special Guests <b>{groups.vipSpecial}</b></button><button className={group === 'attention' ? 'active' : ''} onClick={() => setGroup('attention')}>Attention Needed <b>{groups.attentionNeeded}</b></button></nav>
<div className="occasion-filters">
<input aria-label="Search guest occasions" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search guest, room, booking or source note" />
<select aria-label="Filter occasion status" value={status} onChange={event => setStatus(event.target.value)}>
<option value="all">All statuses</option>{configuration.statuses.filter(option => option.active).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select>
<select aria-label="Filter occasion waiter" value={waiter} onChange={event => setWaiter(event.target.value)}><option value="all">All waiters</option><option value="unassigned">Unassigned waiter</option>{staff.map(person => <option key={person.id} value={person.id}>{person.name}{person.employmentStatus !== 'active' ? ' (Inactive)' : ''}</option>)}</select>
</div>{loading && <div className="inline-state">Loading Guest Experience…</div>}{error && <div className="inline-state error-state">
<p>{error}</p>
<button className="secondary" onClick={() => void load()}>Try again</button>
</div>}{!loading && !error && <>{visibleAttention.length > 0 && <AttentionRecords records={visibleAttention} staff={staff} configuration={configuration} onView={setViewingAttention} />}{visible.length > 0 && <div className="occasion-table-wrap" tabIndex={0} aria-label="Guest Experience records table">
<table className="occasion-table">
<thead>
<tr>
<th>Time</th>
<th>Guest / Room</th>
<th>Occasion</th>
<th>Details</th>
<th>Table</th>
<th>Waiter</th>
<th>Status</th>
<th>Source</th>
<th>
</th>
</tr>
</thead>
<tbody>{visible.map(record => { const occasion = configuration.types.find(option => option.value === record.occasionType); return <tr key={record.id}>
<td className="occasion-time"><b>{record.reservationTime}</b></td>
<td>
<b>{record.guestName}</b>
<small>Room {record.roomNumber || '—'}{record.bookingNumber ? ` · #${record.bookingNumber}` : ''}</small>
</td>
<td>
<span className="occasion-chip" style={{ background: occasion?.color }}>{occasion?.label || record.occasionType}</span>
</td>
<td><b>{record.visitNumber ? `${record.visitNumber}${ordinal(record.visitNumber)} Visit` : occasion?.metadata?.countsAsVipSpecial ? 'VIP / Special' : record.notes || 'Recognition'}</b><small>{record.covers ? `${record.covers} cover${record.covers === 1 ? '' : 's'}` : ''}</small></td>
<td>{optionLabel(configuration.tables, record.tableNumber) || 'Unassigned'}</td>
<td>{record.waiter ? `${record.waiter.name}${record.waiter.employmentStatus !== 'active' ? ' (Inactive)' : ''}` : 'Unassigned'}</td>
<td>
<select aria-label={`Status for ${record.guestName}`} value={record.status} onChange={event => void quickStatus(record, event.target.value)}>{configuration.statuses.filter(option => option.active || option.value === record.status).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select>
</td>
<td>
<span className={record.source === 'booking_intelligence' || record.source.startsWith('automatic') ? 'badge blue' : 'badge'}>{sourceLabel(record)}</span>
</td>
<td className="row-actions">
<button className="link" onClick={() => setViewing(record)}>View</button>
<button className="link" onClick={() => setEditing(record)}>Edit</button>
</td>
</tr>})}</tbody>
</table><div className="mobile-occasion-list">{visible.map(record => <MobileOccasionCard key={record.id} record={record} configuration={configuration} onStatus={nextStatus => void quickStatus(record, nextStatus)} onView={() => setViewing(record)} onEdit={() => setEditing(record)} />)}</div></div>}{visible.length === 0 && visibleAttention.length === 0 && <div className="inline-empty">No Guest Experience records match this date and filters.</div>}</>}</section>
    {editing && <GuestOccasionForm record={editing === 'new' ? undefined : editing} date={date} bookings={bookings} staff={staff} configuration={configuration} onClose={() => setEditing(null)} onSave={async record => { await save(record); setEditing(null) }} />}
    {viewing && <GuestOccasionDetails record={viewing} configuration={configuration} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null) }} onStatus={nextStatus => void quickStatus(viewing, nextStatus)} />}
    {viewingAttention && <AttentionDetails record={viewingAttention} staff={staff} configuration={configuration} onClose={() => setViewingAttention(null)} />}
  </>
}

function AttentionRecords({ records, staff, configuration, onView }: { records: GuestExperienceAttentionRecord[]; staff: Staff[]; configuration: GuestOccasionConfiguration; onView: (record: GuestExperienceAttentionRecord) => void }) {
  const waiterName = (id: string | null) => staff.find(person => person.id === id)?.name || 'Unassigned'
  return <section className="attention-records" aria-label="Attention Needed records"><header><div><p className="eyebrow">ATTENTION NEEDED</p><h3>TLC & allergy follow-up</h3></div><span className="badge">{records.length}</span></header><div className="attention-table-wrap"><table className="attention-table"><thead><tr><th>Time</th><th>Guest / Room</th><th>Attention</th><th>Evidence</th><th>Table</th><th>Waiter</th><th>Status</th><th /></tr></thead><tbody>{records.map(record => <tr key={record.id}><td className="occasion-time"><b>{record.reservationTime}</b></td><td><b>{record.guestName}</b><small>Room {record.roomNumber || '—'}{record.bookingNumber ? ` · #${record.bookingNumber}` : ''}</small></td><td><span className={`badge ${record.normalizedKey === 'ALLERGY' ? 'danger' : 'blue'}`}>{record.normalizedKey === 'ALLERGY' ? 'Allergy' : 'TLC'}</span></td><td className="attention-evidence">{evidencePreview(record.rawEvidence)}</td><td>{optionLabel(configuration.tables, record.tableNumber) || 'Unassigned'}</td><td>{waiterName(record.waiterId)}</td><td><span className="badge attention-state">Attention</span></td><td><button className="link" onClick={() => onView(record)}>View</button></td></tr>)}</tbody></table></div><div className="mobile-attention-list">{records.map(record => <article className="mobile-operation-card mobile-attention-card" key={record.id}><header><div><span className="occasion-card-time">{record.reservationTime}</span><span className={`badge ${record.normalizedKey === 'ALLERGY' ? 'danger' : 'blue'}`}>{record.normalizedKey === 'ALLERGY' ? 'Allergy' : 'TLC'}</span><h4>{record.guestName}</h4><small>Room {record.roomNumber || '—'}{record.bookingNumber ? ` · #${record.bookingNumber}` : ''}</small></div><span className="attention-flag">Attention</span></header><p>{evidencePreview(record.rawEvidence, 90)}</p><div className="mobile-card-facts"><span><small>Table</small><b>{optionLabel(configuration.tables, record.tableNumber) || 'Unassigned'}</b></span><span><small>Waiter</small><b>{waiterName(record.waiterId)}</b></span></div><div className="mobile-card-actions"><button className="secondary" onClick={() => onView(record)}>View Details</button></div></article>)}</div></section>
}

function MobileOccasionCard({ record, configuration, onStatus, onView, onEdit }: { record: GuestOccasionRecord; configuration: GuestOccasionConfiguration; onStatus: (status: string) => void; onView: () => void; onEdit: () => void }) {
  const occasion = configuration.types.find(option => option.value === record.occasionType)
  const status = configuration.statuses.find(option => option.value === record.status)
  return <article className="mobile-operation-card mobile-occasion-card">
    <header><div><span className="occasion-card-time">{record.reservationTime}</span><span className="occasion-chip" style={{ background: occasion?.color }}>{occasion?.label || record.occasionType}{record.visitNumber ? ` · ${record.visitNumber}${ordinal(record.visitNumber)} Visit` : ''}</span><h4>{record.guestName}</h4><small>Room {record.roomNumber || '—'}{record.bookingNumber ? ` · #${record.bookingNumber}` : ' · Manual occasion'}</small></div>{status?.metadata?.occasionWorkflow === 'attention' && <span className="attention-flag">Attention required</span>}</header>
    <div className="mobile-card-facts"><span><small>Table</small><b>{optionLabel(configuration.tables, record.tableNumber) || 'Unassigned'}</b></span><span><small>Waiter</small><b>{record.waiter ? `${record.waiter.name}${record.waiter.employmentStatus !== 'active' ? ' · Inactive' : ''}` : 'Unassigned'}</b></span><span><small>Source</small><b>{sourceLabel(record)}</b></span><span><small>Covers</small><b>{record.covers || '—'}</b></span></div>
    <label className="mobile-card-status">Status<select aria-label={`Mobile occasion status for ${record.guestName}`} value={record.status} style={{ borderColor: status?.color }} onChange={event => onStatus(event.target.value)}>{configuration.statuses.filter(option => option.active || option.value === record.status).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select></label>
    <div className="mobile-card-actions"><button className="secondary" onClick={onView}>View Details</button><button className="secondary" onClick={onEdit}>Edit</button></div>
  </article>
}

function GuestOccasionForm({ record, date, bookings, staff, configuration, onClose, onSave }: { record?: GuestOccasionRecord; date: string; bookings: BookingRecord[]; staff: Staff[]; configuration: GuestOccasionConfiguration; onClose: () => void; onSave: (record: GuestOccasionRecord) => Promise<void> }) {
  const firstType = configuration.types.find(option => option.active)
  const defaultStatus = configuration.statuses.find(option => option.active && option.value === firstType?.metadata?.defaultStatus) || configuration.statuses.find(option => option.active)
  const [form, setForm] = useState<GuestOccasionRecord>(record || { id: crypto.randomUUID(), occasionType: firstType?.value || '', bookingId: null, guestName: '', roomNumber: '', reservationDate: date, reservationTime: '19:00', tableNumber: '', waiterId: null, waiter: null, status: defaultStatus?.value || '', source: 'manual', sourceText: 'Manager-created occasion', notes: '', active: true })
  const [saving, setSaving] = useState(false); const [error, setError] = useState('')
  const availableStaff = staff.filter(person => person.employmentStatus === 'active' || person.id === form.waiterId)
  const update = <K extends keyof GuestOccasionRecord>(field: K, value: GuestOccasionRecord[K]) => setForm(current => ({ ...current, [field]: value }))
  const selectBooking = (bookingId: string) => { const booking = bookings.find(item => item.id === bookingId); if (!booking) return setForm(current => ({ ...current, bookingId: null })); setForm(current => ({ ...current, bookingId: booking.id, guestName: booking.guestName, roomNumber: booking.roomNumber, reservationDate: booking.reservationDate, reservationTime: booking.reservationTime, tableNumber: booking.tableNumber, waiterId: booking.waiterId })) }
  const selectType = (value: string) => { const selected = configuration.types.find(option => option.value === value); const nextStatus = configuration.statuses.find(option => option.active && option.value === selected?.metadata?.defaultStatus)?.value; setForm(current => ({ ...current, occasionType: value, status: !record && nextStatus ? nextStatus : current.status })) }
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!form.occasionType || !form.guestName.trim() || !form.reservationDate || !form.reservationTime || !form.status) return setError('Occasion type, guest, date, time and status are required.'); setSaving(true); setError(''); try { await onSave({ ...form, guestName: form.guestName.trim(), source: record?.source || 'manual', sourceText: record?.sourceText || 'Manager-created occasion' }) } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save guest occasion.') } finally { setSaving(false) } }
  return <OccasionModal title={record ? 'Edit Guest Occasion' : 'Add Manual Occasion'} onClose={onClose} wide>
<form className="staff-form occasion-form" onSubmit={event => void submit(event)}>
<div className="occasion-form-grid">
<label>Related booking<select value={form.bookingId || ''} onChange={event => selectBooking(event.target.value)}>
<option value="">Manual entry / walk-in</option>{bookings.map(booking => <option key={booking.id} value={booking.id}>{booking.reservationTime} · {booking.guestName} · Room {booking.roomNumber || '—'} · #{booking.bookingNumber || 'manual'}</option>)}</select>
</label>
<label>Occasion type<select value={form.occasionType} onChange={event => selectType(event.target.value)}>{configuration.types.filter(option => option.active || option.value === form.occasionType).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select>
</label>
<label>Guest<input value={form.guestName} readOnly={Boolean(form.bookingId)} onChange={event => update('guestName', event.target.value)} />
</label>
<label>Room number<input value={form.roomNumber} readOnly={Boolean(form.bookingId)} onChange={event => update('roomNumber', event.target.value)} />
</label>
<label>Reservation date<input type="date" value={form.reservationDate} readOnly={Boolean(form.bookingId)} onChange={event => update('reservationDate', event.target.value)} />
</label>
<label>Reservation time<input type="time" value={form.reservationTime} readOnly={Boolean(form.bookingId)} onChange={event => update('reservationTime', event.target.value)} />
</label>
<label>Table number<select value={form.tableNumber} disabled={Boolean(form.bookingId)} onChange={event => update('tableNumber', event.target.value)}>
<option value="">Unassigned</option>{configuration.tables.filter(option => option.active || option.value === form.tableNumber).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select>
</label>
<label>Waiter<select value={form.waiterId || ''} disabled={Boolean(form.bookingId)} onChange={event => update('waiterId', event.target.value || null)}>
<option value="">Unassigned</option>{availableStaff.map(person => <option key={person.id} value={person.id} disabled={person.employmentStatus !== 'active'}>{person.name} · {person.number}{person.employmentStatus !== 'active' ? ' (Inactive – historical)' : ''}</option>)}</select>
</label>
<label>Status<select value={form.status} onChange={event => update('status', event.target.value)}>{configuration.statuses.filter(option => option.active || option.value === form.status).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select>
</label>
</div>{form.bookingId && <p className="linked-booking-note">Guest, room, date, time, table and waiter stay synchronized with the linked booking.</p>}{record?.source.startsWith('automatic') && <label>Detection evidence<textarea readOnly rows={3} value={form.sourceText} />
</label>}<label>Manager notes<textarea rows={3} value={form.notes} onChange={event => update('notes', event.target.value)} />
</label>{error && <p className="save-error">{error}</p>}<div className="form-actions">
<button type="button" className="secondary" onClick={onClose}>Cancel</button>
<button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save occasion'}</button>
</div>
</form>
</OccasionModal>
}

function GuestOccasionDetails({ record, configuration, onClose, onEdit, onStatus }: { record: GuestOccasionRecord; configuration: GuestOccasionConfiguration; onClose: () => void; onEdit: () => void; onStatus: (status: string) => void }) {
  const type = configuration.types.find(option => option.value === record.occasionType)
  const groupLabel = type?.metadata?.countsAsVipSpecial ? 'VIP / SPECIAL GUEST' : celebrationTypes.has(record.occasionType) ? 'CELEBRATION' : 'GUEST EXPERIENCE'
  const prepared = configuration.statuses.find(option => option.active && option.metadata?.occasionWorkflow === 'prepared')
  const completed = configuration.statuses.find(option => option.active && option.metadata?.occasionWorkflow === 'completed')
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [onClose])
  return <div className="occasion-drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
<aside className="occasion-drawer" role="dialog" aria-modal="true" aria-label="Guest Occasion Details">
<header><div><p className="eyebrow">{groupLabel}</p><h2>{record.guestName}</h2><span className="occasion-chip" style={{ background: type?.color }}>{type?.label || record.occasionType}{record.visitNumber ? ` · ${record.visitNumber}${ordinal(record.visitNumber)} Visit` : ''}</span></div><button className="close" aria-label="Close guest details" title="Close" onClick={onClose}>×</button></header>
<div className="occasion-drawer-body">
<DrawerSection title="Guest"><Detail label="Room" value={record.roomNumber || '—'} /><Detail label="Booking" value={record.bookingNumber || 'Manual / walk-in'} /><Detail label="Covers" value={record.covers ? String(record.covers) : '—'} /></DrawerSection>
<DrawerSection title="Recognition"><Detail label="Occasion" value={type?.label || record.occasionType} /><Detail label="VIP / Special" value={type?.metadata?.countsAsVipSpecial ? 'Yes' : 'No'} />{type?.metadata?.occasionCategory === 'siyamFamily' && <><Detail label="Explicit visit" value={record.visitNumber ? `${record.visitNumber}${ordinal(record.visitNumber)} visit` : 'Not stated'} /><Detail label="Known visits" value={record.knownVisits ? String(record.knownVisits) : 'Not safely known'} /><Detail label="Previous Andalucía visits" value={String(record.previousAndaluciaVisits || 0)} /></>}</DrawerSection>
<DrawerSection title="Booking Information"><Detail label="Date / time" value={`${formatDate(record.reservationDate)} · ${record.reservationTime}`} /><Detail label="Table" value={optionLabel(configuration.tables, record.tableNumber)} /><Detail label="Waiter" value={record.waiter ? `${record.waiter.name}${record.waiter.employmentStatus !== 'active' ? ' · Inactive historical assignment' : ''}` : 'Unassigned'} /><Detail label="Source" value={sourceLabel(record)} /><Detail label="Evidence summary" value={evidencePreview(record.sourceText)} />{record.sourceText && <EvidenceDisclosure evidence={record.sourceText} />}</DrawerSection>
<DrawerSection title="Occasion Details"><Detail label="Status" value={optionLabel(configuration.statuses, record.status)} /><Detail label="Preparation notes" value={record.notes || '—'} /><Detail label="Created" value={`${record.createdAt ? new Date(record.createdAt).toLocaleString() : '—'} · ${record.createdBy || '—'}`} /><Detail label="Updated" value={`${record.updatedAt ? new Date(record.updatedAt).toLocaleString() : '—'} · ${record.updatedBy || '—'}`} /></DrawerSection>
{type?.metadata?.occasionCategory === 'siyamFamily' && <DrawerSection title="Guest Profile"><p className="drawer-help">Recognition history uses conservative exact normalized guest-name matching only. Room number is never used as identity.</p><Detail label="Preferences / notes" value={record.notes || 'No manager notes recorded'} /></DrawerSection>}
</div><footer><button className="secondary" onClick={onEdit}>Edit</button>{prepared && record.status !== prepared.value && <button className="secondary" onClick={() => onStatus(prepared.value)}>Mark as Prepared</button>}{completed && record.status !== completed.value && <button className="primary" onClick={() => onStatus(completed.value)}>Mark as Completed</button>}</footer>
</aside></div>
}

function AttentionDetails({ record, staff, configuration, onClose }: { record: GuestExperienceAttentionRecord; staff: Staff[]; configuration: GuestOccasionConfiguration; onClose: () => void }) {
  const waiter = staff.find(person => person.id === record.waiterId)
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [onClose])
  return <div className="occasion-drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><aside className="occasion-drawer" role="dialog" aria-modal="true" aria-label="Guest Attention Details"><header><div><p className="eyebrow">ATTENTION NEEDED</p><h2>{record.guestName}</h2><span className={`badge ${record.normalizedKey === 'ALLERGY' ? 'danger' : 'blue'}`}>{record.normalizedKey === 'ALLERGY' ? 'Allergy' : 'TLC / Guest Attention'}</span></div><button className="close" aria-label="Close guest attention details" title="Close" onClick={onClose}>×</button></header><div className="occasion-drawer-body"><DrawerSection title="Guest"><Detail label="Room" value={record.roomNumber || '—'} /><Detail label="Booking" value={record.bookingNumber || '—'} /><Detail label="Covers" value={record.covers ? String(record.covers) : '—'} /></DrawerSection><DrawerSection title="Attention"><Detail label="Classification" value={record.normalizedKey === 'ALLERGY' ? 'Allergy' : 'TLC / Guest Attention'} /><Detail label="Attention message" value={evidencePreview(record.rawEvidence)} /><Detail label="Status" value="Attention" /><EvidenceDisclosure evidence={record.rawEvidence} /></DrawerSection><DrawerSection title="Service"><Detail label="Date / time" value={`${formatDate(record.reservationDate)} · ${record.reservationTime}`} /><Detail label="Table" value={optionLabel(configuration.tables, record.tableNumber)} /><Detail label="Waiter" value={waiter ? `${waiter.name} · ${waiter.number}` : 'Unassigned'} /><Detail label="Source" value="Booking Intelligence" /></DrawerSection><DrawerSection title="Evidence Provenance"><Detail label="Evidence location" value={record.evidenceLocation} /><Detail label="Rule" value={`${record.ruleKey} · ${record.ruleVersion}`} /></DrawerSection></div><footer><button className="secondary" onClick={onClose}>Close</button></footer></aside></div>
}

function EvidenceDisclosure({ evidence }: { evidence: string }) { return <details className="evidence-disclosure"><summary>View full source evidence</summary><p>{evidence}</p></details> }

function DrawerSection({ title, children }: { title: string; children: ReactNode }) { return <section className="drawer-section"><h3>{title}</h3><div>{children}</div></section> }
function Detail({ label, value }: { label: string; value: string }) { return <div className="drawer-detail"><span>{label}</span><b>{value}</b></div> }

export function GuestOccasionConfigurationManager({ configuration, onSave }: { configuration: Pick<GuestOccasionConfiguration, 'types' | 'statuses'>; onSave: (group: 'types' | 'statuses', option: ConfigOption) => Promise<void> }) {
  const [editing, setEditing] = useState<{ group: 'types' | 'statuses'; option: ConfigOption } | null>(null)
  const protectedOrder = ['honeymoon', 'see_you_soon', 'birthday', 'anniversary', 'siyam_family', 'famtrip', 'presstrip']
  const types = [...configuration.types].sort((left, right) => {
    const leftIndex = protectedOrder.indexOf(left.value); const rightIndex = protectedOrder.indexOf(right.value)
    if (leftIndex >= 0 || rightIndex >= 0) return (leftIndex < 0 ? protectedOrder.length : leftIndex) - (rightIndex < 0 ? protectedOrder.length : rightIndex)
    return (left.sortOrder ?? 100) - (right.sortOrder ?? 100) || left.label.localeCompare(right.label)
  })
  const workflow = configuration.statuses.filter(option => option.active && ['attention', 'prepared', 'completed'].includes(String(option.metadata?.occasionWorkflow)))
  return <section className="panel occasion-config">
<div className="panel-title">
<div>
<p className="eyebrow">GUEST EXPERIENCE CONFIGURATION</p>
<h3>Customize presentation and operational workflow</h3>
<p className="occasion-config-subtitle">Detection rules are protected.</p>
</div>
</div>
<div className="occasion-config-grid">
<div className="occasion-config-card">
<div className="occasion-config-heading">
<div><h4>Guest Types</h4><p>Colors apply consistently across Guest Experience.</p></div>
<button className="primary compact" onClick={() => setEditing({ group: 'types', option: { id: crypto.randomUUID(), value: '', label: '', color: '#1b6288', active: true, metadata: { manualOnly: true, defaultStatus: configuration.statuses.find(status => status.active)?.value } } })}>Add manual type</button>
</div>{types.map(option => { const protectedType = Boolean(option.metadata?.systemControlled); return <div className={`occasion-config-row ${protectedType ? 'protected' : 'manual'}`} key={option.id}>
<div>
<b>
<span className="status-dot" style={{ background: option.color }}>
</span>{protectedType && <span className="config-lock" aria-label="Protected type" title="Protected type">🔒</span>}{option.label}</b>
{!protectedType && <small>Manual guest type</small>}
</div>
{protectedType ? <span className="config-protected-state">Protected</span> : <span className={option.active ? 'badge blue' : 'badge'}>{option.active ? 'Active' : 'Archived'}</span>}
<button className="link" onClick={() => setEditing({ group: 'types', option })}>{protectedType ? 'Edit color' : 'Edit'}</button>
{!protectedType && <button className="link" onClick={() => void onSave('types', { ...option, active: !option.active })}>{option.active ? 'Archive' : 'Restore'}</button>}
</div>})}</div>
<div className="occasion-config-card">
<div className="occasion-config-heading">
<div><h4>Workflow</h4><p>Attention → Prepared → Completed</p></div>
</div>{workflow.map(option => <div className="occasion-config-row workflow" key={option.id}>
<div>
<b>
<span className="status-dot" style={{ background: option.color }}>
</span>{option.label}</b>
<small>{option.metadata?.occasionWorkflow === 'attention' ? 'Requires action' : option.metadata?.occasionWorkflow === 'prepared' ? 'Handled and ready' : option.metadata?.occasionWorkflow === 'completed' ? 'Delivered / closed' : 'Historical status'}</small>
</div>
<span className="config-protected-state">Protected</span>
<button className="link" onClick={() => setEditing({ group: 'statuses', option })}>Edit color</button>
</div>)}</div>
</div>{editing && <GuestOccasionConfigForm group={editing.group} option={editing.option} onClose={() => setEditing(null)} onSave={async option => { await onSave(editing.group, option); setEditing(null) }} />}</section>
}

function GuestOccasionConfigForm({ group, option, onClose, onSave }: { group: 'types' | 'statuses'; option: ConfigOption; onClose: () => void; onSave: (option: ConfigOption) => Promise<void> }) {
  const [form, setForm] = useState(option); const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!form.label.trim()) return setError('Name is required.'); try { await onSave({ ...form, label: form.label.trim() }) } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save occasion configuration.') } }
  const protectedEditor = group === 'statuses' || Boolean(option.metadata?.systemControlled)
  return <OccasionModal title={group === 'types' ? option.value ? `Edit ${option.label}` : 'Add Manual Guest Type' : `Edit ${option.label}`} onClose={onClose}>
<form className="staff-form" onSubmit={event => void submit(event)}>
{protectedEditor ? <label>{group === 'types' ? 'Guest type' : 'Workflow status'}<input value={form.label} readOnly aria-readonly="true" /></label> : <label>Name<input value={form.label} onChange={event => setForm({ ...form, label: event.target.value })} /></label>}
<label>Display color<input type="color" value={form.color || '#1b6288'} onChange={event => setForm({ ...form, color: event.target.value })} />
</label>{protectedEditor ? <p className="drawer-help">This system definition is protected. Only its display color can be changed.</p> : <p className="drawer-help">Manual guest types are available only for manager-created records and cannot alter source interpretation.</p>}
{group === 'types' && !protectedEditor && <label className="check-label">
<input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} /> Active</label>}{error && <p className="save-error">{error}</p>}<div className="form-actions">
<button type="button" className="secondary" onClick={onClose}>Cancel</button>
<button className="primary">Save configuration</button>
</div>
</form>
</OccasionModal>
}

function OccasionModal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) { return <div className="modal-backdrop">
<section className={`modal${wide ? ' booking-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
<button type="button" className="close" aria-label="Close dialog" title="Close" onClick={onClose}>×</button>
<h2>{title}</h2>{children}</section>
</div> }

