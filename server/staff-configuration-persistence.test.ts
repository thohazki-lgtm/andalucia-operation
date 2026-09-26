import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { StaffRepository } from './staff-repository.js'

const dataDirectory = await mkdtemp(join(tmpdir(), 'andalucia-final-polish-'))
try {
  const first = new StaffRepository(dataDirectory, new PGlite(dataDirectory))
  await first.initialize()
  const duty = await first.saveConfiguration('duty-codes', { id: randomUUID(), value: 'VALIDATION_DUTY', label: 'Validation Duty', color: '#345678', active: true, metadata: { displayCode: 'VD', countsAsWorking: true, dutyClassification: 'working' } })
  const employment = await first.saveConfiguration('employment-statuses', { id: randomUUID(), value: 'validation_status', label: 'Validation Status', active: true, metadata: {} })
  const position = await first.saveConfiguration('positions', { id: randomUUID(), value: 'Validation Position', label: 'Validation Position', active: true, metadata: {} })
  const staffId = randomUUID()
  await first.create({ id: staffId, number: 'PHASE1-TEMP', name: 'Phase 1 Temporary Staff', position: position.value, nationality: 'Maldivian', division: 'Food & Beverage', department: 'F&B Service', outlet: 'Andalucía', identityDocumentNumber: 'TEMP-ID', employmentStatus: employment.value, joinDate: '2026-09-03' })
  await first.saveConfiguration('employment-statuses', { ...employment, active: false })
  await first.saveConfiguration('positions', { ...position, active: false })
  await first.getDatabase().close()

  const reopened = new StaffRepository(dataDirectory, new PGlite(dataDirectory))
  await reopened.initialize()
  const configuration = await reopened.configuration()
  const historicalStaff = await reopened.find(staffId)
  assert.equal(configuration.dutyCodes.find(option => option.id === duty.id)?.metadata?.countsAsWorking, true)
  assert.equal(configuration.dutyCodes.find(option => option.id === duty.id)?.metadata?.displayCode, 'VD')
  assert.equal(configuration.employmentStatuses.find(option => option.id === employment.id)?.active, false)
  assert.equal(configuration.positions.find(option => option.id === position.id)?.active, false)
  assert.equal(historicalStaff?.employmentStatus, employment.value)
  assert.equal(historicalStaff?.position, position.value)
  await reopened.getDatabase().close()
  console.log(JSON.stringify({ dutyCodePersisted: true, employmentStatusPersisted: true, staffPositionPersisted: true, inactiveHistoricalValuesReadable: true }, null, 2))
} finally {
  await rm(dataDirectory, { recursive: true, force: true })
}
