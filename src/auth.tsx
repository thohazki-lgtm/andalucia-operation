import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { authApi } from './api'
import type { AuthenticatedUser, AuthorizationPermissionKey } from './domain'

type AuthContextValue = { user: AuthenticatedUser; logout: () => Promise<void>; can: (permission: AuthorizationPermissionKey) => boolean; canForOutlet: (permission: AuthorizationPermissionKey, outletScopeId: string) => boolean }
const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('Authenticated application context is unavailable.')
  return context
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'setup' | 'login' | 'authenticated'>('loading')
  const [user, setUser] = useState<AuthenticatedUser | null>(null)
  const [error, setError] = useState('')
  const bootstrap = async () => {
    setState('loading'); setError('')
    try {
      const status = await authApi.bootstrapStatus()
      if (!status.accountConfigured) { setState('setup'); return }
      try { const current = await authApi.me(); setUser(current); setState('authenticated') }
      catch { setUser(null); setState('login') }
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Authentication service is unavailable.'); setState('login') }
  }
  useEffect(() => { void bootstrap() }, [])
  const login = async (identifier: string, password: string) => { const current = await authApi.login(identifier, password); setUser(current); setState('authenticated') }
  const logout = async () => { try { await authApi.logout() } finally { setUser(null); setState('login') } }
  if (state === 'loading') return <AuthFrame><div className="auth-loading" role="status">Checking secure session…</div></AuthFrame>
  if (state === 'setup') return <AuthFrame><section className="auth-card setup-required"><p className="eyebrow">FIRST ACCOUNT REQUIRED</p><h1>Secure account setup</h1><p>No platform account has been created. Run the explicit one-time account bootstrap command on the trusted server, then return here.</p><code>npm run auth:bootstrap</code><button className="secondary" onClick={() => void bootstrap()}>Check Again</button></section></AuthFrame>
  if (state === 'login' || !user) return <LoginForm serviceError={error} onLogin={login} />
  const can = (permission: AuthorizationPermissionKey) => user.permissionKeys.includes(permission)
  const canForOutlet = (permission: AuthorizationPermissionKey, outletScopeId: string) => can(permission) && (user.globalScope || user.allowedOutletScopeIds.includes(outletScopeId))
  return <AuthContext.Provider value={{ user, logout, can, canForOutlet }}>{children}</AuthContext.Provider>
}

function LoginForm({ serviceError, onLogin }: { serviceError: string; onLogin: (identifier: string, password: string) => Promise<void> }) {
  const [identifier, setIdentifier] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(serviceError); const [submitting, setSubmitting] = useState(false)
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(''); setSubmitting(true); try { await onLogin(identifier, password) } catch (loginError) { setError(loginError instanceof Error ? loginError.message : 'Sign in could not be completed.') } finally { setSubmitting(false) } }
  return <AuthFrame><section className="auth-card"><p className="eyebrow">SECURE PLATFORM ACCESS</p><h1>Welcome back</h1><p>Sign in to continue to ANDALUCÍA OPERATION.</p><form onSubmit={event => void submit(event)}><label>Username or email<input autoComplete="username" required value={identifier} onChange={event => setIdentifier(event.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign In'}</button></form></section></AuthFrame>
}

function AuthFrame({ children }: { children: ReactNode }) { return <main className="auth-page"><div className="auth-brand"><span>Á</span><div><b>ANDALUCÍA</b><small>OPERATION</small></div></div>{children}<p className="auth-location">Siyam World Maldives · Venue operations</p></main> }

export function AuthUserButton() {
  const { user, logout } = useAuth(); const [open, setOpen] = useState(false)
  const initials = user.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U'
  const roleLabel = user.isOwner ? 'Owner / Super Admin' : user.roleKeys.includes('outlet_manager') ? 'Outlet Manager' : user.roleKeys.includes('operational_user') ? 'Operational User' : user.roleKeys.includes('viewer') ? 'Viewer' : null
  return <div className="auth-user"><button className="avatar" type="button" aria-label={`${user.displayName} account menu`} title={user.displayName} aria-expanded={open} onClick={() => setOpen(value => !value)}>{initials}</button>{open && <div className="auth-user-menu"><b>{user.displayName}</b><span>{user.loginIdentifier}</span>{roleLabel && <em>{roleLabel}</em>}<button className="secondary" onClick={() => void logout()}>Sign Out</button></div>}</div>
}
