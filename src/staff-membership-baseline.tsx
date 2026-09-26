import { useEffect, useMemo, useState } from 'react'
import { staffMembershipBaselineApi } from './api'
import { useAuth } from './auth'
import type { ConfigOption, Staff, StaffMembershipBaselineCandidate, StaffMembershipBaselinePreview } from './domain'
import './staff-membership-corrections.css'

const BASELINE_MONTH = '2026-09'
const OUTLET_SCOPE_KEY = 'andalucia'
const warningLabels: Record<string, string> = {
  CURRENT_STATUS_INACTIVE: 'Current status is inactive',
  JOINING_AFTER_BASELINE_MONTH: 'Joining date is after September',
  EMPLOYMENT_ENDED_BEFORE_PROPOSED_START: 'Employment ended before proposed start',
  PROPOSED_START_BEFORE_JOINING_DATE: 'Start is before joining date',
  PROPOSED_END_EXCEEDS_EMPLOYMENT_END: 'End exceeds employment end',
  REGULAR_OUTLET_MEMBERSHIP_OVERLAP: 'Overlapping regular outlet membership'
}
const blockingWarnings = new Set(['JOINING_AFTER_BASELINE_MONTH', 'EMPLOYMENT_ENDED_BEFORE_PROPOSED_START', 'PROPOSED_START_BEFORE_JOINING_DATE', 'PROPOSED_END_EXCEEDS_EMPLOYMENT_END', 'REGULAR_OUTLET_MEMBERSHIP_OVERLAP'])
const dateLabel = (value?: string | null) => value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : 'Open-ended'
const dateTimeLabel = (value?: string | null) => value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Indian/Maldives' }).format(new Date(value)) : '—'
const actorDisplayName = (value?: string | null) => value?.replace(/\s*\[[0-9a-f-]{36}\]\s*$/i, '').trim() || '—'
const candidatesFrom = (preview: StaffMembershipBaselinePreview) => [...preview.suggestedCandidates, ...preview.availableForManualInclusion]

export function StaffMembershipBaselinePanel({ staff, employmentStatuses }: { staff: Staff[]; employmentStatuses: ConfigOption[] }) {
  const { canForOutlet } = useAuth()
  const [preview, setPreview] = useState<StaffMembershipBaselinePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [manualQuery, setManualQuery] = useState('')
  const [approvalOpen, setApprovalOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetReason, setResetReason] = useState('')
  const [reopenOpen, setReopenOpen] = useState(false)
  const [reopenReason, setReopenReason] = useState('')
  const [draftDates, setDraftDates] = useState<Record<string, { from: string; to: string }>>({})

  const refresh = async () => {
    setLoading(true); setError('')
    try {
      const next = await staffMembershipBaselineApi.preview(BASELINE_MONTH, OUTLET_SCOPE_KEY)
      setPreview(next)
      setDraftDates(Object.fromEntries(candidatesFrom(next).map(candidate => [candidate.staffId, { from: candidate.proposedEffectiveFrom, to: candidate.proposedEffectiveTo || '' }])))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the September team baseline.')
    } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])

  const allCandidates = useMemo(() => preview ? candidatesFrom(preview) : [], [preview])
  const selected = allCandidates.filter(candidate => candidate.selectedInclude)
  const shownCandidates = preview ? [...preview.suggestedCandidates, ...preview.availableForManualInclusion.filter(candidate => candidate.selectedInclude)] : []
  const manualAvailable = preview?.availableForManualInclusion.filter(candidate => !candidate.selectedInclude && `${candidate.name} ${candidate.employeeNumber} ${candidate.designation} ${candidate.currentOutlet}`.toLowerCase().includes(manualQuery.toLowerCase())) || []
  const selectedWarnings = selected.flatMap(candidate => candidate.warnings)
  const blockerCount = selectedWarnings.filter(warning => blockingWarnings.has(warning)).length
  const reviewId = preview?.status.reviewId
  const canManage = preview ? canForOutlet('manage_staff_membership_baseline', preview.outlet.id) : false
  const canApprove = preview ? canForOutlet('approve_staff_membership_baseline', preview.outlet.id) : false
  const canReopen = preview ? canForOutlet('reopen_staff_membership_baseline', preview.outlet.id) : false
  const editable = Boolean(preview && ['in_review', 'correction_in_review'].includes(preview.status.status) && reviewId && canManage)
  const statusLabel = preview?.status.status.replaceAll('_', ' ').toUpperCase() || 'NOT STARTED'
  const statusFor = (value: string) => employmentStatuses.find(option => option.value === value)?.label || value

  const run = async (key: string, action: () => Promise<void>, success?: string) => {
    setBusy(key); setError(''); setNotice('')
    try { await action(); await refresh(); if (success) setNotice(success) }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : 'The baseline action could not be completed.') }
    finally { setBusy('') }
  }
  const saveCandidate = async (candidate: StaffMembershipBaselineCandidate, included: boolean) => {
    if (!reviewId) return
    const dates = draftDates[candidate.staffId] || { from: candidate.proposedEffectiveFrom, to: candidate.proposedEffectiveTo || '' }
    await run(`candidate-${candidate.staffId}`, () => staffMembershipBaselineApi.saveSelection(reviewId, { staffId: candidate.staffId, included, effectiveFrom: dates.from, effectiveTo: dates.to || null }).then(() => undefined), included ? `${candidate.name} is included in the draft baseline.` : `${candidate.name} is excluded from the draft baseline.`)
  }
  const removeManual = async (candidate: StaffMembershipBaselineCandidate) => {
    if (!reviewId) return
    await run(`candidate-${candidate.staffId}`, () => staffMembershipBaselineApi.removeSelection(reviewId, candidate.staffId), `${candidate.name} was removed from the review.`)
  }
  const approve = async () => {
    if (!reviewId) return
    await run('approve', async () => { await staffMembershipBaselineApi.approve(reviewId); setApprovalOpen(false) }, 'September 2026 Team Baseline approved.')
  }
  const reset = async () => {
    if (!reviewId || !resetReason.trim()) return
    await run('reset', async () => { await staffMembershipBaselineApi.reset(reviewId, resetReason.trim()); setResetOpen(false); setResetReason('') }, 'The unapproved review was reset.')
  }
  const reopen = async () => {
    if (!reviewId || !reopenReason.trim()) return
    await run('reopen', async () => { await staffMembershipBaselineApi.reopen(reviewId, preview.outlet.id, BASELINE_MONTH, reopenReason.trim()); setReopenOpen(false); setReopenReason('') })
  }

  if (loading && !preview) return <section className="panel membership-state"><p>Loading team membership baseline…</p></section>
  if (error && !preview) return <section className="panel membership-state error-state"><p>{error}</p><button className="secondary" onClick={() => void refresh()}>Try again</button></section>
  if (!preview) return null

  if (preview.status.status === 'approved') {
    return <section className="team-membership-page">
      <header className="membership-intro"><div><p className="eyebrow">TEAM MEMBERSHIP</p><h2>September 2026 Baseline · Andalucía</h2><p>Authoritative regular-team membership for future Bill Tip calculations.</p></div><span className="membership-status approved">APPROVED</span></header>
      <section className="panel membership-approved-banner"><div><b>September 2026 Team Baseline Approved</b><span>Selection editing is locked to protect approved history.</span></div><dl><div><dt>Revision</dt><dd>{preview.status.revisionNumber}</dd></div><div><dt>Approved Members</dt><dd>{preview.status.approvedMemberCount}</dd></div><div><dt>Approved At</dt><dd>{dateTimeLabel(preview.status.approvedAt)}</dd></div><div><dt>Approved By</dt><dd>{actorDisplayName(preview.status.approvedBy)}</dd></div></dl>{canReopen && <button className="secondary" onClick={() => setReopenOpen(true)}>Reopen for Correction</button>}</section>
      <section className="panel membership-review-card"><header><div><p className="eyebrow">APPROVED MEMBERS</p><h3>Regular Andalucía Team</h3></div><span>{preview.status.approvedMemberCount} members</span></header><div className="membership-table-wrap"><table className="membership-table approved-table"><thead><tr><th>Staff</th><th>Employee Number</th><th>Designation</th><th>Effective From</th><th>Effective To</th><th>Source</th><th>Status</th></tr></thead><tbody>{preview.status.approvedMemberships.map(membership => { const person = staff.find(item => item.id === membership.staffId); return <tr key={membership.id}><td><b>{person?.name || membership.staffId}</b></td><td>{person?.number || '—'}</td><td>{person?.position || '—'}</td><td>{dateLabel(membership.effectiveFrom)}</td><td>{dateLabel(membership.effectiveTo)}</td><td>Manager baseline review</td><td><span className="membership-status approved compact">Approved</span></td></tr> })}</tbody></table></div><div className="membership-mobile-list">{preview.status.approvedMemberships.map(membership => { const person = staff.find(item => item.id === membership.staffId); return <article key={membership.id}><header><div><b>{person?.name || membership.staffId}</b><small>{person?.number || 'Employee record unavailable'} · {person?.position || '—'}</small></div><span className="membership-status approved compact">Approved</span></header><dl><div><dt>Effective From</dt><dd>{dateLabel(membership.effectiveFrom)}</dd></div><div><dt>Effective To</dt><dd>{dateLabel(membership.effectiveTo)}</dd></div></dl></article> })}</div></section>
      <RevisionHistory preview={preview} />
      {reopenOpen && <Dialog title="Reopen Approved Baseline for Correction" onClose={() => setReopenOpen(false)}><p className="modal-intro">The approved revision remains preserved. A new correction revision will be created and must be approved before it becomes authoritative.</p><label className="membership-reset-reason">Correction reason<textarea rows={4} required value={reopenReason} onChange={event => setReopenReason(event.target.value)} /></label>{error && <p className="save-error" role="alert">{error}</p>}<div className="form-actions"><button className="secondary" onClick={() => setReopenOpen(false)}>Cancel</button><button className="primary" disabled={!reopenReason.trim() || busy === 'reopen'} onClick={() => void reopen()}>{busy === 'reopen' ? 'Reopening…' : 'Reopen for Correction'}</button></div></Dialog>}
    </section>
  }

  if (!canManage) return <section className="team-membership-page">
    <header className="membership-intro"><div><p className="eyebrow">TEAM MEMBERSHIP</p><h2>September 2026 Baseline · Andalucía</h2><p>Read-only baseline review for the selected outlet.</p></div><span className={`membership-status ${preview.status.status}`}>{statusLabel}</span></header>
    <section className="panel membership-status-card"><dl><div><dt>Outlet</dt><dd>{preview.outlet.displayName}</dd></div><div><dt>Baseline Month</dt><dd>September 2026</dd></div><div><dt>Status</dt><dd>{statusLabel}</dd></div><div><dt>Selected Members</dt><dd>{selected.length}</dd></div></dl><p>Your account has read-only access to this baseline.</p></section>
    <section className="panel membership-review-card"><header><div><p className="eyebrow">CANDIDATE REVIEW</p><h3>Regular Team Candidates</h3></div></header><div className="membership-table-wrap"><table className="membership-table approved-table"><thead><tr><th>Staff</th><th>Employee Number</th><th>Designation</th><th>Current Outlet</th><th>Status</th><th>Effective From</th><th>Effective To</th></tr></thead><tbody>{shownCandidates.map(candidate => <tr key={candidate.staffId}><td><b>{candidate.name}</b></td><td>{candidate.employeeNumber}</td><td>{candidate.designation}</td><td>{candidate.currentOutlet}</td><td>{candidate.selectedInclude ? 'Included' : 'Excluded'}</td><td>{dateLabel(candidate.proposedEffectiveFrom)}</td><td>{dateLabel(candidate.proposedEffectiveTo)}</td></tr>)}</tbody></table></div></section>
  </section>

  return <section className="team-membership-page">
    <header className="membership-intro"><div><p className="eyebrow">TEAM MEMBERSHIP</p><h2>September 2026 Baseline · Andalucía</h2><p>Review the regular Andalucía team before Bill Tip calculations begin.</p></div><span className={`membership-status ${preview.status.status}`}>{statusLabel}</span></header>
    <section className="panel membership-status-card"><dl><div><dt>Outlet</dt><dd>{preview.outlet.displayName}</dd></div><div><dt>Baseline Month</dt><dd>September 2026</dd></div><div><dt>Status</dt><dd>{statusLabel}</dd></div><div><dt>Revision</dt><dd>{preview.status.revisionNumber || '—'}</dd></div></dl>{preview.currentRevision?.reviewType === 'correction' ? <p>Revision {preview.currentRevision.revisionNumber} corrects approved Revision {preview.authoritativeRevision?.revisionNumber}. Reason: {preview.currentRevision.reopenReason}</p> : <p>Current outlet is a suggestion only. Manager confirmation remains required.</p>}{preview.status.status === 'not_started' ? <button className="primary" disabled={busy === 'begin'} onClick={() => void run('begin', () => staffMembershipBaselineApi.beginReview(BASELINE_MONTH, OUTLET_SCOPE_KEY).then(() => undefined), 'Baseline review started.')}>{busy === 'begin' ? 'Starting…' : 'Begin September Review'}</button> : preview.currentRevision?.reviewType === 'initial' ? <button className="secondary danger" onClick={() => setResetOpen(true)}>Reset Review</button> : null}</section>
    {preview.changes && <section className="panel membership-diff"><header><div><p className="eyebrow">CHANGES FROM PREVIOUS APPROVED BASELINE</p><h3>Revision {preview.currentRevision?.revisionNumber} Correction</h3></div></header><dl><div><dt>Added</dt><dd>{preview.changes.summary.added}</dd></div><div><dt>Removed</dt><dd>{preview.changes.summary.removed}</dd></div><div><dt>Date changes</dt><dd>{preview.changes.summary.dateChanges}</dd></div><div><dt>Unchanged</dt><dd>{preview.changes.summary.unchanged}</dd></div></dl><details><summary>Inspect exact changes</summary>{preview.changes.changes.filter(change => change.kind !== 'unchanged').map(change => <p key={change.staffId}><b>{change.staffName}</b> · {change.kind.replace('_', ' ')}</p>)}</details></section>}
    <section className="panel membership-review-card"><header><div><p className="eyebrow">CANDIDATE REVIEW</p><h3>Regular Team Candidates</h3><p>{preview.suggestedCandidates.length} Staff records suggested by current outlet.</p></div><button className="secondary" disabled={!editable} onClick={() => setManualOpen(true)}>＋ Add Existing Staff</button></header>
      {error && <p className="save-error" role="alert">{error}</p>}{notice && <p className="membership-notice" role="status">{notice}</p>}
      <div className="membership-table-wrap"><table className="membership-table"><thead><tr><th>Include</th><th>Staff</th><th>Designation</th><th>Current Outlet</th><th>Status</th><th>Employment Dates</th><th>Effective Dates</th><th>Review</th></tr></thead><tbody>{shownCandidates.map(candidate => <CandidateRow key={candidate.staffId} candidate={candidate} editable={editable} busy={busy === `candidate-${candidate.staffId}`} dates={draftDates[candidate.staffId]} statusLabel={statusFor(candidate.employmentStatus)} onDates={dates => setDraftDates(current => ({ ...current, [candidate.staffId]: dates }))} onInclude={included => void saveCandidate(candidate, included)} onRemove={!candidate.suggestedInclude ? () => void removeManual(candidate) : undefined} />)}</tbody></table></div>
      <div className="membership-mobile-list">{shownCandidates.map(candidate => <CandidateCard key={candidate.staffId} candidate={candidate} editable={editable} busy={busy === `candidate-${candidate.staffId}`} dates={draftDates[candidate.staffId]} statusLabel={statusFor(candidate.employmentStatus)} onDates={dates => setDraftDates(current => ({ ...current, [candidate.staffId]: dates }))} onInclude={included => void saveCandidate(candidate, included)} onRemove={!candidate.suggestedInclude ? () => void removeManual(candidate) : undefined} />)}</div>
    </section>
    <section className="panel membership-approval-card"><div><p className="eyebrow">APPROVAL SUMMARY</p><h3>September 2026 · Andalucía</h3></div><dl><div><dt>Selected Members</dt><dd>{selected.length}</dd></div><div><dt>Excluded Candidates</dt><dd>{preview.suggestedCandidates.filter(candidate => !candidate.selectedInclude).length}</dd></div><div><dt>Manual Staff Added</dt><dd>{preview.availableForManualInclusion.filter(candidate => candidate.selectedInclude).length}</dd></div><div><dt>Warnings</dt><dd>{selectedWarnings.length}</dd></div><div><dt>Blockers</dt><dd>{blockerCount}</dd></div></dl>{canApprove && <button className="primary" disabled={!editable || !selected.length || blockerCount > 0} onClick={() => setApprovalOpen(true)}>{preview.currentRevision?.reviewType === 'correction' ? 'Approve Corrected Baseline' : 'Approve September Team Baseline'}</button>}</section>
    {manualOpen && <Dialog title="Add Existing Staff" onClose={() => setManualOpen(false)}><p className="modal-intro">Select an existing Staff record. This does not change their current outlet.</p><input className="membership-manual-search" aria-label="Search existing staff" placeholder="Search name, employee number, designation or outlet" value={manualQuery} onChange={event => setManualQuery(event.target.value)} /><div className="membership-manual-list">{manualAvailable.map(candidate => <button key={candidate.staffId} disabled={Boolean(busy)} onClick={() => { setManualOpen(false); void saveCandidate(candidate, true) }}><b>{candidate.name}</b><span>{candidate.employeeNumber} · {candidate.designation}</span><small>{candidate.currentOutlet}</small></button>)}{!manualAvailable.length && <p>No additional Staff records match.</p>}</div></Dialog>}
    {approvalOpen && <Dialog title="Confirm September 2026 Team Baseline?" onClose={() => setApprovalOpen(false)}><div className="membership-confirm"><p>Selected regular staff: <b>{selected.length}</b></p><p>Outlet: <b>Andalucía</b></p><p>Once approved, these records become the authoritative historical staff scope used by future Bill Tip calculations.</p></div><div className="form-actions"><button className="secondary" onClick={() => setApprovalOpen(false)}>Cancel</button><button className="primary" disabled={busy === 'approve'} onClick={() => void approve()}>{busy === 'approve' ? 'Approving…' : 'Confirm Approval'}</button></div></Dialog>}
    {resetOpen && <Dialog title="Reset Unapproved Review" onClose={() => setResetOpen(false)}><p className="modal-intro">This clears draft selections only. No Staff or membership history will be changed.</p><label className="membership-reset-reason">Reason<textarea rows={3} value={resetReason} onChange={event => setResetReason(event.target.value)} /></label><div className="form-actions"><button className="secondary" onClick={() => setResetOpen(false)}>Cancel</button><button className="secondary danger" disabled={!resetReason.trim() || busy === 'reset'} onClick={() => void reset()}>{busy === 'reset' ? 'Resetting…' : 'Confirm Reset'}</button></div></Dialog>}
  </section>
}

function RevisionHistory({ preview }: { preview: StaffMembershipBaselinePreview }) {
  return <section className="panel membership-history"><header><div><p className="eyebrow">REVISION HISTORY</p><h3>Approved Baseline History</h3></div></header><div className="membership-history-list">{preview.revisionHistory.map(revision => <article key={revision.id}><div><b>Revision {revision.revisionNumber}</b><span className={`membership-status ${revision.status}`}>{revision.isAuthoritative ? 'CURRENT APPROVED' : revision.status.replaceAll('_', ' ').toUpperCase()}</span></div><dl><div><dt>Approved members</dt><dd>{revision.approvedMemberCount}</dd></div><div><dt>Approved</dt><dd>{dateTimeLabel(revision.approvedAt)}</dd></div><div><dt>Approver</dt><dd>{actorDisplayName(revision.approvedBy)}</dd></div>{revision.reopenReason && <div><dt>Correction reason</dt><dd>{revision.reopenReason}</dd></div>}</dl></article>)}</div></section>
}

function CandidateRow({ candidate, editable, busy, dates, statusLabel, onDates, onInclude, onRemove }: CandidateProps) {
  const value = dates || { from: candidate.proposedEffectiveFrom, to: candidate.proposedEffectiveTo || '' }
  return <tr className={candidate.selectedInclude ? 'selected-candidate' : ''}><td><label className="membership-include"><input type="checkbox" checked={candidate.selectedInclude} disabled={!editable || busy} onChange={event => onInclude(event.target.checked)} /><span>{candidate.selectedInclude ? 'Included' : 'Excluded'}</span></label></td><td><b>{candidate.name}</b><small>{candidate.employeeNumber}</small></td><td>{candidate.designation}<small>{candidate.department}</small></td><td>{candidate.currentOutlet}{candidate.suggestedInclude && <small>Suggested match</small>}</td><td>{statusLabel}</td><td><span>Joined {dateLabel(candidate.joiningDate)}</span><small>End {dateLabel(candidate.resignationDate)}</small></td><td><div className="membership-date-pair"><label>From<input type="date" min={candidate.joiningDate > '2026-09-01' ? candidate.joiningDate : '2026-09-01'} max="2026-09-30" value={value.from} disabled={!editable || !candidate.selectedInclude || busy} onChange={event => onDates({ ...value, from: event.target.value })} /></label><label>To<input type="date" min={value.from} max={candidate.resignationDate || undefined} value={value.to} disabled={!editable || !candidate.selectedInclude || busy} onChange={event => onDates({ ...value, to: event.target.value })} /></label><button className="link" disabled={!editable || !candidate.selectedInclude || busy || (value.from === candidate.proposedEffectiveFrom && value.to === (candidate.proposedEffectiveTo || ''))} onClick={() => onInclude(true)}>Save dates</button></div></td><td><Warnings candidate={candidate} />{onRemove && candidate.selectedInclude && <button className="link danger" disabled={busy} onClick={onRemove}>Remove</button>}</td></tr>
}
function CandidateCard(props: CandidateProps) {
  const { candidate, editable, busy, dates, statusLabel, onDates, onInclude, onRemove } = props
  const value = dates || { from: candidate.proposedEffectiveFrom, to: candidate.proposedEffectiveTo || '' }
  return <article className={candidate.selectedInclude ? 'selected-candidate' : ''}><header><div><b>{candidate.name}</b><small>{candidate.employeeNumber} · {candidate.designation}</small></div><label className="membership-include"><input type="checkbox" checked={candidate.selectedInclude} disabled={!editable || busy} onChange={event => onInclude(event.target.checked)} /><span>{candidate.selectedInclude ? 'Included' : 'Excluded'}</span></label></header><dl><div><dt>Current Outlet</dt><dd>{candidate.currentOutlet}</dd></div><div><dt>Employment Status</dt><dd>{statusLabel}</dd></div><div><dt>Joined</dt><dd>{dateLabel(candidate.joiningDate)}</dd></div><div><dt>Employment End</dt><dd>{dateLabel(candidate.resignationDate)}</dd></div></dl><div className="membership-date-pair"><label>Effective From<input type="date" min={candidate.joiningDate > '2026-09-01' ? candidate.joiningDate : '2026-09-01'} max="2026-09-30" value={value.from} disabled={!editable || !candidate.selectedInclude || busy} onChange={event => onDates({ ...value, from: event.target.value })} /></label><label>Effective To<input type="date" min={value.from} max={candidate.resignationDate || undefined} value={value.to} disabled={!editable || !candidate.selectedInclude || busy} onChange={event => onDates({ ...value, to: event.target.value })} /></label><button className="secondary" disabled={!editable || !candidate.selectedInclude || busy || (value.from === candidate.proposedEffectiveFrom && value.to === (candidate.proposedEffectiveTo || ''))} onClick={() => onInclude(true)}>Save dates</button></div><Warnings candidate={candidate} />{onRemove && candidate.selectedInclude && <button className="link danger" disabled={busy} onClick={onRemove}>Remove from review</button>}</article>
}
function Warnings({ candidate }: { candidate: StaffMembershipBaselineCandidate }) { return candidate.warnings.length ? <div className="membership-warnings">{candidate.warnings.map(warning => <span className={blockingWarnings.has(warning) ? 'blocking' : ''} key={warning}>{warningLabels[warning] || warning}</span>)}</div> : <span className="membership-ready">Ready for review</span> }
type CandidateProps = { candidate: StaffMembershipBaselineCandidate; editable: boolean; busy: boolean; dates?: { from: string; to: string }; statusLabel: string; onDates: (dates: { from: string; to: string }) => void; onInclude: (included: boolean) => void; onRemove?: () => void }
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-backdrop membership-dialog-backdrop"><section className="modal membership-dialog" role="dialog" aria-modal="true" aria-label={title}><button className="close" aria-label="Close" onClick={onClose}>×</button><h2>{title}</h2>{children}</section></div> }
