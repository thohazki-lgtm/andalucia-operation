import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { GuestOccasionRepository } from './guest-occasion-repository.js'
import { ReportingRepository } from './reporting-repository.js'
import type { GuestOccasionRecord } from '../src/domain.js'

const db = new PGlite()
await db.exec(await readFile('database/schema.sql', 'utf8'))
const occasions = new GuestOccasionRepository(db)
await occasions.initialize()
const counts: Record<string, number> = { honeymoon: 2, birthday: 3, anniversary: 1, see_you_soon: 1, siyam_family: 2, famtrip: 1, presstrip: 1 }
const created: GuestOccasionRecord[] = []
for (const [occasionType, count] of Object.entries(counts)) for (let index = 0; index < count; index++) {
  const record: GuestOccasionRecord = { id: randomUUID(), occasionType, bookingId: null, guestName: `${occasionType} ${index}`, roomNumber: String(100 + index), reservationDate: '2026-09-08', reservationTime: '19:00', tableNumber: '', waiterId: null, waiter: null, status: index % 3 === 0 ? 'pending' : index % 3 === 1 ? 'ready' : 'completed', source: 'manual', sourceText: '', notes: '', active: true }
  created.push(await occasions.save(record, 'Reporting test'))
}
await occasions.save({ ...created[0], status: 'completed' }, 'Reporting test')
const configuration = await occasions.configuration()
const historical = configuration.types.find(option => option.value === 'presstrip')!
await occasions.saveConfiguration('types', { ...historical, active: false })

const reporting = new ReportingRepository(db)
const daily = await reporting.report('today', '2026-09-08', '2026-09-08')
assert.equal(daily.occasions.total, 11)
assert.deepEqual(Object.fromEntries(daily.occasions.byCategory.map(item => [item.label, item.count])), { Honeymoon: 2, Birthday: 3, Anniversary: 1, 'See You Soon': 1, 'Siyam Family': 2, Famtrip: 1, Presstrip: 1 })
assert.equal(daily.occasions.byCategory.reduce((sum, item) => sum + item.count, 0), 11)
assert.equal(daily.occasions.byStatus.reduce((sum, item) => sum + item.count, 0), 11)

const week = await reporting.report('week', '2026-09-07', '2026-09-13')
assert.equal(week.occasions.byDate.length, 7)
assert.equal(week.occasions.byDate.find(item => item.date === '2026-09-08')?.total, 11)
assert.ok(week.occasions.byDate.filter(item => item.date !== '2026-09-08').every(item => item.total === 0 && item.byCategory.every(category => category.count === 0)))

const month = await reporting.report('month', '2026-09-01', '2026-09-30')
assert.equal(month.occasions.byWeek.length, 5)
assert.equal(month.occasions.byWeek.reduce((sum, item) => sum + item.total, 0), 11)
assert.equal(month.occasions.byCategory.find(item => item.label === 'Presstrip')?.count, 1)

const custom = await reporting.report('custom', '2026-09-08', '2026-09-09')
assert.equal(custom.occasions.total, 11)
assert.equal(custom.occasions.byDate.length, 2)
console.log(JSON.stringify({ daily: daily.occasions, weeklyDays: week.occasions.byDate.length, monthlyWeeks: month.occasions.byWeek.length }, null, 2))
