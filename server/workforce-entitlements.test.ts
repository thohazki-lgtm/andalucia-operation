import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { StaffRepository } from './staff-repository.js'

const dataDirectory = await mkdtemp(join(tmpdir(), 'andalucia-workforce-foundation-'))
try {
  const repository = new StaffRepository(dataDirectory, new PGlite(dataDirectory))
  await repository.initialize()
  const initial = await repository.entitlements()
  const active = initial.find(item => item.employmentStatus === 'active')!
  const inactive = initial.find(item => item.employmentStatus === 'inactive')!
  assert.equal(initial.filter(item => item.employmentStatus === 'active').length, 5)
  assert.deepEqual([active.annualLeavePerYear, active.weeklyOffEntitlement, active.publicHolidayPerYear, active.persisted], [30, 1, 11, false])
  await repository.saveEntitlement({ staffId: active.staffId, annualLeavePerYear: 31, weeklyOffEntitlement: 2, publicHolidayPerYear: 12 })
  await repository.saveEntitlement({ staffId: inactive.staffId, annualLeavePerYear: 40, weeklyOffEntitlement: 0, publicHolidayPerYear: 11 })
  await assert.rejects(() => repository.saveEntitlement({ staffId: active.staffId, annualLeavePerYear: -1, weeklyOffEntitlement: 1, publicHolidayPerYear: 11 }), /zero or more/)

  const holiday2026 = await repository.savePublicHoliday({ id: randomUUID(), name: 'Validation Holiday', date: '2026-07-26', days: 1, active: true })
  const editedHoliday = await repository.savePublicHoliday({ ...holiday2026, name: 'Validation Holiday Updated', days: 2, active: false })
  assert.equal(editedHoliday.date, '2026-07-26')
  assert.equal(editedHoliday.days, 2)
  assert.equal(editedHoliday.active, false)
  const holiday2027 = await repository.savePublicHoliday({ id: randomUUID(), name: 'Next Year Validation', date: '2027-01-01', days: 1, active: true })
  assert.equal((await repository.publicHolidays(2026)).length, 1)
  assert.equal((await repository.publicHolidays(2027)).length, 1)
  await repository.removePublicHoliday(holiday2027.id)
  assert.equal((await repository.publicHolidays(2027)).length, 0)
  await repository.getDatabase().close()

  const reopened = new StaffRepository(dataDirectory, new PGlite(dataDirectory))
  await reopened.initialize()
  const persisted = await reopened.entitlements()
  assert.deepEqual(persisted.find(item => item.staffId === active.staffId) && [persisted.find(item => item.staffId === active.staffId)!.annualLeavePerYear, persisted.find(item => item.staffId === active.staffId)!.weeklyOffEntitlement, persisted.find(item => item.staffId === active.staffId)!.publicHolidayPerYear], [31, 2, 12])
  assert.equal(persisted.find(item => item.staffId === inactive.staffId)?.annualLeavePerYear, 40)
  assert.equal(persisted.find(item => item.staffId === inactive.staffId)?.employmentStatus, 'inactive')
  assert.equal((await reopened.publicHolidays(2026))[0].name, 'Validation Holiday Updated')
  await reopened.getDatabase().close()
  console.log(JSON.stringify({ activeStaffLinked: true, defaultsAvailable: true, entitlementPersistence: true, negativeValuesRejected: true, inactiveHistoryPreserved: true, holidayAddEditStatus: true, yearFiltering: true, unusedHolidayRemoval: true, restartPersistence: true }, null, 2))
} finally {
  await rm(dataDirectory, { recursive: true, force: true })
}
