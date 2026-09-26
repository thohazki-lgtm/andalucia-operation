import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { StaffRepository } from './staff-repository.js'

const dataDirectory = await mkdtemp(join(tmpdir(), 'andalucia-entitlement-balances-'))
const insertRoster = async (repository: StaffRepository, staffId: string, date: string, dutyCode: string) => {
  await repository.getDatabase().query(
    `insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value)
     values($1,$2,$3,$4)
     on conflict(staff_id,duty_date) do update set duty_code_value=excluded.duty_code_value,updated_at=now()`,
    [randomUUID(), staffId, date, dutyCode]
  )
}

try {
  const repository = new StaffRepository(dataDirectory, new PGlite(dataDirectory))
  await repository.initialize()
  const staff = await repository.list()
  const active = staff.find(person => person.employmentStatus === 'active')!
  const inactive = staff.find(person => person.employmentStatus === 'inactive')!
  const dutyCodes = (await repository.configuration()).dutyCodes
  const working = dutyCodes.find(option => option.metadata?.dutyClassification === 'working')!
  const off = dutyCodes.find(option => option.metadata?.dutyClassification === 'off')!
  const annualLeave = dutyCodes.find(option => option.metadata?.dutyClassification === 'annualLeave')!
  assert.ok(working && off && annualLeave)

  const publicHoliday = await repository.saveConfiguration('duty-codes', {
    id: randomUUID(), value: '', label: 'Validation Public Holiday', color: '#8b6b9e', active: true,
    metadata: { displayCode: 'PHV', dutyClassification: 'publicHoliday', countsAsWorking: true }
  })
  assert.equal(publicHoliday.metadata?.countsAsWorking, false)
  await repository.saveEntitlement({ staffId: active.id, annualLeavePerYear: 30, weeklyOffEntitlement: 1, publicHolidayPerYear: 11 })

  for (const date of ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09']) await insertRoster(repository, active.id, date, annualLeave.value)
  for (const date of ['2026-02-02', '2026-02-03', '2026-02-04']) await insertRoster(repository, active.id, date, publicHoliday.value)
  let balance = await repository.entitlementBalance(active.id, 2026, '2026-08-31', '2026-09-06')
  assert.deepEqual(balance.annualLeave, { entitlement: 30, used: 5, remaining: 25 })
  assert.deepEqual(balance.publicHoliday, { entitlement: 11, used: 3, remaining: 8 })
  assert.deepEqual(balance.weeklyOff, { weekStart: '2026-08-31', weekEnd: '2026-09-06', required: 1, assigned: 0, difference: -1, status: 'short' })

  await insertRoster(repository, active.id, '2026-01-09', working.value)
  await insertRoster(repository, active.id, '2026-02-04', working.value)
  balance = await repository.entitlementBalance(active.id, 2026, '2026-08-31', '2026-09-06')
  assert.deepEqual(balance.annualLeave, { entitlement: 30, used: 4, remaining: 26 })
  assert.deepEqual(balance.publicHoliday, { entitlement: 11, used: 2, remaining: 9 })

  await insertRoster(repository, active.id, '2026-09-07', off.value)
  const compliant = await repository.entitlementBalance(active.id, 2026, '2026-09-07', '2026-09-13')
  assert.deepEqual(compliant.weeklyOff, { weekStart: '2026-09-07', weekEnd: '2026-09-13', required: 1, assigned: 1, difference: 0, status: 'compliant' })
  await insertRoster(repository, active.id, '2026-09-14', off.value)
  await insertRoster(repository, active.id, '2026-09-15', off.value)
  const additional = await repository.entitlementBalance(active.id, 2026, '2026-09-14', '2026-09-20')
  assert.deepEqual(additional.weeklyOff, { weekStart: '2026-09-14', weekEnd: '2026-09-20', required: 1, assigned: 2, difference: 1, status: 'additional' })

  await repository.saveEntitlement({ staffId: inactive.id, annualLeavePerYear: 0, weeklyOffEntitlement: 1, publicHolidayPerYear: 0 })
  await insertRoster(repository, inactive.id, '2024-02-29', annualLeave.value)
  const inactiveLeapYear = await repository.entitlementBalance(inactive.id, 2024, '2024-02-26', '2024-03-03')
  assert.deepEqual(inactiveLeapYear.annualLeave, { entitlement: 0, used: 1, remaining: -1 })

  const historicalLeave = await repository.saveConfiguration('duty-codes', {
    id: randomUUID(), value: '', label: 'Historical Leave', color: '#826f42', active: true,
    metadata: { displayCode: 'HLV', dutyClassification: 'annualLeave', countsAsWorking: false }
  })
  const secondActive = staff.filter(person => person.employmentStatus === 'active')[1]
  await repository.saveEntitlement({ staffId: secondActive.id, annualLeavePerYear: 30, weeklyOffEntitlement: 1, publicHolidayPerYear: 11 })
  await insertRoster(repository, secondActive.id, '2026-12-31', historicalLeave.value)
  const renamed = await repository.saveConfiguration('duty-codes', { ...historicalLeave, label: 'Renamed Historical Leave', color: '#426f82', metadata: { ...historicalLeave.metadata, displayCode: 'RHL' } })
  assert.equal(renamed.value, historicalLeave.value)
  assert.equal((await repository.removeDutyCode(renamed.id)).mode, 'retired')
  const historical2026 = await repository.entitlementBalance(secondActive.id, 2026, '2026-12-28', '2027-01-03')
  assert.equal(historical2026.annualLeave.used, 1)
  await insertRoster(repository, secondActive.id, '2027-01-01', publicHoliday.value)
  const historical2027 = await repository.entitlementBalance(secondActive.id, 2027, '2026-12-28', '2027-01-03')
  assert.equal(historical2027.annualLeave.used, 0)
  assert.equal(historical2027.publicHoliday.used, 1)

  const holidayCalendarRows = await repository.getDatabase().query<{ count: number }>('select count(*)::int count from public_holidays')
  assert.equal(holidayCalendarRows.rows[0].count, 0)
  await repository.getDatabase().close()

  const reopened = new StaffRepository(dataDirectory, new PGlite(dataDirectory))
  await reopened.initialize()
  const afterRestart = await reopened.entitlementBalance(active.id, 2026, '2026-09-14', '2026-09-20')
  assert.deepEqual(afterRestart.annualLeave, { entitlement: 30, used: 4, remaining: 26 })
  assert.deepEqual(afterRestart.publicHoliday, { entitlement: 11, used: 2, remaining: 9 })
  assert.equal(afterRestart.weeklyOff.status, 'additional')
  await reopened.getDatabase().close()

  console.log(JSON.stringify({
    annualLeave: '30 / 5 / 25, then 30 / 4 / 26',
    publicHoliday: '11 / 3 / 8, then 11 / 2 / 9 without calendar dependency',
    weeklyOff: ['short', 'compliant', 'additional'],
    zeroEntitlementNegativeBalance: true,
    inactiveHistoricalStaff: true,
    retiredDutyCodeHistory: true,
    renameSafeImmutableIdentity: true,
    leapYearAndYearBoundary: true,
    apiRestartPersistence: true
  }, null, 2))
} finally {
  await rm(dataDirectory, { recursive: true, force: true })
}
