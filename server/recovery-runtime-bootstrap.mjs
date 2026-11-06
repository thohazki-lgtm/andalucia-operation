import { existsSync } from 'node:fs'
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
const expectedSourceRoot = resolve(canonicalRoot, '.runtime', 'recovery-source', authorizationId)

if (!/^[0-9a-f]{32}$/i.test(authorizationId)) fail('RECOVERY_RUNTIME_AUTHORIZATION_INVALID')
if (sourceRoot !== expectedSourceRoot) fail('RECOVERY_RUNTIME_SOURCE_BINDING_INVALID')
if (process.env.ANDALUCIA_RECOVERY_AUTHORIZATION_ID !== authorizationId) fail('RECOVERY_RUNTIME_ENVIRONMENT_BINDING_INVALID')
if (resolve(process.env.ANDALUCIA_EXPECTED_CANONICAL_DATA_DIR || '') !== resolve(canonicalRoot, '.data', 'postgres')) fail('RECOVERY_RUNTIME_CANONICAL_DATA_BINDING_INVALID')

const entry = join(sourceRoot, 'server', 'index.ts')
if (!existsSync(entry)) fail('RECOVERY_RUNTIME_ENTRY_MISSING')

process.chdir(canonicalRoot)
await import(pathToFileURL(entry).href)
