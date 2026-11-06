import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const fail = code => { throw new Error(code) }
const sourceRoot = resolve(process.env.ANDALUCIA_RECOVERY_RUNTIME_SOURCE_ROOT || fail('RECOVERY_RUNTIME_SOURCE_ROOT_REQUIRED'))
const canonicalRoot = resolve(process.env.ANDALUCIA_RECOVERY_CANONICAL_PROJECT_ROOT || fail('RECOVERY_RUNTIME_CANONICAL_ROOT_REQUIRED'))
const authorizationId = process.env.ANDALUCIA_RECOVERY_AUTHORIZATION_ID || fail('RECOVERY_RUNTIME_AUTHORIZATION_REQUIRED')
const sourceSha = process.env.ANDALUCIA_RECOVERY_RUNTIME_SOURCE_SHA || fail('RECOVERY_RUNTIME_SOURCE_SHA_REQUIRED')
const expectedSourceRoot = resolve(canonicalRoot, '.runtime', 'recovery-source', authorizationId)
const canonicalData = resolve(canonicalRoot, '.data', 'postgres')

if (!/^[0-9a-f]{32}$/i.test(authorizationId)) fail('RECOVERY_RUNTIME_AUTHORIZATION_INVALID')
if (!/^[0-9a-f]{40}$/i.test(sourceSha)) fail('RECOVERY_RUNTIME_SOURCE_SHA_INVALID')
if (sourceRoot !== expectedSourceRoot) fail('RECOVERY_RUNTIME_SOURCE_BINDING_INVALID')
if (resolve(process.env.ANDALUCIA_EXPECTED_CANONICAL_DATA_DIR || '') !== canonicalData) fail('RECOVERY_RUNTIME_CANONICAL_DATA_BINDING_INVALID')
if (process.env.ANDALUCIA_REQUIRED_SCHEMA_VERSION !== '027') fail('RECOVERY_RUNTIME_SCHEMA_BINDING_INVALID')

let sourceHead
try {
  sourceHead = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim()
} catch { fail('RECOVERY_RUNTIME_SOURCE_IDENTITY_UNAVAILABLE') }
if (sourceHead !== sourceSha) fail('RECOVERY_RUNTIME_SOURCE_SHA_MISMATCH')

const originalPath = join(sourceRoot, 'server', 'database-protection.ts')
if (!existsSync(originalPath)) fail('RECOVERY_RUNTIME_DATABASE_PROTECTION_MISSING')
const original = await import(`${pathToFileURL(originalPath).href}?andalucia-recovery-original=${sourceSha}`)

export const defaultBackupRoot = resolve(canonicalRoot, '.backups')
export const operationMarkerPaths = original.operationMarkerPaths
export const publicDatabaseHealth = original.publicDatabaseHealth
export const resolveRuntimeStore = (environment = process.env, expected = {}) => original.resolveRuntimeStore(environment, { ...expected, canonicalDirectory: canonicalData })
export const openVerifiedDatabase = options => original.openVerifiedDatabase({ ...options, backupRoot: options.backupRoot || defaultBackupRoot })
