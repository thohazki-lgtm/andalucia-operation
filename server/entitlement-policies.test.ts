import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { StaffRepository } from './staff-repository.js'

const dataDirectory = await mkdtemp(join(tmpdir(), 'andalucia-entitlement-policies-'))
try {
  const repository = new StaffRepository(dataDirectory, new PGlite(dataDirectory))
  await repository.initialize()
  const policies = await repository.entitlementPolicies()
  assert.equal(policies.length, 10)
  assert.deepEqual(policies.map(item => item.code), ['AL', 'SL', 'EL', 'PAT', 'BT', 'CIR', 'HAJ', 'RR', 'OFF', 'PH'])
  assert.equal(policies.every(item => item.configurable), true)
  assert.deepEqual(policies.filter(item => !item.activationRequired).map(item => [item.code, item.defaultAllowance, item.cadence, item.persisted]), [['AL', 30, 'annual', false], ['OFF', 1, 'weekly', false], ['PH', 11, 'annual', false]])
  assert.deepEqual(policies.filter(item => item.activationRequired).map(item => [item.code, item.defaultAllowance, item.approvedAllowance]), [['SL', null, 30], ['EL', null, 10], ['PAT', null, 3], ['BT', null, 360], ['CIR', null, 5], ['HAJ', null, 45], ['RR', null, 6]])
  assert.equal(Number((await repository.getDatabase().query<{ count: number }>("select count(*)::int count from configuration_options where group_key='leave_entitlement_policies'")).rows[0].count), 0, 'Fallbacks must not backfill policy rows.')

  const initial = await repository.entitlements()
  const overridden = initial[0]
  const inherited = initial[1]
  await repository.saveEntitlement({ staffId: overridden.staffId, annualLeavePerYear: 31, weeklyOffEntitlement: 2, publicHolidayPerYear: 12 }, 'Policy test manager')
  const annual = policies.find(item => item.classification === 'annualLeave')!
  await repository.saveEntitlementPolicy({ ...annual, defaultAllowance: 35 }, 'Policy test manager')
  const afterPolicy = await repository.entitlements()
  assert.equal(afterPolicy.find(item => item.staffId === overridden.staffId)?.annualLeavePerYear, 31, 'Existing employee override must not be overwritten.')
  assert.equal(afterPolicy.find(item => item.staffId === inherited.staffId)?.annualLeavePerYear, 35, 'Employees without overrides must inherit the saved policy.')
  assert.equal(afterPolicy.find(item => item.staffId === inherited.staffId)?.persisted, false)
  const inheritedBalance = await repository.entitlementBalance(inherited.staffId, 2026, '2026-10-05', '2026-10-11')
  assert.equal(inheritedBalance.annualLeave.entitlement, 35)
  assert.equal(inheritedBalance.annualLeave.remaining, 35)
  await repository.saveEntitlementPolicy({ ...policies.find(item => item.classification === 'sickLeave')!, defaultAllowance: 30 }, 'Policy test manager')
  const inheritedSick = (await repository.entitlementBalance(inherited.staffId, 2026, '2026-10-05', '2026-10-11')).additionalLeave.find(item => item.classification === 'sickLeave')!
  assert.equal(inheritedSick.entitlement, 30, 'Activated shared defaults must be inherited when no individual override exists.')
  assert.equal(Number((await repository.getDatabase().query<{ count: number }>("select count(*)::int count from audit_logs where entity_type='leave_entitlement_policy'")).rows[0].count), 2)
  assert.equal((await repository.publicHolidays(2026)).length, 0, 'PH allowance policy must remain separate from the calendar.')
  await repository.close()

  const reopened = new StaffRepository(dataDirectory, new PGlite(dataDirectory))
  await reopened.initialize()
  assert.equal((await reopened.entitlementPolicies()).find(item => item.classification === 'annualLeave')?.defaultAllowance, 35)
  assert.equal((await reopened.entitlementPolicies()).find(item => item.classification === 'sickLeave')?.defaultAllowance, 30)
  assert.equal((await reopened.entitlements()).find(item => item.staffId === inherited.staffId)?.annualLeavePerYear, 35)
  await reopened.close()
  console.log(JSON.stringify({ protectedTypes: 10, existingDefaultsPreserved: true, noAutomaticBackfill: true, configurableDefaults: true, employeeOverridePrecedence: true, policyInheritance: true, auditEvidence: true, publicHolidayCalendarSeparated: true, persistence: true }, null, 2))
} finally {
  await rm(dataDirectory, { recursive: true, force: true })
}
