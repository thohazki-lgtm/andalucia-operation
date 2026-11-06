import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { registerHooks } from 'node:module'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const fail = code => { throw new Error(code) }
const value = name => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const sourceRoot = resolve(value('--source-root') || fail('RECOVERY_RUNTIME_SOURCE_ROOT_REQUIRED'))
const canonicalRoot = resolve(value('--canonical-root') || fail('RECOVERY_RUNTIME_CANONICAL_ROOT_REQUIRED'))
const authorizationId = value('--authorization-id') || fail('RECOVERY_RUNTIME_AUTHORIZATION_REQUIRED')
const sourceSha = process.env.ANDALUCIA_ACTIVE_SOURCE_SHA || fail('RECOVERY_RUNTIME_SOURCE_SHA_REQUIRED')
const expectedSourceRoot = resolve(canonicalRoot, '.runtime', 'recovery-source', authorizationId)

if (!/^[0-9a-f]{32}$/i.test(authorizationId)) fail('RECOVERY_RUNTIME_AUTHORIZATION_INVALID')
if (!/^[0-9a-f]{40}$/i.test(sourceSha)) fail('RECOVERY_RUNTIME_SOURCE_SHA_INVALID')
if (sourceRoot !== expectedSourceRoot) fail('RECOVERY_RUNTIME_SOURCE_BINDING_INVALID')
if (process.env.ANDALUCIA_RECOVERY_AUTHORIZATION_ID !== authorizationId) fail('RECOVERY_RUNTIME_ENVIRONMENT_BINDING_INVALID')
if (resolve(process.env.ANDALUCIA_EXPECTED_CANONICAL_DATA_DIR || '') !== resolve(canonicalRoot, '.data', 'postgres')) fail('RECOVERY_RUNTIME_CANONICAL_DATA_BINDING_INVALID')
if (process.env.ANDALUCIA_REQUIRED_SCHEMA_VERSION !== '027') fail('RECOVERY_RUNTIME_SCHEMA_BINDING_INVALID')

let sourceHead
try {
  sourceHead = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim()
} catch { fail('RECOVERY_RUNTIME_SOURCE_IDENTITY_UNAVAILABLE') }
if (sourceHead !== sourceSha) fail('RECOVERY_RUNTIME_SOURCE_SHA_MISMATCH')

const entry = join(sourceRoot, 'server', 'index.ts')
if (!existsSync(entry)) fail('RECOVERY_RUNTIME_ENTRY_MISSING')

const entryUrl = pathToFileURL(entry).href
const compatibilityUrl = pathToFileURL(join(import.meta.dirname, 'recovery-runtime-database-compat.mjs')).href
process.env.ANDALUCIA_RECOVERY_RUNTIME_SOURCE_ROOT = sourceRoot
process.env.ANDALUCIA_RECOVERY_CANONICAL_PROJECT_ROOT = canonicalRoot
process.env.ANDALUCIA_RECOVERY_RUNTIME_SOURCE_SHA = sourceSha
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === entryUrl && specifier === './database-protection.js') {
      return { url: compatibilityUrl, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

process.chdir(canonicalRoot)
await import(entryUrl)
