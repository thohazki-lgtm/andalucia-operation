import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import type { BookingImportPreview, ConfigOption } from '../src/domain.js'
import { parseActivityProgramPdf, ACTIVITY_PROGRAM_PARSER_VERSION } from './activity-program-parser.js'
import { analyzeBookingCandidates, BOOKING_INTELLIGENCE_RULESET_VERSION } from './booking-intelligence-engine.js'
import { BookingRepository } from './booking-repository.js'
import { syntheticActivityProgramPdf } from './activity-program-test-fixture.js'

const pdf = Buffer.from(syntheticActivityProgramPdf('intelligence'))
const parsed = await parseActivityProgramPdf(new Uint8Array(pdf))
const occasionTypes: ConfigOption[] = [
  ['honeymoon', ['honeymoon']], ['birthday', ['birthday']], ['anniversary', ['anniversary']],
  ['see_you_soon', ['see you soon']], ['siyam_family', ['siyam world family members']],
  ['famtrip', ['famtrip', 'fam trip']], ['presstrip', ['presstrip', 'press trip']]
].map(([value, keywords], index) => ({ id: `occasion-${index}`, value: String(value), label: String(value), active: true, metadata: { detectionKeywords: keywords as string[] } }))
const analyzed = analyzeBookingCandidates(parsed.bookings, occasionTypes)
const input: Omit<BookingImportPreview, 'batchId' | 'duplicateFile'> = {
  fileName: '20th sep_daily_bookings_report.pdf', fileHash: createHash('sha256').update(pdf).digest('hex'), reportDate: parsed.reportDate,
  parserVersion: ACTIVITY_PROGRAM_PARSER_VERSION,
  summary: { bookingGroups: analyzed.length, totalCovers: analyzed.reduce((sum, item) => sum + (item.covers || 0), 0), confirmed: analyzed.filter(item => item.sourceStatus.toLowerCase() === 'confirmed').length, pending: analyzed.filter(item => item.sourceStatus.toLowerCase() === 'pending').length, warnings: analyzed.filter(item => item.warnings.length).length, possibleDuplicates: 0 },
  validation: parsed.validation, bookings: analyzed
}
const db = new PGlite()
await db.exec(await readFile('database/schema.sql', 'utf8'))
const repository = new BookingRepository(db)
await repository.initialize()
const first = await repository.prepareImportPreview(input)
const selected = first.bookings.map((item, index) => item.readiness === 'REVIEW_REQUIRED' ? -1 : index).filter(index => index >= 0)
const decisions = first.bookings.map((item, index) => item.readiness === 'REVIEW_REQUIRED' ? { index, action: 'IMPORT_ANYWAY' as const } : null).filter(item => item !== null)
const imported = await repository.confirmImport(first.batchId, selected, decisions)
assert.equal(imported.importedBookings, parsed.bookings.length)
const repeated = await repository.prepareImportPreview(input)
assert.equal(repeated.bookings.filter(item => item.readiness === 'DUPLICATE').length, parsed.bookings.length)
const candidates = await repository.duplicateReanalysisCandidates(repeated.batchId)
assert.equal(candidates.length, parsed.bookings.length)
const source = analyzeBookingCandidates(candidates.map(item => item.source), occasionTypes)
const existing = analyzeBookingCandidates(candidates.map(item => item.existing), occasionTypes)
assert(source.every(item => item.readiness === 'DUPLICATE'))
assert(existing.every(item => item.readiness === 'DUPLICATE'))
const findings = source.reduce((sum, item) => sum + (item.intelligence?.findings.length || 0), 0)
const reviewRequired = source.filter(item => item.intelligence?.reviewRequired).length
assert.equal(findings, 8)
assert.equal(reviewRequired, 1)
assert(source.find(item => item.bookingNumber === '9100003')?.intelligence?.findings.some(item => item.normalizedKey === 'SEE_YOU_SOON'))
const joining = source.find(item => item.bookingNumber === '9100001' && item.rooms.includes('501'))
assert(joining)
assert.equal(joining.intelligence?.effectiveCandidatePax, 6)
for (const key of ['GROUP', 'PAX_RESOLVED']) assert(joining.intelligence?.findings.some(item => item.normalizedKey === key))
assert.equal((await db.query<{ count: number }>('select count(*)::int count from bookings')).rows[0].count, parsed.bookings.length)
assert.equal((await db.query<{ count: number }>('select count(*)::int count from booking_guest_members')).rows[0].count, parsed.bookings.reduce((sum, item) => sum + item.guestMembers.length, 0))
console.log(JSON.stringify({ fixture: 'synthetic-fictional', parsed: parsed.bookings.length, covers: source.reduce((sum, item) => sum + (item.covers || 0), 0), duplicates: repeated.summary.possibleDuplicates, reanalyzedExisting: candidates.length, findings, reviewRequired, ruleset: BOOKING_INTELLIGENCE_RULESET_VERSION, persistedIntelligenceFindings: 0 }, null, 2))
