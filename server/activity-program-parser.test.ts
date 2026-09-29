import assert from 'node:assert/strict'
import { parseActivityProgramPdf } from './activity-program-parser.js'
import { syntheticActivityProgramPdf } from './activity-program-test-fixture.js'

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
console.log(JSON.stringify({ fixture: 'synthetic-fictional', bookings: parsed.bookings.length, covers: parsed.bookings.reduce((sum, booking) => sum + (booking.covers || 0), 0), confirmed: parsed.bookings.filter(booking => booking.sourceStatus.toLowerCase() === 'confirmed').length, pending: parsed.bookings.filter(booking => booking.sourceStatus.toLowerCase() === 'pending').length, reviewRequired: parsed.bookings.filter(booking => booking.readiness === 'REVIEW_REQUIRED').length }, null, 2))
