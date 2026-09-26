import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import type { AuthPrincipal, ChargeableRecord } from '../src/domain.js'
import { AuthorizationService } from './authorization-service.js'
import { ChargeableRepository } from './chargeable-repository.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { runMigrations } from './migration-store.js'

const db = new PGlite()
try {
  await db.exec(await readFile('database/schema.sql', 'utf8')); await runMigrations(db)
  const authorization = new AuthorizationService(db)
  const ownerId = randomUUID(); const managerId = randomUUID(); const otherOutletId = randomUUID()
  await db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status) values($1,'scope-owner','scope-owner','Scope Owner','unused','active'),($2,'scope-manager','scope-manager','Scope Manager','unused','active')", [ownerId, managerId])
  await db.query("insert into authorization_user_roles(id,user_id,role_id,active) select $1,$2,id,true from authorization_roles where role_key='owner'", [randomUUID(), ownerId])
  await db.query("insert into authorization_user_roles(id,user_id,role_id,active) select $1,$2,id,true from authorization_roles where role_key='outlet_manager'", [randomUUID(), managerId])
  await db.query("insert into outlet_scopes(id,scope_key,display_name,active,outlet_type) values($1,'future_outlet','Future Outlet',true,'restaurant')", [otherOutletId])
  await db.query('insert into authorization_user_outlet_scopes(id,user_id,outlet_scope_id,active) values($1,$2,$3,true)', [randomUUID(), managerId, ANDALUCIA_SCOPE_ID])
  const principal = async (userId: string, identifier: string, name: string): Promise<AuthPrincipal> => ({ userId, sessionId: null as unknown as string, loginIdentifier: identifier, displayName: name, staffId: null, ...await authorization.authorizationForUser(userId) })
  const owner = await principal(ownerId, 'scope-owner', 'Scope Owner'); const manager = await principal(managerId, 'scope-manager', 'Scope Manager')
  await authorization.requireOutletPermission(owner, 'manage_chargeables', ANDALUCIA_SCOPE_ID)
  await authorization.requireOutletPermission(manager, 'manage_chargeables', ANDALUCIA_SCOPE_ID)
  await assert.rejects(() => authorization.requireOutletPermission(manager, 'manage_chargeables', otherOutletId), /not authorized for the requested outlet scope/i)

  const repository = new ChargeableRepository(db); await repository.initialize()
  const waiterId = randomUUID(); const bookingId = randomUUID()
  await db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'SW2155','LAKSHIT SHARMA','F&B Attendant','active','2026-01-01')", [waiterId])
  await db.query("insert into bookings(id,guest_name,reservation_date,reservation_time,booking_status,covers,booking_source,room_number,table_number,waiter_id,booking_number) values($1,'Ahmed','2026-09-10','19:30','confirmed',2,'manual','888','table_3',$2,'SCOPE-BOOKING-1')", [bookingId, waiterId])
  const existingIds: string[] = []
  for (let index = 0; index < 6; index++) {
    const id = randomUUID(); existingIds.push(id)
    await db.query("insert into chargeable_item_records(id,outlet_scope_id,booking_id,item_value,amount,waiter_id,status,charge_date,guest_name,room_number,table_number,item_label,item_category,quantity,unit_price,total_amount,notes,active,check_invoice_number) values($1,$2,null,'birthday_basic',75,$3,'charged','2026-09-01',$4,'700','table_1','Birthday Basic','Celebration',1,75,75,'Existing fixture',true,$5)", [id, ANDALUCIA_SCOPE_ID, waiterId, `Existing Guest ${index + 1}`, `EXISTING-CHECK-${index + 1}`])
  }
  const protectedBefore = JSON.stringify((await db.query<any>('select * from chargeable_item_records where id=any($1::uuid[]) order by id', [existingIds])).rows)
  const lobster = (await repository.configuration()).items.find(item => item.value === 'lobster_paella')!
  const charged = (await repository.configuration()).statuses.find(item => item.metadata?.countsAsRealizedRevenue)!
  const pending = (await repository.configuration()).statuses.find(item => item.metadata?.countsAsPendingValue)!
  const record: ChargeableRecord = { id: randomUUID(), date: '2026-09-10', bookingId, guestName: 'Ahmed', roomNumber: '888', checkInvoiceNumber: 'SCOPE-CHECK-001', tableNumber: 'table_3', itemValue: lobster.value, itemLabel: lobster.label, itemCategory: lobster.metadata?.category || '', quantity: 1, unitPrice: 999, totalAmount: 999, waiterId, waiter: null, status: pending.value, notes: 'Outlet scope validation', active: true }
  const malicious = { ...record, outletScopeId: otherOutletId, outlet: 'Future Outlet', isOwner: true, role: 'owner' }
  const saved = await repository.save(malicious, { outletScopeId: ANDALUCIA_SCOPE_ID, actor: `Scope Owner [${ownerId}]` })
  assert.deepEqual({ unitPrice: saved.unitPrice, totalAmount: saved.totalAmount, waiterId: saved.waiterId, bookingId: saved.bookingId }, { unitPrice: 85, totalAmount: 85, waiterId, bookingId })
  const stored = (await db.query<any>('select outlet_scope_id,waiter_id,unit_price::text,total_amount::text from chargeable_item_records where id=$1', [saved.id])).rows[0]
  assert.deepEqual(stored, { outlet_scope_id: ANDALUCIA_SCOPE_ID, waiter_id: waiterId, unit_price: '85.00', total_amount: '85.00' })
  const edited = await repository.save({ ...saved, notes: 'Edited safely', outletScopeId: otherOutletId } as ChargeableRecord, { outletScopeId: ANDALUCIA_SCOPE_ID, actor: `Scope Owner [${ownerId}]` })
  assert.equal(edited.notes, 'Edited safely'); assert.equal((await db.query<any>('select outlet_scope_id from chargeable_item_records where id=$1', [saved.id])).rows[0].outlet_scope_id, ANDALUCIA_SCOPE_ID)
  const realized = await repository.save({ ...edited, status: charged.value }, { outletScopeId: ANDALUCIA_SCOPE_ID, actor: `Scope Owner [${ownerId}]` })
  await assert.rejects(() => repository.save(realized, { outletScopeId: otherOutletId, actor: 'Wrong outlet' }), /cannot be moved to another outlet/i)
  await assert.rejects(() => repository.save({ ...record, id: randomUUID() }), /authorized Chargeable Item outlet could not be resolved/i)
  const pendingRecord = await repository.save({ ...record, id: randomUUID(), status: pending.value }, { outletScopeId: ANDALUCIA_SCOPE_ID, actor: `Scope Owner [${ownerId}]` })
  const summary = await repository.summary('2026-09-10', ANDALUCIA_SCOPE_ID)
  assert.deepEqual({ records: summary.totalCharges, realized: summary.realizedRevenue, pending: summary.pendingValue }, { records: 2, realized: 85, pending: 85 })
  assert.equal((await repository.list('2026-09-10', ANDALUCIA_SCOPE_ID)).some(item => item.id === pendingRecord.id), true)
  const audit = (await db.query<any>('select actor,after_data from audit_logs where entity_type=\'chargeable_item\' and entity_id=$1 order by created_at desc limit 1', [saved.id])).rows[0]
  assert.equal(audit.after_data.outletScopeId, ANDALUCIA_SCOPE_ID); assert.match(audit.actor, new RegExp(ownerId))
  assert.equal(JSON.stringify((await db.query<any>('select * from chargeable_item_records where id=any($1::uuid[]) order by id', [existingIds])).rows), protectedBefore)
  console.log(JSON.stringify({ ownerCreate: true, outletScopeId: stored.outlet_scope_id, sellerPreserved: stored.waiter_id === waiterId, lobster: { unitPrice: stored.unit_price, total: stored.total_amount }, pendingExcludedFromRealized: true, updateScopePreserved: true, maliciousOverrideIgnored: true, unauthorizedOutletDenied: true, existingSixUnchanged: true, auditIncludesOutletScope: true }, null, 2))
} finally { await db.close() }
