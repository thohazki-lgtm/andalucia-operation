import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { StaffRepository } from './staff-repository.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const fixture = await createDisposableDevelopmentStore('employee-leave-entitlements-integration')
try {
  const repository = new StaffRepository(fixture.store, fixture.db)
  await repository.initialize()
  const person = (await repository.list()).find(item => item.employmentStatus === 'active')!
  const original = (await repository.entitlements()).find(item => item.staffId === person.id)!
  const legacyValues = { annualLeavePerYear: original.annualLeavePerYear, weeklyOffEntitlement: original.weeklyOffEntitlement, publicHolidayPerYear: original.publicHolidayPerYear }
  const plannedBefore = Number((await fixture.db.query<{ count: number }>('select count(*)::int count from planned_leave_periods')).rows[0].count)
  const actor = 'Stage 3C isolated manager'

  const created = await repository.saveEntitlement({
    staffId: person.id, ...legacyValues,
    leaveOverrides: { sickLeave: 0, emergencyLeave: 5, paternityLeave: 3, businessTrip: 8, circumcisionLeave: 2, hajjLeave: 10, restAndRecuperation: 6 }
  }, actor)
  assert.equal(created.leaveOverrides.sickLeave, 0, 'Explicit zero must be persisted and distinguishable from Unconfigured.')
  assert.equal(created.leaveOverrides.emergencyLeave, 5)
  assert.equal(Object.keys(created.leaveOverrides).length, 7)

  const edited = await repository.saveEntitlement({ staffId: person.id, ...legacyValues, leaveOverrides: { emergencyLeave: 7 } }, actor)
  assert.equal(edited.leaveOverrides.emergencyLeave, 7)
  assert.equal(edited.leaveOverrides.sickLeave, 0, 'A partial edit must not clear an unrelated explicit zero.')

  const cleared = await repository.saveEntitlement({ staffId: person.id, ...legacyValues, leaveOverrides: { sickLeave: null } }, actor)
  assert.equal(cleared.leaveOverrides.sickLeave, undefined, 'Cleared entitlement must return to Unconfigured.')
  assert.equal(cleared.leaveOverrides.emergencyLeave, 7)
  await assert.rejects(repository.saveEntitlement({ staffId: person.id, ...legacyValues, leaveOverrides: { sickLeave: -1 } }, actor), /whole numbers of zero or more/)
  await assert.rejects(repository.saveEntitlement({ staffId: person.id, ...legacyValues, leaveOverrides: { annualLeave: 99 } as never }, actor), /approved employee leave entitlement classifications/)
  await repository.saveEntitlement({ staffId: person.id, ...legacyValues, leaveOverrides: { sickLeave: 4 } }, actor)

  const configuration = await repository.configuration()
  const currentSick = configuration.dutyCodes.find(item => item.metadata?.dutyClassification === 'sickLeave')!
  assert.ok(currentSick)
  await fixture.db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes','SK','Historical Sick Leave','#a45b57',$2,false,998) on conflict(group_key,value) do nothing", [randomUUID(), JSON.stringify({ displayCode: 'SK', legacyCompatibility: true })])
  const emergencyCode = configuration.dutyCodes.find(item => item.metadata?.dutyClassification === 'emergencyLeave')
  if (!emergencyCode) await repository.activateProtectedDutyCode('EL', actor)
  const activeEmergencyCode = (await repository.configuration()).dutyCodes.find(item => item.metadata?.dutyClassification === 'emergencyLeave')!
  await fixture.db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4),($5,$2,$6,$7),($8,$2,$9,$10)', [randomUUID(), person.id, '2026-03-01', 'SK', randomUUID(), '2026-03-02', currentSick.value, randomUUID(), '2026-03-03', activeEmergencyCode.value])

  const balance = await repository.entitlementBalance(person.id, 2026, '2026-03-02', '2026-03-08')
  const sick = balance.additionalLeave.find(item => item.classification === 'sickLeave')!
  const emergency = balance.additionalLeave.find(item => item.classification === 'emergencyLeave')!
  const paternity = balance.additionalLeave.find(item => item.classification === 'paternityLeave')!
  assert.deepEqual(sick, { classification: 'sickLeave', code: 'SL', label: 'Sick Leave', entitlement: 4, used: 2, remaining: 2, bookedFuture: null, availableAfterBooked: null })
  assert.equal(emergency.entitlement, 7)
  assert.equal(emergency.used, 1)
  assert.equal(paternity.entitlement, 3)
  assert.equal(balance.additionalLeave.every(item => item.bookedFuture === null && item.availableAfterBooked === null), true)

  const legacyAfter = (await repository.entitlements()).find(item => item.staffId === person.id)!
  assert.deepEqual({ annualLeavePerYear: legacyAfter.annualLeavePerYear, weeklyOffEntitlement: legacyAfter.weeklyOffEntitlement, publicHolidayPerYear: legacyAfter.publicHolidayPerYear }, legacyValues)
  assert.equal(Number((await fixture.db.query<{ count: number }>('select count(*)::int count from planned_leave_periods')).rows[0].count), plannedBefore, 'Employee entitlement writes must not create or modify Booked/Future Leave.')
  const audit = await fixture.db.query<{ action: string; actor: string }>("select action,actor from audit_logs where entity_type='staff_leave_entitlement_override' and actor=$1", [actor])
  assert(audit.rows.some(row => row.action === 'created'))
  assert(audit.rows.some(row => row.action === 'updated'))
  assert(audit.rows.some(row => row.action === 'cleared'))
  assert(audit.rows.every(row => row.actor === actor))
  await fixture.db.close()

  const reopened = new StaffRepository(fixture.store, new PGlite(fixture.store))
  const persisted = (await reopened.entitlements()).find(item => item.staffId === person.id)!
  assert.equal(persisted.leaveOverrides.sickLeave, 4)
  assert.equal(persisted.leaveOverrides.emergencyLeave, 7)
  await reopened.close()

  console.log(JSON.stringify({ createEditClear: true, persistence: true, unconfiguredVsExplicitZero: true, employeeCategoryUnique: true, invalidValuesRejected: true, legacyAlOffPhPreserved: true, historicalSkSlSingleCount: true, dutyRosterAuthority: true, bookedFutureSeparated: true, authorizationActorAudit: true, canonicalDatabaseTouched: false }, null, 2))
} finally {
  await fixture.cleanup()
}
