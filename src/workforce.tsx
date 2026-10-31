import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { staffApi } from './api'
import { CORE_DUTY_CODES, EMPLOYEE_OVERRIDE_LEAVE_CLASSIFICATIONS, LEAVE_CLASSIFICATION_LABELS, YEARLY_ENTITLEMENT_LEAVE_CLASSIFICATIONS, type AccumulatedOffBalance, type ConfigOption, type EmployeeOverrideLeaveClassification, type EntitlementPolicy, type LeavePlannerStaffRow, type PublicHoliday, type StaffEntitlement, type StaffEntitlementUpdate, type StaffYearlyEntitlementBalance, type StaffYearlyEntitlementDraft, type StaffYearlyEntitlementPreview, type YearlyEntitlementLeaveClassification } from './domain'
import { addCalendarDays, serviceDate } from './service-date'
import { normalizedLeaveOverrides } from './workforce-entitlement-normalization'
import './workforce.css'

const displayDate = (value: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Indian/Maldives' }).format(new Date(`${value}T00:00:00Z`))
const displayEntitlement = (value: number | null | undefined) => value === null ? 'Unconfigured' : value === undefined ? '—' : value
const NON_AL_YEARLY_CLASSIFICATIONS = YEARLY_ENTITLEMENT_LEAVE_CLASSIFICATIONS.filter(classification => classification !== 'annualLeave')

export function LeaveTypesPanel({ dutyCodes, onActivate }: { dutyCodes: ConfigOption[]; onActivate: (code: string) => Promise<void> }) {
  const [activatingCode, setActivatingCode] = useState<string | null>(null)
  const [activationError, setActivationError] = useState('')
  const leaveTypes = CORE_DUTY_CODES.map(definition => {
    const configured = dutyCodes.find(option => String(option.metadata?.displayCode || option.value).trim().toUpperCase() === definition.code)
    return { ...definition, color: configured?.color || definition.color, configured: Boolean(configured), active: configured?.active !== false }
  })
  const activate = async (code: string) => { try { setActivationError(''); setActivatingCode(code); await onActivate(code) } catch (error) { setActivationError(error instanceof Error ? error.message : 'Unable to activate the Duty Code.') } finally { setActivatingCode(null) } }
  return <article className="panel workforce-foundation-panel leave-types-panel">
    <div className="panel-title workforce-section-title"><div><p className="eyebrow">AUTHORITATIVE CLASSIFICATIONS</p><h3>Leave Types</h3></div><span className="leave-type-count">10 protected types</span></div>
    <div className="leave-type-grid" aria-label="Protected leave types">{leaveTypes.map(item => <article className="leave-type-card" key={item.code}>
      <span className="leave-type-code" style={{ borderColor: item.color, color: item.color }}>{item.code}</span>
      <div><strong>{item.label}</strong>{LEAVE_CLASSIFICATION_LABELS[item.classification] !== item.label && <small>{LEAVE_CLASSIFICATION_LABELS[item.classification]}</small>}</div>
      {item.configured && item.active ? <span className="leave-type-state active">Configured</span> : <button type="button" className="secondary activate-duty-code" disabled={activatingCode !== null} onClick={() => void activate(item.code)}>{activatingCode === item.code ? 'Activating…' : 'Activate Duty Code'}</button>}
    </article>)}</div>
    {activationError && <p className="save-error" role="alert">{activationError}</p>}
  </article>
}

export function EntitlementPoliciesPanel() {
  const [items, setItems] = useState<EntitlementPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<EntitlementPolicy | null>(null)
  const load = async () => { setLoading(true); setError(''); try { setItems(await staffApi.entitlementPolicies()) } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load entitlement policies.') } finally { setLoading(false) } }
  useEffect(() => { void load() }, [])
  const saved = async (policy: EntitlementPolicy) => { const result = await staffApi.saveEntitlementPolicy(policy); setItems(current => current.map(item => item.classification === result.classification ? result : item)); setEditing(null) }
  return <article className="panel workforce-foundation-panel entitlement-policies-panel">
    <div className="panel-title workforce-section-title"><div><p className="eyebrow">DEFAULT ALLOWANCES</p><h3>Entitlement Policies</h3></div></div>
    {error && <p className="save-error" role="alert">{error}</p>}
    {loading ? <p className="workforce-loading">Loading entitlement policies…</p> : <div className="entitlement-policy-list" aria-label="Entitlement policy defaults">{items.map(item => {
      const definition = CORE_DUTY_CODES.find(candidate => candidate.classification === item.classification)
      return <article key={item.classification} className="entitlement-policy-row">
        <div className="policy-card-header">
          <span className="policy-code" style={{ borderColor: definition?.color, color: definition?.color }}>{item.code}</span>
          <div className="policy-identity"><strong>{item.label}</strong>{LEAVE_CLASSIFICATION_LABELS[item.classification] !== item.label && <small>{LEAVE_CLASSIFICATION_LABELS[item.classification]}</small>}</div>
          <span className={item.persisted ? 'policy-source saved' : 'policy-source'}>{item.persisted ? 'Manager configured' : item.activationRequired ? 'Approved · not active' : 'Existing default'}</span>
        </div>
        <div className="policy-card-detail">
          <div className="policy-allowance"><span>Default allowance</span><div><b>{item.defaultAllowance === null ? 'Pending activation' : item.defaultAllowance}</b><small>{item.cadence === 'annual' ? 'days per year' : 'days per week'}{item.activationRequired ? ` · approved ${item.approvedAllowance}` : ''}</small></div></div>
          <button className="secondary" aria-label={`Edit ${item.label} default`} onClick={() => setEditing(item)}>Edit</button>
        </div>
      </article>
    })}</div>}
    <p className="configuration-source-note policy-information-note"><b>Policy defaults:</b> apply only when an employee-specific override does not exist; protected leave identities and calculation rules remain unchanged. Recurring OFF and PH allowances remain policy values, Public Holiday Calendar remains the source for named dates, confirmed usage comes only from Duty Roster, and Booked/Future remains a separate planning deduction.</p>
    {editing && <EntitlementPolicyForm policy={editing} onClose={() => setEditing(null)} onSave={saved} />}
  </article>
}

function EntitlementPolicyForm({ policy, onClose, onSave }: { policy: EntitlementPolicy; onClose: () => void; onSave: (policy: EntitlementPolicy) => Promise<void> }) {
  const [allowance, setAllowance] = useState(policy.defaultAllowance ?? policy.approvedAllowance)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!Number.isInteger(allowance) || allowance < 0) return setError('Default entitlement allowance must be a whole number of zero or more.'); try { setError(''); await onSave({ ...policy, defaultAllowance: allowance }) } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save the entitlement policy.') } }
  return <div className="modal-backdrop" role="presentation"><section className="modal entitlement-policy-modal" role="dialog" aria-modal="true" aria-labelledby="policy-title"><button className="close" aria-label="Close" onClick={onClose}>×</button><h2 id="policy-title">Edit {policy.label} Default</h2><p className="configuration-source-note">This changes the default for employees without an individual override. Existing employee-specific allowances and explicit zero values are preserved.</p><form className="staff-form" onSubmit={event => void submit(event)}><label>Default allowance<input required type="number" min="0" step="1" value={allowance} onChange={event => setAllowance(Number(event.target.value))} /></label><p className="policy-form-unit">{policy.cadence === 'weekly' ? 'Days per week' : 'Days per year'}{policy.activationRequired ? ` · HR-approved preparation value ${policy.approvedAllowance}` : ''}</p>{error && <p className="save-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary">Save Default</button></div></form></section></div>
}

export function StaffEntitlementsManager() {
  const [items, setItems] = useState<StaffEntitlement[]>([])
  const [summaries, setSummaries] = useState<Record<string, LeavePlannerStaffRow['entitlement']>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedStaffId, setExpandedStaffId] = useState<string | null>(null)
  const load = async () => { setLoading(true); setError(''); try { const entitlements = await staffApi.entitlements(); setItems(entitlements.map(item => ({ ...item, leaveOverrides: normalizedLeaveOverrides(item.leaveOverrides) }))); try { const planner = await staffApi.leavePlanner(serviceDate().slice(0, 7)); setSummaries(Object.fromEntries(planner.rows.map(row => [row.staffId, row.entitlement]))) } catch { setSummaries({}) } } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load staff entitlements.') } finally { setLoading(false) } }
  useEffect(() => { void load() }, [])
  const visible = items.filter(item => item.employmentStatus === 'active')
  const showDetails = (staffId: string | null) => setExpandedStaffId(staffId)
  return <article className="panel workforce-foundation-panel staff-entitlements-panel">
    <div className="panel-title workforce-section-title"><div><p className="eyebrow">EMPLOYEE OVERRIDES &amp; BALANCES</p><h3>Employee Entitlements</h3><p>Individual allowances override policy defaults without changing confirmed Duty Roster evidence.</p></div></div>
    {error && <p className="save-error" role="alert">{error}</p>}
    {loading ? <p className="workforce-loading">Loading staff entitlements…</p> : <>
      <div className="entitlement-view-summary" aria-live="polite"><span><b>{visible.length}</b> {visible.length === 1 ? 'employee' : 'employees'} shown</span><small>Annual Leave figures use confirmed Duty Roster usage and separate future bookings.</small></div>
      <div className="employee-entitlement-table-wrap" role="region" aria-label="Employee entitlement balances" tabIndex={0}>
        <table className="employee-entitlement-table">
          <colgroup><col className="entitlement-employee-column" /><col className="entitlement-id-column" /><col /><col /><col /><col /><col className="entitlement-action-column" /></colgroup>
          <thead><tr><th>Employee</th><th>Employee ID</th><th>Available</th><th>Used</th><th>Booked</th><th>Balance</th><th>Action</th></tr></thead>
          {visible.map(item => { const summary = summaries[item.staffId]; const serviceYear = summary?.annualLeave.serviceYear; const expanded = expandedStaffId === item.staffId; const detailsId = `employee-entitlement-details-${item.staffId}`; return <tbody key={item.staffId}>
            <tr className={expanded ? 'employee-entitlement-row expanded' : 'employee-entitlement-row'}>
              <td className="employee-entitlement-identity" data-label="Employee"><b>{item.staffName}</b></td>
              <td className="employee-entitlement-id" data-label="Employee ID"><b>{item.staffNumber}</b></td>
              <td data-label="Available"><b>{displayEntitlement(serviceYear ? serviceYear.remaining : summary?.annualLeave.remaining)}</b></td>
              <td data-label="Used"><b>{serviceYear?.used ?? summary?.annualLeave.used ?? '—'}</b></td>
              <td data-label="Booked"><b>{serviceYear?.bookedFuture ?? summary?.bookedFuture ?? '—'}</b></td>
              <td data-label="Balance"><b>{displayEntitlement(serviceYear ? serviceYear.availableAfterBooked : summary?.availableAfterBooked)}</b></td>
              <td className="employee-entitlement-action" data-label="Action"><button type="button" className="entitlement-details-toggle" aria-expanded={expanded} aria-controls={detailsId} onClick={() => showDetails(expanded ? null : item.staffId)}>{expanded ? 'Close' : 'Details'}</button></td>
            </tr>
            {expanded && <tr className="employee-entitlement-details-row"><td colSpan={7}><EntitlementInlineDetails id={detailsId} item={item} planningSummary={summary} onCollapse={() => showDetails(null)} /></td></tr>}
          </tbody> })}
        </table>
      </div>
      {!visible.length && <p className="workforce-empty">No staff match this view.</p>}
    </>}
  </article>
}

function EntitlementForm({ item, onClose, onSave }: { item: StaffEntitlement; onClose: () => void; onSave: (item: StaffEntitlementUpdate) => Promise<void> }) {
  const [form, setForm] = useState(item)
  const [overrideValues, setOverrideValues] = useState<Record<EmployeeOverrideLeaveClassification, string>>(() => { const overrides = normalizedLeaveOverrides(item.leaveOverrides); return Object.fromEntries(EMPLOYEE_OVERRIDE_LEAVE_CLASSIFICATIONS.map(classification => [classification, overrides[classification]?.toString() ?? ''])) as Record<EmployeeOverrideLeaveClassification, string> })
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); const values = [form.annualLeavePerYear, form.weeklyOffEntitlement, form.publicHolidayPerYear]; if (values.some(value => !Number.isInteger(value) || value < 0)) return setError('Entitlement values must be whole numbers of zero or more.'); const leaveOverrides = Object.fromEntries(EMPLOYEE_OVERRIDE_LEAVE_CLASSIFICATIONS.map(classification => { const raw = overrideValues[classification].trim(); const value = raw === '' ? null : Number(raw); return [classification, value] })) as StaffEntitlementUpdate['leaveOverrides']; if (Object.values(leaveOverrides || {}).some(value => value !== null && (!Number.isInteger(value) || Number(value) < 0))) return setError('Additional leave values must be whole numbers of zero or more, or left blank for Unconfigured.'); try { setError(''); await onSave({ staffId: form.staffId, annualLeavePerYear: form.annualLeavePerYear, weeklyOffEntitlement: form.weeklyOffEntitlement, publicHolidayPerYear: form.publicHolidayPerYear, leaveOverrides }) } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save staff entitlements.') } }
  const numeric = (key: 'annualLeavePerYear' | 'weeklyOffEntitlement' | 'publicHolidayPerYear', value: string) => setForm(current => ({ ...current, [key]: Number(value) }))
  return <div className="modal-backdrop" role="presentation"><section className="modal entitlement-edit-modal" role="dialog" aria-modal="true" aria-labelledby="entitlement-title"><button className="close" aria-label="Close" onClick={onClose}>×</button><h2 id="entitlement-title">Edit Staff Entitlements</h2><p className="workforce-modal-person"><b>{item.staffName}</b><span>{item.staffNumber}</span></p><form className="staff-form" onSubmit={event => void submit(event)}><fieldset className="entitlement-fieldset"><legend>Existing AL / OFF / PH</legend><label>Annual Leave / Year<input required type="number" min="0" step="1" value={form.annualLeavePerYear} onChange={event => numeric('annualLeavePerYear', event.target.value)} /></label><label>Weekly OFF entitlement<input required type="number" min="0" step="1" value={form.weeklyOffEntitlement} onChange={event => numeric('weeklyOffEntitlement', event.target.value)} /></label><label>Public Holiday / Year<input required type="number" min="0" step="1" value={form.publicHolidayPerYear} onChange={event => numeric('publicHolidayPerYear', event.target.value)} /></label></fieldset><fieldset className="entitlement-fieldset additional-entitlement-fields"><legend>Additional leave allowances</legend><p>Leave blank to inherit the active approved policy default; if no default is active it remains Unconfigured. Enter 0 only when zero is the explicit approved employee override.</p>{EMPLOYEE_OVERRIDE_LEAVE_CLASSIFICATIONS.map(classification => { const definition = CORE_DUTY_CODES.find(item => item.classification === classification)!; return <label key={classification}>{definition.code} · {definition.label}<input aria-label={`${definition.label} entitlement`} type="number" min="0" step="1" placeholder="Inherit policy default" value={overrideValues[classification]} onChange={event => setOverrideValues(current => ({ ...current, [classification]: event.target.value }))} /></label> })}</fieldset>{error && <p className="save-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary">Save Entitlements</button></div></form></section></div>
}

function YearlyEntitlementForm({ item, onClose }: { item: StaffEntitlement; onClose: () => void }) {
  const currentYear = Number(serviceDate().slice(0, 4))
  const [year, setYear] = useState(currentYear)
  const [values, setValues] = useState<Record<YearlyEntitlementLeaveClassification, string>>(() => Object.fromEntries(YEARLY_ENTITLEMENT_LEAVE_CLASSIFICATIONS.map(classification => [classification, ''])) as Record<YearlyEntitlementLeaveClassification, string>)
  const [approvalReason, setApprovalReason] = useState('')
  const [preview, setPreview] = useState<StaffYearlyEntitlementPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { let current = true; setLoading(true); setError(''); setPreview(null); void staffApi.yearlyEntitlements(item.staffId, year).then(records => { if (!current) return; setValues(Object.fromEntries(records.map(record => [record.classification, record.entitlement?.toString() ?? ''])) as Record<YearlyEntitlementLeaveClassification, string>); setApprovalReason('') }).catch(loadError => { if (current) setError(loadError instanceof Error ? loadError.message : 'Unable to load yearly entitlements.') }).finally(() => { if (current) setLoading(false) }); return () => { current = false } }, [item.staffId, year])
  const draft = (): StaffYearlyEntitlementDraft | null => { const allowances = Object.fromEntries(NON_AL_YEARLY_CLASSIFICATIONS.map(classification => { const raw = values[classification].trim(); return [classification, raw === '' ? null : Number(raw)] })) as Partial<Record<YearlyEntitlementLeaveClassification, number | null>>; const invalid = Object.values(allowances).some(value => value !== null && (!Number.isFinite(value) || Number(value) < 0 || Math.abs(Number(value) * 10000 - Math.round(Number(value) * 10000)) > 1e-7)); if (invalid) { setError('Allowances must be non-negative numbers with no more than four decimal places, or blank for Unconfigured.'); return null } if (!approvalReason.trim()) { setError('Enter the mandatory HR approval reason before reviewing changes.'); return null } return { staffId: item.staffId, year, allowances, annualLeaveOpeningBalance: null, approvalReason: approvalReason.trim() } }
  const review = async (event: FormEvent) => { event.preventDefault(); const input = draft(); if (!input) return; try { setSaving(true); setError(''); setPreview(await staffApi.previewYearlyEntitlements(input)) } catch (reviewError) { setError(reviewError instanceof Error ? reviewError.message : 'Unable to preview yearly entitlements.') } finally { setSaving(false) } }
  const confirm = async () => { const input = draft(); if (!input || !preview) return; try { setSaving(true); setError(''); await staffApi.saveYearlyEntitlements({ ...input, confirmation: 'CONFIRM_HR_APPROVED_YEARLY_ENTITLEMENTS' }); onClose() } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save yearly entitlements.') } finally { setSaving(false) } }
  const changed = () => setPreview(null)
  const valueLabel = (value: number | null) => value === null ? 'Unconfigured' : value
  return <div className="modal-backdrop" role="presentation"><section className="modal entitlement-edit-modal" role="dialog" aria-modal="true" aria-labelledby="yearly-entitlement-title"><button className="close" aria-label="Close" onClick={onClose}>×</button><h2 id="yearly-entitlement-title">HR-Approved Yearly Entitlements</h2><p className="workforce-modal-person"><b>{item.staffName}</b><span>{item.staffNumber}</span></p>{preview ? <section className="yearly-entitlement-preview" aria-label="Yearly entitlement change preview"><h3>Review before saving</h3><p>No values have been saved. Annual Leave service-year evidence is not part of this calendar-year save.</p><dl className="preview-context"><div><dt>Employee</dt><dd>{preview.staffName} · {preview.staffNumber}</dd></div><div><dt>Year</dt><dd>{preview.year}</dd></div><div><dt>HR approval reason</dt><dd>{preview.approvalReason}</dd></div></dl><div className="entitlement-preview-list">{preview.after.filter(after => after.classification !== 'annualLeave').map(after => { const before = preview.before.find(record => record.classification === after.classification)!; return <article key={after.classification}><b>{after.code} · {after.label}</b><span>{valueLabel(before.entitlement)} → {valueLabel(after.entitlement)}</span></article> })}</div>{error && <p className="save-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="secondary" onClick={() => setPreview(null)}>Back to Edit</button><button type="button" className="primary" disabled={saving} onClick={() => void confirm()}>{saving ? 'Saving…' : 'Confirm HR-Approved Save'}</button></div></section> : <form className="staff-form" onSubmit={event => void review(event)}><label>Entitlement year<input aria-label="Entitlement year" type="number" min="1900" max="2200" step="1" value={year} onChange={event => { const next = Number(event.target.value); if (Number.isInteger(next) && next >= 1900 && next <= 2200) { changed(); setYear(next) } }} /></label><p className="configuration-source-note"><b>Annual Leave:</b> read-only here. Lifetime availability is calculated automatically from completed service months and confirmed Duty Roster usage. Calendar-year AL records are not accepted.</p><fieldset className="entitlement-fieldset additional-entitlement-fields"><legend>Manager-approved yearly allowances</legend><p>Leave blank for Unconfigured. Explicit zero is preserved. OFF remains under the existing weekly policy.</p>{loading ? <p className="workforce-loading">Loading yearly entitlements…</p> : NON_AL_YEARLY_CLASSIFICATIONS.map(classification => { const definition = CORE_DUTY_CODES.find(item => item.classification === classification)!; return <label key={classification}>{definition.code} · {definition.label}<input aria-label={`${year} ${definition.label} allowance`} type="number" min="0" step="0.0001" placeholder="Unconfigured" value={values[classification]} onChange={event => { changed(); setValues(current => ({ ...current, [classification]: event.target.value })) }} /></label> })}</fieldset><fieldset className="entitlement-fieldset"><legend>Approval evidence</legend><label>Mandatory HR approval reason<textarea aria-label="HR approval reason" required rows={3} value={approvalReason} onChange={event => { changed(); setApprovalReason(event.target.value) }} /></label></fieldset>{error && <p className="save-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={loading || saving}>{saving ? 'Preparing preview…' : 'Review Changes'}</button></div></form>}</section></div>
}

function EntitlementInlineDetails({ id, item, planningSummary, onCollapse }: { id: string; item: StaffEntitlement; planningSummary?: LeavePlannerStaffRow['entitlement']; onCollapse: () => void }) {
  const today = serviceDate()
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [weekDate, setWeekDate] = useState(today)
  const [balance, setBalance] = useState<StaffYearlyEntitlementBalance | null>(null)
  const [accumulatedOff, setAccumulatedOff] = useState<AccumulatedOffBalance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { let current = true; setLoading(true); setError(''); void Promise.all([staffApi.yearlyEntitlementBalance(item.staffId, year, weekDate), staffApi.accumulatedOffBalance(item.staffId)]).then(([yearlyBalance, accumulatedBalance]) => { if (current) { setBalance(yearlyBalance); setAccumulatedOff(accumulatedBalance) } }).catch(loadError => { if (current) setError(loadError instanceof Error ? loadError.message : 'Unable to calculate yearly entitlement balances.') }).finally(() => { if (current) setLoading(false) }); return () => { current = false } }, [item.staffId, year, weekDate])
  const stateLabel = balance?.weeklyOff.status === 'pending' ? 'Pending' : balance?.weeklyOff.status === 'short' ? `Short by ${Math.abs(balance.weeklyOff.difference)}` : balance?.weeklyOff.status === 'additional' ? `${balance.weeklyOff.difference} additional OFF` : 'Compliant'
  const accumulatedTotal = accumulatedOff ? accumulatedOff.opening + accumulatedOff.earned : 0
  const nonAnnualLeave = balance?.yearlyLeave.filter(line => line.classification !== 'annualLeave') ?? []
  useEffect(() => { const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onCollapse() }; document.addEventListener('keydown', closeOnEscape); return () => document.removeEventListener('keydown', closeOnEscape) }, [onCollapse])
  const serviceYear = planningSummary?.annualLeave.serviceYear
  return <section id={id} className="employee-entitlement-details" aria-label={`${item.staffName} entitlement details`}>
    <header className="employee-entitlement-details-header"><div><p className="eyebrow">INLINE ENTITLEMENT DETAILS</p><h4>{item.staffName} · {item.staffNumber}</h4></div><dl><div><dt>Service Year</dt><dd>{serviceYear ? `${displayDate(serviceYear.serviceYearStart)} – ${displayDate(serviceYear.serviceYearEnd)}` : '—'}</dd></div><div><dt>Next Anniversary</dt><dd>{serviceYear ? displayDate(serviceYear.nextEntitlementAvailabilityDate) : '—'}</dd></div></dl></header>
    <div className="balance-controls"><label>Selected Year<input aria-label="Entitlement balance year" type="number" min="1900" max="2200" step="1" value={year} onChange={event => { const next = Number(event.target.value); if (Number.isInteger(next) && next >= 1900 && next <= 2200) setYear(next) }} /></label><label>Week containing<input aria-label="Entitlement balance week" type="date" value={weekDate} onChange={event => setWeekDate(event.target.value)} /></label></div>
    {error && <p className="save-error" role="alert">{error}</p>}
    {loading || !balance || !accumulatedOff ? <p className="workforce-loading">Calculating entitlement details…</p> : <>
      <section className="off-days-summary" aria-labelledby={`${id}-off-title`}><header><div><p className="eyebrow">DUTY ROSTER</p><h3 id={`${id}-off-title`}>OFF Days Summary</h3></div>{accumulatedOff.evaluatedThrough && <small>Evaluated through {displayDate(accumulatedOff.evaluatedThrough)}</small>}</header><dl className="off-days-metrics"><div><dt>OFF Taken</dt><dd>{accumulatedOff.consumed}</dd></div><div><dt>Accumulated OFF</dt><dd>{accumulatedTotal}</dd></div><div><dt>Available Balance</dt><dd>{accumulatedOff.available}</dd></div></dl><article className={`weekly-balance off-days-weekly-review ${balance.weeklyOff.status}`}><div><span>Weekly OFF Review</span><small>{displayDate(balance.weeklyOff.weekStart)} – {displayDate(balance.weeklyOff.weekEnd)}</small></div><dl><div><dt>Required</dt><dd>{balance.weeklyOff.required}</dd></div><div><dt>Assigned</dt><dd>{balance.weeklyOff.assigned}</dd></div><div><dt>Difference</dt><dd>{balance.weeklyOff.complete ? `${balance.weeklyOff.difference > 0 ? '+' : ''}${balance.weeklyOff.difference}` : '—'}</dd></div><div><dt>Status</dt><dd>{stateLabel}</dd></div></dl></article><div className="balance-week-actions"><button className="secondary" onClick={() => setWeekDate(value => addCalendarDays(value, -7))}>← Previous Week</button><button className="secondary" onClick={() => setWeekDate(today)}>Current Week</button><button className="secondary" onClick={() => setWeekDate(value => addCalendarDays(value, 7))}>Next Week →</button></div></section>
      <p className="configuration-source-note"><b>As of:</b> {displayDate(balance.asOf)}. Confirmed usage comes only from Duty Roster; Booked/Future remains separate.</p>
      <section className="additional-entitlement-balances" aria-label="Non-Annual Leave entitlement balances"><div>{nonAnnualLeave.map(line => <article key={line.classification}><header><b>{line.code}</b><span>{line.label}</span></header><dl><div><dt>Entitled</dt><dd>{displayEntitlement(line.entitlement)}</dd></div><div><dt>Used</dt><dd>{line.used}</dd></div><div><dt>Balance</dt><dd>{displayEntitlement(line.remaining)}</dd></div></dl></article>)}</div></section>
    </>}
  </section>
}

export function PublicHolidaySettingsManager() {
  const currentYear = Number(serviceDate().slice(0, 4))
  const [year, setYear] = useState(currentYear)
  const [items, setItems] = useState<PublicHoliday[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<PublicHoliday | null>(null)
  const [deleting, setDeleting] = useState<PublicHoliday | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)
  const load = async (selectedYear: number) => { setLoading(true); setError(''); try { setItems(await staffApi.publicHolidays(selectedYear)) } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load public holidays.') } finally { setLoading(false) } }
  useEffect(() => { void load(year) }, [year])
  const activeDays = useMemo(() => items.filter(item => item.active).reduce((total, item) => total + item.days, 0), [items])
  const sortedItems = useMemo(() => [...items].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)), [items])
  const saved = async (holiday: PublicHoliday) => { const result = items.some(item => item.id === holiday.id) ? await staffApi.updatePublicHoliday(holiday) : await staffApi.createPublicHoliday(holiday); if (Number(result.date.slice(0, 4)) === year) setItems(current => current.some(item => item.id === result.id) ? current.map(item => item.id === result.id ? result : item) : [...current, result].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))); else setItems(current => current.filter(item => item.id !== result.id)); setEditing(null) }
  const remove = async (holiday: PublicHoliday) => { try { setDeletingBusy(true); setError(''); await staffApi.removePublicHoliday(holiday.id); setItems(current => current.filter(item => item.id !== holiday.id)); setDeleting(null) } catch (removeError) { setError(removeError instanceof Error ? removeError.message : 'Unable to remove the public holiday.') } finally { setDeletingBusy(false) } }
  return <article className="panel workforce-foundation-panel public-holidays-panel">
    <div className="panel-title workforce-section-title holiday-panel-heading"><div><p className="eyebrow">ANNUAL CALENDAR</p><h3>Public Holiday Calendar</h3><p>Exact annual calendar dates, managed separately from individual staff entitlement allowances.</p></div><button className="primary holiday-add-action" onClick={() => setEditing({ id: crypto.randomUUID(), name: '', date: `${year}-01-01`, days: 1, active: true })}>＋ Add Holiday</button></div>
    <div className="holiday-command"><label>Calendar year<input aria-label="Public holiday year" type="number" min="1900" max="2200" step="1" value={year} onChange={event => { const next = Number(event.target.value); if (Number.isInteger(next) && next >= 1900 && next <= 2200) setYear(next) }} /></label><div className="holiday-active-summary"><span>Active PH calendar days</span><strong>{activeDays}</strong><small>Calendar total only — staff PH entitlement remains separate.</small></div></div>
    {error && <p className="save-error" role="alert">{error}</p>}
    {loading ? <p className="workforce-loading">Loading public holidays…</p> : <>
      {sortedItems.length > 0 && <div className="holiday-records" aria-label="Public holiday settings"><div className="holiday-record-labels" aria-hidden="true"><span>Holiday</span><span>Date</span><span>Days</span><span>Status</span><span>Actions</span></div>{sortedItems.map(item => <article className="holiday-record" key={item.id}><div className="holiday-record-name"><span className="holiday-mobile-label">Holiday</span><b>{item.name}</b></div><div className="holiday-record-value"><span className="holiday-mobile-label">Date</span><time dateTime={item.date}>{displayDate(item.date)}</time></div><div className="holiday-record-value holiday-days"><span className="holiday-mobile-label">Days</span><b>{item.days}</b></div><div className="holiday-record-status"><span className="holiday-mobile-label">Status</span><span className={item.active ? 'badge blue' : 'badge'}>{item.active ? 'Active' : 'Inactive'}</span></div><div className="holiday-record-actions"><button className="secondary" onClick={() => setEditing(item)}>Edit</button><button className="secondary danger" aria-label={`Delete ${item.name}`} onClick={() => setDeleting(item)}>Delete</button></div></article>)}</div>}
      {!items.length && <p className="workforce-empty">No public holidays configured for {year}.</p>}
    </>}
    {editing && <PublicHolidayForm holiday={editing} onClose={() => setEditing(null)} onSave={saved} />}
    {deleting && <PublicHolidayDeleteDialog holiday={deleting} deleting={deletingBusy} onCancel={() => { if (!deletingBusy) setDeleting(null) }} onConfirm={() => void remove(deleting)} />}
  </article>
}

function PublicHolidayDeleteDialog({ holiday, deleting, onCancel, onConfirm }: { holiday: PublicHoliday; deleting: boolean; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => { const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !deleting) onCancel() }; document.addEventListener('keydown', closeOnEscape); return () => document.removeEventListener('keydown', closeOnEscape) }, [deleting, onCancel])
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !deleting) onCancel() }}><section className="modal public-holiday-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="holiday-delete-title" aria-describedby="holiday-delete-description" onMouseDown={event => event.stopPropagation()}><p className="eyebrow">MANAGER CONFIRMATION</p><h2 id="holiday-delete-title">Delete Public Holiday?</h2><p id="holiday-delete-description">This removes <strong>{holiday.name}</strong> on <time dateTime={holiday.date}>{displayDate(holiday.date)}</time> from the calendar. Existing authorization and audit safeguards remain in effect.</p><div className="holiday-delete-actions"><button type="button" className="secondary" autoFocus disabled={deleting} onClick={onCancel}>Cancel</button><button type="button" className="danger" disabled={deleting} onClick={onConfirm}>{deleting ? 'Deleting…' : 'Delete Holiday'}</button></div></section></div>
}

function PublicHolidayForm({ holiday, onClose, onSave }: { holiday: PublicHoliday; onClose: () => void; onSave: (holiday: PublicHoliday) => Promise<void> }) {
  const [form, setForm] = useState(holiday)
  const [error, setError] = useState('')
  const dirty = form.name !== holiday.name || form.date !== holiday.date || form.days !== holiday.days || form.active !== holiday.active
  const requestClose = () => { if (dirty && !window.confirm('Discard unsaved public holiday changes?')) return; onClose() }
  useEffect(() => { const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') requestClose() }; document.addEventListener('keydown', closeOnEscape); return () => document.removeEventListener('keydown', closeOnEscape) }, [dirty, onClose])
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!form.name.trim() || !form.date || !Number.isInteger(form.days) || form.days < 1) return setError('Holiday name, valid date and whole days of one or more are required.'); try { setError(''); await onSave({ ...form, name: form.name.trim() }) } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save the public holiday.') } }
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) requestClose() }}><section className="modal public-holiday-modal" role="dialog" aria-modal="true" aria-labelledby="holiday-title" onMouseDown={event => event.stopPropagation()}><button className="close" aria-label="Close" onClick={requestClose}>×</button><h2 id="holiday-title">{holiday.name ? 'Edit Public Holiday' : 'Add Public Holiday'}</h2><form className="staff-form public-holiday-form" onSubmit={event => void submit(event)}><label>Holiday Name<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><label>Date<input required type="date" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} /></label><label>Days<input required type="number" min="1" step="1" value={form.days} onChange={event => setForm({ ...form, days: Number(event.target.value) })} /></label><label>Status<select value={form.active ? 'active' : 'inactive'} onChange={event => setForm({ ...form, active: event.target.value === 'active' })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>{error && <p className="save-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="secondary" onClick={requestClose}>Cancel</button><button type="submit" className="primary">Save Holiday</button></div></form></section></div>
}
