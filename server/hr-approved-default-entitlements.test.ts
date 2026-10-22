import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { EmployeeOverrideLeaveClassification, LeaveClassification } from '../src/domain.js'
import { StaffRepository } from './staff-repository.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const approvedAdditionalDefaults: Record<EmployeeOverrideLeaveClassification, number> = {
  sickLeave: 30,
  emergencyLeave: 10,
  paternityLeave: 3,
  businessTrip: 360,
  circumcisionLeave: 5,
  hajjLeave: 45,
  restAndRecuperation: 6,
}

const fixture = await createDisposableDevelopmentStore('hr-approved-default-entitlements')
try {
  const repository = new StaffRepository(fixture.store, fixture.db)
  await repository.initialize()

  const initialStaff = await repository.list()
  for (let index = initialStaff.length; index < 12; index += 1) {
    await fixture.db.query(
      "insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date,created_by,updated_by) values($1,$2,$3,'Waiter','active',$4,'isolated test','isolated test')",
      [randomUUID(), `HR-${String(index + 1).padStart(3, '0')}`, `HR Default Fixture ${index + 1}`, `202${index % 4}-0${(index % 8) + 1}-01`],
    )
  }
  const staff = (await repository.list()).slice(0, 12)
  assert.equal(staff.length, 12, 'The default policy must be validated across all 12 staff positions.')

  const before = {
    policies: Number((await fixture.db.query<{ count: number }>("select count(*)::int count from configuration_options where group_key='leave_entitlement_policies'")).rows[0].count),
    yearly: Number((await fixture.db.query<{ count: number }>('select count(*)::int count from staff_leave_entitlement_years')).rows[0].count),
    serviceYears: Number((await fixture.db.query<{ count: number }>('select count(*)::int count from staff_annual_leave_service_years')).rows[0].count),
    planned: Number((await fixture.db.query<{ count: number }>('select count(*)::int count from planned_leave_periods')).rows[0].count),
    activeDutyCodes: Number((await fixture.db.query<{ count: number }>("select count(*)::int count from configuration_options where group_key='duty_codes' and active=true")).rows[0].count),
  }
  assert.equal(before.policies, 0)

  const prepared = await repository.entitlementPolicies()
  assert.deepEqual(
    prepared.map(policy => [policy.code, policy.defaultAllowance, policy.approvedAllowance, policy.activationRequired]),
    [
      ['AL', 30, 30, false], ['SL', null, 30, true], ['EL', null, 10, true], ['PAT', null, 3, true],
      ['BT', null, 360, true], ['CIR', null, 5, true], ['HAJ', null, 45, true], ['RR', null, 6, true],
      ['OFF', 1, 1, false], ['PH', 11, 11, false],
    ],
    'Preparation must expose approved values without silently activating the seven missing defaults.',
  )

  for (const [classification, allowance] of Object.entries(approvedAdditionalDefaults)) {
    const policy = prepared.find(item => item.classification === classification as LeaveClassification)!
    await repository.saveEntitlementPolicy({ ...policy, defaultAllowance: allowance }, 'Stage 3Q isolated HR manager')
  }

  const afterActivation = {
    policies: Number((await fixture.db.query<{ count: number }>("select count(*)::int count from configuration_options where group_key='leave_entitlement_policies'")).rows[0].count),
    yearly: Number((await fixture.db.query<{ count: number }>('select count(*)::int count from staff_leave_entitlement_years')).rows[0].count),
    serviceYears: Number((await fixture.db.query<{ count: number }>('select count(*)::int count from staff_annual_leave_service_years')).rows[0].count),
    planned: Number((await fixture.db.query<{ count: number }>('select count(*)::int count from planned_leave_periods')).rows[0].count),
    activeDutyCodes: Number((await fixture.db.query<{ count: number }>("select count(*)::int count from configuration_options where group_key='duty_codes' and active=true")).rows[0].count),
  }
  assert.equal(afterActivation.policies, 7)
  assert.deepEqual(
    { yearly: afterActivation.yearly, serviceYears: afterActivation.serviceYears, planned: afterActivation.planned, activeDutyCodes: afterActivation.activeDutyCodes },
    { yearly: before.yearly, serviceYears: before.serviceYears, planned: before.planned, activeDutyCodes: before.activeDutyCodes },
    'Shared-policy activation must not backfill records, create historical evidence, alter bookings, or activate Duty Codes.',
  )

  for (const person of staff) {
    const balance = await repository.entitlementBalance(person.id, 2026, '2026-10-05', '2026-10-11')
    assert.deepEqual(Object.fromEntries(balance.additionalLeave.map(line => [line.classification, line.entitlement])), approvedAdditionalDefaults)
    assert.equal(balance.publicHoliday.entitlement, 11)
    assert.equal(balance.weeklyOff.required, 1)
  }

  const explicitZeroStaff = staff[0]
  const inheritedStaff = staff[1]
  const legacy = (await repository.entitlements()).find(item => item.staffId === explicitZeroStaff.id)!
  await repository.saveEntitlement({
    staffId: explicitZeroStaff.id,
    annualLeavePerYear: legacy.annualLeavePerYear,
    weeklyOffEntitlement: legacy.weeklyOffEntitlement,
    publicHolidayPerYear: legacy.publicHolidayPerYear,
    leaveOverrides: { sickLeave: 0 },
  }, 'Stage 3Q isolated HR manager')
  assert.equal((await repository.entitlementBalance(explicitZeroStaff.id, 2026, '2026-10-05', '2026-10-11')).additionalLeave.find(line => line.classification === 'sickLeave')?.entitlement, 0)
  assert.equal((await repository.entitlementBalance(inheritedStaff.id, 2026, '2026-10-05', '2026-10-11')).additionalLeave.find(line => line.classification === 'sickLeave')?.entitlement, 30)

  await fixture.db.query(
    'insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4),($5,$2,$6,$7)',
    [randomUUID(), inheritedStaff.id, '2026-03-01', 'SK', randomUUID(), '2026-03-02', 'SL'],
  )
  const currentYear = await repository.entitlementBalance(inheritedStaff.id, 2026, '2026-10-05', '2026-10-11')
  const nextYear = await repository.entitlementBalance(inheritedStaff.id, 2027, '2027-01-04', '2027-01-10')
  assert.deepEqual(currentYear.additionalLeave.find(line => line.classification === 'sickLeave'), { classification: 'sickLeave', code: 'SL', label: 'Sick Leave', entitlement: 30, used: 2, remaining: 28, bookedFuture: null, availableAfterBooked: null })
  assert.deepEqual(nextYear.additionalLeave.find(line => line.classification === 'sickLeave'), { classification: 'sickLeave', code: 'SL', label: 'Sick Leave', entitlement: 30, used: 0, remaining: 30, bookedFuture: null, availableAfterBooked: null })

  const reconciliation = await repository.entitlementReconciliation(inheritedStaff.id, 2026, '2026-10-05', '2026-10-11')
  assert.equal(reconciliation.lines.length, 10)
  assert.equal(reconciliation.confirmedUsageSource, 'DUTY_ROSTER')
  assert.equal(reconciliation.bookedFutureSource, 'PLANNED_LEAVE_SEPARATE')
  assert.equal(reconciliation.lines.find(line => line.classification === 'sickLeave')?.source, 'policy_default')
  assert.equal(reconciliation.lines.find(line => line.classification === 'sickLeave')?.used, 2)
  assert.equal(reconciliation.lines.find(line => line.classification === 'sickLeave')?.remaining, 28)
  assert.equal((await repository.entitlementReconciliation(explicitZeroStaff.id, 2026, '2026-10-05', '2026-10-11')).lines.find(line => line.classification === 'sickLeave')?.source, 'individual_override')

  assert.equal(Number((await fixture.db.query<{ count: number }>("select count(*)::int count from audit_logs where entity_type='leave_entitlement_policy' and actor='Stage 3Q isolated HR manager'")).rows[0].count), 7)
  assert.equal(Number((await fixture.db.query<{ count: number }>('select count(*)::int count from staff_leave_entitlement_years')).rows[0].count), before.yearly)
  assert.equal(Number((await fixture.db.query<{ count: number }>('select count(*)::int count from staff_annual_leave_service_years')).rows[0].count), before.serviceYears)
  assert.equal(Number((await fixture.db.query<{ count: number }>('select count(*)::int count from planned_leave_periods')).rows[0].count), before.planned)

  console.log(JSON.stringify({ approvedDefaultsPrepared: true, twelveStaffInheritance: true, explicitZeroPrecedence: true, unconfiguredBeforeActivation: true, annualResetWithoutCarryForward: true, historicalSkSlSingleCount: true, dutyRosterAuthority: true, bookedFutureSeparated: true, alOffPhPreserved: true, noHistoricalBackfill: true, noDutyCodeAutoActivation: true, auditedActivationPath: true, canonicalDatabaseTouched: false }, null, 2))
} finally {
  await fixture.cleanup()
}
