import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { initializeDevelopmentStore } from './development-store-init.js'
import { createStoreIdentity } from './database-protection.js'
import { runMigrations } from './migration-store.js'

async function seedOwner(db: PGlite, name: string) {
  const ownerId = randomUUID()
  await db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status,created_by,updated_by) values($1,$2,$2,$3,'test-only-not-a-login-secret','active','synthetic fixture','synthetic fixture')", [ownerId, `${name}.owner`, `${name} Owner`])
  await db.query("insert into authorization_user_roles(id,user_id,role_id,active,created_by,updated_by) select $1,$2,id,true,'synthetic fixture','synthetic fixture' from authorization_roles where role_key='owner'", [randomUUID(), ownerId])
  return ownerId
}

export async function createDisposableDevelopmentStore(name: string) {
  const root = await mkdtemp(join(tmpdir(), `andalucia-${name}-`))
  const store = join(root, 'development', 'postgres')
  await initializeDevelopmentStore(store)
  const db = new PGlite(store)
  const ownerId = await seedOwner(db, name)
  return {
    root, store, db, ownerId,
    cleanup: async () => { await db.close().catch(() => undefined); await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 }) }
  }
}

export async function createDisposableStoreThrough(name: string, throughVersion: string) {
  const root = await mkdtemp(join(tmpdir(), `andalucia-${name}-`))
  const store = join(root, 'development', 'postgres')
  await mkdir(join(root, 'development'), { recursive: true })
  const db = new PGlite(store)
  await db.exec(await readFile(resolve('database/schema.sql'), 'utf8'))
  await runMigrations(db, { throughVersion })
  await createStoreIdentity(store, 'development', { storeId: `andalucia-${name}-${randomUUID()}` })
  const ownerId = await seedOwner(db, name)
  return { root, store, db, ownerId, cleanup: async () => { await db.close().catch(() => undefined); await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 }) } }
}
