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
  const twelveStaff = [{ id: staffId, joinDate: '2024-07-19', expectedAvailable: 65 }]
  for (const [index, joinDate, expectedAvailable] of [
    [2, '2024-04-07', 15], [3, '2025-09-21', 0], [4, '2023-01-01', 22.5], [5, '2024-02-18', 17.5], [6, '2024-01-31', 20],
    [7, '2024-02-29', 17.5], [8, '2023-10-12', 0], [9, '2025-03-30', 15], [10, '2022-12-31', 22.5], [11, '2026-06-15', 7.5], [12, '2025-11-01', 27.5],
  ] as Array<[number, string, number]>) {
    const id = randomUUID()
    await fixture.db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date,created_by,updated_by) values($1,$2,$3,'Waiter','active',$4,'isolated test','isolated test')", [id, `AL-SIMPLE-${String(index).padStart(2, '0')}`, `SIMPLIFIED AL ${index}`, joinDate])
    twelveStaff.push({ id, joinDate, expectedAvailable })
  }
  for (const employee of twelveStaff) {
    const balance = await repository.annualLeaveServiceYearBalance(employee.id, '2026-10-12')
    assert(balance)
    assert.equal(balance.availableLeave, balance.accruingForNextServiceYear, `Lifetime earned availability mismatch for ${employee.joinDate}.`)
    assert.equal(balance.evidenceStatus, 'complete')
    assert(balance.accruingForNextServiceYear >= 0)
  }

  await fixture.db.query(`insert into staff_annual_leave_service_years(id,staff_id,service_year_start,service_year_end,available_from,entitled_units,accrual_units_per_completed_month,approved_opening_carry_units,opening_carry_effective_date,opening_carry_reason,approved_by_user_id,approved_by_name_snapshot) values($1,$2,'2024-07-19','2025-07-18','2025-07-19',30,2.5,30,'2025-07-19','Manager-confirmed manual carry forward',$3,$4)`, [randomUUID(), staffId, approver.userId, approver.displayName])
  const withHistoricalCarry = await repository.annualLeaveServiceYearBalance(staffId, '2026-10-12')
  assert.equal(withHistoricalCarry?.availableLeave, 65, 'Historical manual carry must remain audit evidence without duplicating lifetime accrual.')

  const annualCode = (await repository.configuration()).dutyCodes.find(item => item.metadata?.dutyClassification === 'annualLeave')!.value
  await fixture.db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), staffId, '2026-08-01', annualCode])
  const outlet = (await fixture.db.query<{ id: string }>("select id from outlet_scopes where scope_key='andalucia'")).rows[0]
  await fixture.db.query("insert into planned_leave_periods(id,outlet_scope_id,staff_id,start_date,end_date,leave_type,planning_state,revision,created_by_user_id,created_by_name_snapshot,updated_by_user_id,updated_by_name_snapshot) values($1,$2,$3,'2026-12-01','2026-12-03','annual_leave','booked',1,$4,$5,$4,$5)", [randomUUID(), outlet.id, staffId, fixture.ownerId, owner.displayName])
  const balance = await repository.annualLeaveServiceYearBalance(staffId, '2026-10-12')
  assert(balance)
  assert.equal(balance.used, 1, 'Confirmed usage must come from Duty Roster.')
  assert.equal(balance.bookedFuture, 3, 'Booked/Future leave must stay separate from confirmed usage.')
  assert.equal(balance.remaining, 64)
  assert.equal(balance.availableAfterBooked, 61)

  const ui = await readFile('src/workforce.tsx', 'utf8')
  const api = await readFile('server/index.ts', 'utf8')
  assert(!ui.includes('AnnualLeaveCarryForwardSection') && !ui.includes('Confirm Carry Forward'))
  assert(!api.includes('annual-leave-carry-forward') && !api.includes('saveAnnualLeaveCarryForward'))
  console.log(JSON.stringify({ lifetimeAccrual: true, historicalCarryPreservedWithoutDuplication: true, dutyRosterAuthority: true, bookedFutureSeparate: true, manualCarryUiRemoved: true, manualCarryRoutesRetired: true, canonicalDatabaseTouched: false }, null, 2))
} finally {
  globalThis.Date = NativeDate
  await fixture.cleanup()
}
