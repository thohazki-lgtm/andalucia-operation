import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { employeeAccountApi } from './api'
import type { EmployeeTemporaryCredential, StaffAccountSummary } from './domain'
import { ActionButton, IconAction } from './action-system'

const lastLogin = (value: string | null) => value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Never'

export function StaffAccountManagement({ onToast }: { onToast: (message: string) => void }) {
  const [accounts, setAccounts] = useState<StaffAccountSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState<StaffAccountSummary | null>(null)
  const [identifier, setIdentifier] = useState('')
  const [busyStaffId, setBusyStaffId] = useState<string | null>(null)
  const [credential, setCredential] = useState<EmployeeTemporaryCredential | null>(null)
  const [credentialCopied, setCredentialCopied] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | StaffAccountSummary['status']>('all')
  const [resetting, setResetting] = useState<StaffAccountSummary | null>(null)
  const [resetConfirmation, setResetConfirmation] = useState('')

  const accountCounts = useMemo(() => accounts.reduce((counts, account) => {
    counts[account.status] += 1
    return counts
  }, { active: 0, disabled: 0, not_created: 0 }), [accounts])
  const visibleAccounts = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    return accounts.filter(account => {
      if (statusFilter !== 'all' && account.status !== statusFilter) return false
      if (!query) return true
      return [account.staffName, account.staffNumber, account.loginIdentifier || ''].some(value => value.toLocaleLowerCase().includes(query))
    })
  }, [accounts, searchQuery, statusFilter])

  const load = async () => {
    setLoading(true); setError('')
    try { setAccounts(await employeeAccountApi.list()) }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load employee accounts.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (!resetting) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && busyStaffId !== resetting.staffId) {
        setResetting(null)
        setResetConfirmation('')
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [resetting, busyStaffId])

  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (!creating || !identifier.trim()) return
    setBusyStaffId(creating.staffId); setError('')
    try {
      const result = await employeeAccountApi.create(creating.staffId, identifier.trim())
      setCredentialCopied(false); setCredential(result); setCreating(null); setIdentifier(''); await load()
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to create the employee account.') }
    finally { setBusyStaffId(null) }
  }

  const reset = async (event: FormEvent) => {
    event.preventDefault()
    if (!resetting || resetConfirmation !== 'RESET') return
    setBusyStaffId(resetting.staffId); setError('')
    try {
      setCredentialCopied(false)
      setCredential(await employeeAccountApi.resetPassword(resetting.staffId, resetConfirmation))
      setResetting(null); setResetConfirmation('')
      await load()
    }
    catch (resetError) { setError(resetError instanceof Error ? resetError.message : 'Unable to reset the password.') }
    finally { setBusyStaffId(null) }
  }

  const closeReset = () => {
    if (resetting && busyStaffId === resetting.staffId) return
    setResetting(null); setResetConfirmation(''); setError('')
  }

  const toggle = async (account: StaffAccountSummary) => {
    const enabling = account.status === 'disabled'
    if (!window.confirm(`${enabling ? 'Enable' : 'Disable'} the account for ${account.staffName}?${enabling ? '' : ' The employee will be signed out immediately.'}`)) return
    setBusyStaffId(account.staffId); setError('')
    try { await employeeAccountApi.setEnabled(account.staffId, enabling); await load(); onToast(`${account.staffName}'s account was ${enabling ? 'enabled' : 'disabled'}.`) }
    catch (toggleError) { setError(toggleError instanceof Error ? toggleError.message : 'Unable to change the account status.') }
    finally { setBusyStaffId(null) }
  }

  const actions = (account: StaffAccountSummary) => <div className="staff-account-actions">
    {account.status === 'not_created' ? <ActionButton variant="primary" icon="add" disabled={!account.staffEligible || busyStaffId === account.staffId} title={account.staffEligible ? undefined : 'Archived or inactive staff cannot receive an employee account.'} onClick={() => { setCreating(account); setIdentifier('') }}>{account.staffEligible ? 'Create Account' : 'Unavailable'}</ActionButton> : <>
      <ActionButton icon="refresh" disabled={busyStaffId === account.staffId || account.status !== 'active'} onClick={() => { setError(''); setResetConfirmation(''); setResetting(account) }}>Reset Password</ActionButton>
      <ActionButton icon={account.status === 'active' ? 'archive' : 'restore'} disabled={busyStaffId === account.staffId || (!account.staffEligible && account.status !== 'active')} title={!account.staffEligible && account.status !== 'active' ? 'Archived or inactive staff accounts cannot be enabled.' : undefined} onClick={() => void toggle(account)}>{account.status === 'active' ? 'Disable' : 'Enable'}</ActionButton>
    </>}
  </div>

  return <section className="panel staff-account-panel">
    <header className="staff-account-header"><div><span className="section-label">SECURE ACCESS</span><h2>Employee Account Management</h2></div><dl className="staff-account-summary" aria-label="Account status summary"><div className="active"><dt>Active</dt><dd>{accountCounts.active}</dd></div><div className="disabled"><dt>Disabled</dt><dd>{accountCounts.disabled}</dd></div><div className="not-created"><dt>No Account</dt><dd>{accountCounts.not_created}</dd></div></dl></header>
    {error && <div className="staff-account-error" role="alert">{error}<ActionButton icon="refresh" compact onClick={() => void load()}>Try again</ActionButton></div>}
    {loading ? <div className="inline-state">Loading employee accounts…</div> : <>
      <div className="staff-account-tools"><label className="staff-account-search"><span>Search employees</span><input type="search" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Name, employee ID or username" /></label><label className="staff-account-filter"><span>Account status</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value as 'all' | StaffAccountSummary['status'])}><option value="all">All statuses</option><option value="active">Active</option><option value="disabled">Disabled</option><option value="not_created">No account</option></select></label></div>
      {visibleAccounts.length ? <>
        <div className="staff-table-wrap" tabIndex={0} aria-label="Employee accounts table"><table className="staff-table staff-account-table"><colgroup><col className="account-name-column"/><col className="account-id-column"/><col className="account-username-column"/><col className="account-status-column"/><col className="account-login-column"/><col className="account-actions-column"/></colgroup><thead><tr><th>Employee Name</th><th>Employee ID</th><th>Username</th><th>Account Status</th><th>Last Login</th><th>Actions</th></tr></thead><tbody>{visibleAccounts.map(account => <tr key={account.staffId}><td><b>{account.staffName}</b></td><td>{account.staffNumber}</td><td>{account.loginIdentifier || '—'}</td><td><span className={`staff-account-status ${account.status}`}>{account.status === 'not_created' ? 'No account' : account.status === 'active' ? 'Active' : 'Disabled'}</span>{account.mustChangePassword && <small>Temporary password</small>}</td><td>{lastLogin(account.lastLoginAt)}</td><td>{actions(account)}</td></tr>)}</tbody></table></div>
        <div className="staff-account-cards">{visibleAccounts.map(account => <article key={account.staffId}><header><div><b>{account.staffName}</b><small>{account.staffNumber}</small></div><span className={`staff-account-status ${account.status}`}>{account.status === 'not_created' ? 'No account' : account.status === 'active' ? 'Active' : 'Disabled'}</span></header><dl><div><dt>Username</dt><dd>{account.loginIdentifier || 'Not created'}</dd></div><div><dt>Last Login</dt><dd>{lastLogin(account.lastLoginAt)}</dd></div></dl>{account.mustChangePassword && <p className="staff-account-note">Password change required at next login.</p>}{actions(account)}</article>)}</div>
      </> : <div className="staff-account-empty"><strong>No employee accounts match these filters.</strong><span>Clear the search or choose another account status.</span></div>}
    </>}
    <footer className="staff-account-guidance"><p>Create and control one employee login per existing Staff profile. Temporary passwords are shown once and must be changed at first login.</p></footer>
    {creating && <div className="staff-account-overlay" role="presentation"><section className="staff-account-modal" role="dialog" aria-modal="true" aria-labelledby="create-account-title"><IconAction icon="close" label="Close" className="close" onClick={() => setCreating(null)}/><span className="section-label">NEW EMPLOYEE LOGIN</span><h2 id="create-account-title">Create account for {creating.staffName}</h2><p>This login will be linked to Staff ID {creating.staffNumber} with employee-only permissions.</p><form onSubmit={event => void create(event)}><label>Username<input autoFocus autoComplete="off" value={identifier} onChange={event => setIdentifier(event.target.value)} placeholder="e.g. firstname.lastname" required minLength={3} /></label><div className="form-actions"><ActionButton onClick={() => setCreating(null)}>Cancel</ActionButton><ActionButton type="submit" variant="primary" icon="add" disabled={busyStaffId === creating.staffId}>Create Account</ActionButton></div></form></section></div>}
    {resetting && <div className="staff-account-overlay" role="presentation"><section className="staff-account-modal staff-account-reset-modal" role="dialog" aria-modal="true" aria-labelledby="reset-password-title" aria-describedby="reset-password-impact"><IconAction icon="close" label="Close" className="close" onClick={closeReset}/><span className="section-label">PASSWORD SECURITY</span><h2 id="reset-password-title">Reset employee password</h2><dl className="staff-account-reset-subject"><div><dt>Employee</dt><dd>{resetting.staffName}</dd></div><div><dt>Staff ID</dt><dd>{resetting.staffNumber}</dd></div></dl><p id="reset-password-impact" className="staff-account-security-impact"><strong>Existing employee sessions will be revoked.</strong> A new temporary password will be shown once and must be changed at the employee's next login.</p>{error && <div className="staff-account-modal-error" role="alert">{error}</div>}<form onSubmit={event => void reset(event)}><label>Type <strong>RESET</strong> to confirm<input autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false} value={resetConfirmation} onChange={event => setResetConfirmation(event.target.value)} aria-label="Type RESET to confirm" /></label><div className="form-actions"><ActionButton disabled={busyStaffId === resetting.staffId} onClick={closeReset}>Cancel</ActionButton><ActionButton type="submit" variant="primary" icon="refresh" className="staff-account-reset-confirm" disabled={resetConfirmation !== 'RESET' || busyStaffId === resetting.staffId}>Reset Password</ActionButton></div></form></section></div>}
    {credential && <div className="staff-account-overlay" role="presentation"><section className="staff-account-modal" role="dialog" aria-modal="true" aria-labelledby="temporary-password-title"><span className="section-label">SHOW ONCE</span><h2 id="temporary-password-title">Temporary sign-in details</h2><p>Give these details directly to {credential.account.staffName}. The password is not stored in readable form and will not be shown again.</p><dl className="temporary-credential"><div><dt>Username</dt><dd>{credential.account.loginIdentifier}</dd></div><div><dt>Temporary password</dt><dd>{credential.temporaryPassword}</dd></div></dl><ActionButton icon="save" className="copy-temporary-password" onClick={() => void navigator.clipboard.writeText(credential.temporaryPassword).then(() => setCredentialCopied(true), () => setError('The password could not be copied. Record the displayed value exactly.'))}>{credentialCopied ? 'Password Copied' : 'Copy Temporary Password'}</ActionButton><p className="staff-account-note">The employee must choose a new password at first login.</p><div className="form-actions"><ActionButton variant="primary" icon="check" onClick={() => setCredential(null)}>I have recorded it securely</ActionButton></div></section></div>}
  </section>
}
