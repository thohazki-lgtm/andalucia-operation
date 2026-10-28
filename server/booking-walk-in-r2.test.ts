import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { BookingRepository } from './booking-repository.js'
import { isWalkInBookingEvidence } from './daily-report-service.js'
import type { BookingRecord, WalkInBookingInput } from '../src/domain.js'

const db = new PGlite()
await db.exec(await readFile('database/schema.sql', 'utf8'))
const repository = new BookingRepository(db)
await repository.initialize()

const configuration = await repository.configuration()
const walkInSource = configuration.sources.filter(option => option.value === 'walk_in')
assert.equal(walkInSource.length, 1)
assert.equal(walkInSource[0].active, true)
assert.equal(walkInSource[0].metadata?.systemControlled, true)
assert.equal(configuration.statuses.some(option => option.value === 'waiting' && option.active && option.metadata?.operationalAction === 'waiting'), true)
assert.deepEqual(configuration.tableRanges.map(option => option.value), ['20-29', '30-39', '40-49', '60-69', '70-79'])
assert.equal(configuration.tables.some(option => option.value === 'T01'), false)
assert.equal(configuration.tables.some(option => option.value === '10'), false)
assert.equal(configuration.tables.some(option => option.value === '20'), true)
assert.equal(configuration.tables.some(option => option.value === '79'), true)
assert.equal(configuration.tables.some(option => option.value === '50'), false)
assert.equal(configuration.tables.some(option => option.value.includes('–')), false)
assert.deepEqual(configuration.tables.map(option => Number(option.value)), [...configuration.tables.map(option => Number(option.value))].sort((left, right) => left - right))

const base: WalkInBookingInput = { id: randomUUID(), guestName: '', roomNumber: '', birthDate: null, arrivalDate: null, departureDate: null, mealPeriod: 'Dinner', reservationDate: '2026-09-14', reservationTime: '19:30', covers: 2, guestNotes: '', tableNumber: '20', waiterId: null }
await repository.validateWalkIn(base)
await assert.rejects(() => repository.validateWalkIn({ ...base, tableNumber: 'T01' }), /active configured restaurant table/)
await assert.rejects(() => repository.validateWalkIn({ ...base, tableNumber: '50' }), /active configured restaurant table/)
const guestField = configuration.walkInFields.find(option => option.value === 'guestName')!
await repository.saveConfiguration('walkInFields', { ...guestField, metadata: { ...guestField.metadata, walkInFieldMode: 'required' } }, 'R2 Test')
await assert.rejects(() => repository.validateWalkIn(base), /Guest name is required/)
const reset = await repository.resetWalkInFields('R2 Test')
assert.equal(reset.find(option => option.value === 'guestName')?.metadata?.walkInFieldMode, 'optional')
await assert.rejects(() => repository.saveConfiguration('walkInFields', { ...reset.find(option => option.value === 'reservationDate')!, metadata: { ...reset.find(option => option.value === 'reservationDate')!.metadata, walkInFieldMode: 'hidden' } }, 'R2 Test'), /must remain required/)
await assert.rejects(() => repository.saveConfiguration('sources', { ...walkInSource[0], active: false }, 'R2 Test'), /system controlled/)

const walkIn: BookingRecord = { ...base, bookingNumber: '', bookingStatus: 'confirmed', bookingSource: 'walk_in', bookedBy: 'Authenticated Owner', waiter: null, importSource: 'walk_in' }
await repository.save(walkIn, 'Authenticated Owner')
const manual: BookingRecord = { ...walkIn, id: randomUUID(), guestName: 'Historical Manual', bookingNumber: 'MANUAL-1', bookingSource: 'manual', importSource: 'manual' }
await repository.save(manual, 'Historical Fixture')
await db.query("update bookings set table_number='T01' where id=$1", [manual.id])
const historical = await repository.find(manual.id)
assert.equal(historical?.tableNumber, 'T01')
await repository.save({ ...historical!, guestNotes: 'Historical assignment retained' }, 'Historical Fixture')
assert.equal((await repository.find(manual.id))?.tableNumber, 'T01')
const retainedHistorical = await repository.find(manual.id)
await assert.rejects(() => repository.save({ ...retainedHistorical!, tableNumber: '50' }, 'Historical Fixture'), /active configured restaurant table/)
assert.equal((await repository.find(walkIn.id))?.guestName, '')
assert.equal((await repository.find(walkIn.id))?.bookingSource, 'walk_in')
assert.equal((await repository.find(manual.id))?.bookingSource, 'manual')

assert.equal(isWalkInBookingEvidence({ booking_source: 'walk_in' }), true)
assert.equal(isWalkInBookingEvidence({ booking_source: 'manual' }), false)
assert.equal(isWalkInBookingEvidence({ booking_source: 'activity_program', raw_import_payload: { effective: { walkIn: true } } }), false)
assert.equal(isWalkInBookingEvidence({ booking_source: 'activity_program', source_activity_label: 'Andalucía Walk In Guests' }), false)

const waiting = { ...walkIn, id: randomUUID(), guestName: 'Waiting Guest', bookingStatus: 'waiting', bookingNumber: 'WAIT-1' }
await repository.save(waiting, 'R2 Test')
const summary = await repository.summary('2026-09-14')
assert.equal(summary.totalBookings, 3)
assert.equal(summary.remainingBookings, 3)
assert.equal(summary.remainingCovers, 6)

const firstRange = configuration.tableRanges.find(option => option.value === '20-29')!
await repository.saveConfiguration('tableRanges', { ...firstRange, active: false }, 'R2 Test')
const withoutFirstRange = await repository.configuration()
assert.equal(withoutFirstRange.tables.some(option => Number(option.value) >= 20 && Number(option.value) <= 29), false)
assert.equal(withoutFirstRange.tables.some(option => option.value === '30'), true)
await repository.saveConfiguration('tableRanges', { ...firstRange, active: true }, 'R2 Test')
assert.equal((await repository.configuration()).tables.some(option => option.value === '20'), true)

const auditCount = Number((await db.query<{ count: number }>("select count(*)::int count from audit_logs where entity_type='booking_configuration' and actor='R2 Test'")).rows[0].count)
assert.equal(auditCount >= 2, true)
await db.close()

console.log(JSON.stringify({ canonicalWalkIn: true, sourceImmutable: true, waiting: true, walkInFieldPersistence: true, resetDefaults: true, protectedFields: true, optionalGuestName: true, canonicalReporting: true, activityHeadingsExcluded: true, importedPayloadFlagsExcluded: true, historicalManualPreserved: true, tableRanges: true, individualAssignments: true, rangeOnlyAssignmentSource: true, numericSort: true, inactiveRangeExcluded: true, historicalTablesPreserved: true, audit: true }, null, 2))
