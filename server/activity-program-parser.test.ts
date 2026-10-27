import assert from 'node:assert/strict'
import { parseActivityProgramPdf } from './activity-program-parser.js'
import { syntheticActivityProgramBoundaryPdf, syntheticActivityProgramMismatchPdf, syntheticActivityProgramPdf } from './activity-program-test-fixture.js'

const parsed = await parseActivityProgramPdf(syntheticActivityProgramPdf('import'))
assert.equal(parsed.reportDate, '2026-08-31')
assert.equal(parsed.bookings.length, 4)
assert.equal(parsed.bookings.reduce((sum, booking) => sum + (booking.covers || 0), 0), 7)
const arithmeticOverride = parsed.bookings.find(booking => booking.bookingNumber === '9000001')
assert.deepEqual({ covers: arithmeticOverride?.covers, adults: arithmeticOverride?.coverResolution?.adults, kids: arithmeticOverride?.coverResolution?.kids, source: arithmeticOverride?.coverResolution?.source }, { covers: 3, adults: 2, kids: 1, source: 'arithmetic_expression' })
assert.equal(parsed.bookings.filter(booking => booking.sourceStatus.toLowerCase() === 'confirmed').length, 3)
assert.equal(parsed.bookings.filter(booking => booking.sourceStatus.toLowerCase() === 'pending').length, 1)
assert.deepEqual(parsed.bookings.find(booking => booking.bookingNumber === '9000001')?.rooms, ['211', '212'])
assert.equal(parsed.bookings.find(booking => booking.bookingNumber === '9000004')?.readiness, 'REVIEW_REQUIRED')
assert(parsed.bookings.every(booking => !/Page \d+ from/i.test(booking.bookedBy)))
assert(parsed.validation.reconciled)
assert.equal(parsed.validation.messages.length, 0)

const boundary = await parseActivityProgramPdf(syntheticActivityProgramBoundaryPdf())
assert.equal(boundary.bookings.length, 4, 'multiline notes and page breaks must not terminate an Andalucia section')
assert.equal(boundary.validation.declaredBookingGroups, 4)
assert.equal(boundary.validation.declaredCovers, 14)
assert(boundary.validation.reconciled)
assert.deepEqual(boundary.validation.messages, [], 'supported operational PAX adjustments must remain in the cover ledger, not document warnings')
assert.equal(boundary.bookings.find(booking => booking.bookingNumber === '9200002')?.sourceStatus, 'Pending')
const compactParty = boundary.bookings.find(booking => booking.bookingNumber === '9200003')
assert.deepEqual({ base: compactParty?.coverResolution?.baseCovers, total: compactParty?.covers, source: compactParty?.coverResolution?.source }, { base: 4, total: 6, source: 'arithmetic_expression' })
assert.equal(boundary.bookings.find(booking => booking.bookingNumber === '9200002')?.coverResolution?.kids, 1, 'children under 12 remain separately classified')

const mismatched = await parseActivityProgramPdf(syntheticActivityProgramMismatchPdf())
assert.equal(mismatched.validation.reconciled, false)
assert.equal(mismatched.bookings[0]?.readiness, 'READY', 'document reconciliation warnings must not poison valid individual bookings')
console.log(JSON.stringify({ fixture: 'synthetic-fictional', bookings: parsed.bookings.length, covers: parsed.bookings.reduce((sum, booking) => sum + (booking.covers || 0), 0), confirmed: parsed.bookings.filter(booking => booking.sourceStatus.toLowerCase() === 'confirmed').length, pending: parsed.bookings.filter(booking => booking.sourceStatus.toLowerCase() === 'pending').length, reviewRequired: parsed.bookings.filter(booking => booking.readiness === 'REVIEW_REQUIRED').length }, null, 2))
