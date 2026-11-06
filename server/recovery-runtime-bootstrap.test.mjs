import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const disposableRoot = resolve('.tmp-tests')
await mkdir(disposableRoot, { recursive: true })
const root = await mkdtemp(join(disposableRoot, 'andalucia-recovery-runtime-'))
const authorizationId = '1234567890abcdef1234567890abcdef'
const sourceRoot = join(root, '.runtime', 'recovery-source', authorizationId)
const resultPath = join(root, 'runtime-result.json')
await mkdir(join(sourceRoot, 'server'), { recursive: true })
await mkdir(join(root, '.data', 'postgres'), { recursive: true })
await writeFile(join(sourceRoot, 'server', 'database-protection.ts'), `
  export const operationMarkerPaths = value => ({ postmaster: value })
  export const publicDatabaseHealth = value => value
  export const openVerifiedDatabase = async options => options
  export const resolveRuntimeStore = (_environment, expected = {}) => ({ dataDirectory: expected.canonicalDirectory })
`)
await writeFile(join(sourceRoot, 'server', 'index.ts'), `
  import { writeFileSync } from 'node:fs'
  import { resolveRuntimeStore } from './database-protection.js'
  writeFileSync(process.env.RECOVERY_RUNTIME_TEST_RESULT, JSON.stringify({ cwd: process.cwd(), source: import.meta.url, store: resolveRuntimeStore().dataDirectory }))
`)
execFileSync('git', ['init'], { cwd: sourceRoot, stdio: 'ignore' })
execFileSync('git', ['config', 'user.email', 'recovery-fixture@example.invalid'], { cwd: sourceRoot })
execFileSync('git', ['config', 'user.name', 'Recovery Fixture'], { cwd: sourceRoot })
execFileSync('git', ['add', '.'], { cwd: sourceRoot })
execFileSync('git', ['commit', '-m', 'fixture'], { cwd: sourceRoot, stdio: 'ignore' })
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim()

const bootstrap = join(process.cwd(), 'server', 'recovery-runtime-bootstrap.mjs')
const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
const run = (extraEnv = {}, source = sourceRoot) => spawnSync(process.execPath, [tsxCli, bootstrap, '--source-root', source, '--canonical-root', root, '--authorization-id', authorizationId], {
  cwd: sourceRoot,
  env: {
    ...process.env,
    ANDALUCIA_RECOVERY_AUTHORIZATION_ID: authorizationId,
    ANDALUCIA_EXPECTED_CANONICAL_DATA_DIR: join(root, '.data', 'postgres'),
    ANDALUCIA_ACTIVE_SOURCE_SHA: sourceSha,
    ANDALUCIA_REQUIRED_SCHEMA_VERSION: '027',
    RECOVERY_RUNTIME_TEST_RESULT: resultPath,
    ...extraEnv,
  },
  encoding: 'utf8',
})

const valid = run()
assert.equal(valid.status, 0, valid.stderr || valid.stdout)
const result = JSON.parse(await readFile(resultPath, 'utf8'))
assert.equal(result.cwd, root)
assert.match(result.source, /recovery-source\/1234567890abcdef1234567890abcdef\/server\/index\.ts$/)
assert.equal(result.store, join(root, '.data', 'postgres'))

const mismatchedAuthorization = run({ ANDALUCIA_RECOVERY_AUTHORIZATION_ID: 'abcdefabcdefabcdefabcdefabcdefab' })
assert.notEqual(mismatchedAuthorization.status, 0)
assert.match(mismatchedAuthorization.stderr, /RECOVERY_RUNTIME_ENVIRONMENT_BINDING_INVALID/)

const wrongSource = run({}, join(root, 'unapproved-source'))
assert.notEqual(wrongSource.status, 0)
assert.match(wrongSource.stderr, /RECOVERY_RUNTIME_SOURCE_BINDING_INVALID/)

const wrongSha = run({ ANDALUCIA_ACTIVE_SOURCE_SHA: 'a'.repeat(40) })
assert.notEqual(wrongSha.status, 0)
assert.match(wrongSha.stderr, /RECOVERY_RUNTIME_SOURCE_SHA_MISMATCH/)

const wrongSchema = run({ ANDALUCIA_REQUIRED_SCHEMA_VERSION: '026' })
assert.notEqual(wrongSchema.status, 0)
assert.match(wrongSchema.stderr, /RECOVERY_RUNTIME_SCHEMA_BINDING_INVALID/)

const wrongDatabaseRoot = run({ ANDALUCIA_EXPECTED_CANONICAL_DATA_DIR: join(root, 'other', 'postgres') })
assert.notEqual(wrongDatabaseRoot.status, 0)
assert.match(wrongDatabaseRoot.stderr, /RECOVERY_RUNTIME_CANONICAL_DATA_BINDING_INVALID/)

const missingAuthorizationBinding = run({ ANDALUCIA_RECOVERY_AUTHORIZATION_ID: '' })
assert.notEqual(missingAuthorizationBinding.status, 0)
assert.match(missingAuthorizationBinding.stderr, /RECOVERY_RUNTIME_ENVIRONMENT_BINDING_INVALID/)

const ordinaryStartup = spawnSync(process.execPath, [tsxCli, bootstrap], { cwd: sourceRoot, env: process.env, encoding: 'utf8' })
assert.notEqual(ordinaryStartup.status, 0)
assert.match(ordinaryStartup.stderr, /RECOVERY_RUNTIME_SOURCE_ROOT_REQUIRED/)

console.log(JSON.stringify({ historicalSourceExecuted: true, canonicalWorkingDirectory: true, canonicalStoreBindingApplied: true, authorizationBindingEnforced: true, sourceBindingEnforced: true, sourceShaBindingEnforced: true, schemaBindingEnforced: true, wrongDatabaseRootRejected: true, missingBindingRejected: true, ordinaryStartupRejected: true }))
