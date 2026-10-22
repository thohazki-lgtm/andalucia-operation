import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { AuthPrincipal } from '../src/domain.js'
import { StaffRepository } from './staff-repository.js'
import { createDisposableStoreThrough } from './test-store-fixture.js'

const NativeDate = globalThis.Date
const controlledNow = '2026-10-12T12:00:00+05:00'
class FrozenDate extends NativeDate {
  constructor(...args: any[]) {
    if (args.length === 0) super(controlledNow)
    else if (args.length === 1) super(args[0])
    else super(args[0], args[1], args[2] ?? 1, args[3] ?? 0, args[4] ?? 0, args[5] ?? 0, args[6] ?? 0)
  }
  static now() { return new NativeDate(controlledNow).getTime() }
}
globalThis.Date = FrozenDate as DateConstructor

const fixture = await createDisposableStoreThrough('annual-leave-opening-balance-workflow', '027')
try {
  const repository = new StaffRepository(fixture.store, fixture.db)
  await repository.initialize()
  const owner = (await fixture.db.query<{ id: string; loginIdentifier: string; displayName: string }>('select id,login_identifier "loginIdentifier",display_name "displayName" from user_accounts where id=$1', [fixture.ownerId])).rows[0]
  const approver = { ...owner, userId: owner.id, sessionId: 'isolated-session', staffId: null, status: 'active', roleKeys: ['owner'], permissionKeys: ['manage_staff'], globalScope: true, allowedOutletScopeIds: [], isOwner: true } as AuthPrincipal
  const staffId = randomUUID()
  await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date,created_by,updated_by) values($1,'AL-OPEN-01','OPENING BALANCE TEST','Waiter','active','2024-07-19','isolated test','isolated test')", [staffId])
  const twelveStaff = [{ id: staffId, joinDate: '2024-07-19', expectedAvailable: 30 }]
  for (const [index, joinDate, expectedAvailable] of [
    [2, '2024-04-07', 30], [3, '2025-09-21', 30], [4, '2023-01-01', 30], [5, '2024-02-18', 30], [6, '2024-01-31', 30],
    [7, '2024-02-29', 30], [8, '2023-10-12', 30], [9, '2025-03-30', 30], [10, '2022-12-31', 0], [11, '2026-06-15', 0], [12, '2025-11-01', 0],
  ] as Array<[number, string, number]>) {
    const id = randomUUID()
    await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date,created_by,updated_by) values($1,$2,$3,'Waiter','active',$4,'isolated test','isolated test')", [id, `AL-SIMPLE-${String(index).padStart(2, '0')}`, `SIMPLIFIED AL ${index}`, joinDate])
    twelveStaff.push({ id, joinDate, expectedAvailable })
  }
  for (const employee of twelveStaff) {
    const balance = await repository.annualLeaveServiceYearBalance(employee.id, '2026-10-12')
    assert(balance)
    assert.equal(balance.availableLeave, employee.expectedAvailable, `Automatic availability mismatch for ${employee.joinDate}.`)
    assert.equal(balance.evidenceStatus, 'complete')
    assert(balance.accruingForNextServiceYear >= 0 && balance.accruingForNextServiceYear <= 30)
  }

  const draft = { staffId, carryForward: 10.5 }
  const preview = await repository.previewAnnualLeaveCarryForward(draft)
  assert.equal(preview.before?.availableLeave, 30)
  assert.equal(preview.after.approvedOpeningCarry, 10.5)
  assert.equal(preview.after.availableLeave, 40.5, 'Manual Carry Forward must supplement, not replace, automatic service-year entitlement.')
  assert.equal(preview.after.accruingForNextServiceYear, 5, 'Current service-year accrual remains separate and reserved for next availability.')
  assert.equal(Number((await fixture.db.query<{ count: number }>('select count(*)::int count from staff_annual_leave_service_years where staff_id=$1', [staffId])).rows[0].count), 0, 'Preview must be read-only.')

  await assert.rejects(repository.previewAnnualLeaveCarryForward({ ...draft, carryForward: -1 }), /Carry Forward must/)
  await assert.rejects(repository.saveAnnualLeaveCarryForward({ ...draft, confirmation: '' as never }, approver), /Explicit manager confirmation/)

  await repository.saveAnnualLeaveCarryForward({ ...draft, carryForward: 0, confirmation: 'CONFIRM_ANNUAL_LEAVE_CARRY_FORWARD' }, approver)
  let row = (await fixture.db.query<any>('select approved_opening_carry_units::text balance,opening_carry_reason reason from staff_annual_leave_service_years where staff_id=$1', [staffId])).rows[0]
  assert.equal(Number(row.balance), 0, 'Explicit zero must be persisted distinctly from missing evidence.')
  assert.equal(row.reason, 'Manager-confirmed manual carry forward')
  await repository.saveAnnualLeaveCarryForward({ ...draft, confirmation: 'CONFIRM_ANNUAL_LEAVE_CARRY_FORWARD' }, approver)
  assert.equal(Number((await fixture.db.query<{ count: number }>('select count(*)::int count from staff_annual_leave_service_years where staff_id=$1', [staffId])).rows[0].count), 1, 'Employee/service-year evidence must update in place rather than duplicate.')
  row = (await fixture.db.query<any>('select approved_opening_carry_units::text balance from staff_annual_leave_service_years where staff_id=$1', [staffId])).rows[0]
  assert.equal(Number(row.balance), 10.5)
  assert.equal(Number((await fixture.db.query<{ count: number }>("select count(*)::int count from audit_logs where entity_type='staff_annual_leave_service_year' and entity_id=(select id from staff_annual_leave_service_years where staff_id=$1)", [staffId])).rows[0].count), 2)

  const annualCode = (await repository.configuration()).dutyCodes.find(item => item.metadata?.dutyClassification === 'annualLeave')!.value
  await fixture.db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), staffId, '2026-08-01', annualCode])
  const outlet = (await fixture.db.query<{ id: string }>("select id from outlet_scopes where scope_key='andalucia'")).rows[0]
  await fixture.db.query("insert into planned_leave_periods(id,outlet_scope_id,staff_id,start_date,end_date,leave_type,planning_state,revision,created_by_user_id,created_by_name_snapshot,updated_by_user_id,updated_by_name_snapshot) values($1,$2,$3,'2026-12-01','2026-12-03','annual_leave','booked',1,$4,$5,$4,$5)", [randomUUID(), outlet.id, staffId, fixture.ownerId, owner.displayName])
  const balance = await repository.annualLeaveServiceYearBalance(staffId, '2026-10-12')
  assert(balance)
  assert.equal(balance.used, 1, 'Confirmed usage must come from Duty Roster.')
  assert.equal(balance.bookedFuture, 3, 'Booked/Future leave must stay separate from confirmed usage.')
  assert.equal(balance.remaining, 39.5)
  assert.equal(balance.availableAfterBooked, 36.5)

  const ui = await readFile('src/workforce.tsx', 'utf8')
  const api = await readFile('server/index.ts', 'utf8')
  assert(ui.includes('Review Before Saving') && ui.includes('Confirm Carry Forward'))
  assert(ui.includes('Annual Leave Carry Forward') && !ui.includes('Annual Leave opening balance effective date'))
  assert(api.includes('assertTrustedOrigin(request)') && api.includes('saveAnnualLeaveCarryForward'))
  console.log(JSON.stringify({ automaticServiceYear: true, zeroCarryBaseline: true, previewReadOnly: true, explicitZeroDistinct: true, uniqueServiceYearUpdate: true, auditLogged: true, dutyRosterAuthority: true, bookedFutureSeparate: true, confirmationRequired: true, trustedOriginProtected: true, canonicalDatabaseTouched: false }, null, 2))
} finally {
  globalThis.Date = NativeDate
  await fixture.cleanup()
}
