import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { initializeDevelopmentStore } from './development-store-init.js'
import { CANONICAL_STARTUP_AUTHORIZATION, resolveRuntimeStore } from './database-protection.js'
import { StaffRepository } from './staff-repository.js'

const root = await mkdtemp(join(tmpdir(), 'andalucia-development-isolation-'))
const canonical = join(root, 'canonical', 'postgres')
const development = join(root, 'development', 'postgres')
const backup = join(root, 'backups', 'protected', 'postgres')
for (const path of [canonical, backup]) { await mkdir(path, { recursive: true }); await writeFile(join(path, 'PG_VERSION'), '18\n', 'utf8') }
const expected = { canonicalDirectory: canonical, developmentDirectory: development }

try {
  const initialized = await initializeDevelopmentStore(development)
  assert.equal(initialized.identity.role, 'development')
  assert.notEqual(initialized.identity.storeId, 'andalucia-canonical-live')
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
  const isolatedRuntime = resolveRuntimeStore({ ANDALUCIA_DATA_DIR: development, ANDALUCIA_STORE_ROLE: 'development', NODE_ENV: 'test', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: development }, { canonicalDirectory: canonical })
  assert.equal(isolatedRuntime.dataDirectory, development)
  assert.throws(() => resolveRuntimeStore({ ANDALUCIA_DATA_DIR: canonical, ANDALUCIA_STORE_ROLE: 'development', NODE_ENV: 'test', ANDALUCIA_TEST_DEVELOPMENT_DATA_DIR: canonical }, { canonicalDirectory: canonical }), /TEST_DEVELOPMENT_STORE_MUST_BE_TEMPORARY|CANONICAL_STORE_ROLE_MISMATCH/)
  assert.notEqual(developmentRuntime.dataDirectory, canonicalRuntime.dataDirectory)
  assert.throws(() => resolveRuntimeStore({ ANDALUCIA_DATA_DIR: development, ANDALUCIA_STORE_ROLE: 'canonical', ANDALUCIA_CANONICAL_STARTUP_AUTHORIZATION: CANONICAL_STARTUP_AUTHORIZATION }, expected), /CANONICAL_STORE_PATH_MISMATCH/)

  const disposableDatabase = new PGlite()
  const repository = new StaffRepository(join(root, 'test-repository'), disposableDatabase)
  assert.equal(repository.getDatabase(), disposableDatabase)
  await repository.close()
  assert.equal(StaffRepository.length, 2)

  console.log(JSON.stringify({ developmentStoreInitialized: true, disposableTestDevelopmentSupported: true, developmentIdentityDistinct: true, developmentPhysicallySeparate: true, developmentCannotTargetCanonical: true, developmentCannotOpenBackup: true, testCannotOpenCanonicalRuntime: true, canonicalRequiresGuardedAuthorization: true, canonicalCannotTargetDevelopment: true, missingConfigurationFailsClosed: true, repositoryRequiresInjectedDatabase: true }, null, 2))
} finally { await rm(root, { recursive: true, force: true }) }
