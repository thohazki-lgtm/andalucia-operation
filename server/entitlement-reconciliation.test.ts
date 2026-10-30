import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { AuthPrincipal, StaffYearlyEntitlementDraft, StaffYearlyEntitlementWrite } from '../src/domain.js'
import { StaffRepository } from './staff-repository.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const fixture = await createDisposableDevelopmentStore('entitlement-reconciliation')
try {
  const repository = new StaffRepository(fixture.store, fixture.db)
  await repository.initialize()
  const staffId = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date,created_by,updated_by) values($1,'RECON-001','Reconciliation Fixture','Waiter','active','2023-01-01','isolated test','isolated test')", [staffId])
  const owner = (await fixture.db.query<{ login: string; displayName: string }>('select login_identifier login,display_name as "displayName" from user_accounts where id=$1', [fixture.ownerId])).rows[0]
  const principal: AuthPrincipal = { userId: fixture.ownerId, sessionId: randomUUID(), loginIdentifier: owner.login, displayName: owner.displayName, staffId: null, roleKeys: ['owner'], permissionKeys: ['manage_staff', 'manage_duty_roster'], globalScope: true, allowedOutletScopeIds: [], isOwner: true }
  await repository.saveEntitlement({ staffId, annualLeavePerYear: 30, weeklyOffEntitlement: 1, publicHolidayPerYear: 11, leaveOverrides: { sickLeave: 12, emergencyLeave: 0 } }, 'isolated test')
  const approved = (year: number, allowances: StaffYearlyEntitlementDraft['allowances'], opening: number | null): StaffYearlyEntitlementWrite => ({ staffId, year, allowances, annualLeaveOpeningBalance: opening, approvalReason: `HR approval ${year}`, confirmation: 'CONFIRM_HR_APPROVED_YEARLY_ENTITLEMENTS' })
  await repository.saveYearlyEntitlements(approved(2026, { sickLeave: 8, emergencyLeave: 0, publicHoliday: 11 }, null), principal)
  for (const [start, end, available, opening, reason] of [
    ['2023-01-01', '2023-12-31', '2024-01-01', null, null],
    ['2024-01-01', '2024-12-31', '2025-01-01', null, null],
    ['2025-01-01', '2025-12-31', '2026-01-01', 5.25, 'HR approval 2026'],
    ['2026-01-01', '2026-12-31', '2027-01-01', null, null],
  ] as const) await fixture.db.query(`insert into staff_annual_leave_service_years(id,staff_id,service_year_start,service_year_end,available_from,entitled_units,accrual_units_per_completed_month,approved_opening_carry_units,opening_carry_effective_date,opening_carry_reason,approved_by_user_id,approved_by_name_snapshot) values($1,$2,$3,$4,$5,30,2.5,$6,$7,$8,$9,$10)`, [randomUUID(), staffId, start, end, available, opening, opening === null ? null : available, reason, fixture.ownerId, owner.displayName])
  const configuration = await repository.configuration()
  const code = (classification: string) => configuration.dutyCodes.find(item => item.metadata?.dutyClassification === classification)?.value
  await fixture.db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes','SK','Historical Sick Leave','#a45b57',$2,false,998) on conflict(group_key,value) do nothing", [randomUUID(), JSON.stringify({ displayCode: 'SK', dutyClassification: 'sickLeave', legacyCompatibility: true })])
  for (const [date, dutyCode] of [['2026-02-01', code('annualLeave')!], ['2026-02-02', code('annualLeave')!], ['2026-03-01', 'SK'], ['2026-03-02', code('sickLeave')!], ['2026-10-05', code('off')!]] as Array<[string, string]>) await fixture.db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), staffId, date, dutyCode])
  const outlet = (await fixture.db.query<{ id: string }>("select id from outlet_scopes where scope_key='andalucia'")).rows[0]
  await fixture.db.query("insert into planned_leave_periods(id,outlet_scope_id,staff_id,start_date,end_date,leave_type,planning_state,revision,created_by_user_id,created_by_name_snapshot,updated_by_user_id,updated_by_name_snapshot) values($1,$2,$3,'2026-12-01','2026-12-03','annual_leave','booked',1,$4,$5,$4,$5)", [randomUUID(), outlet.id, staffId, fixture.ownerId, owner.displayName])
  const before = {
    yearly: (await fixture.db.query<{ count: number }>('select count(*)::int count from staff_leave_entitlement_years')).rows[0].count,
    roster: (await fixture.db.query<{ count: number }>('select count(*)::int count from duty_roster_entries')).rows[0].count,
    planned: (await fixture.db.query<{ count: number }>('select count(*)::int count from planned_leave_periods')).rows[0].count,
    audits: (await fixture.db.query<{ count: number }>('select count(*)::int count from audit_logs')).rows[0].count
  }
  const result = await repository.entitlementReconciliation(staffId, 2026, '2026-10-05', '2026-10-11')
  assert.equal(result.readOnly, true)
  assert.equal(result.confirmedUsageSource, 'DUTY_ROSTER')
  assert.equal(result.bookedFutureSource, 'PLANNED_LEAVE_SEPARATE')
  assert.equal(result.lines.length, 10)
  const annual = result.lines.find(line => line.classification === 'annualLeave')!
  assert.deepEqual({ rate: annual.accrualPerCompletedMonth, months: annual.completedEligibleMonths, accrued: annual.accrued, carry: annual.carriedForward, opening: annual.openingBalance, used: annual.used, remaining: annual.remaining, booked: annual.bookedFuture, afterBooked: annual.availableAfterBooked }, { rate: 2.5, months: 9, accrued: 22.5, carry: 5.25, opening: 5.25, used: 2, remaining: 25.75, booked: 3, afterBooked: 22.75 })
  assert.equal(annual.openingBalanceReason, 'HR approval 2026')
  const sick = result.lines.find(line => line.classification === 'sickLeave')!
  assert.deepEqual({ yearly: sick.yearlyEntitlement, individual: sick.individualEntitlement, used: sick.used, remaining: sick.remaining, status: sick.evidenceStatus }, { yearly: 8, individual: 12, used: 2, remaining: 6, status: 'discrepancy' })
  const emergency = result.lines.find(line => line.classification === 'emergencyLeave')!
  assert.equal(emergency.yearlyEntitlement, 0)
  assert.equal(emergency.remaining, 0)
  const paternity = result.lines.find(line => line.classification === 'paternityLeave')!
  assert.equal(paternity.yearlyEntitlement, null)
  assert.equal(paternity.evidenceStatus, 'missing_hr_evidence')
  const off = result.lines.find(line => line.classification === 'off')!
  assert.deepEqual({ cadence: off.cadence, source: off.source, required: off.accrued, assigned: off.used, remaining: off.remaining, status: off.evidenceStatus }, { cadence: 'weekly', source: 'individual_override', required: 1, assigned: 1, remaining: 0, status: 'weekly_recurring' })
  const nextYear = await repository.entitlementReconciliation(staffId, 2027, '2027-01-04', '2027-01-10')
  const nextYearSick = nextYear.lines.find(line => line.classification === 'sickLeave')!
  assert.deepEqual(
    { entitlement: nextYearSick.yearlyEntitlement, used: nextYearSick.used, remaining: nextYearSick.remaining, carriedForward: nextYearSick.carriedForward, source: nextYearSick.source },
    { entitlement: 12, used: 0, remaining: 12, carriedForward: 0, source: 'individual_override' },
    'Non-AL allowances must renew for the new year without carrying prior-year usage or unused balance.',
  )
  const after = {
    yearly: (await fixture.db.query<{ count: number }>('select count(*)::int count from staff_leave_entitlement_years')).rows[0].count,
    roster: (await fixture.db.query<{ count: number }>('select count(*)::int count from duty_roster_entries')).rows[0].count,
    planned: (await fixture.db.query<{ count: number }>('select count(*)::int count from planned_leave_periods')).rows[0].count,
    audits: (await fixture.db.query<{ count: number }>('select count(*)::int count from audit_logs')).rows[0].count
  }
  assert.deepEqual(after, before, 'Reconciliation must not write records or audit events.')
  const serverSource = await readFile('server/index.ts', 'utf8')
  assert.match(serverSource, /request\.method === 'GET' && entitlementReconciliationMatch\) \{ await authorizedWorkforceContext\(request\)/)
  const uiSource = await readFile('src/workforce.tsx', 'utf8')
  assert.doesNotMatch(uiSource, /Entitlement Reconciliation Preview|function EntitlementReconciliationDialog|>Reconcile(?: Year)?</)
  const apiSource = await readFile('src/api.ts', 'utf8')
  assert.match(apiSource, /entitlementReconciliation:/, 'The shared reconciliation service must remain available after its manager-facing UI is removed.')
  console.log(JSON.stringify({ allTenProtectedCategories: true, policyAndIndividualEvidence: true, completedMonthAccrual: true, unlimitedCarryForward: true, approvedOpeningBalance: true, rosterUsageOnly: true, bookedFutureSeparated: true, unconfiguredDistinctFromZero: true, missingEvidenceFlagged: true, discrepanciesFlagged: true, historicalSkSlSingleCount: true, nonAnnualReset: true, weeklyOffPreserved: true, authenticatedGetOnlyEndpoint: true, sharedServicePreserved: true, managerUiRemoved: true, readOnlyNoWrites: true, canonicalDatabaseTouched: false }, null, 2))
} finally {
  await fixture.cleanup()
}
