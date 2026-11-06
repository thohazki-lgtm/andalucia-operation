import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = await mkdtemp(join(tmpdir(), 'andalucia-recovery-runtime-'))
const authorizationId = '1234567890abcdef1234567890abcdef'
const sourceRoot = join(root, '.runtime', 'recovery-source', authorizationId)
const resultPath = join(root, 'runtime-result.json')
await mkdir(join(sourceRoot, 'server'), { recursive: true })
await mkdir(join(root, '.data', 'postgres'), { recursive: true })
await writeFile(join(sourceRoot, 'server', 'index.ts'), `
  import { writeFileSync } from 'node:fs'
  writeFileSync(process.env.RECOVERY_RUNTIME_TEST_RESULT, JSON.stringify({ cwd: process.cwd(), source: import.meta.url }))
`)

const bootstrap = join(process.cwd(), 'server', 'recovery-runtime-bootstrap.mjs')
const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
const run = (extraEnv = {}, source = sourceRoot) => spawnSync(process.execPath, [tsxCli, bootstrap, '--source-root', source, '--canonical-root', root, '--authorization-id', authorizationId], {
  cwd: sourceRoot,
  env: {
    ...process.env,
    ANDALUCIA_RECOVERY_AUTHORIZATION_ID: authorizationId,
    ANDALUCIA_EXPECTED_CANONICAL_DATA_DIR: join(root, '.data', 'postgres'),
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

const mismatchedAuthorization = run({ ANDALUCIA_RECOVERY_AUTHORIZATION_ID: 'abcdefabcdefabcdefabcdefabcdefab' })
assert.notEqual(mismatchedAuthorization.status, 0)
assert.match(mismatchedAuthorization.stderr, /RECOVERY_RUNTIME_ENVIRONMENT_BINDING_INVALID/)

const wrongSource = run({}, join(root, 'unapproved-source'))
assert.notEqual(wrongSource.status, 0)
assert.match(wrongSource.stderr, /RECOVERY_RUNTIME_SOURCE_BINDING_INVALID/)

console.log(JSON.stringify({ historicalSourceExecuted: true, canonicalWorkingDirectory: true, authorizationBindingEnforced: true, sourceBindingEnforced: true }))
