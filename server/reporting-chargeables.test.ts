import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { ChargeableRepository } from './chargeable-repository.js'
import { ReportingRepository } from './reporting-repository.js'
import { runMigrations } from './migration-store.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import type { ChargeableRecord } from '../src/domain.js'

const db = new PGlite()
await db.exec(await readFile('database/schema.sql', 'utf8'))
await runMigrations(db)
const waiterA = randomUUID(); const waiterB = randomUUID()
await db.query('insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12)', [waiterA, 'WA', 'Waiter A', 'Waiter', 'active', '2026-01-01', waiterB, 'WB', 'Waiter B', 'Waiter', 'active', '2026-01-01'])
const repository = new ChargeableRepository(db)
await repository.initialize()
const writeContext = { outletScopeId: ANDALUCIA_SCOPE_ID, actor: 'Isolated reporting regression' }
const configuration = await repository.configuration()
const item = (value: string) => configuration.items.find(option => option.value === value)!
const record = (itemValue: string, quantity: number, waiterId: string | null, status = 'charged', date = '2026-09-08'): ChargeableRecord => ({ id: randomUUID(), date, bookingId: null, guestName: 'Reporting guest', roomNumber: '101', tableNumber: '', checkInvoiceNumber: `CHK-${randomUUID()}`, itemValue, itemLabel: item(itemValue).label, itemCategory: item(itemValue).metadata?.category || '', quantity, unitPrice: 0, totalAmount: 0, waiterId, waiter: null, status, notes: '', active: true })

const lobster = await repository.save(record('lobster_paella', 2, waiterA), writeContext)
await repository.save(record('birthday_basic', 1, waiterB), writeContext)
await repository.save(record('birthday_premium', 1, waiterA), writeContext)
await repository.save(record('anniversary_basic', 2, waiterB), writeContext)
await repository.save(record('lobster_paella', 10, waiterA, 'pending'), writeContext)
await repository.save(record('lobster_paella', 10, waiterA, 'cancelled'), writeContext)
const archived = await repository.save(record('lobster_paella', 5, waiterA, 'pending'), writeContext)
await repository.archive(archived.id, writeContext)
await db.query('update staff set employment_status_key=$2 where id=$1', [waiterB, 'inactive'])
const lobsterConfig = item('lobster_paella')
await repository.saveConfiguration('items', { ...lobsterConfig, metadata: { ...lobsterConfig.metadata, price: 90 } }, writeContext)

const reporting = new ReportingRepository(db)
const daily = await reporting.report('today', '2026-09-08', '2026-09-08')
assert.equal(lobster.unitPrice, 85)
assert.deepEqual({ revenue: daily.chargeables.realizedRevenue, sold: daily.chargeables.itemsSold, topItem: daily.chargeables.topItem?.item, topWaiter: daily.chargeables.topWaiter?.waiter }, { revenue: 530, sold: 6, topItem: 'Birthday', topWaiter: 'Waiter A' })
assert.deepEqual(daily.chargeables.byItem.map(row => [row.item, row.quantity, row.revenue]), [['Birthday', 2, 210], ['Lobster Paella', 2, 170], ['Anniversary', 2, 150]])
assert.deepEqual(daily.chargeables.byWaiter.map(row => [row.waiter, row.itemsSold, row.revenue, row.employmentStatus]), [['Waiter A', 3, 305, 'active'], ['Waiter B', 3, 225, 'inactive']])
assert.equal(daily.chargeables.byWaiter.reduce((sum, row) => sum + row.revenuePercent, 0), 100)
assert.deepEqual(daily.chargeables.byDate[0], { date: '2026-09-08', realizedRevenue: 530, itemsSold: 6 })

const week = await reporting.report('week', '2026-09-07', '2026-09-13')
assert.equal(week.chargeables.byDate.length, 7)
assert.equal(week.chargeables.byDate.reduce((sum, row) => sum + row.realizedRevenue, 0), 530)
const month = await reporting.report('month', '2026-09-01', '2026-09-30')
assert.equal(month.chargeables.byWeek.length, 5)
assert.equal(month.chargeables.byWeek.reduce((sum, row) => sum + row.realizedRevenue, 0), 530)
const custom = await reporting.report('custom', '2026-09-08', '2026-09-09')
assert.equal(custom.chargeables.realizedRevenue, 530)
const zero = await reporting.report('today', '2026-10-01', '2026-10-01')
assert.deepEqual({ revenue: zero.chargeables.realizedRevenue, sold: zero.chargeables.itemsSold, topItem: zero.chargeables.topItem, topWaiter: zero.chargeables.topWaiter }, { revenue: 0, sold: 0, topItem: null, topWaiter: null })
console.log(JSON.stringify({ daily: daily.chargeables, weeklyDays: week.chargeables.byDate.length, monthlyWeeks: month.chargeables.byWeek.length }, null, 2))
