import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { OperationsRepository } from './operations-repository.js'
import { StaffRepository } from './staff-repository.js'

const directory = await mkdtemp(join(tmpdir(), 'andalucia-duty-code-activation-'))
try {
  const repository = new StaffRepository(directory, new PGlite(directory))
  await repository.initialize()
  const operations = new OperationsRepository(repository.getDatabase())
  await operations.initialize()
  const optionalCodes = ['EL', 'PAT', 'BT', 'CIR', 'HAJ', 'RR']
  const initial = await repository.configuration()
  for (const code of optionalCodes) assert.equal(initial.dutyCodes.some(option => option.metadata?.displayCode === code), false, `${code} must not activate automatically`)
  const entitlementsBefore = JSON.stringify(await repository.entitlements())

  const emergency = await repository.activateProtectedDutyCode('EL', 'Activation test')
  assert.equal(emergency.label, 'Emergency Leave')
  assert.equal(emergency.metadata?.dutyClassification, 'emergencyLeave')
  assert.equal(emergency.metadata?.protected, true)
  assert.equal(emergency.metadata?.billTipEligible, undefined, 'leave codes must wait for an explicit manager Bill Tip decision')
  assert.equal(emergency.active, true)
  assert.ok(emergency.color)
  await assert.rejects(() => repository.activateProtectedDutyCode('EL', 'Activation test'), /already configured and active/)
  await assert.rejects(() => repository.saveConfiguration('duty-codes', { id: randomUUID(), value: '', label: 'Emergency Leave', color: '#123456', active: true, metadata: { displayCode: 'EL', dutyClassification: 'emergencyLeave', countsAsWorking: false } }), /Use Activate Duty Code/)

  const recolored = await repository.saveConfiguration('duty-codes', { ...emergency, color: '#234567', metadata: { ...emergency.metadata, billTipEligible: false, billTipWorkedDayUnits: 0 } })
  assert.equal(recolored.color, '#234567', 'activated code color remains configurable')
  assert.deepEqual({ eligible: recolored.metadata?.billTipEligible, units: recolored.metadata?.billTipWorkedDayUnits }, { eligible: false, units: 0 }, 'the saved manager leave rule must persist')
  await repository.reorderDutyCode(emergency.id, 'up')

  const historicalId = randomUUID()
  await repository.getDatabase().query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes','HISTORICAL_RR','Old R&R','#654321',$2,false,91)", [historicalId, JSON.stringify({ displayCode: 'RR', dutyClassification: 'restAndRecuperation', countsAsWorking: false })])
  const rest = await repository.activateProtectedDutyCode('RR', 'Activation test')
  assert.equal(rest.id, historicalId, 'existing identity must be reused')
  assert.equal(rest.value, 'HISTORICAL_RR', 'historical internal code must be reused')
  assert.equal(rest.color, '#654321', 'existing color must be preserved')
  assert.equal(rest.sortOrder, 91, 'existing display order must be preserved')
  assert.equal(rest.label, 'R&R1')

  for (const code of ['PAT', 'BT', 'CIR', 'HAJ']) await repository.activateProtectedDutyCode(code, 'Activation test')
  const configured = (await repository.configuration()).dutyCodes
  for (const code of optionalCodes) assert.equal(configured.filter(option => option.metadata?.displayCode === code && option.active).length, 1, `${code} must have one active configuration`)

  const staff = (await repository.list()).find(person => person.employmentStatus === 'active')!
  await operations.updateRoster(staff.id, '2026-10-12', emergency.value)
  const roster = await operations.roster('2026-10-12', '2026-10-12')
  assert.equal(roster.find(entry => entry.staffId === staff.id)?.dutyCode, emergency.value, 'activated code must be accepted by Duty Roster')
  assert.equal(JSON.stringify(await repository.entitlements()), entitlementsBefore, 'activation must not alter entitlements')

  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const workforce = await readFile(new URL('../src/workforce.tsx', import.meta.url), 'utf8')
  const server = await readFile(new URL('./index.ts', import.meta.url), 'utf8')
  assert.match(workforce, /Activate Duty Code/)
  assert.match(app, /staffApi\.activateDutyCode\(code\)/)
  assert.match(server, /\/api\/config\/staff\/duty-codes\/activate/)
  assert.match(app, /item\.active && !isLegacySickLeave\(item\)/, 'active configurations remain available in the Roster dropdown')
  console.log(JSON.stringify({ explicitActivation: true, automaticBulkActivation: false, managerLeaveFinancialDecisionRequired: true, managerLeaveRulePersisted: true, protectedIdentityReused: true, duplicatesPrevented: true, colorsConfigurable: true, displayOrderPreserved: true, rosterAvailable: true, entitlementsPreserved: true, migrationRequired: false }, null, 2))
  await repository.close()
} finally {
  await rm(directory, { recursive: true, force: true })
}
