import { useEffect, useMemo, useState } from 'react'
import { staffApi } from './api'
import type { LeaveClassification, LeavePlannerReadModel, LeavePlannerStaffRow, Staff } from './domain'
import { addCalendarMonths, calendarDates, serviceDate } from './service-date'
import { LeaveRecordsPanel } from './staff-leave'
import './leave-planner.css'

const labels: Record<LeaveClassification, string> = { annualLeave: 'Annual Leave', off: 'Day Off', publicHoliday: 'Public Holiday', sickLeave: 'Sick Leave' }
const displayDate = (value: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Indian/Maldives' }).format(new Date(`${value}T00:00:00Z`))
const readableText = (color?: string) => { const hex = color?.replace('#', '') || ''; if (!/^[0-9a-f]{6}$/i.test(hex)) return '#173d56'; const [r, g, b] = [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16)); return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#173d56' : '#fff' }

export function LeavePlannerPanel({ staff, initialStaffId }: { staff: Staff[]; initialStaffId?: string }) {
  const [view, setView] = useState<'planner' | 'history'>(initialStaffId ? 'history' : 'planner')
  useEffect(() => { if (initialStaffId) setView('history') }, [initialStaffId])
  return <div className="leave-planner-shell">
    <nav className="leave-planner-tabs" aria-label="Leave Planner views">
      <button className={view === 'planner' ? 'selected' : ''} aria-pressed={view === 'planner'} onClick={() => setView('planner')}>Planner</button>
      <button className={view === 'history' ? 'selected' : ''} aria-pressed={view === 'history'} onClick={() => setView('history')}>Leave History</button>
    </nav>
    {view === 'planner' ? <Planner /> : <LeaveRecordsPanel staff={staff} initialStaffId={initialStaffId} />}
  </div>
}

function Planner() {
  const today = serviceDate()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [staffId, setStaffId] = useState('all')
  const [type, setType] = useState<'all' | LeaveClassification>('all')
  const [model, setModel] = useState<LeavePlannerReadModel | null>(null)
  const [selected, setSelected] = useState<LeavePlannerStaffRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = async () => { setLoading(true); setError(''); try { setModel(await staffApi.leavePlanner(month)) } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load the Leave Planner.') } finally { setLoading(false) } }
  useEffect(() => { void load() }, [month])
  const dates = model ? calendarDates(model.startDate, model.endDate) : []
  const rows = useMemo(() => (model?.rows || []).filter(row => (staffId === 'all' || row.staffId === staffId) && (type === 'all' || row.days.some(day => day.classification === type))), [model, staffId, type])
  const periods = useMemo(() => rows.flatMap(row => row.periods.filter(period => type === 'all' || period.leaveType === type).map(period => ({ row, period }))), [rows, type])
  const setMonthPart = (part: 'year' | 'month', value: string) => setMonth(current => part === 'year' ? `${value}-${current.slice(5)}` : `${current.slice(0, 4)}-${value}`)
  const shift = (value: number) => setMonth(addCalendarMonths(`${month}-01`, value).slice(0, 7))
  const monthTitle = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`))
  return <section className="panel leave-planner-panel">
    <header className="leave-planner-header"><div><p className="eyebrow">CONFIRMED ROSTER AVAILABILITY</p><h2>Leave Planner</h2><p>Confirmed status is derived from Duty Roster and approved Andalucía Team Membership.</p></div><span className="leave-confirmed-chip">Duty Roster confirmed</span></header>
    <div className="leave-month-navigation"><button className="secondary" aria-label="Previous month" onClick={() => shift(-1)}>← Previous</button><strong>{monthTitle}</strong><button className="secondary" aria-label="Next month" onClick={() => shift(1)}>Next →</button><button className="link" onClick={() => setMonth(today.slice(0, 7))}>Today</button></div>
    <div className="leave-planner-filters">
      <label>Year<select value={month.slice(0, 4)} onChange={event => setMonthPart('year', event.target.value)}>{Array.from({ length: 9 }, (_, index) => Number(today.slice(0, 4)) - 4 + index).map(year => <option key={year}>{year}</option>)}</select></label>
      <label>Month<select value={month.slice(5)} onChange={event => setMonthPart('month', event.target.value)}>{Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')).map(value => <option key={value} value={value}>{new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(`2026-${value}-01T00:00:00Z`))}</option>)}</select></label>
      <label>Staff<select value={staffId} onChange={event => setStaffId(event.target.value)}><option value="all">All approved members</option>{model?.rows.map(row => <option key={row.staffId} value={row.staffId}>{row.staffName} · {row.staffNumber}</option>)}</select></label>
      <label>Leave / status<select value={type} onChange={event => setType(event.target.value as typeof type)}><option value="all">AL, OFF, PH and SK</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    {model?.membershipBlocker && <p className="leave-review-warning" role="status">Team Membership evidence is unavailable for this period: {model.membershipBlocker.replaceAll('_', ' ')}. No historical membership has been assumed.</p>}
    {loading ? <p className="leave-state">Loading confirmed roster availability…</p> : error ? <div className="inline-state error-state"><p>{error}</p><button className="secondary" onClick={() => void load()}>Try again</button></div> : model && <>
      <div className="leave-planner-grid-wrap" tabIndex={0} aria-label={`${monthTitle} leave planner calendar`}><table className="leave-planner-grid"><thead><tr><th className="identity staff">Staff</th><th className="identity employee">Employee ID</th><th className="identity designation">Designation</th>{dates.map((date, index) => { const availability = model.availability[index]; return <th className={date === today ? 'today' : ''} key={date} title={`${availability.unavailable} unavailable, ${availability.scheduledWorking} scheduled working, ${availability.unassigned} unassigned`}><span>{Number(date.slice(8))}</span><small>{availability.unavailable}/{availability.members}</small></th> })}</tr></thead><tbody>{rows.map(row => <tr key={row.staffId}><th className="identity staff"><button className="leave-staff-link" onClick={() => setSelected(row)}>{row.staffName}</button></th><td className="identity employee">{row.staffNumber}</td><td className="identity designation">{row.designation}</td>{dates.map(date => { const day = row.days.find(item => item.date === date); const visible = day && (type === 'all' || day.classification === type); const inMembership = row.membershipStart <= date && row.membershipEnd >= date; return <td className={`${date === today ? 'today ' : ''}${inMembership ? '' : 'outside-membership'}`} key={date}>{visible && <span className="leave-day-code" style={{ backgroundColor: day.color, color: readableText(day.color) }} title={`${day.dutyCode} · ${day.dutyLabel} · confirmed by Duty Roster`}>{day.dutyCode}</span>}</td>})}</tr>)}</tbody><tfoot><tr><th className="identity staff">Unavailable</th><td className="identity employee" /><td className="identity designation">Confirmed / members</td>{model.availability.map(day => <td key={day.date}><b>{day.unavailable}</b><small>/{day.members}</small></td>)}</tr></tfoot></table></div>
      <div className="leave-planner-legend" aria-label="Leave Planner legend">{model.dutyCodes.filter(option => ['annualLeave', 'off', 'publicHoliday', 'sickLeave'].includes(option.metadata?.dutyClassification || '')).map(option => <span key={option.id}><i style={{ backgroundColor: option.color }} />{option.metadata?.displayCode || option.value} · {option.label}{option.active ? '' : ' · Historical'}</span>)}</div>
      <div className="leave-planner-mobile" aria-label={`${monthTitle} confirmed absence periods`}>{periods.map(({ row, period }) => <article key={period.id}><header><div><button className="leave-staff-link" onClick={() => setSelected(row)}>{row.staffName}</button><small>{row.designation} · {row.staffNumber}</small></div><span className="leave-type-chip" style={{ borderColor: period.color }}>{period.sourceDutyCode}</span></header><h3>{labels[period.leaveType]}</h3><p>{displayDate(period.fromDate)} – {displayDate(period.toDate)}</p><dl><div><dt>Entitlement days</dt><dd>{period.entitlementDays}</dd></div><div><dt>Calendar span</dt><dd>{period.totalDays}</dd></div><div><dt>AL remaining</dt><dd>{row.entitlement.annualLeave.remaining}</dd></div><div><dt>Source</dt><dd>Duty Roster</dd></div></dl><button className="secondary" onClick={() => setSelected(row)}>View source days</button></article>)}</div>
      {!rows.length && <p className="inline-empty">No approved Team Membership rows match these filters.</p>}
      {rows.length > 0 && periods.length === 0 && <p className="leave-mobile-empty">No confirmed AL, OFF, PH or SK periods match this phone view.</p>}
    </>}
    {selected && <LeavePlannerStaffDrawer row={selected} year={Number(month.slice(0, 4))} onClose={() => setSelected(null)} />}
  </section>
}

function LeavePlannerStaffDrawer({ row, year, onClose }: { row: LeavePlannerStaffRow; year: number; onClose: () => void }) {
  return <div className="staff-profile-overlay"><aside className="staff-profile-drawer leave-planner-drawer" role="dialog" aria-modal="true" aria-label={`Leave Planner details for ${row.staffName}`}><button className="close" aria-label="Close Leave Planner details" onClick={onClose}>×</button><header><p className="eyebrow">CONFIRMED LEAVE &amp; AVAILABILITY</p><h2>{row.staffName}</h2><span>{row.staffNumber} · {row.designation}</span></header><section><dl className="staff-profile-grid"><div><dt>Membership period</dt><dd>{displayDate(row.membershipStart)} – {displayDate(row.membershipEnd)}</dd></div><div><dt>Membership evidence</dt><dd>{row.membershipReviewStatus === 'approved' ? 'Approved' : 'Review required'}</dd></div><div><dt>AL entitlement</dt><dd>{row.entitlement.annualLeave.entitlement}</dd></div><div><dt>AL used · {year}</dt><dd>{row.entitlement.annualLeave.used}</dd></div><div><dt>AL remaining</dt><dd>{row.entitlement.annualLeave.remaining}</dd></div><div><dt>Entitlement source</dt><dd>{row.entitlement.persisted ? 'Staff-specific' : 'Configured default'}</dd></div><div><dt>OFF in selected month</dt><dd>{row.entitlement.offAssignedInMonth}</dd></div><div><dt>Weekly OFF entitlement</dt><dd>{row.entitlement.weeklyOff.required}</dd></div><div><dt>PH entitlement</dt><dd>{row.entitlement.publicHoliday.entitlement}</dd></div><div><dt>PH used · {year}</dt><dd>{row.entitlement.publicHoliday.used}</dd></div><div><dt>PH remaining</dt><dd>{row.entitlement.publicHoliday.remaining}</dd></div></dl></section><section><p className="eyebrow">CONFIRMED PERIODS</p><div className="leave-planner-period-list">{row.periods.map(period => <article key={period.id}><span className="leave-type-chip" style={{ borderColor: period.color }}>{period.sourceDutyCode}</span><div><b>{labels[period.leaveType]}</b><small>{displayDate(period.fromDate)} – {displayDate(period.toDate)}</small></div><dl><div><dt>Entitlement</dt><dd>{period.entitlementDays}</dd></div><div><dt>Calendar</dt><dd>{period.totalDays}</dd></div></dl></article>)}</div>{!row.periods.length && <p className="inline-empty">No confirmed absence periods in this month.</p>}</section><section><p className="eyebrow">SOURCE DAYS</p><div className="leave-daily-list">{row.days.map(day => <div key={day.date}><time>{displayDate(day.date)}</time><b>{day.dutyCode}</b><span>{day.dutyLabel}</span></div>)}</div></section></aside></div>
}
