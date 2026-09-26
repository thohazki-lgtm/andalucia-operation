import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import type { BookingGuestMemberPreview, BookingImportPreviewRecord, ConfigOption } from '../src/domain.js'
import { analyzeBookingCandidates, BOOKING_INTELLIGENCE_RULESET_VERSION } from './booking-intelligence-engine.js'
import { resolveBookingCover, resolveBookingCoverRecords } from './booking-cover-resolver.js'
import { BookingRepository } from './booking-repository.js'
import { GuestOccasionRepository } from './guest-occasion-repository.js'
import { parseActivityProgramPdf } from './activity-program-parser.js'

const member = (index: number, note = '', birthDate: string | null = null): BookingGuestMemberPreview => ({ guestName: `Guest ${index}`, roomNumber: String(300 + index), accommodationCode: '', birthDate, arrivalDate: null, departureDate: null, mealPlan: '', guestNotes: note, sourceRowOrder: index })
const booking = (id: string, covers: number, note = '', members: BookingGuestMemberPreview[] = []): BookingImportPreviewRecord => ({ venue: 'andalucia', reservationDate: '2026-09-20', reservationTime: '19:30', bookingNumber: id, primaryGuest: `Guest ${id}`, rooms: members.map(item => item.roomNumber), covers, sourceStatus: 'Confirmed', bookedBy: 'Test', sourceNotes: note, activityLabel: 'Dinner at Andalucia', walkIn: false, guestMembers: members, warnings: [], readiness: 'READY' })
const occasionTypes: ConfigOption[] = [
  { id: 'h', value: 'honeymoon', label: 'Honeymoon', active: true, metadata: { detectionKeywords: ['honeymoon'] } },
  { id: 'b', value: 'birthday', label: 'Birthday', active: true, metadata: { detectionKeywords: ['birthday'] } },
  { id: 'a', value: 'anniversary', label: 'Anniversary', active: true, metadata: { detectionKeywords: ['anniversary'] } },
  { id: 's', value: 'see_you_soon', label: 'See You Soon', active: true, metadata: { detectionKeywords: ['see you soon'] } },
  { id: 'f', value: 'famtrip', label: 'Famtrip', active: true, metadata: { detectionKeywords: ['famtrip', 'fam trip'] } },
  { id: 'p', value: 'presstrip', label: 'Presstrip', active: true, metadata: { detectionKeywords: ['presstrip', 'press trip'] } },
  { id: 'sf', value: 'siyam_family', label: 'Siyam Family', active: true, metadata: { detectionKeywords: ['siyam world family members'] } }
]

const analyzed = (record: BookingImportPreviewRecord) => analyzeBookingCandidates([resolveBookingCover(record)], occasionTypes)[0]
const keys = (record: BookingImportPreviewRecord) => record.intelligence?.findings.map(item => item.normalizedKey) || []

for (const note of ['I: HM deco pls', 'I: HM table', 'I: HM Celebration - kindly decorate the table', 'Honeymoon couple']) assert(keys(analyzed(booking(`HM-${note}`, 2, note))).includes('HONEYMOON'))
for (const note of ['I: SYS', 'I: SYS Table', 'I: SYS Tables', 'I: SYS deco', 'I: SYS Decoration', 'I: SYS Decorations', 'See You Soon', 'Table See You Soon', 'See You Soon Tables', 'G: sYs DeCo', 'B: sys tables']) {
  const record = analyzed(booking(`SYS-${note}`, 2, note))
  const finding = record.intelligence?.findings.find(item => item.normalizedKey === 'SEE_YOU_SOON')
  assert(finding)
  assert.equal(finding.rawEvidence, note)
  assert(finding.detectedPhrase.length > 0)
  assert.equal(finding.evidenceLocation, 'booking.sourceNotes')
  assert.equal(finding.ruleVersion, BOOKING_INTELLIGENCE_RULESET_VERSION)
  assert(record.intelligence?.newOccasionKeys.includes('see_you_soon'))
}
const sysParity = analyzed(booking('SYS-PARITY', 2, 'I: SYS tables'))
assert.deepEqual(sysParity.intelligence?.legacyOccasionKeys, ['see_you_soon'])
assert.deepEqual(sysParity.intelligence?.newOccasionKeys, ['see_you_soon'])
assert.deepEqual(sysParity.intelligence?.occasionDiscrepancies, [])
const multi = analyzed(booking('MULTI', 2, 'I: HM table. TLC. Guest has shellfish allergy.'))
assert.deepEqual(['ALLERGY', 'GUEST_ATTENTION_TLC', 'HONEYMOON'], [...new Set(keys(multi))].sort())
assert.equal(multi.intelligence?.findings.find(item => item.normalizedKey === 'GUEST_ATTENTION_TLC')?.rawEvidence, 'I: HM table. TLC. Guest has shellfish allergy.')
assert(multi.intelligence?.findings.every(item => item.ruleVersion === BOOKING_INTELLIGENCE_RULESET_VERSION && /^[0-9a-f]{64}$/.test(item.evidenceSha256)))

const clearBlocked = analyzed(booking('BLOCKED', 12, 'I: BLOCKED capacity for restaurant service'))
assert.equal(clearBlocked.covers, 12)
assert.equal(clearBlocked.intelligence?.effectiveCandidatePax, 0)
assert(keys(clearBlocked).includes('BLOCKED_CAPACITY'))
const ambiguousBlocked = analyzed(booking('BLOCKED-AMBIG', 2, 'Guest was blocked from calling the room'))
assert(keys(ambiguousBlocked).includes('BLOCKED_REVIEW_REQUIRED'))
assert.equal(ambiguousBlocked.readiness, 'REVIEW_REQUIRED')

const solo = analyzed(booking('SOLO', 1))
assert(keys(solo).includes('PAX_REVIEW_REQUIRED'))
assert.equal(solo.readiness, 'REVIEW_REQUIRED')
const correctedSolo = analyzed(booking('SOLO-3', 1, 'I: 3 pax'))
assert.equal(correctedSolo.intelligence?.effectiveCandidatePax, 3)
assert(!keys(correctedSolo).includes('PAX_REVIEW_REQUIRED'))

const joining = analyzed(booking('JOIN', 4, 'I: joining with family, 15 pax'))
assert.equal(joining.covers, 15)
assert.equal(joining.intelligence?.effectiveCandidatePax, 15)
assert(keys(joining).includes('GROUP'))
for (const sourcePax of [1, 2, 4]) for (const note of ['I: joining with 15 pax', 'I: joining family with 15 pax', 'I: joining another room, total 15 pax', 'I: joining group 15 pax', 'I: joining 15 pax']) {
  const record = analyzed(booking(`JOIN-${sourcePax}-${note}`, sourcePax, note))
  assert.equal(record.covers, 15)
  assert.equal(record.intelligence?.effectiveCandidatePax, 15)
  assert(keys(record).includes('GROUP'))
  assert(!keys(record).includes('GROUP_REVIEW_REQUIRED'))
}
for (const note of ['I: add 2 more people', 'I: 2 additional guests', 'I: +2 pax']) {
  const incremental = analyzed(booking(`ADD-${note}`, 4, note))
  assert.equal(incremental.covers, 6)
  assert.equal(incremental.coverResolution?.source, 'incremental_addition')
}
const incremental = analyzed(booking('ADD', 4, 'I: add 2 more people'))
for (const note of ['15 pax group', '15 pax dinner together', 'table for 15', 'booking for 15 people']) assert.equal(analyzed(booking(`GROUP-${note}`, 4, note)).covers, 15)
const plainTotal = analyzed(booking('PLAIN-TOTAL', 2, 'I: 15 pax'))
assert.equal(plainTotal.covers, 15)
assert.equal(plainTotal.intelligence?.paxSemantic, 'GROUP_TOTAL')
assert(keys(plainTotal).includes('GROUP'))

const repeatedUnlinked = analyzeBookingCandidates(resolveBookingCoverRecords([booking('G1', 4, '15 pax dinner together'), booking('G2', 3, '15 pax dinner together')]), occasionTypes)
assert(repeatedUnlinked.every(item => keys(item).includes('GROUP')))
assert(repeatedUnlinked.every(item => !keys(item).includes('GROUP_REVIEW_REQUIRED')))
assert(repeatedUnlinked.every(item => item.readiness === 'READY'))
assert.equal(repeatedUnlinked.reduce((sum, item) => sum + (item.intelligence?.operationalContributionPax || 0), 0), 30)

const linkedGroup = analyzeBookingCandidates(resolveBookingCoverRecords([
  booking('LINKED-1', 2, 'I: joining with 15 pax, rooms 809, 810'),
  booking('LINKED-2', 4, 'I: joining group 15 pax, rooms 809, 810')
]), occasionTypes)
assert.equal(linkedGroup.reduce((sum, item) => sum + (item.covers || 0), 0), 15)
assert(linkedGroup.every(item => item.coverResolution?.groupTotal === 15))
assert(linkedGroup.every(item => !keys(item).includes('GROUP_REVIEW_REQUIRED')))

const joiningMultiFlag = analyzed(booking('JOIN-MULTI', 2, 'I: joining with 15 pax', [member(1, 'G: Siyam World Family Members - 2nd Visit')]))
assert.equal(joiningMultiFlag.covers, 15)
assert(keys(joiningMultiFlag).includes('GROUP'))
assert(keys(joiningMultiFlag).includes('SIYAM_FAMILY'))

const kids = analyzed(booking('KIDS', 1, '2 adults + 1 kid'))
assert.deepEqual({ total: kids.covers, kids: kids.coverResolution?.kids, adults: kids.coverResolution?.adults }, { total: 3, kids: 1, adults: 2 })
const sameStructuredKid = analyzed(booking('KIDS-SAME', 3, '2 adults + 1 kid', [member(1, '', '2018-09-20'), member(2), member(3)]))
assert.equal(sameStructuredKid.coverResolution?.kids, 1)
assert(!keys(sameStructuredKid).includes('KIDS_REVIEW_REQUIRED'))
const conflictingKids = analyzed(booking('KIDS-CONFLICT', 4, '2 adults + 2 kids', [member(1, '', '2018-09-20'), member(2), member(3), member(4)]))
assert(keys(conflictingKids).includes('KIDS_REVIEW_REQUIRED'))

for (const note of ['This showroom is harmonious', 'systematic service', 'systematic tables', 'cutlery checklist']) {
  const record = analyzed(booking(`FALSE-${note}`, 2, note))
  assert(!keys(record).includes('HONEYMOON'))
  assert(!keys(record).includes('SEE_YOU_SOON'))
  assert(!keys(record).includes('GUEST_ATTENTION_TLC'))
}
assert(!keys(analyzed(booking('FALSE-ALLERGY', 2, 'Guest enjoys nutmeg and seafood restaurant views'))).includes('ALLERGY'))
assert.equal(joining.covers, 15)
assert.equal(incremental.covers, 6)

const occasions = analyzed(booking('OCCASIONS', 2, 'Birthday. Anniversary. Fam trip. Press trip. Siyam World Family Members - 2nd Visit.'))
for (const key of ['BIRTHDAY', 'ANNIVERSARY', 'FAMTRIP', 'PRESSTRIP', 'SIYAM_FAMILY']) assert(keys(occasions).includes(key))
assert.equal((occasions.intelligence?.findings.find(item => item.normalizedKey === 'SIYAM_FAMILY')?.detectedValue as { visitNumber: number }).visitNumber, 2)
assert.deepEqual(occasions.intelligence?.legacyOccasionKeys, occasions.intelligence?.newOccasionKeys)

const db = new PGlite()
await db.exec(await readFile('database/schema.sql', 'utf8'))
const repository = new BookingRepository(db)
await repository.initialize()
const preview = await repository.prepareImportPreview({ fileName: 'intelligence-preview.pdf', fileHash: 'a'.repeat(64), reportDate: '2026-09-20', parserVersion: 'test', summary: { bookingGroups: 1, totalCovers: multi.covers || 0, confirmed: 1, pending: 0, warnings: 0, possibleDuplicates: 0 }, validation: { declaredBookingGroups: 1, declaredCovers: multi.covers || 0, reconciled: true, messages: [] }, bookings: [multi] })
assert(preview.bookings[0].intelligence)
const stored = await db.query<{ preview_payload: unknown }>('select preview_payload from booking_import_batches where id=$1', [preview.batchId])
const payload = typeof stored.rows[0].preview_payload === 'string' ? JSON.parse(stored.rows[0].preview_payload) : stored.rows[0].preview_payload
assert.equal(payload[0].intelligence.rulesetVersion, BOOKING_INTELLIGENCE_RULESET_VERSION)
const imported = await repository.confirmImport(preview.batchId, [0])
assert.equal(imported.importedBookings, 1)
const repeated = await repository.prepareImportPreview({ fileName: 'intelligence-preview.pdf', fileHash: 'a'.repeat(64), reportDate: '2026-09-20', parserVersion: 'test', summary: { bookingGroups: 1, totalCovers: multi.covers || 0, confirmed: 1, pending: 0, warnings: 0, possibleDuplicates: 0 }, validation: { declaredBookingGroups: 1, declaredCovers: multi.covers || 0, reconciled: true, messages: [] }, bookings: [multi] })
assert.equal(repeated.bookings[0].readiness, 'DUPLICATE')
const duplicateCandidates = await repository.duplicateReanalysisCandidates(repeated.batchId)
assert.equal(duplicateCandidates.length, 1)
assert.equal(duplicateCandidates[0].source.bookingNumber, multi.bookingNumber)
assert.equal(duplicateCandidates[0].existing.duplicateBookingId, imported.importedBookingIds[0])
const duplicateSourceAnalysis = analyzeBookingCandidates(duplicateCandidates.map(item => item.source), occasionTypes)
const duplicateExistingAnalysis = analyzeBookingCandidates(duplicateCandidates.map(item => item.existing), occasionTypes)
assert(keys(duplicateSourceAnalysis[0]).includes('HONEYMOON'))
assert(keys(duplicateExistingAnalysis[0]).includes('HONEYMOON'))
assert.equal(duplicateSourceAnalysis[0].readiness, 'DUPLICATE')
assert.equal(duplicateExistingAnalysis[0].readiness, 'DUPLICATE')
const findingsTable = await db.query<{ count: number }>("select count(*)::int count from information_schema.tables where table_name='booking_intelligence_findings'")
assert.equal(findingsTable.rows[0].count, 0)

const guestOccasions = new GuestOccasionRepository(db)
await guestOccasions.initialize()
const occasionProjectionRecords = [analyzed(booking('PROJECT-SYS', 2, 'I: SYS deco')), analyzed(booking('PROJECT-BIRTHDAY', 2, 'I: Birthday Package 75 USD'))]
const projectionPreview = await repository.prepareImportPreview({ fileName: 'occasion-projection.pdf', fileHash: 'b'.repeat(64), reportDate: '2026-09-20', parserVersion: 'test', summary: { bookingGroups: 2, totalCovers: 4, confirmed: 2, pending: 0, warnings: 0, possibleDuplicates: 0 }, validation: { declaredBookingGroups: 2, declaredCovers: 4, reconciled: true, messages: [] }, bookings: occasionProjectionRecords })
const projectionImport = await repository.confirmImport(projectionPreview.batchId, [0, 1])
for (const bookingId of projectionImport.importedBookingIds) await guestOccasions.detectForBooking(bookingId, 'R1.3 isolated validation')
const projected = await guestOccasions.list('2026-09-20')
assert(projected.some(item => item.occasionType === 'see_you_soon' && item.bookingNumber === 'PROJECT-SYS'))
assert(projected.some(item => item.occasionType === 'birthday' && item.bookingNumber === 'PROJECT-BIRTHDAY'))

const realPdfFixture = process.argv[2]
let realPdf: { bookings: number; covers: number; findings: number; reviewRequired: number; findingCounts: Record<string, number>; occasionDiscrepancies: number } | undefined
if (realPdfFixture) {
  const parsed = await parseActivityProgramPdf(new Uint8Array(await readFile(realPdfFixture)))
  const analyzedRecords = analyzeBookingCandidates(parsed.bookings, occasionTypes)
  assert(parsed.reportDate)
  assert(analyzedRecords.length > 0)
  assert(analyzedRecords.every(record => record.intelligence?.rulesetVersion === BOOKING_INTELLIGENCE_RULESET_VERSION))
  const target = analyzedRecords.find(record => record.intelligence?.findings.some(item => item.normalizedKey === 'GROUP') && record.intelligence.effectiveCandidatePax === 15)
  assert(target)
  assert.equal(target.covers, 15)
  assert.equal(target.intelligence?.effectiveCandidatePax, 15)
  assert(keys(target).includes('GROUP'))
  assert.equal(target.intelligence?.findings.filter(item => item.normalizedKey === 'GROUP').length, 1)
  const findingCounts: Record<string, number> = {}
  for (const record of analyzedRecords) for (const item of record.intelligence?.findings || []) findingCounts[item.normalizedKey] = (findingCounts[item.normalizedKey] || 0) + 1
  realPdf = { bookings: analyzedRecords.length, covers: analyzedRecords.reduce((sum, record) => sum + (record.intelligence?.operationalContributionPax ?? record.covers ?? 0), 0), findings: analyzedRecords.reduce((sum, record) => sum + (record.intelligence?.findings.length || 0), 0), reviewRequired: analyzedRecords.filter(record => record.intelligence?.reviewRequired).length, findingCounts, occasionDiscrepancies: analyzedRecords.reduce((sum, record) => sum + (record.intelligence?.occasionDiscrepancies.length || 0), 0) }
}

console.log(JSON.stringify({ ruleset: BOOKING_INTELLIGENCE_RULESET_VERSION, honeymoon: 'PASS', seeYouSoon: 'PASS', tlc: 'PASS', blocked: 'PASS', singlePax: 'PASS', groupSemantics: 'PASS', groupDoubleCounting: 'PASS', kids: 'PASS', allergies: 'PASS', occasionParity: 'PASS', multiFlag: 'PASS', falsePositives: 'PASS', reviewedPreviewPersistence: 'PASS', duplicateReanalysis: 'PASS', realPdf }, null, 2))
