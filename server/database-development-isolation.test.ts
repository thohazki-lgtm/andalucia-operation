import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeDevelopmentStore } from './development-store-init.js'
import { CANONICAL_STARTUP_AUTHORIZATION, resolveRuntimeStore } from './database-protection.js'

const root = await mkdtemp(join(tmpdir(), 'andalucia-development-isolation-'))
const canonical = join(root, 'canonical', 'postgres')
const development = join(root, 'development', 'postgres')
try {
  const initialized = await initializeDevelopmentStore(development)
  assert.equal(initialized.identity.role, 'development')
  assert.notEqual(initialized.identity.storeId, 'andalucia-canonical-live')
  assert.equal(resolveRuntimeStore({ ANDALUCIA_DATA_DIR: development, ANDALUCIA_STORE_ROLE: 'development' }, { canonicalDirectory: canonical, developmentDirectory: development }).role, 'development')
  assert.throws(() => resolveRuntimeStore({ ANDALUCIA_DATA_DIR: canonical, ANDALUCIA_STORE_ROLE: 'development' }, { canonicalDirectory: canonical, developmentDirectory: development }), /DEVELOPMENT_STORE_PATH_MISMATCH|CANONICAL_STORE_ROLE_MISMATCH/)
  assert.throws(() => resolveRuntimeStore({ ANDALUCIA_DATA_DIR: canonical, ANDALUCIA_STORE_ROLE: 'canonical' }, { canonicalDirectory: canonical, developmentDirectory: development }), /CANONICAL_GUARDED_STARTUP_REQUIRED/)
  assert.throws(() => resolveRuntimeStore({ ANDALUCIA_DATA_DIR: development, ANDALUCIA_STORE_ROLE: 'canonical', ANDALUCIA_CANONICAL_STARTUP_AUTHORIZATION: CANONICAL_STARTUP_AUTHORIZATION }, { canonicalDirectory: canonical, developmentDirectory: development }), /CANONICAL_STORE_PATH_MISMATCH/)
  console.log(JSON.stringify({ developmentStoreInitialized: true, developmentIdentityDistinct: true, developmentCannotTargetCanonical: true, canonicalRequiresGuardedAuthorization: true, canonicalCannotTargetDevelopment: true }, null, 2))
} finally { await rm(root, { recursive: true, force: true }) }
