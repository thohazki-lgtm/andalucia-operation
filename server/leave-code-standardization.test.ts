import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { CORE_DUTY_CODES } from '../src/domain.js'
import { OperationsRepository } from './operations-repository.js'
import { StaffRepository } from './staff-repository.js'

const dataDirectory = await mkdtemp(join(tmpdir(), 'andalucia-leave-code-standardization-'))
const existingCodeDirectory = await mkdtemp(join(tmpdir(), 'andalucia-existing-core-code-'))
try {
  const repository = new StaffRepository(dataDirectory, new PGlite(dataDirectory))
  await repository.initialize()
  const operations = new OperationsRepository(repository.getDatabase())
  await operations.initialize()

  const initiallyConfigured = (await repository.configuration()).dutyCodes
  for (const code of ['EL', 'PAT', 'BT', 'CIR', 'HAJ', 'RR']) assert.equal(initiallyConfigured.some(item => item.metadata?.displayCode === code), false, `${code} must require explicit activation`)
  for (const code of ['EL', 'PAT', 'BT', 'CIR', 'HAJ', 'RR']) await repository.activateProtectedDutyCode(code, 'Stage 2 test')
  const dutyCodes = (await repository.configuration()).dutyCodes
  assert.deepEqual(CORE_DUTY_CODES.map(item => item.code), ['AL', 'SL', 'EL', 'PAT', 'BT', 'CIR', 'HAJ', 'RR', 'OFF', 'PH'])
  for (const definition of CORE_DUTY_CODES) {
    const option = dutyCodes.find(item => item.metadata?.displayCode === definition.code)
    assert.ok(option, `${definition.code} must be available`)
    assert.equal(option.label, definition.label)
    assert.equal(option.metadata?.dutyClassification, definition.classification)
    assert.equal(option.metadata?.protected, true)
    assert.equal(option.metadata?.countsAsWorking, false)
  }

  const sickLeave = dutyCodes.find(item => item.metadata?.displayCode === 'SL')!
  const recolored = await repository.saveConfiguration('duty-codes', { ...sickLeave, color: '#112233', metadata: { ...sickLeave.metadata, billTipEligible: true, billTipWorkedDayUnits: 1 } })
  assert.equal(recolored.color, '#112233')
  await assert.rejects(() => repository.saveConfiguration('duty-codes', { ...sickLeave, label: 'Renamed Sick Leave' }), /protected core Duty Code/)
  const disabledSickLeave = await repository.saveConfiguration('duty-codes', { ...recolored, active: false })
  assert.equal(disabledSickLeave.active, false, 'Core leave-code availability must be manager controlled.')
  assert.equal((await repository.configuration()).dutyCodes.find(item => item.id === sickLeave.id)?.active, false, 'Disabled core leave availability must survive configuration normalization.')
  await repository.saveConfiguration('duty-codes', { ...disabledSickLeave, active: true })
  await assert.rejects(() => repository.removeDutyCode(sickLeave.id), /protected core Duty Code/)
  await assert.rejects(() => repository.saveConfiguration('duty-codes', { id: randomUUID(), value: '', label: 'Duplicate Sick Leave', color: '#123456', active: true, metadata: { displayCode: 'SL', dutyClassification: 'sickLeave', countsAsWorking: false } }), /Use Activate Duty Code/)

  const validCustom = await repository.saveConfiguration('duty-codes', { id: randomUUID(), value: '', label: 'Custom Rest Duty', color: '#234567', active: true, metadata: { displayCode: 'RRX', dutyClassification: 'other', countsAsWorking: false, billTipEligible: true, billTipWorkedDayUnits: 0 } })
  assert.equal(validCustom.metadata?.displayCode, 'RRX')
  assert.equal(validCustom.metadata?.countsAsWorking, false)
  await assert.rejects(() => repository.saveConfiguration('duty-codes', { id: randomUUID(), value: '', label: 'R&R', color: '#234567', active: true, metadata: { displayCode: 'RR', dutyClassification: 'restAndRecuperation', countsAsWorking: false } }), /RR · R&R1 is a protected core Duty Code/)
  await assert.rejects(() => repository.saveConfiguration('duty-codes', { id: randomUUID(), value: '', label: '', color: '#234567', active: true, metadata: { displayCode: 'NEW', dutyClassification: 'other', countsAsWorking: false } }), /required/)
  await assert.rejects(() => repository.saveConfiguration('duty-codes', { id: randomUUID(), value: '', label: 'Missing Classification', color: '#234567', active: true, metadata: { displayCode: 'NEW', countsAsWorking: false } }), /required/)
  const restAndRecuperation = dutyCodes.find(item => item.metadata?.displayCode === 'RR')!
  await assert.rejects(() => repository.saveConfiguration('duty-codes', { ...restAndRecuperation, label: 'R&R' }), /protected core Duty Code/)

  const legacyValue = 'LEGACY_SK'
  await repository.getDatabase().query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes',$2,'Sick Leave (Legacy)','#a45b57',$3,true,999)", [randomUUID(), legacyValue, JSON.stringify({ displayCode: 'SK', dutyClassification: 'sickLeave', countsAsWorking: false })])
  const staff = (await repository.list()).find(person => person.employmentStatus === 'active')!
  await repository.getDatabase().query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), staff.id, '2026-09-10', legacyValue])
  await operations.updateRoster(staff.id, '2026-09-11', sickLeave.value)
  for (const [day, code] of [['12', 'EL'], ['13', 'PAT'], ['14', 'BT'], ['15', 'CIR'], ['16', 'HAJ'], ['17', 'RR'], ['18', 'OFF'], ['19', 'PH']] as const) {
    await operations.updateRoster(staff.id, `2026-09-${day}`, dutyCodes.find(item => item.metadata?.displayCode === code)!.value)
  }
  await assert.rejects(() => operations.updateRoster(staff.id, '2026-09-20', legacyValue), /Use SL for new roster assignments/)

  const historical = await repository.leaveRecords('2026-09-10', '2026-09-20', staff.id)
  const sickDays = historical.flatMap(record => record.entries).filter(day => day.classification === 'sickLeave')
  assert.deepEqual(sickDays.map(day => `${day.date}:${day.dutyCode}`), ['2026-09-10:SK', '2026-09-11:SL'])
  assert.equal(new Set(sickDays.map(day => day.date)).size, 2, 'SK/SL compatibility must not double count a roster date')
  assert.deepEqual(historical.map(record => record.leaveType), ['sickLeave', 'sickLeave', 'emergencyLeave', 'paternityLeave', 'businessTrip', 'circumcisionLeave', 'hajjLeave', 'restAndRecuperation', 'off', 'publicHoliday'])

  const normalizedLegacy = (await repository.configuration()).dutyCodes.find(item => item.value === legacyValue)!
  assert.equal(normalizedLegacy.metadata?.legacyCompatibility, true)
  assert.equal(normalizedLegacy.metadata?.protected, true)
  await assert.rejects(() => repository.removeDutyCode(normalizedLegacy.id), /historical Sick Leave compatibility/)

  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const leavePlanner = await readFile(new URL('../src/leave-planner.tsx', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  assert.match(app, /item\.value === entry\?\.dutyCode \|\| item\.active && !isLegacySickLeave\(item\)/)
  assert.match(app, /Code identity and classification are protected\. Managers may change roster availability for leave codes other than OFF, plus color, display order and approved financial settings\./)
  assert.match(app, /Use Activate Duty Code in Leave & Entitlements when it is unavailable\./)
  assert.match(leavePlanner, /Duty Roster remains authoritative/)
  assert.match(styles, /\.leave-summary-cards\{display:grid/)
  assert.match(styles, /@media\(max-width:700px\)[^{]*\{[\s\S]*?\.leave-summary-cards\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/)

  await repository.getDatabase().close()
  const existingDatabase = new PGlite(existingCodeDirectory)
  await existingDatabase.exec(await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'))
  await existingDatabase.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes','CUSTOM_EL','Existing Emergency Leave','#654321',$2,true,0)", [randomUUID(), JSON.stringify({ displayCode: 'EL', dutyClassification: 'other', countsAsWorking: false })])
  const existingRepository = new StaffRepository(existingCodeDirectory, existingDatabase)
  await existingRepository.initialize()
  const existingEmergencyCodes = (await existingRepository.configuration()).dutyCodes.filter(item => item.metadata?.displayCode === 'EL')
  assert.equal(existingEmergencyCodes.length, 1, 'an existing display code must not be duplicated by standard initialization')
  assert.equal(existingEmergencyCodes[0].value, 'CUSTOM_EL', 'existing immutable internal identity must be preserved')
  assert.equal(existingEmergencyCodes[0].label, 'Emergency Leave')
  await existingRepository.getDatabase().close()
  console.log(JSON.stringify({ coreCodesStandardized: true, identitiesProtected: true, colorsConfigurable: true, validCustomSave: true, duplicateRrProtectedMessage: true, missingFieldsRejected: true, existingInternalIdentityPreserved: true, duplicateCoreDisplayCodesPrevented: true, historicalSkPreserved: true, slStandardForNewAssignments: true, skSlNoDoubleCounting: true, dutyRosterAuthoritative: true, responsiveLayoutsPreserved: true, schemaMigrationRequired: false }, null, 2))
} finally {
  await rm(dataDirectory, { recursive: true, force: true })
  await rm(existingCodeDirectory, { recursive: true, force: true })
}
