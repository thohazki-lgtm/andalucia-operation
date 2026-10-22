import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { PGlite } from '@electric-sql/pglite'
import { StaffRepository } from './staff-repository.js'

const dataDirectory = await mkdtemp(join(tmpdir(), 'andalucia-final-polish-'))
const snapshotPath = join(tmpdir(), `andalucia-staff-configuration-${randomUUID()}.tgz`)
const execFileAsync = promisify(execFile)
try {
  const first = new StaffRepository(dataDirectory, new PGlite(dataDirectory))
  await first.initialize()
  const duty = await first.saveConfiguration('duty-codes', { id: randomUUID(), value: 'VALIDATION_DUTY', label: 'Validation Duty', color: '#345678', active: true, metadata: { displayCode: 'VD', countsAsWorking: true, dutyClassification: 'working', billTipEligible: true, billTipWorkedDayUnits: 1 } })
  assert.deepEqual({ eligible: duty.metadata?.billTipEligible, units: duty.metadata?.billTipWorkedDayUnits }, { eligible: true, units: 1 })
  await assert.rejects(() => first.saveConfiguration('duty-codes', { id: randomUUID(), value: 'DUTY_EL_TEST', label: 'Emergency Leave', color: '#745678', active: true, metadata: { displayCode: 'ELX', countsAsWorking: false, dutyClassification: 'other' } }), /Choose whether ELX · Emergency Leave is eligible for Bill Tips/)
  const managerConfigured = await first.saveConfiguration('duty-codes', { id: randomUUID(), value: 'DUTY_EL_TEST', label: 'Emergency Leave', color: '#745678', active: true, metadata: { displayCode: 'ELX', countsAsWorking: false, dutyClassification: 'other', billTipEligible: true, billTipWorkedDayUnits: 0 } })
  assert.deepEqual({ eligible: managerConfigured.metadata?.billTipEligible, units: managerConfigured.metadata?.billTipWorkedDayUnits }, { eligible: true, units: 0 })
  const sickLeave = (await first.configuration()).dutyCodes.find(option => option.metadata?.displayCode === 'SL')
  assert.ok(sickLeave)
  await assert.rejects(() => first.saveConfiguration('duty-codes', { ...sickLeave, color: '#8f75b5' }), /Choose whether SL · Sick Leave is eligible for Bill Tips/)
  const savedSickLeave = await first.saveConfiguration('duty-codes', { ...sickLeave, color: '#8f75b5', metadata: { ...sickLeave.metadata, billTipEligible: true, billTipWorkedDayUnits: 1 } })
  assert.deepEqual({ eligible: savedSickLeave.metadata?.billTipEligible, units: savedSickLeave.metadata?.billTipWorkedDayUnits }, { eligible: true, units: 1 })
  const configurableCodes = (await first.configuration()).dutyCodes
  const on = configurableCodes.find(option => (option.metadata?.displayCode || option.value) === 'ON')
  assert.ok(on)
  const savedOn = await first.saveConfiguration('duty-codes', { ...on, metadata: { ...on.metadata, billTipEligible: false, billTipWorkedDayUnits: 0 } })
  assert.deepEqual({ eligible: savedOn.metadata?.billTipEligible, units: savedOn.metadata?.billTipWorkedDayUnits }, { eligible: true, units: 1 }, 'working duties must follow the approved automatic rule')
  const publicHoliday = configurableCodes.find(option => (option.metadata?.displayCode || option.value) === 'PH')
  assert.ok(publicHoliday)
  const savedPublicHoliday = await first.saveConfiguration('duty-codes', { ...publicHoliday, metadata: { ...publicHoliday.metadata, billTipEligible: false, billTipWorkedDayUnits: 0 } })
  assert.deepEqual({ eligible: savedPublicHoliday.metadata?.billTipEligible, units: savedPublicHoliday.metadata?.billTipWorkedDayUnits }, { eligible: false, units: 0 }, 'PH must remain manager controlled')
  const off = configurableCodes.find(option => (option.metadata?.displayCode || option.value) === 'OFF')
  assert.ok(off)
  const savedOff = await first.saveConfiguration('duty-codes', { ...off, metadata: { ...off.metadata, billTipEligible: false, billTipWorkedDayUnits: 0 } })
  assert.deepEqual({ eligible: savedOff.metadata?.billTipEligible, units: savedOff.metadata?.billTipWorkedDayUnits }, { eligible: false, units: 0 }, 'OFF must remain manager controlled')
  const annualLeave = configurableCodes.find(option => option.metadata?.displayCode === 'AL')
  assert.ok(annualLeave)
  const protectedAnnualLeave = await first.saveConfiguration('duty-codes', { ...annualLeave, metadata: { ...annualLeave.metadata, billTipEligible: true, billTipWorkedDayUnits: 1 } })
  assert.deepEqual({ eligible: protectedAnnualLeave.metadata?.billTipEligible, units: protectedAnnualLeave.metadata?.billTipWorkedDayUnits }, { eligible: false, units: 0 })
  const employment = await first.saveConfiguration('employment-statuses', { id: randomUUID(), value: 'validation_status', label: 'Validation Status', active: true, metadata: {} })
  const position = (await first.configuration()).positions.find(option => option.value === 'Restaurant Supervisor')
  assert.ok(position)
  const staffId = randomUUID()
  await first.create({ id: staffId, number: 'PHASE1-TEMP', name: 'Phase 1 Temporary Staff', position: position.value, nationality: 'Maldivian', division: 'Food & Beverage', department: 'F&B Service', outlet: 'Andalucía', identityDocumentNumber: 'TEMP-ID', employmentStatus: employment.value, joinDate: '2026-09-03' })
  await first.saveConfiguration('employment-statuses', { ...employment, active: false })
  const renamedPosition = await first.saveConfiguration('positions', { ...position, label: 'Team Leader' })
  const snapshot = await first.getDatabase().dumpDataDir('gzip')
  await writeFile(snapshotPath, new Uint8Array(await snapshot.arrayBuffer()))
  await first.getDatabase().close()

  const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const verifier = join(process.cwd(), 'server', 'staff-configuration-persistence-verifier.ts')
  const { stdout } = await execFileAsync(process.execPath, [tsxCli, verifier, snapshotPath, staffId, duty.id, employment.id, renamedPosition.id], { cwd: process.cwd(), maxBuffer: 1024 * 1024 })
  assert.deepEqual(JSON.parse(stdout), { dutyCountsAsWorking: true, dutyDisplayCode: 'VD', employmentActive: false, positionLabel: 'Team Leader', staffEmploymentStatus: employment.value, staffPosition: position.value })
  console.log(JSON.stringify({ dutyCodePersisted: true, annualLeaveOnlyAutomaticExclusion: true, workingAndTrainingAutomaticEligible: true, leaveAndOffManagerControlled: true, eligibleLeaveRulePersisted: true, ineligibleLeaveRulePersisted: true, undecidedCustomRuleRejected: true, explicitManagerRulePersisted: true, employmentStatusPersisted: true, staffPositionPersisted: true, designationLabelRefreshPersisted: true, inactiveHistoricalValuesReadable: true }, null, 2))
} finally {
  await rm(snapshotPath, { force: true })
  await rm(dataDirectory, { recursive: true, force: true })
}
