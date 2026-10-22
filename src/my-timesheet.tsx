import { useEffect, useMemo, useState } from 'react'
import { timesheetApi } from './api'
import type { TimesheetDayInput, TimesheetDayView, TimesheetMonthView } from './domain'
import { serviceDate } from './service-date'
import { ActionButton, DateControl, StatusPill, SvgIcon } from './action-system'
import { timesheetConfirmationPresentation, timesheetIsReadOnlyNonWorkingDay, timesheetShiftPresentation } from './timesheet-presentation'

const fromDay = (day: TimesheetDayView): TimesheetDayInput => ({ firstShift: { ...day.firstShift }, secondShift: { ...day.secondShift }, overtime: { duration: day.overtime.duration === '00:00' ? '' : day.overtime.duration, expectedRevision: day.overtime.revision } })
const hours = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
const previewTotal = (input: TimesheetDayInput) => {
  const segments = [input.firstShift, input.secondShift].flatMap(shift => {
    if (!shift.timeIn || !shift.timeOut) return []
    const toMinute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))
    const start = toMinute(shift.timeIn); let end = toMinute(shift.timeOut); if (end <= start) end += 1440
    return [{ start, end }]
  })
  if (segments.length === 2) { while (segments[1].start < segments[0].start) { segments[1].start += 1440; segments[1].end += 1440 }; if (segments[1].start < segments[0].end) return null }
  const total = segments.reduce((sum, shift) => sum + shift.end - shift.start, 0)
  return total <= 1440 ? total : null
}
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(new Date(`${date}T00:00:00Z`))
const formatTimeEntry = (value: string) => { const digits = value.replace(/\D/g, '').slice(0, 4); return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}` }
const timeEntryError = (value: string | null) => value && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? 'Enter a valid 24-hour time (HH:mm).' : ''
const overtimeEntryError = (value: string | undefined) => {
  const normalized = value?.trim() || '00:00'; const match = normalized.match(/^(\d{2}):([0-5]\d)$/)
  if (!match) return 'Enter OT as HH:mm, from 00:00 to 02:00.'
  return Number(match[1]) * 60 + Number(match[2]) > 120 ? 'Manual OT cannot exceed 02:00 per day.' : ''
}
type TimeFieldKey = 'firstShift.timeIn' | 'firstShift.timeOut' | 'secondShift.timeIn' | 'secondShift.timeOut'

function TimeEntryField({ id, label, accessibleLabel, value, disabled, error, onChange, onBlur }: { id: string; label: string; accessibleLabel: string; value: string | null; disabled: boolean; error: string; onChange: (value: string) => void; onBlur: () => void }) {
  const errorId = `${id}-error`
  return <label className="timesheet-time-field" htmlFor={id}><span>{label}</span><input id={id} className="timesheet-time-input" type="text" inputMode="numeric" pattern="[0-9:]*" maxLength={5} autoComplete="off" placeholder="HH:mm" aria-label={accessibleLabel} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} value={value || ''} disabled={disabled} onChange={event => onChange(formatTimeEntry(event.target.value))} onBlur={onBlur}/>{error && <small id={errorId} className="timesheet-time-error" role="alert">{error}</small>}</label>
}

function DayEntry({ day, onChanged }: { day: TimesheetDayView; onChanged: (day: TimesheetDayView) => void }) {
  const [form, setForm] = useState<TimesheetDayInput>(() => fromDay(day)); const [saving, setSaving] = useState(false); const [message, setMessage] = useState(''); const [expanded, setExpanded] = useState(false); const [touchedTimes, setTouchedTimes] = useState<Set<TimeFieldKey>>(() => new Set()); const [overtimeTouched, setOvertimeTouched] = useState(false)
  const totalPreview = useMemo(() => previewTotal(form), [form])
  useEffect(() => { setForm(fromDay(day)); setTouchedTimes(new Set()); setOvertimeTouched(false) }, [day])
  const setTime = (shift: 'firstShift' | 'secondShift', key: 'timeIn' | 'timeOut', value: string) => setForm(current => ({ ...current, [shift]: { ...current[shift], [key]: value || null } }))
  const setOvertime = (value: string) => setForm(current => ({ ...current, overtime: { duration: value, expectedRevision: day.overtime.revision } }))
  const fieldValue = (field: TimeFieldKey) => { const [shift, key] = field.split('.') as ['firstShift' | 'secondShift', 'timeIn' | 'timeOut']; return form[shift][key] }
  const visibleTimeError = (field: TimeFieldKey) => touchedTimes.has(field) ? timeEntryError(fieldValue(field)) : ''
  const touchTime = (field: TimeFieldKey) => setTouchedTimes(current => new Set(current).add(field))
  const overtimeError = overtimeEntryError(form.overtime?.duration)
  const save = async (confirm: boolean) => { const fields: TimeFieldKey[] = ['firstShift.timeIn', 'firstShift.timeOut', 'secondShift.timeIn', 'secondShift.timeOut']; const invalid = fields.filter(field => timeEntryError(fieldValue(field))); if (invalid.length || overtimeError) { setTouchedTimes(current => new Set([...current, ...invalid])); setOvertimeTouched(true); setMessage('Correct the highlighted time fields before saving.'); return } setSaving(true); setMessage(''); try { const saved = confirm ? await timesheetApi.confirmDay(day.date, form) : await timesheetApi.saveDraft(day.date, form); onChanged(saved); setMessage(confirm ? 'Day confirmed.' : 'Draft saved.') } catch (error) { setMessage(error instanceof Error ? error.message : 'The timesheet day could not be saved.') } finally { setSaving(false) } }
  const detailsId = `timesheet-day-${day.date}`
  const presentationDay = { ...day, firstShift: form.firstShift, secondShift: form.secondShift, totalMinutes: totalPreview ?? day.totalMinutes }
  const firstShiftSummary = timesheetShiftPresentation(presentationDay, 'firstShift').text
  const secondShiftSummary = timesheetShiftPresentation(presentationDay, 'secondShift').text
  const confirmation = timesheetConfirmationPresentation(day)
  const overtimeTone = day.overtime.status === 'approved' ? 'success' : day.overtime.status === 'rejected' ? 'danger' : 'gold'
  if (timesheetIsReadOnlyNonWorkingDay(day)) return <article className={`timesheet-day timesheet-day-readonly${day.state === 'confirmed' ? ' confirmed' : ''}`} aria-label={`${day.date}, ${day.scheduledDuty!.code}, ${confirmation.label}, zero working hours`}>
    <span className="timesheet-day-date"><b>{day.weekday}</b><span>{dateLabel(day.date)}</span></span>
    <span className="timesheet-duty" style={{ borderColor: day.scheduledDuty!.color || undefined }}><b>{day.scheduledDuty!.code}</b><span>{day.scheduledDuty!.name}</span></span>
    <span className="timesheet-day-total"><small>Total</small><b>0h 00m</b></span>
    <span className="timesheet-day-state"><StatusPill tone={confirmation.state === 'confirmed' ? 'success' : confirmation.state === 'draft' ? 'gold' : 'neutral'} className={`timesheet-state ${confirmation.state}`}>{confirmation.label}</StatusPill></span>
  </article>
  return <article className={`timesheet-day${day.state === 'confirmed' ? ' confirmed' : ''}${day.rosterConflict ? ' roster-conflict' : ''}`}>
    <button type="button" className="timesheet-day-toggle" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(current => !current)}>
      <span className="timesheet-day-date"><b>{day.weekday}</b><span>{dateLabel(day.date)}</span></span>
      {day.scheduledDuty ? <span className="timesheet-duty" style={{ borderColor: day.scheduledDuty.color || undefined }}><b>{day.scheduledDuty.code}</b><span>{day.scheduledDuty.name}</span>{day.rosterConflict && <em>Recorded work · review</em>}</span> : <span className="timesheet-duty unassigned"><b>—</b><span>No roster assignment</span></span>}
      <span className="timesheet-day-shifts"><small>Recorded shifts</small><b>{firstShiftSummary}<i>/</i>{secondShiftSummary}</b></span>
      <span className="timesheet-day-total"><small>Total</small><b>{totalPreview === null ? 'Check times' : hours(totalPreview)}</b></span>
      <span className="timesheet-day-ot"><small>Manual OT</small><b>{form.overtime?.duration || '00:00'}</b>{day.overtime.status && <StatusPill tone={overtimeTone} className={`timesheet-overtime-status ${day.overtime.status}`}>{day.overtime.status}</StatusPill>}</span>
      <span className="timesheet-day-state"><StatusPill tone={confirmation.state === 'confirmed' ? 'success' : confirmation.state === 'draft' ? 'gold' : 'neutral'} className={`timesheet-state ${confirmation.state}`}>{confirmation.label}</StatusPill><span className="timesheet-toggle-label">{expanded ? 'Collapse' : day.editable ? 'Review / edit' : 'Review'}</span><SvgIcon name={expanded ? 'chevron-left' : 'chevron-right'} size={18}/></span>
    </button>
    {expanded && <div id={detailsId} className="timesheet-day-details">
      {day.rosterConflict && <p className="timesheet-roster-warning" role="status"><b>Rostered as {day.scheduledDuty?.code} · {day.scheduledDuty?.name}.</b> Recorded working hours are preserved and flagged for manager review. This does not change the Duty Roster assignment.</p>}
      <div className="timesheet-shifts">
        <fieldset><legend>First shift</legend><TimeEntryField id={`${day.date}-first-in`} label="Time In" accessibleLabel="First shift time in, 24-hour HH:mm" value={form.firstShift.timeIn} disabled={!day.editable || saving} error={visibleTimeError('firstShift.timeIn')} onChange={value => setTime('firstShift', 'timeIn', value)} onBlur={() => touchTime('firstShift.timeIn')} /><TimeEntryField id={`${day.date}-first-out`} label="Time Out" accessibleLabel="First shift time out, 24-hour HH:mm" value={form.firstShift.timeOut} disabled={!day.editable || saving} error={visibleTimeError('firstShift.timeOut')} onChange={value => setTime('firstShift', 'timeOut', value)} onBlur={() => touchTime('firstShift.timeOut')} /></fieldset>
        <fieldset><legend>Second shift <small>Optional</small></legend><TimeEntryField id={`${day.date}-second-in`} label="Time In" accessibleLabel="Second shift time in, 24-hour HH:mm" value={form.secondShift.timeIn} disabled={!day.editable || saving} error={visibleTimeError('secondShift.timeIn')} onChange={value => setTime('secondShift', 'timeIn', value)} onBlur={() => touchTime('secondShift.timeIn')} /><TimeEntryField id={`${day.date}-second-out`} label="Time Out" accessibleLabel="Second shift time out, 24-hour HH:mm" value={form.secondShift.timeOut} disabled={!day.editable || saving} error={visibleTimeError('secondShift.timeOut')} onChange={value => setTime('secondShift', 'timeOut', value)} onBlur={() => touchTime('secondShift.timeOut')} /></fieldset>
      </div>
      <div className="timesheet-overtime-entry"><label>Manual OT <span>HH:mm · maximum 02:00</span><input type="text" inputMode="numeric" pattern="[0-9:]*" maxLength={5} autoComplete="off" placeholder="00:00" aria-label="Manual overtime duration, HH:mm" aria-invalid={overtimeTouched && Boolean(overtimeError)} aria-describedby={overtimeTouched && overtimeError ? `${day.date}-overtime-error` : undefined} value={form.overtime?.duration || ''} disabled={!day.overtime.editable || saving} onChange={event => setOvertime(formatTimeEntry(event.target.value))} onBlur={() => setOvertimeTouched(true)} /></label>{overtimeTouched && overtimeError && <small id={`${day.date}-overtime-error`} className="timesheet-time-error" role="alert">{overtimeError}</small>}{day.overtime.status && <StatusPill tone={overtimeTone} className={`timesheet-overtime-status ${day.overtime.status}`}>{day.overtime.status}</StatusPill>}{day.overtime.status === 'rejected' && day.overtime.rejectionReason && <small className="timesheet-overtime-reason">{day.overtime.rejectionReason}</small>}{day.overtime.status === 'approved' && <small className="timesheet-overtime-reason">Approved OT · manager-controlled.</small>}</div>
      <footer><div><small>Total working hours <em>verified by the server when saved</em></small><strong>{totalPreview === null ? 'Check shift times' : hours(totalPreview)}</strong></div>{day.editable && <div className="timesheet-actions"><ActionButton icon="save" disabled={saving} onClick={() => void save(false)}>Save Draft</ActionButton><ActionButton variant="primary" icon="check" disabled={saving} onClick={() => void save(true)}>Confirm Day</ActionButton></div>}</footer>
      {day.state === 'confirmed' && day.editable && <p className="timesheet-correction-note">Corrections remain available until month-end. Saving a correction preserves the previous confirmed values in the audit history.</p>}
      {message && <p className={message.endsWith('.') && !/could not|required|invalid|overlap|locked/i.test(message) ? 'timesheet-message' : 'timesheet-message error'} role="status">{message}</p>}
    </div>}
  </article>
}

export function MyTimesheetPage() {
  const [month, setMonth] = useState(serviceDate().slice(0, 7)); const [view, setView] = useState<TimesheetMonthView | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [submitting, setSubmitting] = useState(false)
  useEffect(() => { let active = true; setLoading(true); setError(''); void timesheetApi.month(month).then(result => { if (active) setView(result) }).catch(loadError => { if (active) { setView(null); setError(loadError instanceof Error ? loadError.message : 'My Timesheet could not be loaded.') } }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [month])
  const totals = useMemo(() => ({ minutes: view?.days.reduce((sum, day) => sum + day.totalMinutes, 0) || 0, confirmed: view?.days.filter(day => day.state === 'confirmed').length || 0 }), [view])
  const changed = (day: TimesheetDayView) => setView(current => current ? { ...current, days: current.days.map(item => item.date === day.date ? day : item) } : current)
  const submitMonth = async () => { if (!view || submitting) return; setSubmitting(true); setError(''); try { await timesheetApi.submitMonth(month); setView({ ...view, status: 'submitted', locked: true }) } catch (submitError) { setError(submitError instanceof Error ? submitError.message : 'The month could not be submitted.') } finally { setSubmitting(false) } }
  return <section className="my-timesheet">
    <header className="timesheet-hero"><div><p className="eyebrow">EMPLOYEE TIMESHEET</p><h2>{view?.staff.name || 'Employee Timesheet'}</h2>{view && <p>{view.staff.number}</p>}</div><label>Selected month<DateControl type="month" label="Selected timesheet month" value={month} onChange={event => setMonth(event.target.value)} /></label></header>
    {error && <p className="save-error" role="alert">{error}</p>}{loading && <div className="panel timesheet-loading">Loading your roster and timesheet…</div>}
    {view && !loading && <><div className="timesheet-summary"><span><small>Recorded hours</small><b>{hours(totals.minutes)}</b></span><span><small>Confirmed days</small><b>{totals.confirmed}</b></span><span><small>Month status</small><b>{view.status === 'open' ? 'In Progress' : view.status[0].toUpperCase() + view.status.slice(1)}</b></span></div>{view.locked && <p className="timesheet-lock-note">This month is closed. A manager must reopen it before corrections can be saved.</p>}<div className="timesheet-days">{view.days.map(day => <DayEntry key={day.date} day={day} onChanged={changed} />)}</div>{view.status === 'open' && !view.locked && <div className="timesheet-submit"><ActionButton variant="primary" icon="check" disabled={submitting} onClick={() => void submitMonth()}>{submitting ? 'Submitting…' : 'Submit Month'}</ActionButton><small>Submission locks employee editing until a manager reopens the month.</small></div>}</>}
  </section>
}
