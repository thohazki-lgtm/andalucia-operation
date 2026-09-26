import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { MaintenanceRepository } from './maintenance-repository.js'
import { ReportingRepository } from './reporting-repository.js'
import type { MaintenanceRecord } from '../src/domain.js'

const db = new PGlite()
await db.exec(await readFile('database/schema.sql', 'utf8'))
const maintenance = new MaintenanceRepository(db)
await maintenance.initialize()
const areas = (await maintenance.configuration()).areas
const area = areas[0].value
const record = (issue: string, dateReported: string, status: string): MaintenanceRecord => ({ id: randomUUID(), issue, dateReported, area, status, notes: '', reportedByStaffId: null, reportedBy: null })
const retimeLatestAudit = async (id: string, timestamp: string) => {
  const audit = await db.query<{ id: string }>("select id from audit_logs where entity_type='maintenance_issue' and entity_id=$1 order by created_at desc,id desc limit 1", [id])
  await db.query('update audit_logs set created_at=$2 where id=$1', [audit.rows[0].id, timestamp])
}

const issueA = await maintenance.save(record('Issue A', '2026-09-08', 'open'))
const issueB = await maintenance.save(record('Issue B', '2026-09-08', 'in_progress'))
const issueC = await maintenance.save(record('Issue C', '2026-09-08', 'completed'))
await retimeLatestAudit(issueC.id, '2026-09-08T08:00:00+05:00')
const reporting = new ReportingRepository(db)
let daily = await reporting.report('today', '2026-09-08', '2026-09-08')
assert.deepEqual({ open: daily.maintenance.open, inProgress: daily.maintenance.inProgress, completedToday: daily.maintenance.completedToday }, { open: 1, inProgress: 1, completedToday: 1 })

await maintenance.save({ ...issueA, status: 'in_progress' })
await retimeLatestAudit(issueA.id, '2026-09-08T09:00:00+05:00')
daily = await reporting.report('today', '2026-09-08', '2026-09-08')
assert.deepEqual({ open: daily.maintenance.open, inProgress: daily.maintenance.inProgress, completedToday: daily.maintenance.completedToday }, { open: 0, inProgress: 2, completedToday: 1 })

await maintenance.save({ ...issueA, status: 'completed' })
await retimeLatestAudit(issueA.id, '2026-09-08T10:00:00+05:00')
daily = await reporting.report('today', '2026-09-08', '2026-09-08')
assert.deepEqual({ open: daily.maintenance.open, inProgress: daily.maintenance.inProgress, completedToday: daily.maintenance.completedToday }, { open: 0, inProgress: 1, completedToday: 2 })
assert.equal(daily.maintenance.issuesReported, 3)
assert.deepEqual(daily.maintenance.byDate, [{ date: '2026-09-08', issuesReported: 3, completed: 2 }])

const weeklyA = await maintenance.save(record('Weekly A', '2026-09-14', 'open'))
await maintenance.save(record('Weekly B', '2026-09-15', 'in_progress'))
const weeklyC = await maintenance.save(record('Weekly C', '2026-09-18', 'completed'))
await maintenance.save({ ...weeklyA, status: 'completed' })
await retimeLatestAudit(weeklyA.id, '2026-09-16T12:00:00+05:00')
await retimeLatestAudit(weeklyC.id, '2026-09-18T12:00:00+05:00')
const week = await reporting.report('week', '2026-09-14', '2026-09-20')
assert.deepEqual({ reported: week.maintenance.issuesReported, open: week.maintenance.open, inProgress: week.maintenance.inProgress, completed: week.maintenance.completedDuringPeriod }, { reported: 3, open: 0, inProgress: 1, completed: 2 })
assert.equal(week.maintenance.byDate.reduce((sum, row) => sum + row.issuesReported, 0), 3)
assert.equal(week.maintenance.byDate.reduce((sum, row) => sum + row.completed, 0), 2)

const boundary = await maintenance.save(record('Month boundary', '2026-08-31', 'open'))
await maintenance.save({ ...boundary, status: 'completed' })
await retimeLatestAudit(boundary.id, '2026-09-02T08:00:00+05:00')
const month = await reporting.report('month', '2026-09-01', '2026-09-30')
assert.equal(month.maintenance.records.some(row => row.id === boundary.id), false)
assert.equal(month.maintenance.byDate.find(row => row.date === '2026-09-02')?.completed, 1)
assert.equal(month.maintenance.byWeek.length, 5)
assert.equal(month.maintenance.byWeek.reduce((sum, row) => sum + row.completed, 0), 5)

const custom = await reporting.report('custom', '2026-09-02', '2026-09-18')
assert.equal(custom.maintenance.completedDuringPeriod, 5)
assert.equal(custom.maintenance.byDate.length, 17)
const repeated = await reporting.report('today', '2026-09-08', '2026-09-08')
assert.deepEqual(repeated.maintenance, daily.maintenance)
const zero = await reporting.report('today', '2026-10-01', '2026-10-01')
assert.deepEqual({ reported: zero.maintenance.issuesReported, open: zero.maintenance.open, inProgress: zero.maintenance.inProgress, completed: zero.maintenance.completedToday }, { reported: 0, open: 0, inProgress: 0, completed: 0 })

console.log(JSON.stringify({ daily: daily.maintenance, weekly: week.maintenance, monthlyWeeks: month.maintenance.byWeek, customCompleted: custom.maintenance.completedDuringPeriod, zero: zero.maintenance }, null, 2))
