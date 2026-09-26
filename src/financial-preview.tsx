import { useEffect, useState } from 'react'
import { billTipWorkflowApi, financialPreviewApi } from './api'
import type { BillTipVersionDiff, BillTipVersionSnapshot, BillTipWorkflowState, ConfigOption, FinancialManagerPreview, FinancialPreviewExternalAllocation, Staff } from './domain'
import { ChargeableItemsPage, type ChargeableConfiguration } from './chargeables'
import { WineSpiritsPage } from './wine-spirits'
import { useAuth } from './auth'
import { serviceDate } from './service-date'
import './financial-preview.css'

type ModuleTab = 'chargeables' | 'wine-spirits' | 'bill-tips' | 'earnings'

const money = (value: string | number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0))
const monthLabel = (month: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(`${month}-01T00:00:00`))

export function IncentivesBillTipsPage({ staff, configuration, onToast }: { staff: Staff[]; configuration: ChargeableConfiguration; onToast: (message: string) => void }) {
  const [tab, setTab] = useState<ModuleTab>('chargeables')
  return <section className="financial-module">
    <nav className="financial-primary-tabs" aria-label="Incentives and Bill Tips sections">
      <button type="button" className={tab === 'chargeables' ? 'selected' : ''} onClick={() => setTab('chargeables')}>Chargeable Items</button>
      <button type="button" className={tab === 'wine-spirits' ? 'selected' : ''} onClick={() => setTab('wine-spirits')}>Wine &amp; Spirits</button>
      <button type="button" className={tab === 'bill-tips' ? 'selected' : ''} onClick={() => setTab('bill-tips')}>Bill Tips</button>
      <button type="button" className={tab === 'earnings' ? 'selected' : ''} onClick={() => setTab('earnings')}>Earnings Summary</button>
    </nav>
    {tab === 'chargeables' ? <ChargeableItemsPage staff={staff} configuration={configuration} onToast={onToast} /> : tab === 'wine-spirits' ? <WineSpiritsPage staff={staff} tables={configuration.tables} onToast={onToast} /> : <ManagerPreview activeTab={tab} />}
  </section>
}

function ManagerPreview({ activeTab }: { activeTab: 'bill-tips' | 'earnings' }) {
  const { user, canForOutlet } = useAuth()
  const [month, setMonth] = useState(serviceDate().slice(0, 7))
  const [pool, setPool] = useState('0.00')
  const [external, setExternal] = useState<FinancialPreviewExternalAllocation[]>([])
  const [preview, setPreview] = useState<FinancialManagerPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [workflow, setWorkflow] = useState<BillTipWorkflowState | null>(null)
  const [dialog, setDialog] = useState<'finalize' | 'reopen' | 'refinalize' | null>(null)
  const [saving, setSaving] = useState(false)
  const finalizedLocked = activeTab === 'bill-tips' && Boolean(workflow?.currentFinalized && !workflow.activeCorrection)
  const load = async (hydrateStored = false) => {
    setLoading(true); setError('')
    try { const nextWorkflow = activeTab === 'bill-tips' ? await billTipWorkflowApi.state(month) : null; const stored = hydrateStored ? nextWorkflow?.activeCorrection || nextWorkflow?.currentFinalized : null; const effectivePool = stored?.pool || pool || '0.00'; const effectiveExternal = stored ? stored.externalAllocations.map(item => ({ id: item.id, name: item.name, staffReference: item.staffReference || undefined, departmentOutlet: item.departmentOutlet || undefined, fixedAmount: item.fixedAmount, remarks: item.remarks })) : external; const nextPreview = await financialPreviewApi.preview(month, effectivePool, effectiveExternal); if (stored) { setPool(effectivePool); setExternal(effectiveExternal) }; setPreview(nextPreview); setWorkflow(nextWorkflow) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The financial preview could not be calculated.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load(true) }, [activeTab, month])
  return <>
    <div className="financial-command panel">
      <div><p className="eyebrow">LIVE OPERATIONAL PREVIEW</p><h2>{activeTab === 'bill-tips' ? 'Bill Tip Preview' : 'Earnings Summary'}</h2><p>Provisional manager review only. No payout, finalization, or month close is created.</p></div>
      <div className="financial-command-controls">
        <label>Month<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label>
        {activeTab === 'bill-tips' && <label>Total Bill Tip Pool (USD)<input inputMode="decimal" disabled={finalizedLocked} value={pool} onChange={event => setPool(event.target.value)} /></label>}
        <button type="button" className="primary" onClick={() => void load()} disabled={loading}>{loading ? 'Calculating…' : 'Recalculate Preview'}</button>
      </div>
    </div>
    {activeTab === 'bill-tips' && <ExternalAllocations allocations={external} onChange={setExternal} onRecalculate={load} disabled={loading || finalizedLocked} />}
    {loading && <div className="panel financial-state">Calculating from approved membership, roster and realized sales…</div>}
    {!loading && error && <div className="panel financial-state error-state"><b>Preview unavailable</b><p>{error}</p><button type="button" className="secondary" onClick={() => void load()}>Try again</button></div>}
    {!loading && preview && activeTab === 'bill-tips' && <BillTipPreview preview={preview} workflow={workflow} canCorrect={Boolean(workflow && user.isOwner && canForOutlet('perform_financial_corrections', workflow.outlet.id))} onFinalize={() => setDialog('finalize')} onReopen={() => setDialog('reopen')} onRefinalize={() => setDialog('refinalize')} />}
    {!loading && preview && activeTab === 'earnings' && <EarningsPreview preview={preview} />}
    {dialog && preview && workflow && <BillTipConfirmationDialog mode={dialog} preview={preview} workflow={workflow} saving={saving} onClose={() => setDialog(null)} onConfirm={async reason => { setSaving(true); setError(''); try { if (dialog === 'finalize') await billTipWorkflowApi.finalize({ month, totalPool: pool, externalAllocations: external, backupId: workflow.backup.backupId || '', confirmation: `FINALIZE BILL TIPS ${month}`, idempotencyKey: crypto.randomUUID() }); else if (dialog === 'reopen' && workflow.currentFinalized) await billTipWorkflowApi.reopen(workflow.currentFinalized.id, reason, crypto.randomUUID(), 'REOPEN BILL TIPS FOR CORRECTION'); else if (dialog === 'refinalize' && workflow.activeCorrection) await billTipWorkflowApi.refinalize(workflow.activeCorrection.id, { totalPool: pool, externalAllocations: external, backupId: workflow.backup.backupId || '', confirmation: `RE-FINALIZE BILL TIPS ${month}`, idempotencyKey: crypto.randomUUID() }); setDialog(null); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : 'The Bill Tip workflow could not be completed.'); setDialog(null) } finally { setSaving(false) } }} />}
  </>
}

function ExternalAllocations({ allocations, onChange, onRecalculate, disabled }: { allocations: FinancialPreviewExternalAllocation[]; onChange: (value: FinancialPreviewExternalAllocation[]) => void; onRecalculate: () => Promise<void>; disabled: boolean }) {
  const update = (id: string, patch: Partial<FinancialPreviewExternalAllocation>) => onChange(allocations.map(item => item.id === id ? { ...item, ...patch } : item))
  const add = () => { if (!disabled) onChange([...allocations, { id: crypto.randomUUID(), name: '', staffReference: '', departmentOutlet: '', fixedAmount: '0.00', remarks: '' }]) }
  return <section className="panel external-allocations">
    <header><div><p className="eyebrow">POOL DEDUCTIONS</p><h3>External / Support Staff Allocation</h3><p>Fixed allocations reduce the regular-team pool and do not change Team Membership or roster eligibility.</p></div><button type="button" className="secondary" disabled={disabled} onClick={add}>+ Add person</button></header>
    {allocations.length === 0 ? <p className="financial-empty">No external/support allocations entered.</p> : <div className="external-list">{allocations.map(item => <article key={item.id}>
      <label>Name<input disabled={disabled} value={item.name} onChange={event => update(item.id, { name: event.target.value })} /></label>
      <label>Employee ID / ID No.<input disabled={disabled} value={item.staffReference || ''} onChange={event => update(item.id, { staffReference: event.target.value })} /></label>
      <label>Department / Outlet<input disabled={disabled} value={item.departmentOutlet || ''} onChange={event => update(item.id, { departmentOutlet: event.target.value })} /></label>
      <label>Fixed Amount<input disabled={disabled} inputMode="decimal" value={item.fixedAmount} onChange={event => update(item.id, { fixedAmount: event.target.value })} /></label>
      <label className="external-remarks">Remarks<input disabled={disabled} value={item.remarks || ''} onChange={event => update(item.id, { remarks: event.target.value })} /></label>
      <div className="quick-amounts" aria-label={`Quick amount for ${item.name || 'external allocation'}`}>{['5.00','10.00','15.00','20.00'].map(amount => <button type="button" disabled={disabled} key={amount} onClick={() => update(item.id, { fixedAmount: amount })}>${Number(amount)}</button>)}</div>
      <button type="button" className="link danger-link" disabled={disabled} onClick={() => onChange(allocations.filter(value => value.id !== item.id))}>Remove</button>
    </article>)}</div>}
    <footer><button type="button" className="primary" disabled={disabled} onClick={() => void onRecalculate()}>Apply to Preview</button></footer>
  </section>
}

function PreviewBanner({ preview }: { preview: FinancialManagerPreview }) {
  return <div className="financial-preview-banner"><span>PROVISIONAL</span><b>{monthLabel(preview.month)} · {preview.outlet.name}</b><small>Approved Team Membership · Revision {preview.membership.revisionNumber} · {preview.membership.memberCount} regular Staff</small><em>{preview.periodStatus === 'IN_PROGRESS' ? 'Open / In Progress' : 'Closed period preview'}</em></div>
}

function Metric({ label, value }: { label: string; value: string | number }) { return <article><span>{label}</span><strong>{value}</strong></article> }

function BillTipPreview({ preview, workflow, canCorrect, onFinalize, onReopen, onRefinalize }: { preview: FinancialManagerPreview; workflow: BillTipWorkflowState | null; canCorrect: boolean; onFinalize: () => void; onReopen: () => void; onRefinalize: () => void }) {
  const b = preview.billTips
  return <div className="financial-preview-results">
    <PreviewBanner preview={preview} />
    <div className="financial-metrics">
      <Metric label="Total Tip Pool" value={money(b.totalPool)} /><Metric label="External Allocations" value={money(b.externalAllocationTotal)} /><Metric label="Regular Team Pool" value={money(b.remainingRegularTeamPool)} /><Metric label="Eligible Recorded Days" value={b.totalEligibleRecordedDays} /><Metric label="Value / Eligible Day" value={money(b.valuePerEligibleDay)} /><Metric label="Regular Staff Distributed" value={money(b.regularStaffDistributed)} /><Metric label="Rounding Remainder" value={money(b.roundingRemainder)} /><Metric label="Review Status" value={b.reviewStatus === 'READY' ? 'Ready' : 'Review Required'} />
    </div>
    {b.externalAllocations.length > 0 && <section className="panel financial-subsection"><header><h3>External / Support Allocations</h3><strong>{money(b.externalAllocationTotal)}</strong></header><div className="financial-table-wrap"><table><thead><tr><th>Name</th><th>Employee / ID</th><th>Department / Outlet</th><th>Remarks</th><th>Fixed Amount</th></tr></thead><tbody>{b.externalAllocations.map(item => <tr key={item.id}><td>{item.name}</td><td>{item.staffReference || '—'}</td><td>{item.departmentOutlet || '—'}</td><td>{item.remarks || '—'}</td><td>{money(item.fixedAmount)}</td></tr>)}</tbody></table></div></section>}
    <section className="panel financial-subsection"><header><div><h3>Regular Team Bill Tip Preview</h3><p>Future or unclosed dates are shown separately and are not treated as missing roster records.</p></div><span className={`financial-status ${b.reviewStatus.toLowerCase()}`}>{b.reviewStatus.replace('_', ' ')}</span></header><div className="financial-table-wrap"><table className="bill-tip-table"><thead><tr><th>Staff</th><th>Employee ID</th><th>Designation</th><th>Membership Period</th><th>Eligible Days</th><th>AL Excluded</th><th>Historical Missing</th><th>Future / Unclosed</th><th>Calculated Bill Tip</th><th>Review</th></tr></thead><tbody>{b.staff.map(item => <tr key={item.staffId}><td><b>{item.staffName}</b></td><td>{item.staffNumber}</td><td>{item.designation}</td><td>{item.membershipFrom} → {item.membershipTo || 'Open'}</td><td>{item.eligibleRecordedDays}</td><td>{item.alDaysExcluded}</td><td>{item.historicalMissingRosterDays}</td><td>{item.futureUnclosedDays}</td><td><b>{money(item.calculatedBillTip)}</b></td><td><span className={`financial-status ${item.reviewStatus.toLowerCase()}`}>{item.reviewStatus === 'READY' ? 'Ready' : 'Review'}</span></td></tr>)}</tbody></table></div></section>
    <div className="financial-reconciliation panel"><span>Regular Staff {money(b.regularStaffDistributed)}</span><b>+</b><span>External {money(b.externalAllocationTotal)}</span><b>+</b><span>Remainder {money(b.roundingRemainder)}</span><b>=</b><strong>Total Pool {money(b.totalPool)}</strong></div>
    {workflow && <BillTipWorkflowPanel preview={preview} workflow={workflow} canCorrect={canCorrect} onFinalize={onFinalize} onReopen={onReopen} onRefinalize={onRefinalize} />}
  </div>
}

function BillTipWorkflowPanel({ preview, workflow, canCorrect, onFinalize, onReopen, onRefinalize }: { preview: FinancialManagerPreview; workflow: BillTipWorkflowState; canCorrect: boolean; onFinalize: () => void; onReopen: () => void; onRefinalize: () => void }) {
  const [selected, setSelected] = useState<BillTipVersionSnapshot | null>(null)
  const [diff, setDiff] = useState<BillTipVersionDiff | null>(null)
  const openSnapshot = async (version: BillTipVersionSnapshot) => { setSelected(version); setDiff(version.previousVersionId ? await billTipWorkflowApi.diff(version.id) : null) }
  const blocked = preview.periodStatus !== 'CLOSED' || preview.billTips.reviewStatus !== 'READY' || !workflow.backup.ready
  return <>
    <section className="panel bill-tip-finalization-card">
      <header><div><p className="eyebrow">AUTHORITATIVE MONTHLY SNAPSHOT</p><h3>Bill Tip Finalization</h3></div><span className={`period-pill ${preview.periodStatus === 'CLOSED' ? 'closed' : 'open'}`}>{preview.periodStatus === 'CLOSED' ? 'CLOSED PERIOD' : 'OPEN / IN PROGRESS'}</span></header>
      {preview.periodStatus === 'IN_PROGRESS' && <p className="finalization-guidance">This operational month is still in progress. Finalization is intentionally unavailable until the period is complete and manager review is satisfied.</p>}
      {!workflow.backup.ready && <div className="backup-gate"><b>Verified PRE_FINALIZATION backup required</b><span>A protected, restore-tested backup matching the current operational state must be prepared through the established database-protection workflow.</span>{workflow.backup.blockers.map(item => <small key={item}>{item.replaceAll('_', ' ')}</small>)}</div>}
      {workflow.backup.ready && <div className="backup-gate ready"><b>Recovery point verified</b><span>{workflow.backup.backupId} · protected and restore-tested</span></div>}
      {!workflow.currentFinalized && !workflow.activeCorrection && <button className="primary" type="button" disabled={blocked} onClick={onFinalize}>Review Finalization</button>}
      {workflow.currentFinalized && !workflow.activeCorrection && <div className="finalized-callout"><div><b>FINALIZED · VERSION {workflow.currentFinalized.version}</b><span>{workflow.currentFinalized.finalizedAt ? new Date(workflow.currentFinalized.finalizedAt).toLocaleString() : 'Finalized'} by {workflow.currentFinalized.finalizedByName}</span></div>{canCorrect && <button className="secondary" type="button" disabled={!workflow.backup.ready} title={!workflow.backup.ready ? 'Prepare a current verified PRE_FINALIZATION backup before reopening.' : 'Create an audited correction version'} onClick={onReopen}>Reopen for Correction</button>}</div>}
      {workflow.activeCorrection && <div className="finalized-callout correction"><div><b>VERSION {workflow.activeCorrection.version} · CORRECTION IN REVIEW</b><span>{workflow.activeCorrection.correctionReason} · source Version {workflow.activeCorrection.version - 1}</span></div>{canCorrect && <button className="primary" type="button" disabled={blocked} onClick={onRefinalize}>Review Re-Finalization</button>}</div>}
    </section>
    {workflow.activeCorrection && <CorrectionPreview source={workflow.history.find(item => item.id === workflow.activeCorrection?.previousVersionId) || null} preview={preview} />}
    {workflow.history.length > 0 && <section className="panel financial-subsection version-history"><header><div><p className="eyebrow">AUDITED RECORD</p><h3>Version History</h3></div></header><div className="version-list">{workflow.history.map(version => <article key={version.id}><div><b>Version {version.version}</b><span className={`financial-status ${version.status}`}>{version.isCurrent ? 'Current Finalized' : version.status.replaceAll('_', ' ')}</span><small>{version.finalizedAt ? new Date(version.finalizedAt).toLocaleString() : new Date(version.createdAt).toLocaleString()} · {version.finalizedByName || version.reopenedByName || version.createdBy}</small>{version.correctionReason && <p>{version.correctionReason}</p>}</div><div><strong>{money(version.pool)}</strong><small>{version.staffCount} regular staff</small><button className="link" type="button" onClick={() => void openSnapshot(version)}>View Snapshot</button></div></article>)}</div></section>}
    {selected && <VersionSnapshotDialog version={selected} diff={diff} onClose={() => { setSelected(null); setDiff(null) }} />}
  </>
}

function CorrectionPreview({ source, preview }: { source: BillTipVersionSnapshot | null; preview: FinancialManagerPreview }) {
  if (!source) return null
  const changes: Array<{ id: string; name: string; number: string; type: string; before: string | null; after: string | null }> = [...preview.billTips.staff.map(after => { const before = source.staff.find(item => item.staffId === after.staffId); return { id: after.staffId, name: after.staffName, number: after.staffNumber, type: !before ? 'ADDED' : before.finalAmount !== after.calculatedBillTip || before.eligibleDays !== after.eligibleRecordedDays ? 'CHANGED' : 'UNCHANGED', before: before?.finalAmount || null, after: after.calculatedBillTip } }), ...source.staff.filter(before => !preview.billTips.staff.some(after => after.staffId === before.staffId)).map(before => ({ id: before.staffId, name: before.staffName, number: before.staffNumber, type: 'REMOVED', before: before.finalAmount, after: null }))]
  return <section className="panel financial-subsection correction-diff"><header><div><h3>Before / After Review</h3><p>Version {source.version} remains frozen. The “after” column is the currently authoritative preview.</p></div></header><div className="diff-metrics"><Metric label="Pool Before" value={money(source.pool)} /><Metric label="Pool After" value={money(preview.billTips.totalPool)} /><Metric label="External Before" value={money(source.external)} /><Metric label="External After" value={money(preview.billTips.externalAllocationTotal)} /></div><div className="financial-table-wrap"><table><thead><tr><th>Staff</th><th>Employee ID</th><th>Change</th><th>Before</th><th>After</th></tr></thead><tbody>{changes.map(item => <tr key={item.id}><td>{item.name}</td><td>{item.number}</td><td>{item.type}</td><td>{item.before ? money(item.before) : '—'}</td><td>{item.after ? money(item.after) : '—'}</td></tr>)}</tbody></table></div></section>
}

function BillTipConfirmationDialog({ mode, preview, workflow, saving, onClose, onConfirm }: { mode: 'finalize' | 'reopen' | 'refinalize'; preview: FinancialManagerPreview; workflow: BillTipWorkflowState; saving: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  const b = preview.billTips
  const correction = mode === 'reopen'
  const title = correction ? 'Reopen for Correction' : mode === 'refinalize' ? `Re-Finalize Version ${workflow.activeCorrection?.version}` : 'Finalize Bill Tips'
  return <div className="modal-backdrop"><section className="modal bill-tip-review-modal" role="dialog" aria-modal="true" aria-labelledby="bill-tip-review-title"><button className="close" aria-label="Close Bill Tip review" title="Close" onClick={onClose}>×</button><p className="eyebrow">CONTROLLED FINANCIAL APPROVAL</p><h2 id="bill-tip-review-title">{title}</h2>
    <div className="review-identity"><div><span>Outlet</span><b>{preview.outlet.name}</b></div><div><span>Month</span><b>{monthLabel(preview.month)}</b></div><div><span>Membership</span><b>Revision {preview.membership.revisionNumber}</b></div><div><span>Regular Staff</span><b>{preview.membership.memberCount}</b></div></div>
    {!correction && <><div className="financial-metrics final-review-metrics"><Metric label="Total Pool" value={money(b.totalPool)} /><Metric label="External Allocations" value={money(b.externalAllocationTotal)} /><Metric label="Regular Team Pool" value={money(b.remainingRegularTeamPool)} /><Metric label="Eligible Days" value={b.totalEligibleRecordedDays} /><Metric label="Value / Day" value={money(b.valuePerEligibleDay)} /><Metric label="Staff Distributed" value={money(b.regularStaffDistributed)} /><Metric label="Rounding Remainder" value={money(b.roundingRemainder)} /><Metric label="Exact Reconciliation" value={money(Number(b.regularStaffDistributed) + Number(b.externalAllocationTotal) + Number(b.roundingRemainder))} /></div>
      <div className="financial-table-wrap final-review-table"><table><thead><tr><th>Staff</th><th>Employee ID</th><th>Designation</th><th>Membership</th><th>Eligible</th><th>AL Excluded</th><th>Historical Missing</th><th>Final Bill Tip</th></tr></thead><tbody>{b.staff.map(item => <tr key={item.staffId}><td><b>{item.staffName}</b></td><td>{item.staffNumber}</td><td>{item.designation}</td><td>{item.membershipFrom} → {item.membershipTo || 'Open'}</td><td>{item.eligibleRecordedDays}</td><td>{item.alDaysExcluded}</td><td>{item.historicalMissingRosterDays}</td><td><b>{money(item.calculatedBillTip)}</b></td></tr>)}</tbody></table></div>
      {b.externalAllocations.length > 0 && <div className="external-final-review"><h3>External / Support Allocations</h3>{b.externalAllocations.map(item => <div key={item.id}><span>{item.name}<small>{item.staffReference || item.departmentOutlet || 'External support'}</small></span><b>{money(item.fixedAmount)}</b></div>)}</div>}</>}
    {correction && <label className="correction-reason">Correction reason<textarea rows={4} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain why a new version is required" /></label>}
    <div className="approval-warning"><b>{correction ? 'Version 1 will remain immutable.' : `Approval creates an authoritative immutable Version ${workflow.activeCorrection?.version || 1} snapshot.`}</b><span>{correction ? 'A separate correction-in-review version will be created and fully audited.' : 'Bill Tip finalization is separate from Incentives and does not close the operational month.'}</span></div>
    <label className="explicit-confirmation"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>I have reviewed the month, team, allocations, reconciliation and recovery point, and I explicitly approve this action.</span></label>
    <div className="form-actions"><button className="secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className={correction ? 'secondary danger' : 'primary'} type="button" disabled={saving || !confirmed || (correction && !reason.trim())} onClick={() => void onConfirm(reason)}>{saving ? 'Completing…' : title}</button></div>
  </section></div>
}

function VersionSnapshotDialog({ version, diff, onClose }: { version: BillTipVersionSnapshot; diff: BillTipVersionDiff | null; onClose: () => void }) {
  return <div className="modal-backdrop"><section className="modal bill-tip-review-modal" role="dialog" aria-modal="true" aria-labelledby="bill-tip-snapshot-title"><button className="close" aria-label="Close Bill Tip snapshot" title="Close" onClick={onClose}>×</button><p className="eyebrow">IMMUTABLE BILL TIP HISTORY</p><h2 id="bill-tip-snapshot-title">Version {version.version} · {version.isCurrent ? 'Current Finalized' : version.status.replaceAll('_', ' ')}</h2><p className="snapshot-audit">{version.finalizedAt ? `Finalized ${new Date(version.finalizedAt).toLocaleString()} by ${version.finalizedByName}` : `Created ${new Date(version.createdAt).toLocaleString()} by ${version.createdBy}`}</p>{version.correctionReason && <div className="approval-warning"><b>Correction reason</b><span>{version.correctionReason}</span></div>}
    <div className="financial-metrics final-review-metrics"><Metric label="Total Pool" value={money(version.pool)} /><Metric label="External" value={money(version.external)} /><Metric label="Regular Pool" value={money(version.regularPool)} /><Metric label="Eligible Days" value={version.eligibleDays} /><Metric label="Value / Day" value={money(version.valuePerDay)} /><Metric label="Distributed" value={money(version.distributed)} /><Metric label="Remainder" value={money(version.remainder)} /><Metric label="Membership Revision" value={version.membershipRevisionNumber || '—'} /></div>
    {diff && <div className="version-diff-summary"><b>Compared with Version {diff.previousVersion}</b><span>Pool {money(diff.totalPool.before)} → {money(diff.totalPool.after)}</span><span>External {money(diff.external.before)} → {money(diff.external.after)}</span><span>Eligible days {diff.eligibleDays.before} → {diff.eligibleDays.after}</span></div>}
    {diff && <div className="financial-table-wrap"><table><thead><tr><th>Staff</th><th>Employee ID</th><th>Change</th><th>Before</th><th>After</th></tr></thead><tbody>{diff.staff.map(item => <tr key={item.staffId}><td>{item.staffName}</td><td>{item.staffNumber}</td><td>{item.change}</td><td>{item.before ? money(item.before) : '—'}</td><td>{item.after ? money(item.after) : '—'}</td></tr>)}</tbody></table></div>}
    {version.externalAllocations.length > 0 && <div className="external-final-review"><h3>Frozen External / Support Allocations</h3>{version.externalAllocations.map(item => <div key={item.id}><span>{item.name}<small>{item.staffReference || item.departmentOutlet || 'External support'}{item.remarks ? ` · ${item.remarks}` : ''}</small></span><b>{money(item.fixedAmount)}</b></div>)}</div>}
    <div className="financial-table-wrap final-review-table"><table><thead><tr><th>Staff</th><th>Employee ID</th><th>Designation</th><th>Membership</th><th>Eligible</th><th>AL Excluded</th><th>Historical Missing</th><th>Frozen Amount</th></tr></thead><tbody>{version.staff.map(item => <tr key={item.staffId}><td><b>{item.staffName}</b></td><td>{item.staffNumber}</td><td>{item.designation}</td><td>{item.membershipFrom} → {item.membershipTo || 'Open'}</td><td>{item.eligibleDays}</td><td>{item.alExcluded}</td><td>{item.historicalMissing}</td><td><b>{money(item.finalAmount)}</b></td></tr>)}</tbody></table></div>
    <div className="form-actions"><button className="secondary" type="button" onClick={onClose}>Close</button></div></section></div>
}

function EarningsPreview({ preview }: { preview: FinancialManagerPreview }) {
  return <div className="financial-preview-results">
    <PreviewBanner preview={preview} />
    <div className="financial-metrics incentive-metrics"><Metric label="Realized Sales" value={preview.incentives.realizedRecordCount} /><Metric label="Realized Gross" value={money(preview.incentives.realizedGrossAmount)} /><Metric label="Pending Excluded" value={`${preview.incentives.pendingExcludedCount} · ${money(preview.incentives.pendingExcludedAmount)}`} /><Metric label="Seller Review" value={preview.incentives.unattributedRealizedCount ? `${preview.incentives.unattributedRealizedCount} required` : 'Ready'} /><Metric label="Wine / Spirits" value="Active" /></div>
    <section className="panel financial-subsection"><header><div><h3>Incentive Preview</h3><p>Direct seller earnings from realized eligible sales only. Seller identity uses the linked Staff record; missing links are never inferred.</p></div><span className={`financial-status ${preview.incentives.reviewStatus.toLowerCase()}`}>{preview.incentives.reviewStatus === 'READY' ? 'Ready' : 'Review Required'}</span></header><div className="financial-table-wrap"><table><thead><tr><th>Source</th><th>Service Date</th><th>Check / Invoice</th><th>Room</th><th>Item</th><th>Qty</th><th>Gross</th><th>Net Unit</th><th>Applied Rule / Tier</th><th>Incentive</th><th>Sold By</th><th>Status</th></tr></thead><tbody>{preview.incentives.records.map(item => <tr key={`${item.sourceType}-${item.sourceId}`}><td><b>{item.sourceType === 'WINE_SPIRITS' ? 'Wine / Spirits' : 'Food'}</b></td><td>{item.serviceDate}</td><td>{item.checkInvoiceNumber || 'Historical · not recorded'}</td><td>{item.roomNumber || '—'}</td><td>{item.itemLabel}</td><td>{item.quantity}</td><td>{money(item.grossAmount)}</td><td>{item.eligibleNetUnitPrice ? money(item.eligibleNetUnitPrice) : money(item.eligibleNetAmount)}</td><td>{item.appliedTier || item.appliedRule}</td><td><b>{money(item.incentive)}</b></td><td>{item.soldByName || <span className="seller-review">Unassigned · manager review</span>}<small>{item.soldByNumber || 'No Staff UUID linked'}</small></td><td><span className={`financial-status ${item.reviewStatus.toLowerCase()}`}>{item.reviewStatus === 'READY' ? 'Provisional' : 'Review'}</span></td></tr>)}</tbody></table></div></section>
    <section className="panel financial-subsection"><header><h3>Staff Incentive Summary</h3><span className="financial-status ready">Wine / Spirits Active</span></header><div className="financial-table-wrap"><table><thead><tr><th>Staff</th><th>Food Incentive</th><th>Wine / Spirits Incentive</th><th>Total Incentive</th></tr></thead><tbody>{preview.incentives.staffSummary.map(item => <tr key={item.staffId}><td><b>{item.staffName}</b><small>{item.staffNumber}</small></td><td>{money(item.foodIncentive)}</td><td>{money(item.wineSpiritsIncentive)}</td><td><b>{money(item.totalIncentive)}</b></td></tr>)}</tbody></table></div></section>
    <section className="panel financial-subsection"><header><div><h3>Earnings Summary</h3><p>Derived preview only; no duplicate financial totals are persisted.</p></div></header><div className="financial-table-wrap"><table><thead><tr><th>Staff</th><th>Employee ID</th><th>Bill Tips</th><th>Food Incentives</th><th>Wine / Spirits</th><th>Total Extra Earnings</th><th>Status</th></tr></thead><tbody>{preview.earnings.map(item => <tr key={item.staffId}><td><b>{item.staffName}</b></td><td>{item.staffNumber}</td><td>{money(item.billTips)}</td><td>{money(item.foodIncentives)}</td><td>{money(item.wineSpiritsIncentives)}</td><td><b>{money(item.totalExtraEarnings)}</b></td><td><span className={`financial-status ${item.status.toLowerCase()}`}>{item.status === 'READY' ? 'Ready' : 'Review'}</span></td></tr>)}</tbody></table></div></section>
  </div>
}

export type { ChargeableConfiguration, ConfigOption }
