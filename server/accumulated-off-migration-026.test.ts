import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { AuthPrincipal, StaffMembershipHistory } from '../src/domain.js'
import { auditActorLabel } from './authorization-service.js'
import { createOperationalFingerprint } from './database-backup.js'
import { AccumulatedOffService } from './accumulated-off-service.js'
import { migrationStatus, runMigrations } from './migration-store.js'
import { OperationsRepository } from './operations-repository.js'
import { ANDALUCIA_SCOPE_ID, OutletMembershipRepository } from './outlet-membership-repository.js'
import { PlannedLeaveRepository } from './planned-leave-repository.js'
import { StaffRepository } from './staff-repository.js'
import { createDisposableDevelopmentStore, createDisposableStoreThrough } from './test-store-fixture.js'
import { addCalendarDays, serviceDate } from '../src/service-date.js'

const migrationFixture = await createDisposableStoreThrough('accumulated-off-migration', '025')
try {
  const before = await createOperationalFingerprint(migrationFixture.db)
  const result = await runMigrations(migrationFixture.db, { throughVersion: '026' })
  assert.deepEqual(result.applied, ['026'])
  const after = await createOperationalFingerprint(migrationFixture.db)
  const { generatedAt: _bg, migration: _bm, ...beforeProtected } = before
  const { generatedAt: _ag, migration: _am, ...afterProtected } = after
  assert.deepEqual(afterProtected, beforeProtected)
  assert.equal((await migrationStatus(migrationFixture.db)).migrations.find(item => item.version === '026')?.state, 'applied')
} finally { await migrationFixture.cleanup() }

const fixture = await createDisposableDevelopmentStore('accumulated-off-workflow')
const staffRepository = new StaffRepository(fixture.store, fixture.db)
try {
  await staffRepository.initialize()
  const db = staffRepository.getDatabase()
  const membership = new OutletMembershipRepository(db); await membership.initialize()
  const person = (await staffRepository.list()).find(item => item.employmentStatus === 'active')!
  const actor: AuthPrincipal = { userId: fixture.ownerId, displayName: 'Accumulated OFF Manager', loginIdentifier: 'test-owner', sessionId: randomUUID(), staffId: null, isOwner: true, roleKeys: ['owner'], permissionKeys: ['manage_duty_roster'], globalScope: true, allowedOutletScopeIds: [ANDALUCIA_SCOPE_ID] }
  const history: StaffMembershipHistory = { id: randomUUID(), staffId: person.id, outletScopeId: ANDALUCIA_SCOPE_ID, membershipDimension: 'regular_outlet', effectiveFrom: '2026-09-01', effectiveTo: null, source: 'baseline_manager_review', reason: 'Migration 026 isolated validation', reviewStatus: 'approved' }
  await membership.createMembership(history)
  const controlledNow = new Date('2026-10-21T07:00:00.000Z')
  const accumulated = new AccumulatedOffService(db, () => controlledNow)
  const operations = new OperationsRepository(db, (changes, label) => accumulated.recalculateAffected(changes, label)); await operations.initialize()
  const configuration = await staffRepository.configuration()
  const working = configuration.dutyCodes.find(item => item.metadata?.countsAsWorking === true)!
  const off = configuration.dutyCodes.find(item => item.metadata?.countsAsOffDay === true || item.metadata?.dutyClassification === 'off')!
  for (const date of ['2026-09-06','2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12']) await operations.updateRoster(person.id, date, working.value, 'Accumulated OFF test')
  let balance = await accumulated.balance(person.id, ANDALUCIA_SCOPE_ID)
  assert.equal(balance.earned, 1, 'Seven recognized working assignments must earn exactly one accumulated OFF day.')
  await accumulated.recalculateWeek(person.id, ANDALUCIA_SCOPE_ID, '2026-09-06'); await accumulated.recalculateWeek(person.id, ANDALUCIA_SCOPE_ID, '2026-09-06')
  assert.equal((await accumulated.balance(person.id, ANDALUCIA_SCOPE_ID)).earned, 1, 'Repeated evaluation must be idempotent.')

  for (const date of ['2026-09-13','2026-09-14','2026-09-15','2026-09-16','2026-09-17','2026-09-18']) await operations.updateRoster(person.id, date, working.value, 'Accumulated OFF test')
  assert.equal((await accumulated.balance(person.id, ANDALUCIA_SCOPE_ID)).earned, 1, 'Incomplete weeks must not earn OFF.')
  await operations.updateRoster(person.id, '2026-09-19', off.value, 'Accumulated OFF test')
  assert.equal((await accumulated.balance(person.id, ANDALUCIA_SCOPE_ID)).earned, 1, 'Six working days plus one OFF must earn zero for that week.')
  await db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes','UNKNOWN_026','Unknown validation code','#999999','{}'::jsonb,true,999)", [randomUUID()])
  for (const date of ['2026-09-20','2026-09-21','2026-09-22','2026-09-23','2026-09-24','2026-09-25']) await operations.updateRoster(person.id, date, working.value, 'Accumulated OFF test')
  await operations.updateRoster(person.id, '2026-09-26', 'UNKNOWN_026', 'Unknown-code validation')
  assert.equal((await accumulated.balance(person.id, ANDALUCIA_SCOPE_ID)).earned, 1, 'Unknown duty semantics must not earn OFF.')
  assert.equal(await accumulated.recalculateWeek(person.id, ANDALUCIA_SCOPE_ID, '2026-10-18'), null, 'The controlled current Sunday-Saturday week must not be evaluated before Saturday ends.')

  const second = (await staffRepository.list()).find(item => item.employmentStatus === 'active' && item.id !== person.id)!
  await membership.createMembership({ id: randomUUID(), staffId: second.id, outletScopeId: ANDALUCIA_SCOPE_ID, membershipDimension: 'regular_outlet', effectiveFrom: '2026-09-08', effectiveTo: '2026-09-12', source: 'baseline_manager_review', reason: 'Partial membership validation', reviewStatus: 'approved' })
  for (const date of ['2026-09-06','2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12']) await operations.updateRoster(second.id, date, working.value, 'Partial membership validation')
  assert.equal((await accumulated.balance(second.id, ANDALUCIA_SCOPE_ID)).earned, 0, 'Partial membership weeks must not earn OFF.')

  const auditCount = async () => Number((await db.query<{ count: number }>("select count(*)::int count from audit_logs where entity_type='accumulated_off_week'")).rows[0].count)
  const beforeInitialEvaluation = await auditCount()
  const initialized = await accumulated.initializeEligibleHistory(ANDALUCIA_SCOPE_ID, actor)
  const afterInitialEvaluation = await auditCount()
  const repeated = await accumulated.initializeEligibleHistory(ANDALUCIA_SCOPE_ID, actor)
  assert.equal(initialized.eligibleStaff, 2, 'Only approved current regular-outlet members overlapping the policy period are eligible for initialization.')
  assert.equal(initialized.evaluatedThrough, '2026-10-17')
  assert.ok(initialized.evaluations >= 2)
  assert.ok(afterInitialEvaluation >= beforeInitialEvaluation)
  assert.equal(Number((await db.query<{ count: number }>("select count(*)::int count from audit_logs where entity_type='accumulated_off_history' and actor=$1", [auditActorLabel(actor)])).rows[0].count), 1, 'Initial historical evaluation must retain exactly one authorized manager audit identity.')
  assert.deepEqual(repeated, initialized)
  assert.equal(await auditCount(), afterInitialEvaluation, 'Repeated historical initialization must not duplicate evaluations or audit events.')
  assert.equal(Number((await db.query<{ count: number }>("select count(*)::int count from audit_logs where entity_type='accumulated_off_history'")).rows[0].count), 1, 'Repeated historical initialization must not duplicate its manager audit record.')

  const afterControlledWeek = new AccumulatedOffService(db, () => new Date('2026-10-26T07:00:00.000Z'))
  const completedMissingWeek = await afterControlledWeek.recalculateWeek(person.id, ANDALUCIA_SCOPE_ID, '2026-10-18')
  assert.equal(completedMissingWeek?.evaluation_state, 'incomplete', 'After the Sunday-Saturday boundary passes, a completed week with missing records must be evaluated as incomplete.')
  assert.equal(Number(completedMissingWeek?.earned_days), 0, 'A completed week with missing records must never earn accumulated OFF.')

  const planned = new PlannedLeaveRepository(db, accumulated)
  const planningStart = addCalendarDays(serviceDate(), 1)
  const planningEnd = addCalendarDays(planningStart, 2)
  const laterPlanningDate = addCalendarDays(planningStart, 7)
  const booking = await planned.create({ staffId: person.id, startDate: planningStart, endDate: planningEnd, leaveType: 'annual_leave', managerNote: 'Accumulated OFF reservation test', accumulatedOffDaysAllocated: 1 }, { outletScopeId: ANDALUCIA_SCOPE_ID, actor })
  balance = await accumulated.balance(person.id, ANDALUCIA_SCOPE_ID)
  assert.equal(balance.reserved, 1); assert.equal(balance.available, 0)
  await assert.rejects(() => planned.create({ staffId: person.id, startDate: laterPlanningDate, endDate: laterPlanningDate, leaveType: 'annual_leave', accumulatedOffDaysAllocated: 1 }, { outletScopeId: ANDALUCIA_SCOPE_ID, actor }), /verified available balance of 0/)

  await operations.updateRoster(person.id, '2026-09-12', off.value, 'Historical correction')
  balance = await accumulated.balance(person.id, ANDALUCIA_SCOPE_ID)
  assert.equal(balance.earned, 0); assert.equal(balance.conflict, true); assert.equal((await planned.find(booking.id, ANDALUCIA_SCOPE_ID))?.accumulatedOffDaysAllocated, 1)
  await operations.updateRoster(person.id, '2026-09-12', working.value, 'Historical correction restored')
  const cancelled = await planned.cancel(booking.id, booking.revision, 'Cancellation releases reservation', { outletScopeId: ANDALUCIA_SCOPE_ID, actor })
  assert.equal(cancelled.planningState, 'cancelled'); assert.equal((await accumulated.balance(person.id, ANDALUCIA_SCOPE_ID)).available, 1)

  const active = await planned.create({ staffId: person.id, startDate: planningStart, endDate: planningEnd, leaveType: 'annual_leave', managerNote: 'Confirmed consumption test', accumulatedOffDaysAllocated: 1 }, { outletScopeId: ANDALUCIA_SCOPE_ID, actor })
  await operations.updateRoster(person.id, planningStart, off.value, 'Confirmed accumulated OFF roster evidence')
  await accumulated.confirmConsumption(active.id, [planningStart], { outletScopeId: ANDALUCIA_SCOPE_ID, actor })
  balance = await accumulated.balance(person.id, ANDALUCIA_SCOPE_ID)
  assert.equal(balance.consumed, 1); assert.equal(balance.reserved, 0); assert.equal(balance.available, 0)
  await assert.rejects(() => accumulated.confirmConsumption(active.id, [planningStart], { outletScopeId: ANDALUCIA_SCOPE_ID, actor }), /exceeds|duplicate/i)
  await operations.updateRoster(person.id, addCalendarDays(planningStart, 1), off.value, 'Ordinary weekly OFF')
  assert.equal((await accumulated.balance(person.id, ANDALUCIA_SCOPE_ID)).consumed, 1, 'Ordinary OFF must not consume balance without explicit confirmation.')

  const opened = await accumulated.addOpeningBalance({ staffId: person.id, days: 2, effectiveDate: '2026-09-01', justification: 'Verified historical roster evidence', evidenceReference: 'HR-OFF-OPENING-001' }, { outletScopeId: ANDALUCIA_SCOPE_ID, actor })
  assert.equal(opened.opening, 2); assert.equal(opened.available, 2)
  const audits = await db.query<{ count: number }>("select count(*)::int count from audit_logs where entity_type in ('accumulated_off_week','accumulated_off_opening','accumulated_off_consumption')")
  assert.ok(Number(audits.rows[0].count) >= 3)
  console.log(JSON.stringify({ migration026: true, initialHistoricalEvaluation: true, initialHistoricalEvaluationIdempotent: true, sevenWorkingEarnsOne: true, sixWorkingPlusOffEarnsZero: true, incompleteEarnsZero: true, unknownCodeEarnsZero: true, partialMembershipEarnsZero: true, currentWeekNotEvaluated: true, idempotent: true, correctionConflictFlagged: true, cancellationReleasesReservation: true, explicitRosterConsumptionOnce: true, ordinaryOffNotConsumed: true, openingBalanceAudited: true, canonicalDataTouched: false }, null, 2))
} finally { await fixture.cleanup() }
