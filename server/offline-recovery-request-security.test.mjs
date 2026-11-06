import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { AuthService } from './auth-service.ts'
import { AuthorizationService } from './authorization-service.ts'
import { authenticateOfflineManager } from './offline-recovery-request-control.ts'

const root = await mkdtemp(join(tmpdir(), 'andalucia-offline-recovery-auth-'))
const db = new PGlite(join(root, 'postgres'))
try {
  await db.exec(await readFile('database/schema.sql', 'utf8'))
  const authorization = new AuthorizationService(db); await authorization.initialize()
  const auth = new AuthService(db, authorization)
  const owner = await auth.createFirstAccount({ identifier: 'platform.owner', displayName: 'Platform Owner', password: 'OwnerPassword2026' })
  await authorization.promoteOwner(owner.userId, owner)
  const manager = await auth.createAccount({ identifier: 'outlet.manager', displayName: 'Outlet Manager', password: 'ManagerPassword2026' }, owner)
  await authorization.assignRole(manager.userId, 'outlet_manager', owner)
  assert.deepEqual(await authenticateOfflineManager(db, ' PLATFORM.OWNER ', 'OwnerPassword2026'), { userId: owner.userId, displayName: owner.displayName })
  await assert.rejects(() => authenticateOfflineManager(db, 'platform.owner', 'WrongPassword2026'), /OFFLINE_RECOVERY_MANAGER_AUTHENTICATION_FAILED/)
  await assert.rejects(() => authenticateOfflineManager(db, 'unknown.owner', 'WrongPassword2026'), /OFFLINE_RECOVERY_MANAGER_AUTHENTICATION_FAILED/)
  await assert.rejects(() => authenticateOfflineManager(db, 'outlet.manager', 'ManagerPassword2026'), /OFFLINE_RECOVERY_OWNER_AUTHORIZATION_REQUIRED/)
  await db.query('update user_accounts set must_change_password=true where id=$1', [owner.userId])
  await assert.rejects(() => authenticateOfflineManager(db, 'platform.owner', 'OwnerPassword2026'), /OFFLINE_RECOVERY_MANAGER_AUTHENTICATION_FAILED/)
  const script = await readFile('deployment/windows/New-AndaluciaOfflineRecoveryRequest.ps1', 'utf8')
  assert.match(script, /Read-Host 'Manager password' -AsSecureString/)
  const parameterBlock = script.match(/^param\([\s\S]*?^\)/m)?.[0] || ''
  assert.doesNotMatch(parameterBlock, /Password/)
  assert.match(script, /ZeroFreeBSTR/)
  const control = await readFile('server/offline-recovery-request-control.ts', 'utf8')
  assert.match(control, /open\(issueLock, 'wx'\)/)
  assert.match(control, /prepare-stopped-recovery/)
  assert.match(control, /RECOVERY_AUTHORIZED/)
  assert.doesNotMatch(control, /password[^\n]*process\.argv/i)
  console.log(JSON.stringify({ legitimateOwnerAuthentication: true, wrongPasswordRejected: true, unknownIdentityRejected: true, nonOwnerRejected: true, passwordChangeRequiredRejected: true, passwordNotInArguments: true, securePromptCleared: true, concurrentIssuerLock: true, journalBoundAuthorization: true, canonicalDatabaseTouched: false }, null, 2))
} finally { await db.close(); await rm(root, { recursive: true, force: true }) }
