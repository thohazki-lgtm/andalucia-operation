import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { staffApi } from './api'
import type { PublicHoliday, StaffEntitlement, StaffEntitlementBalance } from './domain'
import { addCalendarDays, serviceDate } from './service-date'
import './workforce.css'

const displayDate = (value: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Indian/Maldives' }).format(new Date(`${value}T00:00:00Z`))

export function StaffEntitlementsManager() {
  const [items, setItems] = useState<StaffEntitlement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<StaffEntitlement | null>(null)
  const [viewing, setViewing] = useState<StaffEntitlement | null>(null)
  const load = async () => { setLoading(true); setError(''); try { setItems(await staffApi.entitlements()) } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load staff entitlements.') } finally { setLoading(false) } }
  useEffect(() => { void load() }, [])
  const visible = items.filter(item => showInactive || item.employmentStatus === 'active')
  const saved = async (item: StaffEntitlement) => { const result = await staffApi.saveEntitlement(item); setItems(current => current.map(existing => existing.staffId === result.staffId ? result : existing)); setEditing(null) }
  return <article className="panel workforce-foundation-panel staff-entitlements-panel">
    <div className="panel-title workforce-section-title"><div><p className="eyebrow">ALLOWANCE SETTINGS</p><h3>Staff Entitlements</h3><p>Recurring allowances linked to the shared Staff Management record.</p></div><label className="workforce-check"><input type="checkbox" checked={showInactive} onChange={event => setShowInactive(event.target.checked)} /> Show inactive staff</label></div>
    {error && <p className="save-error" role="alert">{error}</p>}
    {loading ? <p className="workforce-loading">Loading staff entitlements…</p> : <>
      <div className="workforce-table-wrap"><table className="workforce-table entitlement-table" aria-label="Staff entitlement settings"><thead><tr><th>Staff ID</th><th>Staff Name</th><th>Annual Leave / Year</th><th>Weekly OFF</th><th>PH / Year</th><th>Status</th><th>Action</th></tr></thead><tbody>{visible.map(item => <tr key={item.staffId}><td><b>{item.staffNumber}</b></td><td>{item.staffName}</td><td>{item.annualLeavePerYear}</td><td>{item.weeklyOffEntitlement}</td><td>{item.publicHolidayPerYear}</td><td><span className={item.employmentStatus === 'active' ? 'badge blue' : 'badge'}>{item.employmentStatus === 'active' ? 'Active' : 'Inactive'}</span></td><td><button className="link" onClick={() => setViewing(item)}>View Balance</button><button className="link" onClick={() => setEditing(item)}>Edit</button></td></tr>)}</tbody></table></div>
      <div className="workforce-mobile-cards" aria-label="Staff entitlement settings mobile view">{visible.map(item => <article className="workforce-record-card" key={item.staffId}><header><div><b>{item.staffName}</b><small>{item.staffNumber}</small></div><span className={item.employmentStatus === 'active' ? 'badge blue' : 'badge'}>{item.employmentStatus === 'active' ? 'Active' : 'Inactive'}</span></header><dl><div><dt>Annual Leave / Year</dt><dd>{item.annualLeavePerYear}</dd></div><div><dt>Weekly OFF</dt><dd>{item.weeklyOffEntitlement}</dd></div><div><dt>PH / Year</dt><dd>{item.publicHolidayPerYear}</dd></div></dl><div className="workforce-card-actions"><button className="secondary" onClick={() => setViewing(item)}>View Balance</button><button className="secondary" onClick={() => setEditing(item)}>Edit</button></div></article>)}</div>
      {!visible.length && <p className="workforce-empty">No staff match this view.</p>}
    </>}
    {editing && <EntitlementForm item={editing} onClose={() => setEditing(null)} onSave={saved} />}
    {viewing && <EntitlementBalanceDialog item={viewing} onClose={() => setViewing(null)} />}
  </article>
}

function EntitlementForm({ item, onClose, onSave }: { item: StaffEntitlement; onClose: () => void; onSave: (item: StaffEntitlement) => Promise<void> }) {
  const [form, setForm] = useState(item)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); const values = [form.annualLeavePerYear, form.weeklyOffEntitlement, form.publicHolidayPerYear]; if (values.some(value => !Number.isInteger(value) || value < 0)) return setError('Entitlement values must be whole numbers of zero or more.'); try { setError(''); await onSave(form) } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save staff entitlements.') } }
  const numeric = (key: 'annualLeavePerYear' | 'weeklyOffEntitlement' | 'publicHolidayPerYear', value: string) => setForm(current => ({ ...current, [key]: Number(value) }))
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="entitlement-title"><button className="close" aria-label="Close" onClick={onClose}>×</button><h2 id="entitlement-title">Edit Staff Entitlements</h2><p className="workforce-modal-person"><b>{item.staffName}</b><span>{item.staffNumber}</span></p><form className="staff-form" onSubmit={event => void submit(event)}><label>Annual Leave / Year<input required type="number" min="0" step="1" value={form.annualLeavePerYear} onChange={event => numeric('annualLeavePerYear', event.target.value)} /></label><label>Weekly OFF entitlement<input required type="number" min="0" step="1" value={form.weeklyOffEntitlement} onChange={event => numeric('weeklyOffEntitlement', event.target.value)} /></label><label>Public Holiday / Year<input required type="number" min="0" step="1" value={form.publicHolidayPerYear} onChange={event => numeric('publicHolidayPerYear', event.target.value)} /></label>{error && <p className="save-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary">Save Entitlements</button></div></form></section></div>
}

function EntitlementBalanceDialog({ item, onClose }: { item: StaffEntitlement; onClose: () => void }) {
  const today = serviceDate()
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [weekDate, setWeekDate] = useState(today)
  const [balance, setBalance] = useState<StaffEntitlementBalance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { let current = true; setLoading(true); setError(''); void staffApi.entitlementBalance(item.staffId, year, weekDate).then(result => { if (current) setBalance(result) }).catch(loadError => { if (current) setError(loadError instanceof Error ? loadError.message : 'Unable to calculate entitlement balances.') }).finally(() => { if (current) setLoading(false) }); return () => { current = false } }, [item.staffId, year, weekDate])
  const stateLabel = balance?.weeklyOff.status === 'short' ? `Short by ${Math.abs(balance.weeklyOff.difference)}` : balance?.weeklyOff.status === 'additional' ? `${balance.weeklyOff.difference} additional OFF` : 'Compliant'
  return <div className="modal-backdrop" role="presentation"><section className="modal entitlement-balance-modal" role="dialog" aria-modal="true" aria-labelledby="balance-title"><button className="close" aria-label="Close" onClick={onClose}>×</button><h2 id="balance-title">Entitlement Balance</h2><p className="workforce-modal-person"><b>{item.staffName}</b><span>{item.staffNumber}</span></p><div className="balance-controls"><label>Selected Year<input aria-label="Entitlement balance year" type="number" min="1900" max="2200" step="1" value={year} onChange={event => { const next = Number(event.target.value); if (Number.isInteger(next) && next >= 1900 && next <= 2200) setYear(next) }} /></label><label>Week containing<input aria-label="Entitlement balance week" type="date" value={weekDate} onChange={event => setWeekDate(event.target.value)} /></label></div>{error && <p className="save-error" role="alert">{error}</p>}{loading || !balance ? <p className="workforce-loading">Calculating balances…</p> : <><div className="balance-annual-grid"><article><span>Annual Leave</span><dl><div><dt>Entitlement</dt><dd>{balance.annualLeave.entitlement}</dd></div><div><dt>Used</dt><dd>{balance.annualLeave.used}</dd></div><div><dt>Remaining</dt><dd>{balance.annualLeave.remaining}</dd></div></dl></article><article><span>Public Holiday</span><dl><div><dt>Entitlement</dt><dd>{balance.publicHoliday.entitlement}</dd></div><div><dt>Used</dt><dd>{balance.publicHoliday.used}</dd></div><div><dt>Remaining</dt><dd>{balance.publicHoliday.remaining}</dd></div></dl></article></div><article className={`weekly-balance ${balance.weeklyOff.status}`}><div><span>Weekly OFF</span><small>{displayDate(balance.weeklyOff.weekStart)} – {displayDate(balance.weeklyOff.weekEnd)}</small></div><dl><div><dt>Required</dt><dd>{balance.weeklyOff.required}</dd></div><div><dt>Assigned</dt><dd>{balance.weeklyOff.assigned}</dd></div><div><dt>Difference</dt><dd>{balance.weeklyOff.difference > 0 ? '+' : ''}{balance.weeklyOff.difference}</dd></div><div><dt>Status</dt><dd>{stateLabel}</dd></div></dl></article></>}<div className="balance-week-actions"><button className="secondary" onClick={() => setWeekDate(value => addCalendarDays(value, -7))}>← Previous Week</button><button className="secondary" onClick={() => setWeekDate(today)}>Current Week</button><button className="secondary" onClick={() => setWeekDate(value => addCalendarDays(value, 7))}>Next Week →</button></div></section></div>
}

export function PublicHolidaySettingsManager() {
  const currentYear = Number(serviceDate().slice(0, 4))
  const [year, setYear] = useState(currentYear)
  const [items, setItems] = useState<PublicHoliday[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<PublicHoliday | null>(null)
  const load = async (selectedYear: number) => { setLoading(true); setError(''); try { setItems(await staffApi.publicHolidays(selectedYear)) } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load public holidays.') } finally { setLoading(false) } }
  useEffect(() => { void load(year) }, [year])
  const activeDays = useMemo(() => items.filter(item => item.active).reduce((total, item) => total + item.days, 0), [items])
  const saved = async (holiday: PublicHoliday) => { const result = items.some(item => item.id === holiday.id) ? await staffApi.updatePublicHoliday(holiday) : await staffApi.createPublicHoliday(holiday); if (Number(result.date.slice(0, 4)) === year) setItems(current => current.some(item => item.id === result.id) ? current.map(item => item.id === result.id ? result : item) : [...current, result].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))); else setItems(current => current.filter(item => item.id !== result.id)); setEditing(null) }
  const remove = async (holiday: PublicHoliday) => { if (!window.confirm(`Remove ${holiday.name} on ${displayDate(holiday.date)}?`)) return; try { setError(''); await staffApi.removePublicHoliday(holiday.id); setItems(current => current.filter(item => item.id !== holiday.id)) } catch (removeError) { setError(removeError instanceof Error ? removeError.message : 'Unable to remove the public holiday.') } }
  return <article className="panel workforce-foundation-panel public-holidays-panel">
    <div className="panel-title workforce-section-title"><div><p className="eyebrow">ANNUAL CALENDAR</p><h3>Public Holiday Settings</h3><p>Exact annual calendar dates, managed separately from individual staff entitlement allowances.</p></div><button className="primary" onClick={() => setEditing({ id: crypto.randomUUID(), name: '', date: `${year}-01-01`, days: 1, active: true })}>＋ Add Holiday</button></div>
    <div className="holiday-command"><label>Calendar year<input aria-label="Public holiday year" type="number" min="1900" max="2200" step="1" value={year} onChange={event => { const next = Number(event.target.value); if (Number.isInteger(next) && next >= 1900 && next <= 2200) setYear(next) }} /></label><div><span>Active PH calendar days</span><strong>{activeDays}</strong><small>Calendar total only — staff PH entitlement remains separate.</small></div></div>
    {error && <p className="save-error" role="alert">{error}</p>}
    {loading ? <p className="workforce-loading">Loading public holidays…</p> : <>
      <div className="workforce-table-wrap"><table className="workforce-table holiday-table" aria-label="Public holiday settings"><thead><tr><th>Holiday Name</th><th>Date</th><th>Days</th><th>Status</th><th>Action</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><b>{item.name}</b></td><td>{displayDate(item.date)}</td><td>{item.days}</td><td><span className={item.active ? 'badge blue' : 'badge'}>{item.active ? 'Active' : 'Inactive'}</span></td><td><button className="link" onClick={() => setEditing(item)}>Edit</button><button className="icon-action remove-action" aria-label={`Remove ${item.name}`} title="Remove Holiday" onClick={() => void remove(item)}>⌫</button></td></tr>)}</tbody></table></div>
      <div className="workforce-mobile-cards" aria-label="Public holiday settings mobile view">{items.map(item => <article className="workforce-record-card" key={item.id}><header><div><b>{item.name}</b><small>{displayDate(item.date)}</small></div><span className={item.active ? 'badge blue' : 'badge'}>{item.active ? 'Active' : 'Inactive'}</span></header><dl><div><dt>Days</dt><dd>{item.days}</dd></div></dl><div className="workforce-card-actions"><button className="secondary" onClick={() => setEditing(item)}>Edit</button><button className="icon-action remove-action" aria-label={`Remove ${item.name}`} title="Remove Holiday" onClick={() => void remove(item)}>⌫</button></div></article>)}</div>
      {!items.length && <p className="workforce-empty">No public holidays configured for {year}.</p>}
    </>}
    {editing && <PublicHolidayForm holiday={editing} onClose={() => setEditing(null)} onSave={saved} />}
  </article>
}

function PublicHolidayForm({ holiday, onClose, onSave }: { holiday: PublicHoliday; onClose: () => void; onSave: (holiday: PublicHoliday) => Promise<void> }) {
  const [form, setForm] = useState(holiday)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!form.name.trim() || !form.date || !Number.isInteger(form.days) || form.days < 1) return setError('Holiday name, valid date and whole days of one or more are required.'); try { setError(''); await onSave({ ...form, name: form.name.trim() }) } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save the public holiday.') } }
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="holiday-title"><button className="close" aria-label="Close" onClick={onClose}>×</button><h2 id="holiday-title">{holiday.name ? 'Edit Public Holiday' : 'Add Public Holiday'}</h2><form className="staff-form" onSubmit={event => void submit(event)}><label>Holiday Name<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><label>Date<input required type="date" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} /></label><label>Days<input required type="number" min="1" step="1" value={form.days} onChange={event => setForm({ ...form, days: Number(event.target.value) })} /></label><label>Status<select value={form.active ? 'active' : 'inactive'} onChange={event => setForm({ ...form, active: event.target.value === 'active' })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>{error && <p className="save-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary">Save Holiday</button></div></form></section></div>
}
