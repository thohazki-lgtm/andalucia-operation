import assert from 'node:assert/strict'
import { resolveBookingCover, resolveBookingCoverRecords } from './booking-cover-resolver.js'
import type { BookingGuestMemberPreview, BookingImportPreviewRecord } from '../src/domain.js'

const member = (index: number, birthDate: string | null = null): BookingGuestMemberPreview => ({ guestName: `Guest ${index}`, roomNumber: '', accommodationCode: '', birthDate, arrivalDate: null, departureDate: null, mealPlan: '', guestNotes: '', sourceRowOrder: index })
const booking = (bookingNumber: string, covers: number, notes = '', status = 'confirmed', members: BookingGuestMemberPreview[] = []): BookingImportPreviewRecord => ({ venue: 'andalucia', reservationDate: '2026-09-08', reservationTime: '19:30', bookingNumber, primaryGuest: `Guest ${bookingNumber}`, rooms: [], covers, sourceStatus: status, bookedBy: 'Test', sourceNotes: notes, activityLabel: 'Dinner at Andalucia', walkIn: false, guestMembers: members, warnings: [], readiness: 'READY' })

const septemberGroup = resolveBookingCoverRecords([
  booking('A', 6, 'I: 374/375/376/426 12pax'),
  booking('B', 5, 'I: 374/375/376/426 12pax')
])
assert.equal(septemberGroup.reduce((sum, item) => sum + (item.covers || 0), 0), 12)
assert(septemberGroup.every(item => item.coverResolution?.source === 'linked_room_group_total'))
assert.equal(resolveBookingCover(booking('C', 2, 'I: 3pax')).covers, 3)
assert.equal(resolveBookingCover(booking('D', 1, 'B: Будет 3 человека')).covers, 3)
for (const [id, covers] of [['E', 5], ['F', 1], ['G', 3]] as const) {
  const pending = resolveBookingCover(booking(id, covers, '', 'pending'))
  assert.equal(pending.covers, covers)
  assert.equal(pending.coverResolution?.source, 'base_pending_pax')
}

assert.equal(resolveBookingCover(booking('H', 8, 'I: 12 PAX GROUP')).covers, 12)
assert.equal(resolveBookingCover(booking('I', 4, 'I: 10 PAX FAMILY')).covers, 10)
assert.equal(resolveBookingCover(booking('J', 4, 'I: 5 PAX')).covers, 5)
const joining = resolveBookingCover(booking('K', 4, 'I: JOINING WITH 10 PAX'))
assert.equal(joining.covers, 10)
assert.equal(joining.coverResolution?.source, 'joining_family_total')
const arithmetic = resolveBookingCover(booking('L', 4, 'B: 5pax I: 6 PAX + ONE INFANT', 'confirmed', Array.from({ length: 6 }, (_, index) => member(index + 1))))
assert.deepEqual({ covers: arithmetic.covers, kids: arithmetic.coverResolution?.kids, adults: arithmetic.coverResolution?.adults, source: arithmetic.coverResolution?.source }, { covers: 7, kids: 1, adults: 6, source: 'arithmetic_expression' })
assert.equal(resolveBookingCover(booking('M', 5, 'B: 6 PAX I: 6 PAX')).covers, 6)
assert.equal(resolveBookingCover(booking('N', 6, 'I: 7 PAX')).covers, 7)
const januaryGroup = resolveBookingCoverRecords([
  booking('O1', 14, 'I: 20pax / 720, 710, 712, 713, 325'),
  booking('O2', 5, 'I: 720, 710, 712, 713, 325')
])
assert.equal(januaryGroup.reduce((sum, item) => sum + (item.covers || 0), 0), 20)

const russianConfirmation = resolveBookingCover(booking('R', 2, 'B: 2 гостя'))
assert.equal(russianConfirmation.covers, 2)
const structuredChild = resolveBookingCover(booking('CHILD', 4, 'I: 4 PAX + 1 CHILD', 'confirmed', [member(1, '2016-01-01'), member(2), member(3), member(4), member(5)]))
assert.deepEqual({ covers: structuredChild.covers, kids: structuredChild.coverResolution?.kids, adults: structuredChild.coverResolution?.adults }, { covers: 5, kids: 1, adults: 4 })
for (const [text, covers, kids, adults] of [
  ['2 ADULTS + 1 CHILD', 3, 1, 2],
  ['2 adults + one child', 3, 1, 2],
  ['2 adults + 1 kid', 3, 1, 2],
  ['3 adults + 2 kids', 5, 2, 3],
  ['2 adults + 1 infant', 3, 1, 2],
  ['2 adults + one infant', 3, 1, 2]
] as const) {
  const result = resolveBookingCover(booking(`EXPRESSION-${text}`, 2, `I: ${text}`))
  assert.deepEqual({ covers: result.covers, kids: result.coverResolution?.kids, adults: result.coverResolution?.adults }, { covers, kids, adults })
}

for (const record of [...septemberGroup, joining, arithmetic, ...januaryGroup, structuredChild]) {
  assert.equal((record.coverResolution?.adults || 0) + (record.coverResolution?.kids || 0), record.covers)
}

console.log(JSON.stringify({ septemberLinkedGroup: septemberGroup.map(item => item.covers), septemberTotal: 12, overrides: { simple: 3, russian: 3 }, pending: [5, 1, 3], january: { group: 12, family: 10, simple: 5, joining: 10, arithmetic: { covers: 7, kids: 1 }, repeatedInstruction: 6, override: 7, linkedGroup: januaryGroup.map(item => item.covers), linkedTotal: 20 } }, null, 2))
