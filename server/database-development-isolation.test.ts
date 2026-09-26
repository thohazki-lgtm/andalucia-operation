import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CANONICAL_STARTUP_AUTHORIZATION, resolveRuntimeStore } from './database-protection.js'
import { StaffRepository } from './staff-repository.js'
import { PGlite } from '@electric-sql/pglite'

const root = await mkdtemp(join(tmpdir(), 'andalucia-development-isolation-'))
const canonical = join(root, 'canonical', 'postgres')
const development = join(root, 'development', 'postgres')
const backup = join(root, 'backups', 'protected', 'postgres')
for (const path of [canonical, development, backup]) { await mkdir(path, { recursive: true }); await writeFile(join(path, 'PG_VERSION'), '18\n', 'utf8') }
const expected = { canonicalDirectory: canonical, developmentDirectory: development }

try {
  assert.throws(() => resolveRuntimeStore({}, expected), /ANDALUCIA_DATA_DIR_REQUIRED/)
  assert.throws(() => resolveRuntimeStore({ ANDALUCIA_DATA_DIR: canonical, ANDALUCIA_STORE_ROLE: 'development' }, expected), /DEVELOPMENT_STORE_PATH_MISMATCH|CANONICAL_STORE_ROLE_MISMATCH/)
  assert.throws(() => resolveRuntimeStore({ ANDALUCIA_DATA_DIR: backup, ANDALUCIA_STORE_ROLE: 'development' }, expected), /DEVELOPMENT_STORE_PATH_MISMATCH/)
  assert.throws(() => resolveRuntimeStore({ ANDALUCIA_DATA_DIR: canonical, ANDALUCIA_STORE_ROLE: 'test' }, expected), /APPLICATION_RUNTIME_ROLE_FORBIDDEN/)
  assert.throws(() => resolveRuntimeStore({ ANDALUCIA_DATA_DIR: canonical, ANDALUCIA_STORE_ROLE: 'canonical' }, expected), /CANONICAL_GUARDED_STARTUP_REQUIRED/)
  const canonicalRuntime = resolveRuntimeStore({ ANDALUCIA_DATA_DIR: canonical, ANDALUCIA_STORE_ROLE: 'canonical', ANDALUCIA_CANONICAL_STARTUP_AUTHORIZATION: CANONICAL_STARTUP_AUTHORIZATION }, expected)
  assert.equal(canonicalRuntime.dataDirectory, canonical)
  assert.equal(canonicalRuntime.role, 'canonical')
  const developmentRuntime = resolveRuntimeStore({ ANDALUCIA_DATA_DIR: development, ANDALUCIA_STORE_ROLE: 'development' }, expected)
  assert.equal(developmentRuntime.dataDirectory, development)
  assert.equal(developmentRuntime.role, 'development')
  assert.notEqual(developmentRuntime.dataDirectory, canonicalRuntime.dataDirectory)

  const disposableDatabase = new PGlite()
  const repository = new StaffRepository(join(root, 'test-repository'), disposableDatabase)
  assert.equal(repository.getDatabase(), disposableDatabase)
  await repository.close()
  assert.equal(StaffRepository.length, 2)

  console.log(JSON.stringify({ developmentPhysicallySeparate: true, developmentCannotOpenCanonical: true, developmentCannotOpenBackup: true, testCannotOpenCanonicalRuntime: true, canonicalRequiresGuardedAuthorization: true, missingConfigurationFailsClosed: true, repositoryRequiresInjectedDatabase: true }, null, 2))
} finally { await rm(root, { recursive: true, force: true }) }
