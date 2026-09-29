import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { StaffMembershipHistory } from '../src/domain.js'
import { LeavePlannerService } from './leave-planner-service.js'
import { OperationsRepository } from './operations-repository.js'
import { ANDALUCIA_SCOPE_ID, OutletMembershipRepository } from './outlet-membership-repository.js'
import { StaffRepository } from './staff-repository.js'

const dataDirectory = await mkdtemp(join(tmpdir(), 'andalucia-leave-planner-r2-'))
const repository = new StaffRepository(dataDirectory, new PGlite(dataDirectory))
try {
  await repository.initialize()
  const database = repository.getDatabase()
  const operations = new OperationsRepository(database)
  const memberships = new OutletMembershipRepository(database)
  await operations.initialize()
  await memberships.initialize()

  const staff = (await repository.list()).filter(person => person.employmentStatus === 'active').slice(0, 2)
  assert.equal(staff.length, 2)
  const membership = (staffId: string, from: string, to: string | null): StaffMembershipHistory => ({
    id: randomUUID(), staffId, outletScopeId: ANDALUCIA_SCOPE_ID, membershipDimension: 'regular_outlet', effectiveFrom: from,
    effectiveTo: to, source: 'baseline_manager_review', reason: 'Leave Planner isolated validation', reviewStatus: 'approved'
  })
  await memberships.createMembership(membership(staff[0].id, '2026-09-01', null))
  await memberships.createMembership(membership(staff[1].id, '2026-09-15', '2026-09-30'))

  const dutyCodes = (await repository.configuration()).dutyCodes
  const annualLeave = dutyCodes.find(option => option.metadata?.dutyClassification === 'annualLeave')!
  const off = dutyCodes.find(option => option.metadata?.dutyClassification === 'off')!
  const working = dutyCodes.find(option => option.metadata?.countsAsWorking)!
  const publicHoliday = await repository.saveConfiguration('duty-codes', {
    id: randomUUID(), value: '', label: 'Public Holiday', color: '#e6c833', active: true,
    metadata: { displayCode: 'PH', dutyClassification: 'publicHoliday', countsAsWorking: false, countsAsPublicHoliday: true, billTipEligible: true, billTipWorkedDayUnits: 1 }
  })
  const sickLeave = await repository.saveConfiguration('duty-codes', {
    id: randomUUID(), value: '', label: 'Sick Leave', color: '#a45b57', active: true,
    metadata: { displayCode: 'SK', dutyClassification: 'sickLeave', countsAsWorking: false, countsAsSickLeave: true, billTipEligible: true }
  })

  const assignments = [
    ['2026-09-01', annualLeave.value], ['2026-09-02', annualLeave.value], ['2026-09-03', off.value],
    ['2026-09-04', annualLeave.value], ['2026-09-05', publicHoliday.value], ['2026-09-06', annualLeave.value],
    ['2026-09-07', sickLeave.value], ['2026-09-08', working.value], ['2026-09-15', working.value]
  ] as const
  for (const [date, dutyCode] of assignments) await operations.updateRoster(staff[0].id, date, dutyCode)
  await operations.updateRoster(staff[1].id, '2026-09-15', off.value)

  const planner = await new LeavePlannerService(repository, memberships).view('2026-09')
  assert.equal(planner.membershipBlocker, null)
  assert.equal(planner.rows.length, 2)
  const first = planner.rows.find(row => row.staffId === staff[0].id)!
  const second = planner.rows.find(row => row.staffId === staff[1].id)!
  assert.deepEqual(first.periods.map(period => `${period.leaveType}:${period.fromDate}:${period.toDate}`), [
    'annualLeave:2026-09-01:2026-09-02', 'off:2026-09-03:2026-09-03', 'annualLeave:2026-09-04:2026-09-04',
    'publicHoliday:2026-09-05:2026-09-05', 'annualLeave:2026-09-06:2026-09-06', 'sickLeave:2026-09-07:2026-09-07'
  ])
  assert.deepEqual({ start: second.membershipStart, end: second.membershipEnd, days: second.days.length }, { start: '2026-09-15', end: '2026-09-30', days: 1 })
  assert.deepEqual({ entitlement: first.entitlement.annualLeave.entitlement, used: first.entitlement.annualLeave.used, remaining: first.entitlement.annualLeave.remaining }, { entitlement: 30, used: 4, remaining: 26 })
  assert.deepEqual({ entitlement: first.entitlement.publicHoliday.entitlement, used: first.entitlement.publicHoliday.used, remaining: first.entitlement.publicHoliday.remaining }, { entitlement: 11, used: 1, remaining: 10 })
  assert.equal(first.entitlement.persisted, false)
  assert.equal(first.entitlement.offAssignedInMonth, 1)
  const firstDay = planner.availability.find(day => day.date === '2026-09-01')!
  const overlapDay = planner.availability.find(day => day.date === '2026-09-15')!
  assert.deepEqual({ members: firstDay.members, working: firstDay.scheduledWorking, unavailable: firstDay.unavailable, unassigned: firstDay.unassigned }, { members: 1, working: 0, unavailable: 1, unassigned: 0 })
  assert.deepEqual({ members: overlapDay.members, working: overlapDay.scheduledWorking, unavailable: overlapDay.unavailable, unassigned: overlapDay.unassigned }, { members: 2, working: 1, unavailable: 1, unassigned: 0 })
  assert.deepEqual(publicHoliday.metadata, expectMetadata(publicHoliday.metadata))
  await assert.rejects(() => new LeavePlannerService(repository, memberships).view('2026-13'), /valid Leave Planner month/)

  console.log(JSON.stringify({ conservativeGrouping: true, annualLeaveSeparatedByOff: true, annualLeaveSeparatedByPublicHoliday: true, publicHolidayNonWorking: true, publicHolidayEntitlement: true, billTipWorkedDayUnit: true, sickLeavePreserved: true, approvedMembershipScope: true, membershipStartEnd: true, factualDailyAvailability: true, defaultEntitlementsReadOnly: true }, null, 2))
} finally {
  await repository.getDatabase().close().catch(() => undefined)
  await rm(dataDirectory, { recursive: true, force: true })
}

function expectMetadata(metadata: Record<string, unknown> | undefined) {
  assert.equal(metadata?.dutyClassification, 'publicHoliday')
  assert.equal(metadata?.countsAsWorking, false)
  assert.equal(metadata?.countsAsPublicHoliday, true)
  assert.equal(metadata?.billTipEligible, true)
  assert.equal(metadata?.billTipWorkedDayUnits, 1)
  return metadata
}
