import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import type { AuthPrincipal, StaffYearlyEntitlementDraft, StaffYearlyEntitlementWrite } from '../src/domain.js'
import { StaffRepository } from './staff-repository.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const fixture = await createDisposableStoreThrough('hr-approved-opening-balances', '027')
try {
  const repository = new StaffRepository(fixture.store, fixture.db)
  await repository.initialize()
  const staffId = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date,created_by,updated_by) values($1,'HR-OPEN-001','Opening Balance Fixture','Waiter','active','2023-01-01','isolated test','isolated test')", [staffId])
  const owner = (await fixture.db.query<{ login: string; displayName: string }>('select login_identifier login,display_name as "displayName" from user_accounts where id=$1', [fixture.ownerId])).rows[0]
  const principal: AuthPrincipal = { userId: fixture.ownerId, sessionId: randomUUID(), loginIdentifier: owner.login, displayName: owner.displayName, staffId: null, roleKeys: ['owner'], permissionKeys: ['manage_staff', 'manage_duty_roster'], globalScope: true, allowedOutletScopeIds: [], isOwner: true }
  const legacyBefore = (await fixture.db.query<Record<string, unknown>>('select * from staff_entitlements order by staff_id')).rows
  const overridesBefore = (await fixture.db.query<Record<string, unknown>>('select * from staff_leave_entitlement_overrides order by staff_id,leave_classification')).rows
  const draft = (year: number, allowances: StaffYearlyEntitlementDraft['allowances'], reason = 'HR-approved yearly entitlement evidence'): StaffYearlyEntitlementDraft => ({ staffId, year, allowances, annualLeaveOpeningBalance: null, approvalReason: reason })
  const confirmed = (input: StaffYearlyEntitlementDraft): StaffYearlyEntitlementWrite => ({ ...input, confirmation: 'CONFIRM_HR_APPROVED_YEARLY_ENTITLEMENTS' })

  const firstDraft = draft(2024, { sickLeave: 12 })
  const firstPreview = await repository.previewYearlyEntitlements(firstDraft)
  assert.equal((await fixture.db.query<{ count: number }>('select count(*)::int count from staff_leave_entitlement_years where staff_id=$1', [staffId])).rows[0].count, 0, 'Preview must remain read-only.')
  assert.equal(firstPreview.after.find(item => item.classification === 'sickLeave')?.entitlement, 12)
  assert.equal(firstPreview.after.find(item => item.classification === 'annualLeave')?.configured, false, 'Calendar-year Annual Leave must remain outside yearly entitlement writes.')
  await assert.rejects(repository.saveYearlyEntitlements({ ...firstDraft, confirmation: undefined } as unknown as StaffYearlyEntitlementWrite, principal), /Explicit manager confirmation/)
  await repository.saveYearlyEntitlements(confirmed(firstDraft), principal)
  await repository.saveYearlyEntitlements(confirmed(draft(2025, { sickLeave: 20 }, 'HR-approved 2025 entitlement')), principal)

  const configuration = await repository.configuration()
  const code = (classification: string) => configuration.dutyCodes.find(item => item.metadata?.dutyClassification === classification)?.value
  await fixture.db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes','SK','Historical Sick Leave','#a45b57',$2,false,998) on conflict(group_key,value) do nothing", [randomUUID(), JSON.stringify({ displayCode: 'SK', dutyClassification: 'sickLeave', legacyCompatibility: true })])
  for (const [date, dutyCode] of [['2026-02-01', code('annualLeave')!], ['2026-02-02', code('annualLeave')!], ['2026-03-01', 'SK'], ['2026-03-02', code('sickLeave')!]] as Array<[string, string]>) await fixture.db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), staffId, date, dutyCode])

  const currentDraft = draft(2026, { sickLeave: 8, emergencyLeave: 0, paternityLeave: 41.7, publicHoliday: 11 }, 'HR-approved 2026 non-AL entitlements')
  const preview = await repository.previewYearlyEntitlements(currentDraft)
  assert.equal(preview.after.find(item => item.classification === 'annualLeave')?.configured, false)
  assert.equal((await fixture.db.query<{ count: number }>('select count(*)::int count from staff_leave_entitlement_years where staff_id=$1 and entitlement_year=2026', [staffId])).rows[0].count, 0)
  await repository.saveYearlyEntitlements(confirmed(currentDraft), principal)

  await fixture.db.query(`insert into staff_annual_leave_service_years(id,staff_id,service_year_start,service_year_end,available_from,entitled_units,accrual_units_per_completed_month,approved_opening_carry_units,opening_carry_effective_date,opening_carry_reason,approved_by_user_id,approved_by_name_snapshot) values($1,$2,'2025-01-01','2025-12-31','2026-01-01',30,2.5,5.25,'2026-01-01','Manager-confirmed manual carry forward',$3,$4)`, [randomUUID(), staffId, fixture.ownerId, owner.displayName])

  const annual = await repository.annualLeaveServiceYearBalance(staffId, '2026-10-12')
  assert(annual)
  assert.deepEqual({ available: annual.availableLeave, openingAdjustment: annual.approvedOpeningCarry, used: annual.used, remaining: annual.remaining }, { available: 110.5, openingAdjustment: null, used: 2, remaining: 110.5 })
  const balance = await repository.yearlyEntitlementBalance(staffId, 2026, '2026-10-05', '2026-10-11')
  const sick = balance.yearlyLeave.find(item => item.classification === 'sickLeave')!
  assert.deepEqual({ entitlement: sick.entitlement, used: sick.used, remaining: sick.remaining }, { entitlement: 8, used: 2, remaining: 6 })
  assert.equal(balance.yearlyLeave.find(item => item.classification === 'emergencyLeave')?.entitlement, 0)
  assert.equal(balance.yearlyLeave.find(item => item.classification === 'paternityLeave')?.entitlement, 41.7)
  assert.equal((await repository.yearlyEntitlements(staffId, 2027)).find(item => item.classification === 'sickLeave')?.entitlement, null, 'Non-AL categories must not carry into a new year.')
  await assert.rejects(repository.previewYearlyEntitlements(draft(2027, { sickLeave: 8 }, '')), /HR approval reason/)
  await assert.rejects(repository.previewYearlyEntitlements({ ...draft(2027, { annualLeave: 30 }), annualLeaveOpeningBalance: 3 }), /service year/)

  const yearlyAudit = await fixture.db.query<{ actor: string }>("select actor from audit_logs where entity_type='staff_leave_entitlement_year'")
  assert(yearlyAudit.rows.length > 0)
  assert(yearlyAudit.rows.every(row => row.actor === owner.displayName))
  assert.deepEqual((await fixture.db.query<Record<string, unknown>>('select * from staff_entitlements order by staff_id')).rows, legacyBefore)
  assert.deepEqual((await fixture.db.query<Record<string, unknown>>('select * from staff_leave_entitlement_overrides order by staff_id,leave_classification')).rows, overridesBefore)

  const source = await readFile('server/index.ts', 'utf8')
  assert.match(source, /POST' && yearlyEntitlementPreviewMatch\) \{ assertTrustedOrigin\(request\); await authorizedWorkforceContext\(request\)/)
  assert.match(source, /PUT' && yearlyEntitlementMatch\) \{ assertTrustedOrigin\(request\); const context = await authorizedWorkforceContext\(request\)/)
  assert.doesNotMatch(source, /annual-leave-carry-forward|saveAnnualLeaveCarryForward/)
  const ui = await readFile('src/workforce.tsx', 'utf8')
  assert.match(ui, /Confirm HR-Approved Save/)
  assert.doesNotMatch(ui, /AnnualLeaveCarryForwardSection|Confirm Carry Forward/)

  await fixture.db.close()
  const reopenedDatabase = new PGlite(fixture.store)
  const reopened = new StaffRepository(fixture.store, reopenedDatabase)
  const persisted = await reopened.yearlyEntitlements(staffId, 2026)
  assert.equal(persisted.find(item => item.classification === 'sickLeave')?.entitlement, 8)
  assert.equal(persisted.find(item => item.classification === 'annualLeave')?.configured, false)
  const persistedAnnual = await reopened.annualLeaveServiceYearBalance(staffId, '2026-10-12')
  assert.equal(persistedAnnual?.approvedOpeningCarry, null)
  assert.equal(persistedAnnual?.remaining, 110.5)
  await reopened.close()

  console.log(JSON.stringify({ previewReadOnly: true, explicitManagerConfirmation: true, mandatoryApprovalReason: true, lifetimeAnnualLeave: true, historicalManualCarryPreservedWithoutDuplication: true, noDoubleCounting: true, nonAnnualYearlyEntitlements: true, nonAnnualReset: true, historicalSkSlSingleCount: true, dutyRosterAuthority: true, auditLogging: true, persistence: true, legacyTablesPreserved: true, schemaVersion: '027', canonicalDatabaseTouched: false }, null, 2))
} finally {
  await fixture.cleanup()
}
