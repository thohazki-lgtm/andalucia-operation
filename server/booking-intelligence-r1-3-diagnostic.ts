import assert from 'node:assert/strict'
import { config } from '../src/domain.js'
import { parseActivityProgramPdf } from './activity-program-parser.js'
import { analyzeBookingCandidates, reconcileAnalyzedBookingCovers } from './booking-intelligence-engine.js'
import { syntheticActivityProgramPdf } from './activity-program-test-fixture.js'

const parsed = await parseActivityProgramPdf(syntheticActivityProgramPdf('intelligence'))
const analyzed = analyzeBookingCandidates(parsed.bookings, config.occasionTypes)
const reconciliation = reconcileAnalyzedBookingCovers(analyzed, parsed.validation.declaredCovers)
const ledger = analyzed.map((record, index) => ({
  index,
  bookingNumber: record.bookingNumber,
  time: record.reservationTime,
  rooms: record.rooms,
  primaryGuest: record.primaryGuest,
  sourcePax: record.coverResolution?.baseCovers ?? null,
  structuredMembers: record.guestMembers.length,
  source: record.coverResolution?.source,
  evidence: record.coverResolution?.evidence,
  groupId: record.coverResolution?.groupId ?? null,
  groupTotal: record.coverResolution?.groupTotal ?? null,
  effectivePax: record.intelligence?.effectiveCandidatePax ?? record.covers,
  delta: (record.intelligence?.effectiveCandidatePax ?? record.covers ?? 0) - (record.coverResolution?.baseCovers ?? 0),
  readiness: record.readiness,
  notes: [record.sourceNotes, ...record.guestMembers.map(member => member.guestNotes)].filter(Boolean),
  diagnostics: record.coverResolution?.diagnostics ?? [],
  findings: record.intelligence?.findings.map(item => ({ key: item.normalizedKey, phrase: item.detectedPhrase, location: item.evidenceLocation, review: item.reviewState })) ?? []
}))

assert.equal(parsed.reportDate, '2026-09-20')
assert.equal(analyzed.length, 6)
assert.equal(parsed.validation.declaredCovers, 11)
assert.equal(reconciliation.sourceBookingTotal, 11)
assert.equal(reconciliation.positiveAdjustments, 4)
assert.equal(reconciliation.exclusions, 2)
assert.equal(reconciliation.effectiveOperationalTotal, 13)
assert.equal(reconciliation.unresolvedRecords, 1)
assert.equal(reconciliation.reconciled, true)
const joining = analyzed.find(record => record.bookingNumber === '9100001')
assert(joining)
assert.equal(joining.intelligence?.paxSemantic, 'GROUP_TOTAL')
assert.equal(joining.intelligence?.operationalContributionPax, 6)
assert.equal(joining.intelligence?.coverDelta, 4)
const blocked = analyzed.find(record => record.bookingNumber === '9100005')
assert(blocked)
assert.equal(blocked.intelligence?.paxSemantic, 'BLOCKED_CAPACITY')
assert.equal(blocked.intelligence?.operationalContributionPax, 0)
assert.equal(blocked.intelligence?.coverDelta, -2)
const birthday = analyzed.find(record => record.bookingNumber === '9100002')
assert(birthday)
assert(birthday.intelligence?.findings.some(item => item.normalizedKey === 'BIRTHDAY'))
assert(birthday.intelligence?.newOccasionKeys.includes('birthday'))
const sys = analyzed.find(record => record.bookingNumber === '9100003')
assert(sys)
assert(sys.intelligence?.findings.some(item => item.normalizedKey === 'SEE_YOU_SOON'))
assert(sys.intelligence?.newOccasionKeys.includes('see_you_soon'))
assert.equal(analyzed.filter(record => record.intelligence?.sourcePax === 1).length, 1)
assert(analyzed.filter(record => record.intelligence?.sourcePax === 1).every(record => record.intelligence?.paxSemantic === 'MANAGER_REVIEW' && record.intelligence.operationalContributionPax === 1))

console.log(JSON.stringify({
  fixture: 'synthetic-fictional', reportDate: parsed.reportDate,
  validation: parsed.validation,
  reconciliation,
  totals: {
    bookings: ledger.length,
    source: ledger.reduce((sum, row) => sum + Number(row.sourcePax || 0), 0),
    effective: ledger.reduce((sum, row) => sum + Number(row.effectivePax || 0), 0),
    delta: ledger.reduce((sum, row) => sum + row.delta, 0)
  },
  changed: ledger.filter(row => row.delta !== 0 || row.findings.some(item => /BLOCKED|PAX|GROUP/.test(item.key))),
  occasions: ledger.filter(row => row.findings.some(item => ['HONEYMOON', 'SEE_YOU_SOON', 'BIRTHDAY'].includes(item.key))),
  singles: ledger.filter(row => row.sourcePax === 1),
  ledger
}, null, 2))
