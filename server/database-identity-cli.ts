import { isAbsolute, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { canonicalStoreDirectory, createStoreIdentity, SUPPORTED_SCHEMA_VERSION } from './database-protection.js'
import { reviewedMigrationSet } from './migration-store.js'
import { ANDALUCIA_SCOPE_ID, ANDALUCIA_SCOPE_KEY } from './outlet-membership-repository.js'

const configured = process.env.ANDALUCIA_DATA_DIR?.trim()
if (!configured || !isAbsolute(configured) || resolve(configured) !== canonicalStoreDirectory) throw new Error('CANONICAL_STORE_PATH_MISMATCH')
const db = new PGlite(configured)
try {
  const reviewed = await reviewedMigrationSet()
  const expected = reviewed.versions.filter(item => item.version <= SUPPORTED_SCHEMA_VERSION)
  const ledger = (await db.query<{ version: string; checksum: string }>("select version,checksum from schema_migrations where status='applied' order by version")).rows
  if (ledger.length !== expected.length || expected.some(item => ledger.find(row => row.version === item.version)?.checksum !== item.checksum)) throw new Error('CANONICAL_STORE_LEDGER_NOT_ACCEPTED')
  const outlet = (await db.query<{ count: number }>('select count(*)::int count from outlet_scopes where id=$1 and scope_key=$2 and active=true', [ANDALUCIA_SCOPE_ID, ANDALUCIA_SCOPE_KEY])).rows[0]?.count || 0
  const owner = (await db.query<{ count: number }>("select count(*)::int count from user_accounts u join authorization_user_roles ur on ur.user_id=u.id and ur.active=true join authorization_roles r on r.id=ur.role_id and r.active=true where u.status='active' and r.role_key='owner' and r.global_scope=true")).rows[0]?.count || 0
  if (Number(outlet) !== 1 || Number(owner) < 1) throw new Error('CANONICAL_STORE_FOUNDATION_NOT_ACCEPTED')
} finally { await db.close() }
const identity = await createStoreIdentity(configured, 'canonical', { authorization: process.env.ANDALUCIA_STORE_IDENTITY_AUTHORIZATION })
console.log(JSON.stringify({ identityVersion: identity.identityVersion, storeId: identity.storeId, role: identity.role, outletScopeId: identity.outletScopeId }, null, 2))
