import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { ChargeableRepository } from './chargeable-repository.js'
import { runMigrations } from './migration-store.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import type { ChargeableRecord } from '../src/domain.js'

const db = new PGlite()
await db.exec(await readFile('database/schema.sql', 'utf8'))
await runMigrations(db)
const waiterId = randomUUID()
const bookingId = randomUUID()
await db.query('insert into staff (id, staff_number, full_name, position_key, employment_status_key, join_date) values ($1,$2,$3,$4,$5,$6)', [waiterId, 'TEST-001', 'Test Waiter', 'Waiter', 'active', '2026-01-01'])
await db.query('insert into bookings (id, guest_name, reservation_date, reservation_time, booking_status, covers, booking_source, room_number, table_number, waiter_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [bookingId, 'Linked Guest', '2026-09-01', '18:00', 'confirmed', 2, 'manual', '101', 'T01', waiterId])
const repository = new ChargeableRepository(db)
await repository.initialize()
const configuration = await repository.configuration()
const lobster = configuration.items.find(item => item.value === 'lobster_paella')!
const pending = configuration.statuses.find(item => item.metadata?.chargeableStage === 'pending')!
const charged = configuration.statuses.find(item => item.metadata?.chargeableStage === 'charged')!
const saveContext = { outletScopeId: ANDALUCIA_SCOPE_ID, actor: 'Chargeable repository test' }
const record = (id: string): ChargeableRecord => ({ id, date: '2026-09-01', bookingId, guestName: 'Linked Guest', roomNumber: '101', checkInvoiceNumber: 'TEST-CHECK-001', tableNumber: 'T01', itemValue: lobster.value, itemLabel: lobster.label, itemCategory: lobster.metadata?.category || '', quantity: 2, unitPrice: Number(lobster.metadata?.price), totalAmount: 0, waiterId, waiter: null, status: pending.value, notes: '', active: true })

const original = await repository.save(record(randomUUID()), saveContext)
assert.equal(original.unitPrice, 85)
assert.equal(original.totalAmount, 170)
await repository.saveConfiguration('items', { ...lobster, metadata: { ...lobster.metadata, price: 100 } }, saveContext)
const originalChargedMetadata = structuredClone(charged.metadata)
const protectedCharged = await repository.saveConfiguration('statuses', { ...charged, label: 'Posted', color: '#123456', active: false, metadata: { ...charged.metadata, countsAsRealizedRevenue: false, countsAsPendingValue: true } }, saveContext)
assert.equal(protectedCharged.label, 'Charged')
assert.equal(protectedCharged.active, true)
assert.equal(protectedCharged.color, '#123456')
assert.deepEqual(protectedCharged.metadata, originalChargedMetadata)
assert.equal(protectedCharged.metadata?.countsAsRealizedRevenue, true)
assert.equal(protectedCharged.metadata?.countsAsPendingValue, false)
await assert.rejects(() => repository.saveConfiguration('statuses', { id: randomUUID(), value: 'posted', label: 'Posted', active: true }, saveContext), /cannot be created/)
assert.equal(Number((await db.query<any>("select count(*)::int count from audit_logs where entity_type='chargeable_configuration'")).rows[0].count), 2)
const historical = await repository.save({ ...original, quantity: 3, status: charged.value }, saveContext)
assert.equal(historical.unitPrice, 85)
assert.equal(historical.totalAmount, 255)
assert.equal((await repository.create({ ...historical }, saveContext)).id, historical.id)
await assert.rejects(() => repository.save({ ...historical, notes: 'Ordinary edit is forbidden' }, saveContext), /immutable/)
const current = await repository.save({ ...record(randomUUID()), quantity: 1 }, saveContext)
assert.equal(current.unitPrice, 100)
assert.equal(current.totalAmount, 100)
assert.equal((await repository.duplicateWarnings({ ...record(randomUUID()), quantity: 1 }, ANDALUCIA_SCOPE_ID)).length, 1)
await db.query("update staff set employment_status_key='inactive',full_name='Renamed Waiter' where id=$1", [waiterId])
const preservedWaiter = await repository.find(historical.id, ANDALUCIA_SCOPE_ID)
assert.ok(preservedWaiter)
assert.equal(preservedWaiter.waiterId, waiterId)
assert.equal(preservedWaiter.waiter?.name, 'Test Waiter')
await assert.rejects(() => repository.save({ ...record(randomUUID()), waiterId }, saveContext), /Inactive staff/)
const summary = await repository.summary('2026-09-01', ANDALUCIA_SCOPE_ID)
assert.deepEqual(summary, { totalCharges: 2, totalValue: 355, realizedRevenue: 255, pendingValue: 100, charged: 1, pending: 1, itemsSold: 3, topSeller: 'Lobster Paella', guests: 1 })
await assert.rejects(() => repository.save({ ...historical, status: 'cancelled' }, saveContext), /correction reason/)
const corrected = await repository.save({ ...historical, status: 'cancelled', correctionReason: 'Manager verified duplicate signed check' }, saveContext)
assert.equal(corrected.status, 'cancelled')
console.log(JSON.stringify({ historicalUnitPrice: preservedWaiter.unitPrice, newUnitPrice: current.unitPrice, historicalWaiterRetained: preservedWaiter.waiterId === waiterId, summary }, null, 2))
