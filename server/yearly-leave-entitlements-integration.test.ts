import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import type { AuthPrincipal, StaffYearlyEntitlementWrite } from '../src/domain.js'
import { StaffRepository } from './staff-repository.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'

const fixture = await createDisposableDevelopmentStore('yearly-leave-entitlements-integration')
try {
  const repository = new StaffRepository(fixture.store, fixture.db)
  await repository.initialize()
  const staffId = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date,created_by,updated_by) values($1,'YEAR-001','Yearly Balance Fixture','Waiter','active','2024-01-01','isolated test','isolated test')", [staffId])
  const owner = (await fixture.db.query<{ login: string; displayName: string }>('select login_identifier login,display_name as "displayName" from user_accounts where id=$1', [fixture.ownerId])).rows[0]
  const principal: AuthPrincipal = { userId: fixture.ownerId, sessionId: randomUUID(), loginIdentifier: owner.login, displayName: owner.displayName, staffId: null, roleKeys: ['owner'], permissionKeys: ['manage_staff', 'manage_duty_roster'], globalScope: true, allowedOutletScopeIds: [], isOwner: true }
  const approved = (year: number, allowances: StaffYearlyEntitlementWrite['allowances']): StaffYearlyEntitlementWrite => ({ staffId, year, allowances, annualLeaveOpeningBalance: null, approvalReason: 'Isolated manager-approved entitlement test', confirmation: 'CONFIRM_HR_APPROVED_YEARLY_ENTITLEMENTS' })

  const legacyBefore = (await fixture.db.query<Record<string, unknown>>('select * from staff_entitlements order by staff_id')).rows
  const overridesBefore = (await fixture.db.query<Record<string, unknown>>('select * from staff_leave_entitlement_overrides order by staff_id,leave_classification')).rows
  await repository.saveYearlyEntitlements(approved(2024, { sickLeave: 20 }), principal)
  await repository.saveYearlyEntitlements(approved(2025, { sickLeave: 12 }), principal)
  const saved = await repository.saveYearlyEntitlements(approved(2026, { sickLeave: 8, emergencyLeave: 0, paternityLeave: 41.7, publicHoliday: 11 }), principal)
  assert.equal(saved.find(item => item.classification === 'annualLeave')?.configured, false, 'Calendar-year records must not configure service-year Annual Leave.')
  assert.equal(saved.find(item => item.classification === 'paternityLeave')?.entitlement, 41.7)
  assert.equal(saved.find(item => item.classification === 'emergencyLeave')?.entitlement, 0)
  assert.equal(saved.find(item => item.classification === 'hajjLeave')?.entitlement, null)

  const configuration = await repository.configuration()
  const code = (classification: string) => configuration.dutyCodes.find(item => item.metadata?.dutyClassification === classification)?.value
  await fixture.db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes','SK','Historical Sick Leave','#a45b57',$2,false,998) on conflict(group_key,value) do nothing", [randomUUID(), JSON.stringify({ displayCode: 'SK', dutyClassification: 'sickLeave', legacyCompatibility: true })])
  const entries: Array<[string, string]> = [['2026-03-01', 'SK'], ['2026-03-02', code('sickLeave')!], ['2026-04-01', code('publicHoliday')!]]
  for (const [date, dutyCode] of entries) await fixture.db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), staffId, date, dutyCode])

  const balance = await repository.yearlyEntitlementBalance(staffId, 2026, '2026-10-05', '2026-10-11')
  const annual = balance.yearlyLeave.find(item => item.classification === 'annualLeave')!
  const sick = balance.yearlyLeave.find(item => item.classification === 'sickLeave')!
  const emergency = balance.yearlyLeave.find(item => item.classification === 'emergencyLeave')!
  const paternity = balance.yearlyLeave.find(item => item.classification === 'paternityLeave')!
  assert.equal(annual.entitlement, 30, 'Annual Leave must use the approved automatic service-year entitlement, never a calendar-year override.')
  assert.equal(annual.remaining, 30)
  assert.deepEqual({ entitlement: sick.entitlement, used: sick.used, remaining: sick.remaining }, { entitlement: 8, used: 2, remaining: 6 })
  assert.deepEqual({ entitlement: emergency.entitlement, remaining: emergency.remaining }, { entitlement: 0, remaining: 0 })
  assert.equal(paternity.remaining, 41.7)
  assert.equal(balance.yearlyLeave.find(item => item.classification === 'hajjLeave')?.entitlement, null)

  const audit = await fixture.db.query<{ action: string; actor: string }>("select action,actor from audit_logs where entity_type='staff_leave_entitlement_year'")
  assert(audit.rows.some(row => row.action === 'created'))
  assert(audit.rows.every(row => row.actor === owner.displayName))
  await repository.saveYearlyEntitlements(approved(2026, { paternityLeave: null }), principal)
  assert.equal((await repository.yearlyEntitlements(staffId, 2026)).find(item => item.classification === 'paternityLeave')?.configured, false)

  await assert.rejects(repository.saveYearlyEntitlements(approved(2026, { annualLeave: 30 }), principal), /managed automatically by service year/)
  await assert.rejects(repository.saveYearlyEntitlements(approved(2026, { sickLeave: -1 }), principal), /non-negative numbers/)
  await assert.rejects(repository.saveYearlyEntitlements(approved(2026, { off: 1 } as never), principal), /approved yearly leave classifications/)

  assert.deepEqual((await fixture.db.query<Record<string, unknown>>('select * from staff_entitlements order by staff_id')).rows, legacyBefore)
  assert.deepEqual((await fixture.db.query<Record<string, unknown>>('select * from staff_leave_entitlement_overrides order by staff_id,leave_classification')).rows, overridesBefore)
  const source = await readFile('server/index.ts', 'utf8')
  assert.match(source, /PUT' && yearlyEntitlementMatch\) \{ assertTrustedOrigin\(request\); const context = await authorizedWorkforceContext\(request\)/)

  await fixture.db.close()
  const reopened = new StaffRepository(fixture.store, new PGlite(fixture.store))
  assert.equal((await reopened.yearlyEntitlements(staffId, 2026)).find(item => item.classification === 'sickLeave')?.entitlement, 8)
  await reopened.close()

  console.log(JSON.stringify({ yearlyPersistence: true, annualLeaveServiceYearOnly: true, annualReset: true, decimalPrecision: true, missingVersusZero: true, historicalSkSlSingleCount: true, dutyRosterAuthority: true, managerAuthorizationBoundary: true, auditLogging: true, legacyEntitlementsPreserved: true, canonicalDatabaseTouched: false }, null, 2))
} finally {
  await fixture.cleanup()
}
