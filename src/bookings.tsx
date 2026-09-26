import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { bookingApi, guestOccasionApi } from './api'
import './import-preview.css'
import './import-confirm.css'
import './booking-service.css'
import './booking-intelligence.css'
import type { BookingGuestMemberPreview, BookingImportPreview, BookingImportPreviewRecord, BookingImportResult, BookingImportReviewChanges, BookingImportReviewDecision, BookingIntelligenceReanalysisPreview, BookingIntelligenceReanalysisRecord, BookingRecord, ConfigOption, GuestOccasionRecord, Staff, WalkInBookingInput, WalkInFieldMode } from './domain'
import { addCalendarDays, serviceDate } from './service-date'
import { consumeWorkflow } from './workflow-intent'
import { bookingTimeWindow } from './booking-time'
import { detectBookingAllergyEvidence } from './booking-allergy'

type BookingConfiguration = { statuses: ConfigOption[]; sources: ConfigOption[]; tables: ConfigOption[]; tableRanges?: ConfigOption[]; walkInFields?: ConfigOption[]; occasionTypes?: ConfigOption[] }
type BookingConfigApiGroup = 'statuses' | 'sources' | 'tables' | 'tableRanges' | 'walkInFields'
type ServiceTab = 'all' | 'arrived' | 'remaining' | 'noShow' | 'excluded'
type GuestAlert = { label: string; note: string }

const operationalPax = (booking: BookingImportPreviewRecord) => booking.intelligence?.operationalContributionPax ?? booking.covers ?? 0

const optionLabel = (options: ConfigOption[], value: string) => options.find(option => option.value === value)?.label || value || '—'
const bookingStatusVisualOrder = new Map(['confirmed', 'waiting', 'arrived', 'no_show', 'cancelled', 'completed'].map((value, index) => [value, index]))
const orderedBookingStatuses = (statuses: ConfigOption[]) => statuses.map((option, index) => ({ option, index })).sort((left, right) => {
  const leftRank = bookingStatusVisualOrder.get(left.option.value)
  const rightRank = bookingStatusVisualOrder.get(right.option.value)
  if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank
  if (leftRank !== undefined) return -1
  if (rightRank !== undefined) return 1
  return left.index - right.index
}).map(({ option }) => option)
const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`)) : '—'
const serviceStageFor = (statuses: ConfigOption[], value: string) => { const metadata = statuses.find(option => option.value === value)?.metadata; return metadata?.serviceStage || (metadata?.bookingMetric === 'arrived' ? 'arrived' : metadata?.bookingMetric === 'noShow' ? 'noShow' : 'remaining') }
const timeWindow = bookingTimeWindow
const guestAlerts = (booking: BookingRecord): GuestAlert[] => {
  const note = [booking.sourceGuestNotes, booking.guestNotes].filter(Boolean).join(' | ').trim()
  return detectBookingAllergyEvidence(note).map(alert => ({ label: alert.label, note }))
}

function BookingModal({ title, children, onClose, wide = false, side = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; side?: boolean }) {
  return <div className={`modal-backdrop${side ? ' booking-drawer-backdrop' : ''}`}>
<section className={side ? 'modal booking-detail-drawer' : wide ? 'modal booking-modal-wide' : 'modal'} role="dialog" aria-modal="true" aria-label={title}>
<button type="button" className="close" aria-label="Close dialog" title="Close" onClick={onClose}>×</button>
<h2>{title}</h2>{children}</section>
</div>
}

function ConfigArchiveButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  const action = active ? `Remove ${label}` : `Restore ${label}`
  return <button type="button" className={`config-icon-action${active ? ' remove' : ' restore'}`} aria-label={action} title={action} onClick={onClick}>
    {active
      ? <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" /></svg>
      : <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 8v-4m0 0h4M5 4l3.2 3.2A7 7 0 1 1 6 15" /></svg>}
  </button>
}

export function BookingsPage({ staff, configuration, onToast, initialBooking }: { staff: Staff[]; configuration: BookingConfiguration; onToast: (message: string) => void; initialBooking?: { id: string; date: string } | null }) {
  const [date, setDate] = useState(initialBooking?.date || serviceDate())
  const [bookings, setBookings] = useState<BookingRecord[]>([])
  const [occasions, setOccasions] = useState<GuestOccasionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [time, setTime] = useState('all')
  const [status, setStatus] = useState('all')
  const [table, setTable] = useState('all')
  const [waiter, setWaiter] = useState('all')
  const [serviceTab, setServiceTab] = useState<ServiceTab>('all')
  const [editing, setEditing] = useState<BookingRecord | 'walk-in' | null>(null)
  const [viewing, setViewing] = useState<BookingRecord | null>(null)
  const [showImport, setShowImport] = useState(false)

  useEffect(() => {
    if (consumeWorkflow('booking-add')) setEditing('walk-in')
    else if (consumeWorkflow('booking-import')) setShowImport(true)
  }, [])

  const load = async (targetDate = date) => { setLoading(true); setError(''); try { const [nextBookings, nextOccasions] = await Promise.all([bookingApi.list(targetDate), guestOccasionApi.list(targetDate)]); setBookings(nextBookings); setOccasions(nextOccasions) } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load bookings.') } finally { setLoading(false) } }
  useEffect(() => { void load() }, [date])
  useEffect(() => { if (!initialBooking || initialBooking.date !== date) return; const target = bookings.find(item => item.id === initialBooking.id); if (target) setViewing(target) }, [bookings, date, initialBooking])
  const showImportedDate = (targetDate: string) => {
    if (targetDate === date) void load(targetDate)
    else setDate(targetDate)
  }

  const statusMetadata = (value: string) => configuration.statuses.find(option => option.value === value)?.metadata
  const serviceStage = (booking: BookingRecord) => serviceStageFor(configuration.statuses, booking.bookingStatus)
  const expected = bookings.filter(booking => !statusMetadata(booking.bookingStatus)?.excludesFromExpectedCovers)
  const arrivedBookings = bookings.filter(booking => ['arrived', 'completed'].includes(serviceStage(booking)))
  const remainingBookings = expected.filter(booking => serviceStage(booking) === 'remaining')
  const noShowBookings = bookings.filter(booking => serviceStage(booking) === 'noShow')
  const requiringAssignment = expected.filter(booking => serviceStage(booking) !== 'completed')
  const summary = {
    total: bookings.length,
    covers: expected.reduce((total, booking) => total + booking.covers, 0),
    arrived: arrivedBookings.length,
    arrivedCovers: arrivedBookings.reduce((total, booking) => total + booking.covers, 0),
    remaining: remainingBookings.length,
    remainingCovers: remainingBookings.reduce((total, booking) => total + booking.covers, 0),
    noShows: noShowBookings.length,
    noShowCovers: noShowBookings.reduce((total, booking) => total + booking.covers, 0),
    unassignedTables: requiringAssignment.filter(booking => !booking.tableNumber).length,
    unassignedWaiters: requiringAssignment.filter(booking => !booking.waiterId).length
  }
  const serviceTabs: Array<{ value: ServiceTab; label: string; count: number }> = [
    { value: 'all', label: 'All Bookings', count: bookings.length },
    { value: 'arrived', label: 'Arrived', count: arrivedBookings.length },
    { value: 'remaining', label: 'Remaining', count: remainingBookings.length },
    { value: 'noShow', label: 'No-Shows', count: noShowBookings.length },
    { value: 'excluded', label: 'Cancelled', count: bookings.filter(booking => serviceStage(booking) === 'excluded').length }
  ]
  const occasionByBooking = useMemo(() => { const output = new Map<string, GuestOccasionRecord[]>(); for (const occasion of occasions) if (occasion.bookingId) output.set(occasion.bookingId, [...(output.get(occasion.bookingId) || []), occasion]); return output }, [occasions])
  const times = [...new Set(bookings.map(booking => booking.reservationTime))].filter(Boolean).sort()
  const visible = useMemo(() => bookings.filter(booking => `${booking.guestName} ${booking.roomNumber} ${booking.bookingNumber} ${booking.guestNotes} ${booking.sourceGuestNotes || ''} ${booking.memberSearchText || ''}`.toLowerCase().includes(query.toLowerCase()) && (serviceTab === 'all' || serviceStage(booking) === serviceTab || (serviceTab === 'arrived' && serviceStage(booking) === 'completed')) && (time === 'all' || booking.reservationTime === time) && (status === 'all' || booking.bookingStatus === status) && (table === 'all' || (table === 'unassigned' ? !booking.tableNumber : booking.tableNumber === table)) && (waiter === 'all' || (waiter === 'unassigned' ? !booking.waiterId : booking.waiterId === waiter))), [bookings, query, serviceTab, time, status, table, waiter, configuration.statuses])
  const grouped = [...new Set(visible.map(booking => booking.reservationTime))].sort().map(groupTime => ({ time: groupTime, bookings: visible.filter(booking => booking.reservationTime === groupTime) }))

  const persist = async (record: BookingRecord) => {
    const saved = bookings.some(item => item.id === record.id) ? await bookingApi.update(record) : await bookingApi.create(record)
    if (saved.reservationDate === date) { setBookings(current => current.some(item => item.id === saved.id) ? current.map(item => item.id === saved.id ? saved : item) : [...current, saved].sort((a, b) => a.reservationTime.localeCompare(b.reservationTime))); setViewing(current => current?.id === saved.id ? saved : current) }
    else await load()
    return saved
  }
  const save = async (record: BookingRecord) => {
    const saved = await persist(record)
    onToast('Booking saved.')
    return saved
  }
  const quickUpdate = async (booking: BookingRecord, changes: Partial<BookingRecord>) => { try { await persist({ ...booking, ...changes }) } catch (saveError) { onToast(saveError instanceof Error ? saveError.message : 'Unable to update booking.') } }
  const waitingStatus = configuration.statuses.find(option => option.active && (option.metadata?.operationalAction === 'waiting' || option.value === 'waiting'))
  const arrivedStatus = configuration.statuses.find(option => option.active && option.metadata?.serviceStage === 'arrived')
  const noShowStatus = configuration.statuses.find(option => option.active && option.metadata?.serviceStage === 'noShow')

  return <>
    <section className="booking-command">
<div>
<button className="secondary date-step" aria-label="Previous service day" onClick={() => setDate(current => addCalendarDays(current, -1))}>←</button>
<label>Service date<input aria-label="Booking date" type="date" value={date} onChange={event => setDate(event.target.value)} />
</label>
<button className="secondary date-step" aria-label="Next service day" onClick={() => setDate(current => addCalendarDays(current, 1))}>→</button>
<button className="link" onClick={() => setDate(serviceDate())}>Today</button>
<small>{date === serviceDate() ? "Today's dinner service" : formatDate(date)}</small>
</div>
<div>
<button className="secondary upload-action" onClick={() => setShowImport(true)}>⇧ UPLOAD ACTIVITY PROGRAM</button>
<button className="primary" onClick={() => setEditing('walk-in')}>＋ Add Walk-In</button>
</div>
</section>
    <section className="service-summary">
<ServiceMetric label="Total Covers" value={summary.covers} detail={`${expected.length} expected bookings`} />
<ServiceMetric label="Arrived Covers" value={summary.arrivedCovers} detail={`${summary.arrived} bookings`} tone="arrived" />
<ServiceMetric label="Remaining Covers" value={summary.remainingCovers} detail={`${summary.remaining} bookings`} />
<ServiceMetric label="No-Show Covers" value={summary.noShowCovers} detail={`${summary.noShows} bookings`} tone="exception" />
<ServiceMetric label="Unassigned Tables" value={summary.unassignedTables} detail="Bookings requiring allocation" tone="warning" />
<ServiceMetric label="Unassigned Waiters" value={summary.unassignedWaiters} detail="Bookings requiring allocation" tone="warning" />
</section>
    <section className="service-progress" aria-label={`${summary.arrivedCovers} of ${summary.covers} covers arrived`}><div><span>Dinner Service Progress</span><b>{summary.arrivedCovers} / {summary.covers} covers</b></div><div className="service-progress-track"><span style={{ width: `${summary.covers ? Math.min(100, summary.arrivedCovers / summary.covers * 100) : 0}%` }} /></div></section>
    <section className="panel booking-panel service-panel">
<nav className="booking-service-tabs" aria-label="Booking service status">{serviceTabs.map(tab => <button key={tab.value} className={serviceTab === tab.value ? 'active' : ''} aria-pressed={serviceTab === tab.value} onClick={() => setServiceTab(tab.value)}>{tab.label}<span>{tab.count}</span></button>)}</nav>
<div className="booking-tools service-tools">
<input aria-label="Search bookings" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search guest, room, booking # or notes" />
<select aria-label="Filter by reservation time" value={time} onChange={event => setTime(event.target.value)}>
<option value="all">All times</option>{times.map(value => <option key={value} value={value}>{value}</option>)}</select>
<select aria-label="Filter by operational status" value={status} onChange={event => setStatus(event.target.value)}>
<option value="all">All statuses</option>{configuration.statuses.map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select>
<select aria-label="Filter by table" value={table} onChange={event => setTable(event.target.value)}>
<option value="all">All tables</option>
<option value="unassigned">Unassigned table</option>{configuration.tables.map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select>
<select aria-label="Filter by waiter" value={waiter} onChange={event => setWaiter(event.target.value)}>
<option value="all">All waiters</option>
<option value="unassigned">Unassigned waiter</option>{staff.map(person => <option key={person.id} value={person.id}>{person.name}{person.employmentStatus !== 'active' ? ' (Inactive)' : ''}</option>)}</select>
</div>{loading && <div className="inline-state">Loading dinner service…</div>}{error && <div className="inline-state error-state">
<p>{error}</p>
<button className="secondary" onClick={() => void load()}>Try again</button>
</div>}{!loading && !error && <div className="service-groups">{grouped.map(group => { const groupCovers = group.bookings.reduce((total, booking) => total + booking.covers, 0); return <section className="time-group" key={group.time}>
<header className="time-group-header">
<strong>{timeWindow(group.time)}</strong>
<span>{group.bookings.length} {group.bookings.length === 1 ? 'Booking' : 'Bookings'} · {groupCovers} {groupCovers === 1 ? 'Cover' : 'Covers'}</span></header>
<div className="booking-table-wrap" tabIndex={0} aria-label={`${group.time} bookings table`}>
<table className="service-table">
<thead>
<tr>
<th>Time</th>
<th>Room</th>
<th>Guest Name</th>
<th>Covers</th>
<th>Occasion</th>
<th>Allergies</th>
<th>Table</th>
<th>Waiter</th>
<th>Status</th>
<th>Actions</th>
</tr>
</thead>
<tbody>{group.bookings.map(booking => <ServiceBookingRow key={booking.id} booking={booking} occasions={occasionByBooking.get(booking.id) || []} staff={staff} configuration={configuration} waitingStatus={waitingStatus} arrivedStatus={arrivedStatus} noShowStatus={noShowStatus} onUpdate={quickUpdate} onView={() => setViewing(booking)} />)}</tbody>
</table>
</div>
<div className="mobile-booking-list">{group.bookings.map(booking => <MobileBookingCard key={booking.id} booking={booking} occasions={occasionByBooking.get(booking.id) || []} staff={staff} configuration={configuration} waitingStatus={waitingStatus} arrivedStatus={arrivedStatus} noShowStatus={noShowStatus} onUpdate={quickUpdate} onView={() => setViewing(booking)} />)}</div>
</section> })}{visible.length === 0 && <div className="inline-empty"><span>No bookings match this service date and filters.</span><div className="empty-state-actions"><button className="secondary" onClick={() => setShowImport(true)}>⇧ Upload Activity Program</button><button className="primary" onClick={() => setEditing('walk-in')}>＋ Add Walk-In</button></div></div>}</div>}</section>
    {editing === 'walk-in' && <WalkInBookingForm date={date} staff={staff} configuration={configuration} onClose={() => setEditing(null)} onSave={async record => { const saved = await bookingApi.createWalkIn(record); if (saved.reservationDate === date) setBookings(current => [...current, saved].sort((a, b) => a.reservationTime.localeCompare(b.reservationTime))); else await load(); setEditing(null) }} />}
    {editing && editing !== 'walk-in' && <BookingForm booking={editing} date={date} staff={staff} configuration={configuration} onClose={() => setEditing(null)} onSave={async record => { await save(record); setEditing(null) }} />}
    {viewing && <BookingView booking={viewing} occasions={occasionByBooking.get(viewing.id) || []} configuration={configuration} onClose={() => setViewing(null)} />}
    {showImport && <ActivityProgramImport statuses={configuration.statuses} onClose={() => setShowImport(false)} onImported={showImportedDate} onViewImported={targetDate => { showImportedDate(targetDate); setShowImport(false) }} />}
  </>
}

function ServiceMetric({ label, value, detail, tone = '' }: { label: string; value: number; detail: string; tone?: string }) { return <article className={`panel ${tone}`}>
<span>{label}</span>
<strong>{value}</strong>
<small>{detail}</small>
</article> }

const serviceEligibleDesignations = new Set(['venue manager', 'assistant restaurant manager', 'restaurant supervisor', 'f&b attendant', 'waiter'])
const canReceiveServiceAssignment = (person: Staff) => (person.assignmentEligible ?? person.employmentStatus === 'active') && (person.serviceAssignmentEligible ?? serviceEligibleDesignations.has(person.position.toLowerCase()))

function OccasionBadges({ occasions, options }: { occasions: GuestOccasionRecord[]; options: ConfigOption[] }) {
  const values = [...new Set(occasions.map(occasion => occasion.occasionType))]
  return values.length ? <div className="occasion-badges">{values.map(value => { const option = options.find(item => item.value === value); return <span key={value} className="occasion-chip" style={{ borderColor: option?.color || '#b38b3a', color: option?.color || '#775b22' }}>{option?.label || value}</span> })}</div> : <span className="quiet-value">—</span>
}

function AllergyBadges({ booking, full = false }: { booking: BookingRecord; full?: boolean }) {
  const alerts = guestAlerts(booking)
  return alerts.length ? <div className={`allergy-badges${full ? ' full' : ''}`} role="note" aria-label={`Allergy or dietary alert: ${alerts.map(alert => alert.label).join(', ')}`}>{alerts.map(alert => <span key={alert.label} className="allergy-alert" title={alert.note}>⚠ {alert.label}</span>)}{full && <p>{alerts[0].note}</p>}</div> : <span className="quiet-value">None recorded</span>
}

function ServiceBookingRow({ booking, occasions, staff, configuration, waitingStatus, arrivedStatus, noShowStatus, onUpdate, onView }: { booking: BookingRecord; occasions: GuestOccasionRecord[]; staff: Staff[]; configuration: BookingConfiguration; waitingStatus?: ConfigOption; arrivedStatus?: ConfigOption; noShowStatus?: ConfigOption; onUpdate: (booking: BookingRecord, changes: Partial<BookingRecord>) => Promise<void>; onView: () => void }) {
  const status = configuration.statuses.find(option => option.value === booking.bookingStatus)
  const stage = serviceStageFor(configuration.statuses, booking.bookingStatus)
  const availableStaff = staff.filter(person => canReceiveServiceAssignment(person) || person.id === booking.waiterId)
  const waiting = booking.bookingStatus === waitingStatus?.value
  const guestLabel = booking.guestName || (booking.bookingSource === 'walk_in' ? 'Walk-In Guest' : 'Guest not recorded')
  return <tr className={`service-row stage-${waiting ? 'waiting' : stage.toLowerCase()}${stage === 'arrived' ? ' is-arrived' : ''}`}>
<td className="service-time"><b>{booking.reservationTime || '—'}</b>{stage === 'arrived' && <span className="sr-only">Guest has arrived.</span>}</td>
<td className="service-room">
<b>{booking.roomNumber || '—'}</b>
</td>
<td className="service-guest">
<b>{guestLabel}</b>
<small>{booking.bookingNumber || 'No booking number'}</small>
</td>
<td className="service-covers">
<b>{booking.covers}</b>
</td>
<td><OccasionBadges occasions={occasions} options={configuration.occasionTypes || []} /></td>
<td><AllergyBadges booking={booking} /></td>
<td>
<select className={!booking.tableNumber ? 'unassigned-control' : ''} aria-label={`Table for ${booking.guestName}`} value={booking.tableNumber} onChange={event => void onUpdate(booking, { tableNumber: event.target.value })}>
<option value="">Unassigned</option>{configuration.tables.filter(option => option.active || option.value === booking.tableNumber).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select>
</td>
<td>
<select className={!booking.waiterId ? 'unassigned-control' : ''} aria-label={`Waiter for ${booking.guestName}`} value={booking.waiterId || ''} onChange={event => void onUpdate(booking, { waiterId: event.target.value || null })}>
<option value="">Unassigned</option>{availableStaff.map(person => { const eligible = canReceiveServiceAssignment(person); return <option key={person.id} value={person.id} disabled={!eligible}>{person.name}{!eligible ? ' · Ineligible (historical)' : ''}</option> })}</select>
</td>
<td>
<select className="service-status-select" aria-label={`Status for ${booking.guestName}`} value={booking.bookingStatus} style={{ borderColor: status?.color || '#dce5e8' }} onChange={event => void onUpdate(booking, { bookingStatus: event.target.value })}>{configuration.statuses.filter(option => option.active || option.value === booking.bookingStatus).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select>
</td>
<td>
<div className="service-actions">{waitingStatus && stage === 'remaining' && !waiting && <button className="quick-waiting" onClick={() => void onUpdate(booking, { bookingStatus: waitingStatus.value })}>◷ {waitingStatus.label}</button>}{arrivedStatus && stage === 'remaining' && <button className="quick-arrive" onClick={() => void onUpdate(booking, { bookingStatus: arrivedStatus.value })}>✓ {arrivedStatus.label}</button>}{noShowStatus && stage === 'remaining' && <button className="quick-noshow" onClick={() => void onUpdate(booking, { bookingStatus: noShowStatus.value })}>× {noShowStatus.label}</button>}<button className="link" onClick={onView}>View Details</button></div>
</td>
</tr>
}

function MobileBookingCard({ booking, occasions, staff, configuration, waitingStatus, arrivedStatus, noShowStatus, onUpdate, onView }: { booking: BookingRecord; occasions: GuestOccasionRecord[]; staff: Staff[]; configuration: BookingConfiguration; waitingStatus?: ConfigOption; arrivedStatus?: ConfigOption; noShowStatus?: ConfigOption; onUpdate: (booking: BookingRecord, changes: Partial<BookingRecord>) => Promise<void>; onView: () => void }) {
  const status = configuration.statuses.find(option => option.value === booking.bookingStatus)
  const stage = serviceStageFor(configuration.statuses, booking.bookingStatus)
  const availableStaff = staff.filter(person => canReceiveServiceAssignment(person) || person.id === booking.waiterId)
  const waiting = booking.bookingStatus === waitingStatus?.value
  const guestLabel = booking.guestName || (booking.bookingSource === 'walk_in' ? 'Walk-In Guest' : 'Guest not recorded')
  return <article className={`mobile-operation-card stage-${waiting ? 'waiting' : stage.toLowerCase()}${stage === 'arrived' ? ' is-arrived' : ''}`}>
    <header><div><span className="mobile-card-kicker">{booking.reservationTime || 'Time not set'}</span><h4>{guestLabel}</h4><small>#{booking.bookingNumber || 'No booking number'}</small></div><span className="booking-status" style={{ background: status?.color || '#718492' }}>{status?.label || booking.bookingStatus}</span></header>
    {stage === 'arrived' && <p className="mobile-arrived-state">✓ Guest has arrived</p>}
    <div className="mobile-card-facts"><span><small>Room</small><b>{booking.roomNumber || '—'}</b></span><span><small>Covers</small><b>{booking.covers}</b></span><span><small>Occasion</small><OccasionBadges occasions={occasions} options={configuration.occasionTypes || []} /></span><span><small>Allergies</small><AllergyBadges booking={booking} /></span></div>
    <div className="mobile-card-fields"><label>Table<select className={!booking.tableNumber ? 'unassigned-control' : ''} aria-label={`Mobile table for ${booking.guestName}`} value={booking.tableNumber} onChange={event => void onUpdate(booking, { tableNumber: event.target.value })}><option value="">Unassigned</option>{configuration.tables.filter(option => option.active || option.value === booking.tableNumber).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select></label><label>Waiter<select className={!booking.waiterId ? 'unassigned-control' : ''} aria-label={`Mobile waiter for ${booking.guestName}`} value={booking.waiterId || ''} onChange={event => void onUpdate(booking, { waiterId: event.target.value || null })}><option value="">Unassigned</option>{availableStaff.map(person => { const eligible = canReceiveServiceAssignment(person); return <option key={person.id} value={person.id} disabled={!eligible}>{person.name}{!eligible ? ' · Ineligible (historical)' : ''}</option> })}</select></label><label className="mobile-full-field">Status<select aria-label={`Mobile status for ${booking.guestName}`} value={booking.bookingStatus} style={{ borderColor: status?.color }} onChange={event => void onUpdate(booking, { bookingStatus: event.target.value })}>{configuration.statuses.filter(option => option.active || option.value === booking.bookingStatus).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select></label></div>
    <div className="mobile-card-actions"><button className="secondary" onClick={onView}>View Details</button>{waitingStatus && stage === 'remaining' && !waiting && <button className="quick-waiting" onClick={() => void onUpdate(booking, { bookingStatus: waitingStatus.value })}>◷ {waitingStatus.label}</button>}{arrivedStatus && stage === 'remaining' && <button className="quick-arrive" onClick={() => void onUpdate(booking, { bookingStatus: arrivedStatus.value })}>✓ {arrivedStatus.label}</button>}{noShowStatus && stage === 'remaining' && <button className="quick-noshow" onClick={() => void onUpdate(booking, { bookingStatus: noShowStatus.value })}>× {noShowStatus.label}</button>}</div>
  </article>
}

type ReviewDecisionState = { action: BookingImportReviewDecision['action']; changes?: BookingImportReviewChanges; record?: BookingImportPreviewRecord }

function ActivityProgramImport({ statuses, onClose, onImported, onViewImported }: { statuses: ConfigOption[]; onClose: () => void; onImported: (date: string) => void; onViewImported: (date: string) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<BookingImportPreview | null>(null)
  const [selectedPreview, setSelectedPreview] = useState<BookingImportPreviewRecord | null>(null)
  const [reanalysis, setReanalysis] = useState<BookingIntelligenceReanalysisPreview | null>(null)
  const [selectedIntelligence, setSelectedIntelligence] = useState<BookingIntelligenceReanalysisRecord | null>(null)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [editingReview, setEditingReview] = useState<{ index: number; booking: BookingImportPreviewRecord } | null>(null)
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set())
  const [reviewDecisions, setReviewDecisions] = useState<Record<number, ReviewDecisionState>>({})
  const [confirming, setConfirming] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [result, setResult] = useState<BookingImportResult | null>(null)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState('')
  const parse = async () => { if (!file) return setError('Select an Activity Program PDF.'); setParsing(true); setError(''); setPreview(null); setReanalysis(null); setResult(null); setReviewDecisions({}); try { const next = await bookingApi.previewActivityProgram(file); setPreview(next); setSelectedIndexes(new Set(next.bookings.map((booking, index) => ['READY', 'WARNING'].includes(booking.readiness) ? index : -1).filter(index => index >= 0))) } catch (parseError) { setError(parseError instanceof Error ? parseError.message : 'The Activity Program could not be parsed.') } finally { setParsing(false) } }
  const reanalyzeDuplicates = async () => { if (!preview) return; setReanalyzing(true); setError(''); try { setReanalysis(await bookingApi.reanalyzeImportPreview(preview.batchId)) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Existing bookings could not be re-analyzed.') } finally { setReanalyzing(false) } }
  const readyEntries = preview ? preview.bookings.map((booking, index) => ({ booking, index })).filter(({ booking }) => ['READY', 'WARNING'].includes(booking.readiness)) : []
  const reviewEntries = preview ? preview.bookings.map((booking, index) => ({ booking, index })).filter(({ booking }) => booking.readiness === 'REVIEW_REQUIRED') : []
  const duplicateEntries = preview ? preview.bookings.map((booking, index) => ({ booking, index })).filter(({ booking }) => booking.readiness === 'DUPLICATE') : []
  const selectedBookings = preview ? preview.bookings.map((booking, index) => ({ booking: reviewDecisions[index]?.record || booking, index, managerDecision: reviewDecisions[index]?.action })).filter(({ index }) => selectedIndexes.has(index) || ['IMPORT_ANYWAY', 'EDIT_BEFORE_IMPORT'].includes(reviewDecisions[index]?.action)) : []
  const selectedCovers = selectedBookings.reduce((total, { booking, managerDecision }) => total + (managerDecision ? Number(booking.covers || 0) : operationalPax(booking)), 0)
  const warningsIncluded = selectedBookings.filter(({ booking }) => booking.warnings.length > 0).length
  const unresolvedReviews = reviewEntries.filter(({ index }) => !reviewDecisions[index]).length
  const managerApproved = reviewEntries.filter(({ index }) => ['IMPORT_ANYWAY', 'EDIT_BEFORE_IMPORT'].includes(reviewDecisions[index]?.action)).length
  const skippedByManager = reviewEntries.filter(({ index }) => reviewDecisions[index]?.action === 'SKIP').length
  const toggle = (index: number) => setSelectedIndexes(current => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next })
  const selectReady = () => setSelectedIndexes(new Set(readyEntries.map(({ index }) => index)))
  const decide = (index: number, decision: ReviewDecisionState) => setReviewDecisions(current => ({ ...current, [index]: decision }))
  const decisionsForApi = Object.entries(reviewDecisions).map(([index, decision]) => ({ index: Number(index), action: decision.action, changes: decision.changes }))
  const confirm = async () => { if (!preview) return; setConfirming(true); setError(''); try { const imported = await bookingApi.confirmImport(preview.batchId, [...selectedIndexes].sort((a, b) => a - b), decisionsForApi); setResult(imported); onImported(imported.reservationDate); setShowConfirmation(false) } catch (confirmError) { setError(confirmError instanceof Error ? confirmError.message : 'The selected bookings could not be imported.'); setShowConfirmation(false) } finally { setConfirming(false) } }
  return <BookingModal title="Activity Program Import" onClose={onClose} wide>
<div className="import-workflow">
<p className="import-boundary">Upload → Parse → Review → Import</p>
<div className="import-upload">
<label>Activity Program PDF<input aria-label="Activity Program PDF" type="file" accept="application/pdf,.pdf" onChange={event => { setFile(event.target.files?.[0] || null); setPreview(null); setReanalysis(null); setResult(null); setSelectedIndexes(new Set()); setReviewDecisions({}); setError('') }} />
</label>
<button className="primary" disabled={!file || parsing} onClick={() => void parse()}>{parsing ? 'Parsing…' : 'Parse PDF'}</button>
</div>{error && <p className="save-error">{error}</p>}{preview && !result && <>
<div className="import-heading">
<div>
<p className="eyebrow">IMPORT SUMMARY</p>
<h3>{preview.fileName}</h3>
</div>
<span className={preview.validation.reconciled ? 'import-validation good' : 'import-validation review'}>{preview.validation.reconciled ? 'Totals reconciled' : 'Reconciliation review'}</span>
</div>
<div className="import-summary-grid">
<Summary label="Detected Bookings" value={preview.bookings.length} />
<Summary label="Ready to Import" value={readyEntries.length} />
<Summary label="Requires Review" value={reviewEntries.length} />
<Summary label="Duplicates" value={duplicateEntries.length} />
<Summary label="Total Covers Detected" value={preview.summary.totalCovers} />
<Summary label="Ready Covers" value={readyEntries.reduce((total, { booking }) => total + operationalPax(booking), 0)} />
</div>{(preview.duplicateFile || preview.validation.messages.length > 0) && <div className="import-alert">
<b>{preview.duplicateFile ? 'This file has been parsed before. Live booking identities were checked again.' : 'Document validation requires attention.'}</b>{preview.validation.messages.map(message => <span key={message}>{message}</span>)}</div>}{preview.validation.coverReconciliation && <CoverReconciliation reconciliation={preview.validation.coverReconciliation} />}<div className="import-selection">
<button className="secondary" onClick={selectReady}>Select All READY</button>
<button className="link" onClick={() => setSelectedIndexes(new Set())}>Clear selection</button>
<div>
<span>Selected Bookings</span>
<b>{selectedBookings.length}</b>
</div>
<div>
<span>Selected Covers</span>
<b>{selectedCovers}</b>
</div>
<button className="primary confirm-import" disabled={!selectedBookings.length || unresolvedReviews > 0} title={unresolvedReviews ? 'Choose an action for every review item.' : undefined} onClick={() => setShowConfirmation(true)}>REVIEW &amp; IMPORT</button>
</div>
{unresolvedReviews > 0 && <p className="review-required-message">Choose Import Anyway, Edit Before Import or Skip for every item requiring review.</p>}
<section className="import-review-section ready-section"><header><div><p className="eyebrow">READY TO IMPORT</p><h4>{readyEntries.length} booking groups</h4></div><span>{readyEntries.reduce((total, { booking }) => total + operationalPax(booking), 0)} covers</span></header><div className="import-table-wrap">
<table className="import-table">
<thead>
<tr>
<th>
<span className="sr-only">Select</span>
</th>
<th>Time</th>
<th>Booking #</th>
<th>Primary Guest</th>
<th>Room(s)</th>
<th>Covers</th>
<th>Intelligence</th>
<th>Source Status</th>
<th>Booked By</th>
<th>Warnings</th>
<th>Import Readiness</th>
<th>
</th>
</tr>
</thead>
<tbody>{readyEntries.map(({ booking, index }) => <tr key={`${booking.bookingNumber}-${index}`} className={selectedIndexes.has(index) ? 'selected-import-row' : ''}>
<td>
<input aria-label={`Select booking ${booking.bookingNumber || index + 1}`} type="checkbox" checked={selectedIndexes.has(index)} onChange={() => toggle(index)} />
</td>
<td>
<b>{booking.reservationTime || '—'}</b>
</td>
<td>{booking.bookingNumber || '—'}</td>
<td>{booking.primaryGuest || '—'}</td>
<td>{booking.rooms.join(', ') || '—'}</td>
<td>{booking.covers ?? '—'}</td>
<td><IntelligencePills booking={booking} /></td>
<td>{booking.sourceStatus || '—'}</td>
<td>{booking.bookedBy || '—'}</td>
<td>{booking.warnings.length || '—'}</td>
<td>
<Readiness state={booking.readiness} />
</td>
<td>
<button className="link" onClick={() => setSelectedPreview(booking)}>View</button>
</td>
</tr>)}</tbody>
</table>
</div><div className="import-record-cards">{readyEntries.map(({ booking, index }) => <ImportPreviewCard key={`${booking.bookingNumber}-${index}`} booking={booking} selected={selectedIndexes.has(index)} onToggle={() => toggle(index)} onView={() => setSelectedPreview(booking)} />)}</div></section>
<section className="import-review-section requires-review"><header><div><p className="eyebrow">REQUIRES REVIEW</p><h4>{reviewEntries.length} booking group{reviewEntries.length === 1 ? '' : 's'}</h4></div><span>{reviewEntries.reduce((total, { booking }) => total + operationalPax(booking), 0)} candidate covers</span></header>{reviewEntries.length === 0 ? <p className="empty-review-state">No uncertain records require manager review.</p> : <div className="review-item-list">{reviewEntries.map(({ booking, index }) => { const decision = reviewDecisions[index]; const displayed = decision?.record || booking; return <article className="review-item" key={`${booking.bookingNumber}-${index}`}><div className="review-item-heading"><div><b>{displayed.reservationTime || 'Time missing'} · {displayed.primaryGuest || 'Guest missing'}</b><span>Booking #{displayed.bookingNumber || 'Missing'} · {displayed.covers ?? 'Missing'} covers</span></div>{decision && <span className={`decision-state ${decision.action.toLowerCase()}`}>{decision.action.replaceAll('_', ' ')}</span>}</div><IntelligencePills booking={booking} /><PaxComparison booking={booking} /><div className="review-item-facts"><span><small>Room</small><b>{displayed.rooms.join(', ') || 'Missing'}</b></span><span><small>Source status</small><b>{displayed.sourceStatus || 'Missing'}</b></span><span><small>Booked by</small><b>{displayed.bookedBy || '—'}</b></span></div><div className="review-reasons"><b>Why manager review is required</b>{booking.warnings.map(warning => <span key={warning}>{warning}</span>)}</div>{booking.sourceNotes && <p className="review-source-note"><b>Source notes</b>{booking.sourceNotes}</p>}<div className="review-actions"><button className="secondary" onClick={() => decide(index, { action: 'IMPORT_ANYWAY', record: booking })}>Import Anyway</button><button className="secondary" onClick={() => setEditingReview({ index, booking: displayed })}>Edit Before Import</button><button className="link danger-link" onClick={() => decide(index, { action: 'SKIP' })}>Skip</button><button className="link" onClick={() => setSelectedPreview(displayed)}>Guest group ({displayed.guestMembers.length})</button></div></article> })}</div>}</section>
<section className="import-review-section duplicate-section"><header><div><p className="eyebrow">DUPLICATES / EXISTING BOOKINGS</p><h4>{duplicateEntries.length} booking group{duplicateEntries.length === 1 ? '' : 's'} safely skipped</h4></div>{duplicateEntries.length > 0 && <button className="secondary reanalyze-intelligence" disabled={reanalyzing} onClick={() => void reanalyzeDuplicates()}>{reanalyzing ? 'Re-analyzing…' : reanalysis ? 'Re-analyze again' : 'Re-analyze Intelligence'}</button>}</header>{reanalysis && <div className="reanalysis-summary"><Summary label="Existing Bookings" value={reanalysis.existingBookings} /><Summary label="Intelligence Findings" value={reanalysis.intelligenceFindings} /><Summary label="Requires Intelligence Review" value={reanalysis.requiresIntelligenceReview} /></div>}<p className="reanalysis-boundary">Duplicate import protection remains active. Intelligence results are preview-only and do not update Bookings, covers, Guest Occasions, Dashboard or Reports.</p>{duplicateEntries.length === 0 ? <p className="empty-review-state">No live booking duplicates found.</p> : <div className="duplicate-list">{duplicateEntries.map(({ booking, index }) => { const intelligence = reanalysis?.records.find(item => item.index === index); return <article key={`${booking.bookingNumber}-${index}`}><b>{booking.reservationTime} · #{booking.bookingNumber}</b><span>{booking.primaryGuest} · {booking.rooms.join(', ') || 'No room'}</span><small>Existing booking {booking.duplicateBookingId}. This source record will not overwrite restaurant operations.</small>{intelligence && <IntelligencePills booking={intelligence.source} />}<div className="duplicate-actions"><button className="link" onClick={() => setSelectedPreview(booking)}>View source</button>{intelligence && <button className="link" onClick={() => setSelectedIntelligence(intelligence)}>View intelligence</button>}</div></article> })}</div>}</section>
</>}{result && <ImportResult result={result} onView={() => onViewImported(result.reservationDate)} />}</div>{selectedPreview && <PreviewDetails booking={selectedPreview} onClose={() => setSelectedPreview(null)} />}{selectedIntelligence && <IntelligenceComparisonDetails record={selectedIntelligence} onClose={() => setSelectedIntelligence(null)} />}{showConfirmation && preview && <div className="preview-detail-overlay">
<section className="confirmation-card">
<p className="eyebrow">MANAGER CONFIRMATION</p>
<h3>Confirm Activity Program import?</h3>
<div className="confirmation-summary">
<span>Activity Program Date</span>
<b>{formatDate(preview.reportDate)}</b>
<span>Selected Bookings</span>
<b>{selectedBookings.length}</b>
<span>Selected Covers</span>
<b>{selectedCovers}</b>
<span>Warnings included</span>
<b>{warningsIncluded}</b>
<span>Manager-approved review items</span>
<b>{managerApproved}</b>
<span>Duplicates skipped</span>
<b>{duplicateEntries.length}</b>
<span>Skipped by manager</span>
<b>{skippedByManager}</b>
</div>
<p>Only the selected source bookings will be created. Existing restaurant assignments and operational updates will never be overwritten.</p>
<div className="form-actions">
<button className="secondary" disabled={confirming} onClick={() => setShowConfirmation(false)}>Back to preview</button>
<button className="primary" disabled={confirming} onClick={() => void confirm()}>{confirming ? 'Importing…' : 'Confirm Import'}</button>
</div>
</section>
</div>}{editingReview && preview && <ReviewEditDialog batchId={preview.batchId} index={editingReview.index} booking={editingReview.booking} statuses={statuses} onClose={() => setEditingReview(null)} onSave={(changes, record) => { decide(editingReview.index, { action: 'EDIT_BEFORE_IMPORT', changes, record }); setEditingReview(null) }} />}</BookingModal>
}

function IntelligencePills({ booking }: { booking: BookingImportPreviewRecord }) {
  const findings = booking.intelligence?.findings || []
  const labels = [...new Set(findings.map(item => item.displayLabel).filter(label => ['HONEYMOON', 'BIRTHDAY', 'ANNIVERSARY', 'SEE YOU SOON', 'SIYAM FAMILY', 'FAM TRIP', 'PRESS TRIP', 'TLC', 'ALLERGY', 'GROUP', 'GROUP REVIEW', 'PAX REVIEW', 'KIDS REVIEW', 'BLOCKED'].includes(label)))]
  return labels.length ? <div className="intelligence-pills" aria-label={`Booking intelligence: ${labels.join(', ')}`}>{labels.map(label => <span key={label} className={/REVIEW/.test(label) ? 'review' : label === 'ALLERGY' || label === 'TLC' ? 'attention' : ''}>{label}</span>)}</div> : <span className="quiet-value">—</span>
}

function CoverReconciliation({ reconciliation }: { reconciliation: NonNullable<BookingImportPreview['validation']['coverReconciliation']> }) {
  const attention = reconciliation.ledger.filter(item => item.delta !== 0 || item.reviewRequired)
  return <section className={`cover-reconciliation ${reconciliation.reconciled ? 'reconciled' : 'review'}`} aria-label="Cover reconciliation ledger">
    <header><div><p className="eyebrow">COVER RECONCILIATION</p><h4>{reconciliation.reconciled ? 'Totals reconciled' : 'Manager review required'}</h4></div><span>{reconciliation.unresolvedRecords} unresolved</span></header>
    <div className="cover-equation"><span><small>Header covers</small><b>{reconciliation.rawSectionHeaderTotal}</b></span><i>+</i><span><small>Adjustments</small><b>+{reconciliation.positiveAdjustments}</b></span><i>−</i><span><small>Exclusions</small><b>−{reconciliation.exclusions}</b></span><i>=</i><span><small>Operational candidates</small><b>{reconciliation.effectiveOperationalTotal}</b></span></div>
    {attention.length > 0 && <div className="cover-ledger"><div className="cover-ledger-head"><span>Booking</span><span>Source</span><span>Effective</span><span>Delta</span><span>Rule / reason</span></div>{attention.map(item => <article key={`${item.index}-${item.bookingNumber}`}><span><b>#{item.bookingNumber || 'Missing'}</b><small>{item.reservationTime} · {item.rooms.join(', ') || 'No room'}</small></span><b>{item.sourcePax}</b><b>{item.effectiveOperationalPax}</b><b className={item.delta ? 'changed' : ''}>{item.delta > 0 ? '+' : ''}{item.delta}</b><span><b>{item.paxSemantic.replaceAll('_', ' ')}</b><small>{item.reason}</small></span></article>)}</div>}
  </section>
}

function PaxComparison({ booking }: { booking: BookingImportPreviewRecord }) {
  const intelligence = booking.intelligence
  if (!intelligence?.showPaxComparison) return null
  return <div className="intelligence-pax" aria-label="PAX intelligence comparison"><span><small>Source PAX</small><b>{intelligence.sourcePax ?? '—'}</b></span><span><small>Detected PAX</small><b>{intelligence.detectedPax ?? '—'}</b></span><span><small>Effective candidate</small><b>{intelligence.effectiveCandidatePax ?? '—'}</b></span></div>
}

function ImportPreviewCard({ booking, selected, onToggle, onView }: { booking: BookingImportPreviewRecord; selected: boolean; onToggle: () => void; onView: () => void }) { return <article className={`import-preview-card${selected ? ' selected' : ''}`}><header><label><input type="checkbox" checked={selected} onChange={onToggle} /> Include</label><Readiness state={booking.readiness} /></header><b>{booking.reservationTime} · {booking.primaryGuest}</b><span>#{booking.bookingNumber} · {booking.rooms.join(', ') || 'No room'} · {booking.covers ?? '—'} covers</span><IntelligencePills booking={booking} /><PaxComparison booking={booking} /><button className="link" onClick={onView}>View guest group</button></article> }

function ReviewEditDialog({ batchId, index, booking, statuses, onClose, onSave }: { batchId: string; index: number; booking: BookingImportPreviewRecord; statuses: ConfigOption[]; onClose: () => void; onSave: (changes: BookingImportReviewChanges, record: BookingImportPreviewRecord) => void }) {
  const [form, setForm] = useState<BookingImportReviewChanges>({ reservationDate: booking.reservationDate, reservationTime: booking.reservationTime, primaryGuest: booking.primaryGuest, room: booking.rooms.join(', '), covers: booking.covers || 1, sourceStatus: statuses.some(option => option.active && option.value === booking.sourceStatus.toLowerCase()) ? booking.sourceStatus.toLowerCase() : statuses.find(option => option.active)?.value || '', sourceNotes: booking.sourceNotes })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const update = <K extends keyof BookingImportReviewChanges>(field: K, value: BookingImportReviewChanges[K]) => setForm(current => ({ ...current, [field]: value }))
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(''); try { const validation = await bookingApi.validateImportReview(batchId, index, form); if (validation.duplicateBookingId) throw new Error(`These corrected values match existing booking ${validation.duplicateBookingId}. It will remain in the duplicate section.`); onSave(form, validation.record) } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'The correction could not be validated.') } finally { setSaving(false) } }
  return <div className="preview-detail-overlay"><section className="review-edit-dialog" role="dialog" aria-modal="true" aria-label="Edit booking before import"><button type="button" className="close" aria-label="Close review editor" title="Close" onClick={onClose}>×</button><p className="eyebrow">EDIT BEFORE IMPORT</p><h3>Correct booking #{booking.bookingNumber}</h3><p className="immutable-source-key">Booking number is preserved as the original source identity.</p><form className="review-edit-form" onSubmit={event => void submit(event)}><label>Reservation date<input type="date" value={form.reservationDate} onChange={event => update('reservationDate', event.target.value)} /></label><label>Reservation time<input type="time" value={form.reservationTime} onChange={event => update('reservationTime', event.target.value)} /></label><label>Primary guest<input value={form.primaryGuest} onChange={event => update('primaryGuest', event.target.value)} /></label><label>Room(s)<input value={form.room} placeholder="e.g. 211, 212" onChange={event => update('room', event.target.value)} /></label><label>Covers<input type="number" min="1" step="1" value={form.covers} onChange={event => update('covers', Number(event.target.value))} /></label><label>Operational status<select value={form.sourceStatus} onChange={event => update('sourceStatus', event.target.value)}>{statuses.filter(option => option.active).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select></label><label className="review-notes-field">Source notes<textarea rows={4} value={form.sourceNotes} onChange={event => update('sourceNotes', event.target.value)} /></label>{error && <p className="save-error review-form-error">{error}</p>}<div className="form-actions"><button type="button" className="secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving ? 'Validating…' : 'Save correction'}</button></div></form></section></div>
}

function ImportResult({ result, onView }: { result: BookingImportResult; onView: () => void }) { return <div className="import-result">
<p className="eyebrow">IMPORT RESULT</p>
<h3>Activity Program import completed</h3>
<div className="import-summary-grid">
<Summary label="Imported Bookings" value={result.importedBookings} />
<Summary label="Imported Covers" value={result.importedCovers} />
<Summary label="Manager-approved Review" value={result.managerApprovedReviewItems} />
<Summary label="Skipped Duplicates" value={result.skippedDuplicates} />
<Summary label="Skipped by Manager" value={result.skippedByManager} />
<Summary label="Warnings" value={result.warnings} />
<Summary label="Failed Records" value={result.failedRecords.length} />
</div>{result.failedRecords.length > 0 && <div className="import-alert">{result.failedRecords.map(record => <span key={`${record.bookingNumber}-${record.reason}`}>
<b>{record.bookingNumber}:</b> {record.reason}</span>)}</div>}<button className="primary view-imported" onClick={onView}>VIEW IMPORTED BOOKINGS</button>
</div> }

function Summary({ label, value }: { label: string; value: string | number }) { return <article>
<span>{label}</span>
<strong>{value}</strong>
</article> }
function Readiness({ state }: { state: BookingImportPreviewRecord['readiness'] }) { return <span className={`readiness ${state.toLowerCase()}`}>{state.replace('_', ' ')}</span> }
function PreviewDetails({ booking, onClose }: { booking: BookingImportPreviewRecord; onClose: () => void }) {
  return <div className="preview-detail-overlay">
<section className="preview-detail" role="dialog" aria-modal="true" aria-label="Booking source preview">
<button type="button" className="close" aria-label="Close preview" title="Close" onClick={onClose}>×</button>
<p className="eyebrow">SOURCE BOOKING PREVIEW</p>
<h3>{booking.primaryGuest || 'Guest details'}</h3>
<div className="booking-detail preview-source">
<span>Reservation</span>
<b>{formatDate(booking.reservationDate)} · {booking.reservationTime}</b>
<span>Booking / Covers</span>
<b>{booking.bookingNumber || 'Missing'} · {booking.covers ?? 'Missing'} pax</b>
<span>Activity</span>
<b>{booking.activityLabel}</b>
<span>Source status</span>
<b>{booking.sourceStatus || '—'}</b>
<span>Booked by</span>
<b>{booking.bookedBy || '—'}</b>
<span>Source annotations</span>
<b>{booking.sourceNotes || '—'}</b>
<span>Readiness</span>
<b>
<Readiness state={booking.readiness} />
</b>
</div>{booking.intelligence && <section className="intelligence-detail">
<div className="intelligence-detail-heading"><div><p className="eyebrow">BOOKING INTELLIGENCE</p><b>{booking.intelligence.rulesetVersion}</b></div><IntelligencePills booking={booking} /></div>
<PaxComparison booking={booking} />
{booking.intelligence.findings.length > 0 ? <div className="intelligence-evidence-list">{booking.intelligence.findings.map((item, index) => <article key={`${item.normalizedKey}-${item.evidenceSha256}-${index}`}><header><b>{item.displayLabel}</b><span>{item.reviewState === 'REVIEW_REQUIRED' ? 'Manager review' : 'Detected'}</span></header><p>{item.rawEvidence}</p><small>{item.evidenceLocation} · matched “{item.detectedPhrase}” · {item.ruleKey}</small></article>)}</div> : <p className="quiet-value">No intelligence indicators detected.</p>}
{booking.intelligence.occasionDiscrepancies.length > 0 && <div className="intelligence-parity"><b>Legacy comparison</b>{booking.intelligence.occasionDiscrepancies.map(message => <span key={message}>{message}</span>)}</div>}
{booking.intelligence.newOccasionKeys.length > 0 && <div className="intelligence-projection"><b>Projected Booking Occasion</b><span>{booking.intelligence.newOccasionKeys.map(value => value.replaceAll('_', ' ')).join(' · ')}</span></div>}
</section>}{booking.warnings.length > 0 && <div className="preview-warnings">
<b>Review notes</b>{booking.warnings.map(warning => <span key={warning}>{warning}</span>)}</div>}<h3 className="modal-subtitle">Guest members</h3>
<div className="guest-member-table">
<table>
<thead>
<tr>
<th>#</th>
<th>Guest</th>
<th>Room / Code</th>
<th>Birth</th>
<th>Arrival</th>
<th>Departure</th>
<th>MP</th>
<th>Guest Notes</th>
</tr>
</thead>
<tbody>{booking.guestMembers.map(guest => <tr key={guest.sourceRowOrder}>
<td>{guest.sourceRowOrder}</td>
<td>
<b>{guest.guestName}</b>
</td>
<td>{guest.roomNumber || '—'}{guest.accommodationCode ? ` · ${guest.accommodationCode}` : ''}</td>
<td>{formatDate(guest.birthDate)}</td>
<td>{formatDate(guest.arrivalDate)}</td>
<td>{formatDate(guest.departureDate)}</td>
<td>{guest.mealPlan || '—'}</td>
<td>{guest.guestNotes || '—'}</td>
</tr>)}</tbody>
</table>
</div>
<div className="form-actions">
<button className="secondary" onClick={onClose}>Close details</button>
</div>
</section>
</div>
}

function IntelligenceEvidence({ booking }: { booking: BookingImportPreviewRecord }) {
  const intelligence = booking.intelligence
  if (!intelligence) return <p className="quiet-value">No intelligence analysis is available.</p>
  return <><div className="intelligence-detail-heading"><div><p className="eyebrow">INTELLIGENCE PREVIEW</p><b>{intelligence.rulesetVersion}</b></div><IntelligencePills booking={booking} /></div><PaxComparison booking={booking} />{intelligence.findings.length > 0 ? <div className="intelligence-evidence-list">{intelligence.findings.map((item, index) => <article key={`${item.normalizedKey}-${item.evidenceSha256}-${index}`}><header><b>{item.displayLabel}</b><span>{item.reviewState === 'REVIEW_REQUIRED' ? 'Manager review' : 'Detected'}</span></header><p>{item.rawEvidence}</p><small>{item.evidenceLocation} · matched “{item.detectedPhrase}” · {item.ruleKey}</small></article>)}</div> : <p className="quiet-value">No intelligence indicators detected.</p>}</>
}

function IntelligenceComparisonDetails({ record, onClose }: { record: BookingIntelligenceReanalysisRecord; onClose: () => void }) {
  const facts = (booking: BookingImportPreviewRecord) => <div className="reanalysis-facts"><span><small>Booking / Reservation</small><b>#{booking.bookingNumber} · {formatDate(booking.reservationDate)} · {booking.reservationTime}</b></span><span><small>Guest / Room</small><b>{booking.primaryGuest} · {booking.rooms.join(', ') || 'No room'}</b></span><span><small>Covers</small><b>{booking.covers ?? 'Missing'}</b></span><span><small>Source status</small><b>{booking.sourceStatus || '—'}</b></span><span className="wide"><small>Source annotations</small><b>{booking.sourceNotes || '—'}</b></span></div>
  return <div className="preview-detail-overlay"><section className="preview-detail intelligence-comparison" role="dialog" aria-modal="true" aria-label="Existing booking intelligence comparison"><button type="button" className="close" aria-label="Close intelligence preview" title="Close" onClick={onClose}>×</button><p className="eyebrow">SAFE RE-ANALYSIS · PREVIEW ONLY</p><h3>{record.source.primaryGuest || 'Existing booking intelligence'}</h3><div className="reanalysis-comparison"><section><p className="eyebrow">SOURCE</p>{facts(record.source)}</section><section><p className="eyebrow">EXISTING BOOKING</p><small className="existing-booking-id">Live ID {record.existing.duplicateBookingId}</small>{facts(record.existing)}</section></div><section className="intelligence-detail"><IntelligenceEvidence booking={record.source} /></section><div className="occasion-projection-parity"><span><small>Detected source occasions</small><b>{record.source.intelligence?.newOccasionKeys.map(value => value.replaceAll('_', ' ')).join(' · ') || 'None'}</b></span><span><small>Existing Guest Occasions</small><b>{record.existingOccasionKeys?.map(value => value.replaceAll('_', ' ')).join(' · ') || 'None'}</b></span>{record.occasionProjectionDifferences?.map(message => <p key={message}>{message}</p>)}</div><details className="existing-intelligence"><summary>Compare intelligence from the current persisted booking</summary><div className="intelligence-detail"><IntelligenceEvidence booking={record.existing} /></div></details><div className="reanalysis-safety-note"><b>No import or operational update will occur.</b><span>Any projection difference is informational. The duplicate booking and its Guest Occasions remain unchanged.</span></div><div className="form-actions"><button className="secondary" onClick={onClose}>Close intelligence</button></div></section></div>
}

function WalkInBookingForm({ date, staff, configuration, onClose, onSave }: { date: string; staff: Staff[]; configuration: BookingConfiguration; onClose: () => void; onSave: (booking: WalkInBookingInput) => Promise<void> }) {
  const [form, setForm] = useState<WalkInBookingInput>({ id: crypto.randomUUID(), guestName: '', roomNumber: '', birthDate: null, arrivalDate: null, departureDate: null, mealPeriod: 'Dinner', reservationDate: date, reservationTime: '19:00', covers: 1, guestNotes: '', tableNumber: '', waiterId: null })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const fields = configuration.walkInFields || []
  const mode = (field: string): WalkInFieldMode => fields.find(option => option.value === field)?.metadata?.walkInFieldMode || ({ reservationDate: 'required', reservationTime: 'required', covers: 'required', mealPeriod: 'required' }[field] as WalkInFieldMode || 'hidden')
  const shown = (field: string) => mode(field) !== 'hidden' && mode(field) !== 'system'
  const required = (field: string) => mode(field) === 'required'
  const fieldLabel = (field: string, fallback: string) => `${fields.find(option => option.value === field)?.label || fallback}${required(field) ? ' *' : ''}`
  const availableWaiters = staff.filter(canReceiveServiceAssignment)
  const update = <K extends keyof WalkInBookingInput>(field: K, value: WalkInBookingInput[K]) => setForm(current => ({ ...current, [field]: value }))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    for (const [field, label] of [['guestName', 'Guest name'], ['roomNumber', 'Room number'], ['reservationDate', 'Reservation date'], ['reservationTime', 'Reservation time'], ['mealPeriod', 'Meal period'], ['tableNumber', 'Table number'], ['waiterId', 'Waiter'], ['guestNotes', 'Guest notes']] as Array<[keyof WalkInBookingInput, string]>) if (required(field) && !String(form[field] ?? '').trim()) return setError(`${label} is required.`)
    if (!Number.isInteger(form.covers) || form.covers < 1) return setError('Covers must be a whole number greater than zero.')
    if (form.arrivalDate && form.departureDate && form.departureDate < form.arrivalDate) return setError('Departure date cannot be before arrival date.')
    setSaving(true); setError('')
    try { await onSave({ ...form, guestName: form.guestName.trim(), roomNumber: form.roomNumber.trim(), mealPeriod: form.mealPeriod.trim(), guestNotes: form.guestNotes.trim() }) }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save Walk-in booking.') }
    finally { setSaving(false) }
  }
  return <BookingModal title="Add Walk-In" onClose={onClose} wide>
<div className="walk-in-system-note"><span>Fast service entry</span><b>Source: Walk-In · Status: Confirmed</b><small>Booked By is recorded from your signed-in account.</small></div>
<form className="staff-form booking-form walk-in-booking-form" onSubmit={event => void submit(event)}>
<div className="booking-form-grid">
{shown('guestName') && <label>{fieldLabel('guestName', 'Guest name')}<input value={form.guestName} onChange={event => update('guestName', event.target.value)} /></label>}
{shown('roomNumber') && <label>{fieldLabel('roomNumber', 'Room number')}<input value={form.roomNumber} onChange={event => update('roomNumber', event.target.value)} /></label>}
{shown('reservationDate') && <label>{fieldLabel('reservationDate', 'Reservation date')}<input type="date" required={required('reservationDate')} value={form.reservationDate} onChange={event => update('reservationDate', event.target.value)} /></label>}
{shown('reservationTime') && <label>{fieldLabel('reservationTime', 'Reservation time')}<input type="time" required={required('reservationTime')} value={form.reservationTime} onChange={event => update('reservationTime', event.target.value)} /></label>}
{shown('covers') && <label>{fieldLabel('covers', 'Covers')}<input type="number" min="1" step="1" required value={form.covers} onChange={event => update('covers', Number(event.target.value))} /></label>}
{shown('mealPeriod') && <label>{fieldLabel('mealPeriod', 'Meal period')}<input required={required('mealPeriod')} value={form.mealPeriod} onChange={event => update('mealPeriod', event.target.value)} /></label>}
{shown('tableNumber') && <label>{fieldLabel('tableNumber', 'Table')}<select required={required('tableNumber')} value={form.tableNumber} onChange={event => update('tableNumber', event.target.value)}><option value="">Unassigned</option>{configuration.tables.filter(option => option.active).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select></label>}
{shown('waiterId') && <label>{fieldLabel('waiterId', 'Waiter')}<select required={required('waiterId')} value={form.waiterId || ''} onChange={event => update('waiterId', event.target.value || null)}><option value="">Unassigned</option>{availableWaiters.map(person => <option key={person.id} value={person.id}>{person.name} · {person.number}</option>)}</select></label>}
{shown('birthDate') && <label>{fieldLabel('birthDate', 'Birth date')}<input type="date" required={required('birthDate')} value={form.birthDate || ''} onChange={event => update('birthDate', event.target.value || null)} /></label>}
{shown('arrivalDate') && <label>{fieldLabel('arrivalDate', 'Arrival date')}<input type="date" required={required('arrivalDate')} value={form.arrivalDate || ''} onChange={event => update('arrivalDate', event.target.value || null)} /></label>}
{shown('departureDate') && <label>{fieldLabel('departureDate', 'Departure date')}<input type="date" required={required('departureDate')} value={form.departureDate || ''} onChange={event => update('departureDate', event.target.value || null)} /></label>}
</div>
{shown('guestNotes') && <label>{fieldLabel('guestNotes', 'Guest notes')}<textarea rows={3} required={required('guestNotes')} value={form.guestNotes} onChange={event => update('guestNotes', event.target.value)} /></label>}
{error && <p className="save-error">{error}</p>}<div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save Walk-In'}</button></div>
</form>
</BookingModal>
}

function BookingForm({ booking, date, staff, configuration, onClose, onSave }: { booking?: BookingRecord; date: string; staff: Staff[]; configuration: BookingConfiguration; onClose: () => void; onSave: (booking: BookingRecord) => Promise<void> }) {
  const [form, setForm] = useState<BookingRecord>(booking || { id: crypto.randomUUID(), guestName: '', roomNumber: '', birthDate: null, arrivalDate: null, departureDate: null, mealPeriod: 'Dinner', reservationDate: date, reservationTime: '19:00', bookingNumber: '', covers: 2, bookingStatus: configuration.statuses.find(option => option.active)?.value || '', bookingSource: configuration.sources.find(option => option.value === 'manual' && option.active)?.value || configuration.sources.find(option => option.active)?.value || '', bookedBy: 'Venue Manager', guestNotes: '', tableNumber: '', waiterId: null, waiter: null, importSource: 'manual' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const availableWaiters = staff.filter(person => canReceiveServiceAssignment(person) || person.id === form.waiterId)
  const update = <K extends keyof BookingRecord>(field: K, value: BookingRecord[K]) => setForm(current => ({ ...current, [field]: value }))
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!form.guestName.trim() || !form.reservationDate || !form.reservationTime || !Number.isInteger(form.covers) || form.covers < 1 || !form.bookingStatus || !form.bookingSource) return setError('Guest name, reservation date, time, covers, status and source are required.'); if (form.arrivalDate && form.departureDate && form.departureDate < form.arrivalDate) return setError('Departure date cannot be before arrival date.'); setSaving(true); setError(''); try { await onSave({ ...form, guestName: form.guestName.trim(), roomNumber: form.roomNumber.trim(), bookingNumber: form.bookingNumber.trim(), bookedBy: form.bookedBy.trim(), guestNotes: form.guestNotes.trim() }) } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save booking.') } finally { setSaving(false) } }
  return <BookingModal title={booking ? 'Edit Booking' : 'Add Manual Booking'} onClose={onClose} wide>
<form className="staff-form booking-form" onSubmit={event => void submit(event)}>
<div className="booking-form-grid">
<label>Guest name<input value={form.guestName} onChange={event => update('guestName', event.target.value)} />
</label>
<label>Room number<input value={form.roomNumber} onChange={event => update('roomNumber', event.target.value)} />
</label>
<label>Reservation date<input type="date" value={form.reservationDate} onChange={event => update('reservationDate', event.target.value)} />
</label>
<label>Reservation time<input type="time" value={form.reservationTime} onChange={event => update('reservationTime', event.target.value)} />
</label>
<label>Covers<input type="number" min="1" step="1" value={form.covers} onChange={event => update('covers', Number(event.target.value))} />
</label>
<label>Meal period<input value={form.mealPeriod} onChange={event => update('mealPeriod', event.target.value)} />
</label>
<label>Table number<select value={form.tableNumber} onChange={event => update('tableNumber', event.target.value)}>
<option value="">Unassigned</option>{configuration.tables.filter(option => option.active || option.value === form.tableNumber).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select>
</label>
<label>Waiter<select value={form.waiterId || ''} onChange={event => update('waiterId', event.target.value || null)}>
<option value="">Unassigned</option>{availableWaiters.map(person => { const eligible = canReceiveServiceAssignment(person); return <option key={person.id} value={person.id} disabled={!eligible}>{person.name} · {person.number}{!eligible ? ' (Ineligible – historical)' : ''}</option> })}</select>
</label>
<label>Booking status<select value={form.bookingStatus} onChange={event => update('bookingStatus', event.target.value)}>{configuration.statuses.filter(option => option.active || option.value === form.bookingStatus).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select>
</label>
<label>Booking source<select value={form.bookingSource} onChange={event => update('bookingSource', event.target.value)}>{configuration.sources.filter(option => option.active || option.value === form.bookingSource).map(option => <option key={option.id} value={option.value}>{option.label}</option>)}</select>
</label>
<label>Booking number<input value={form.bookingNumber} onChange={event => update('bookingNumber', event.target.value)} />
</label>
<label>Booked by<input value={form.bookedBy} onChange={event => update('bookedBy', event.target.value)} />
</label>
<label>Birth date<input type="date" value={form.birthDate || ''} onChange={event => update('birthDate', event.target.value || null)} />
</label>
<label>Arrival date<input type="date" value={form.arrivalDate || ''} onChange={event => update('arrivalDate', event.target.value || null)} />
</label>
<label>Departure date<input type="date" value={form.departureDate || ''} onChange={event => update('departureDate', event.target.value || null)} />
</label>
</div>
<label>Guest notes<textarea rows={4} value={form.guestNotes} onChange={event => update('guestNotes', event.target.value)} />
</label>{error && <p className="save-error">{error}</p>}<div className="form-actions">
<button type="button" className="secondary" onClick={onClose}>Cancel</button>
<button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save booking'}</button>
</div>
</form>
</BookingModal>
}

function BookingView({ booking, occasions, configuration, onClose }: { booking: BookingRecord; occasions: GuestOccasionRecord[]; configuration: BookingConfiguration; onClose: () => void }) {
  const [members, setMembers] = useState<BookingGuestMemberPreview[]>([])
  useEffect(() => { if (booking.importedBatchId) void bookingApi.guestMembers(booking.id).then(setMembers) }, [booking.id, booking.importedBatchId])
  const stage = serviceStageFor(configuration.statuses, booking.bookingStatus)
  return <BookingModal title="Booking details" onClose={onClose} side>
{stage === 'arrived' && <div className="booking-arrived-banner" role="status">✓ Guest has arrived</div>}
{guestAlerts(booking).length > 0 && <section className="booking-alert-detail"><p className="eyebrow">ALLERGIES / DIETARY ALERTS</p><AllergyBadges booking={booking} full /></section>}
<div className="detail-sections">
<section className="detail-section source-section">
<p className="eyebrow">SOURCE INFORMATION</p>
<div className="booking-detail">
<span>Primary guest</span>
<b>{booking.guestName || (booking.bookingSource === 'walk_in' ? 'Walk-In Guest' : '—')}</b>
<span>All room numbers</span>
<b>{booking.roomNumber || '—'}</b>
<span>Reservation</span>
<b>{formatDate(booking.reservationDate)} · {booking.reservationTime}</b>
<span>Covers</span>
<b>{booking.covers}</b>
<span>Occasion</span>
<b><OccasionBadges occasions={occasions} options={configuration.occasionTypes || []} /></b>
<span>Booking number</span>
<b>{booking.bookingNumber || '—'}</b>
<span>Source</span>
<b>{optionLabel(configuration.sources, booking.bookingSource)}</b>
<span>Original source status</span>
<b>{booking.sourceBookingStatus || booking.bookingStatus || '—'}</b>
<span>Booked by</span>
<b>{booking.bookedBy || '—'}</b>
<span>Guest/source notes</span>
<b>{booking.sourceGuestNotes || '—'}</b>{booking.importedBatchId && <>
<span>Source file</span>
<b>{booking.sourceFilename || '—'}</b>
<span>Report / parser</span>
<b>{formatDate(booking.sourceReportDate || null)} · {booking.sourceParserVersion || '—'}</b>
</>}</div>{members.length > 0 && <>
<h3 className="modal-subtitle">Linked guest members</h3>
<div className="guest-member-table">
<table>
<thead>
<tr>
<th>#</th>
<th>Guest</th>
<th>Room / Code</th>
<th>Birth</th>
<th>Arrival</th>
<th>Departure</th>
<th>MP</th>
<th>Notes</th>
</tr>
</thead>
<tbody>{members.map(member => <tr key={member.sourceRowOrder}>
<td>{member.sourceRowOrder}</td>
<td>
<b>{member.guestName}</b>
</td>
<td>{member.roomNumber || '—'}{member.accommodationCode ? ` · ${member.accommodationCode}` : ''}</td>
<td>{formatDate(member.birthDate)}</td>
<td>{formatDate(member.arrivalDate)}</td>
<td>{formatDate(member.departureDate)}</td>
<td>{member.mealPlan || '—'}</td>
<td>{member.guestNotes || '—'}</td>
</tr>)}</tbody>
</table>
</div>
</>}</section>
<section className="detail-section operation-section">
<p className="eyebrow">ANDALUCÍA OPERATION</p>
<div className="booking-detail">
<span>Operational status</span>
<b>{optionLabel(configuration.statuses, booking.bookingStatus)}</b>
<span>Table</span>
<b>{optionLabel(configuration.tables, booking.tableNumber)}</b>
<span>Waiter</span>
<b>{booking.waiter ? `${booking.waiter.name} · ${booking.waiter.number}${booking.waiter.employmentStatus !== 'active' ? ' · Inactive' : ''}` : 'Unassigned'}</b>
<span>Manager operational notes</span>
<b>{booking.guestNotes || '—'}</b>
<span>Import provenance</span>
<b>{booking.importSource || 'Manual'}{booking.importedBatchId ? ` · Batch ${booking.importedBatchId}` : ''}</b>
<span>Created</span>
<b>{booking.createdAt ? new Date(booking.createdAt).toLocaleString() : '—'} by {booking.createdBy || '—'}</b>
<span>Updated</span>
<b>{booking.updatedAt ? new Date(booking.updatedAt).toLocaleString() : '—'} by {booking.updatedBy || '—'}</b>
</div>
</section>
</div>
</BookingModal>
}

export function BookingConfigurationManager({ configuration, onSave, onResetWalkIn }: { configuration: BookingConfiguration; onSave: (group: BookingConfigApiGroup, option: ConfigOption) => Promise<void>; onResetWalkIn: () => Promise<void> }) {
  const [editing, setEditing] = useState<{ group: 'statuses' | 'tableRanges'; option: ConfigOption } | null>(null)
  const [error, setError] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const changeFieldMode = async (option: ConfigOption, mode: WalkInFieldMode) => { setError(''); try { await onSave('walkInFields', { ...option, metadata: { ...option.metadata, walkInFieldMode: mode } }) } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to update the Walk-in form.') } }
  const toggle = async (group: 'statuses' | 'tableRanges', option: ConfigOption) => { setError(''); try { await onSave(group, { ...option, active: !option.active }) } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to update booking configuration.') } }
  return <section className="booking-config-r2">
<article className="panel booking-config-section status-config-section">
<div className="panel-title"><div><p className="eyebrow">SERVICE WORKFLOW</p><h3>Booking Statuses</h3></div><button className="secondary compact-config-action" onClick={() => setEditing({ group: 'statuses', option: { id: crypto.randomUUID(), value: '', label: '', color: '#1b6288', active: true, metadata: { serviceStage: 'remaining' } } })}>＋ Add Status</button></div>
<div className="booking-config-rows">{orderedBookingStatuses(configuration.statuses).map(option => { const protectedOption = Boolean(option.metadata?.protected); return <div className="booking-status-config-row" key={option.id}><span className="booking-config-swatch" style={{ background: option.color || '#dbe6ec' }} /><b>{option.label}</b><div className="booking-config-row-actions"><span className={`compact-state ${option.active ? 'active' : ''}`}>{option.active ? 'Active' : 'Inactive'}</span><button className="link compact-edit-action" onClick={() => setEditing({ group: 'statuses', option })}>Edit</button>{protectedOption ? <span className="protected-config" title="Protected operational status">Protected</span> : <ConfigArchiveButton active={option.active} label={`${option.label} status`} onClick={() => void toggle('statuses', option)} />}</div></div> })}</div>
</article>
<article className="panel booking-config-section table-range-section">
<div className="panel-title"><div><p className="eyebrow">RESTAURANT FLOOR</p><h3>Restaurant Table Ranges</h3></div><button className="secondary compact-config-action" onClick={() => setEditing({ group: 'tableRanges', option: { id: crypto.randomUUID(), value: '', label: '', active: true, metadata: { tableRangeStart: 1, tableRangeEnd: 9 } } })}>＋ Add Range</button></div>
<p className="config-section-intro">Ranges provide individual tables for assignment. Historical T01–T12 values remain unchanged.</p>
<div className="table-range-list">{(configuration.tableRanges || []).map(option => { const start = option.metadata?.tableRangeStart; const end = option.metadata?.tableRangeEnd; const protectedOption = Boolean(option.metadata?.protected || option.metadata?.systemControlled); return <div className="table-range-row" key={option.id}><span><b>{option.label}</b><small>{Number(start) && Number(end) ? Number(end) - Number(start) + 1 : 0} individual tables</small></span><div className="booking-config-row-actions"><span className={`compact-state ${option.active ? 'active' : ''}`}>{option.active ? 'Active' : 'Inactive'}</span><button className="link compact-edit-action" onClick={() => setEditing({ group: 'tableRanges', option })}>Edit</button>{protectedOption ? <span className="protected-config" title="Protected table range">Protected</span> : <ConfigArchiveButton active={option.active} label={`${option.label} range`} onClick={() => void toggle('tableRanges', option)} />}</div></div> })}</div>
</article>
<article className="panel booking-config-section walk-in-config-section">
<div className="panel-title"><div><p className="eyebrow">FAST SERVICE ENTRY</p><h3>Walk-in Guest Form</h3></div><button className="link reset-walk-in" onClick={() => setConfirmReset(true)}>Reset to Recommended Defaults</button></div>
<p className="config-section-intro">Choose which fields managers see when adding a Walk-In. Date, time, covers and meal period stay protected.</p>
<div className="walk-in-field-list">{(configuration.walkInFields || []).map(option => { const mode = option.metadata?.walkInFieldMode || 'hidden'; const protectedField = option.metadata?.protected; const system = option.metadata?.systemControlled; return <div className="walk-in-field-row" key={option.id}><span><b>{option.label}</b>{option.value === 'bookingSource' && <small>Walk-In</small>}{option.value === 'bookingStatus' && <small>Confirmed</small>}{option.value === 'bookedBy' && <small>Signed-in user</small>}</span>{system ? <span className="field-control-state system">System Controlled</span> : protectedField ? <span className="field-control-state protected">Required · Protected</span> : <div className="field-mode-control" role="group" aria-label={`${option.label} display requirement`}>{(['required', 'optional', 'hidden'] as WalkInFieldMode[]).map(value => <button type="button" key={value} className={mode === value ? 'selected' : ''} aria-pressed={mode === value} onClick={() => void changeFieldMode(option, value)}>{value}</button>)}</div>}</div> })}</div>
</article>
{error && <p className="save-error booking-config-error" role="alert">{error}</p>}
{editing && <BookingConfigForm group={editing.group} option={editing.option} onClose={() => setEditing(null)} onSave={async option => { await onSave(editing.group, option); setEditing(null) }} />}
{confirmReset && <div className="modal-backdrop nested-config-confirm"><section className="modal" role="dialog" aria-modal="true" aria-label="Reset Walk-in Guest Form"><button className="close" aria-label="Close" onClick={() => setConfirmReset(false)}>×</button><p className="eyebrow">WALK-IN GUEST FORM</p><h2>Reset field settings?</h2><p className="config-confirm-copy">This restores only the approved Required, Optional and Hidden field defaults. Bookings, sources, statuses and tables are not changed.</p><div className="form-actions"><button className="secondary" onClick={() => setConfirmReset(false)}>Cancel</button><button className="primary" onClick={() => void onResetWalkIn().then(() => setConfirmReset(false)).catch(saveError => { setConfirmReset(false); setError(saveError instanceof Error ? saveError.message : 'Unable to reset the Walk-in form.') })}>Reset Form Settings</button></div></section></div>}
</section>
}

function BookingConfigForm({ group, option, onClose, onSave }: { group: 'statuses' | 'tableRanges'; option: ConfigOption; onClose: () => void; onSave: (option: ConfigOption) => Promise<void> }) {
  const [form, setForm] = useState(option)
  const [advanced, setAdvanced] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const protectedStatus = group === 'statuses' && Boolean(form.metadata?.protected)
  const submit = async (event: FormEvent) => { event.preventDefault(); if (group === 'statuses' && (!form.value.trim() || !form.label.trim())) return setError('Status name and internal code are required.'); setSaving(true); setError(''); try { await onSave(group === 'statuses' ? { ...form, value: form.value.trim().toLowerCase().replaceAll(' ', '_'), label: form.label.trim() } : form) } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save configuration.') } finally { setSaving(false) } }
  return <BookingModal title={group === 'statuses' ? (option.value ? 'Edit Booking Status' : 'Add Booking Status') : (option.value ? 'Edit Table Range' : 'Add Table Range')} onClose={onClose}>
<form className="staff-form booking-config-form" onSubmit={event => void submit(event)}>
{group === 'statuses' ? <>
<label>Status Name<input value={form.label} onChange={event => setForm({ ...form, label: event.target.value })} /></label>
<label>Color<input type="color" disabled={protectedStatus} title={protectedStatus ? 'This operational color is protected.' : undefined} value={form.color || '#1b6288'} onChange={event => setForm({ ...form, color: event.target.value })} />{protectedStatus && <small>Protected operational color</small>}</label>
<label className="check-label"><input type="checkbox" disabled={protectedStatus} checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} /> Active</label>
<label>Internal Code<input readOnly={Boolean(option.value)} value={form.value} onChange={event => setForm({ ...form, value: event.target.value })} /><small>{option.value ? 'Immutable after creation' : 'Created once and retained for history'}</small></label>
<details open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)} className="booking-status-advanced"><summary>Advanced Operational Behavior</summary><label>Service Stage<select disabled={protectedStatus} value={form.metadata?.serviceStage || 'remaining'} onChange={event => setForm({ ...form, metadata: { ...form.metadata, serviceStage: event.target.value as NonNullable<ConfigOption['metadata']>['serviceStage'] } })}><option value="remaining">Remaining</option><option value="arrived">Arrived</option><option value="completed">Completed</option><option value="noShow">No-Show</option><option value="excluded">Excluded</option></select></label><label>Dashboard Metric<select disabled={protectedStatus} value={form.metadata?.bookingMetric || ''} onChange={event => setForm({ ...form, metadata: { ...form.metadata, bookingMetric: (event.target.value || undefined) as 'arrived' | 'noShow' | undefined } })}><option value="">None</option><option value="arrived">Arrived</option><option value="noShow">No-Shows</option></select></label><label className="check-label"><input type="checkbox" disabled={protectedStatus} checked={Boolean(form.metadata?.excludesFromExpectedCovers)} onChange={event => setForm({ ...form, metadata: { ...form.metadata, excludesFromExpectedCovers: event.target.checked } })} /> Exclude from expected covers</label>{protectedStatus && <small>Protected operational behavior</small>}</details>
</> : <div className="table-range-form"><label>First Table<input type="number" min="1" value={form.metadata?.tableRangeStart || ''} onChange={event => setForm({ ...form, metadata: { ...form.metadata, tableRangeStart: Number(event.target.value) } })} /></label><label>Last Table<input type="number" min="1" value={form.metadata?.tableRangeEnd || ''} onChange={event => setForm({ ...form, metadata: { ...form.metadata, tableRangeEnd: Number(event.target.value) } })} /></label><label className="check-label"><input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} /> Active</label></div>}
{error && <p className="save-error">{error}</p>}<div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
</form>
</BookingModal>
}

