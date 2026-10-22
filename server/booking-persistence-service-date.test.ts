import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { PGlite } from '@electric-sql/pglite'
import { BookingRepository } from './booking-repository.js'
import { ACTIVITY_PROGRAM_PARSER_VERSION, parseActivityProgramPdf } from './activity-program-parser.js'
import { serviceDate } from '../src/service-date.js'
import type { BookingImportPreviewRecord, BookingImportPreview } from '../src/domain.js'
import { initializeDevelopmentStore } from './development-store-init.js'

const execFileAsync = promisify(execFile)

const reservationDate = '2026-09-08'
const storage = await mkdtemp(join(tmpdir(), 'andalucia-booking-date-'))
const databasePath = join(storage, 'postgres')

const bookingNumbers = ['2666735', '2665267', '2663301', '2669053', ...Array.from({ length: 42 }, (_, index) => `SEP8-${String(index + 1).padStart(3, '0')}`)]
const times = ['18:00', '18:00', '19:00', '21:30', ...Array.from({ length: 42 }, (_, index) => `${String(18 + Math.floor((index % 8) / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`)]
const covers = bookingNumbers.map((_, index) => index === 0 ? 2 : index === 1 ? 3 : index === 2 ? 12 : index === 3 ? 3 : index < 23 ? 3 : 2)
const syntheticRecords: BookingImportPreviewRecord[] = bookingNumbers.map((bookingNumber, index) => ({
  venue: 'andalucia', reservationDate, reservationTime: times[index], bookingNumber,
  primaryGuest: `September Guest ${index + 1}`, rooms: [`${700 + index}`], covers: covers[index],
  sourceStatus: 'Confirmed', bookedBy: 'Activity Program', sourceNotes: '',
  activityLabel: 'Dinner at Andalucia', walkIn: false,
  guestMembers: [{ guestName: `September Guest ${index + 1}`, roomNumber: `${700 + index}`, accommodationCode: '', birthDate: null, arrivalDate: '2026-09-01', departureDate: '2026-09-10', mealPlan: 'AI', guestNotes: '', sourceRowOrder: index + 1 }],
  warnings: [], readiness: 'READY'
}))
const fixture = process.argv[2]
let fileName = '8th sep daily_bookings_report.pdf'
let fileHash = createHash('sha256').update('8-september-2026-regression-fixture').digest('hex')
let parserVersion = 'regression-fixture'
let records = syntheticRecords
if (fixture) {
  const pdf = await readFile(fixture)
  const parsed = await parseActivityProgramPdf(new Uint8Array(pdf))
  assert.equal(parsed.reportDate, reservationDate)
  assert.equal(parsed.bookings.length, 46)
  assert.equal(parsed.bookings.reduce((sum, booking) => sum + (booking.covers || 0), 0), 123)
  fileName = fixture.split(/[\\/]/).pop() || fileName
  fileHash = createHash('sha256').update(pdf).digest('hex')
  parserVersion = ACTIVITY_PROGRAM_PARSER_VERSION
  records = parsed.bookings
}
const previewInput: Omit<BookingImportPreview, 'batchId' | 'duplicateFile'> = {
  fileName,
  fileHash,
  reportDate: reservationDate,
  parserVersion,
  summary: { bookingGroups: records.length, totalCovers: covers.reduce((sum, value) => sum + value, 0), confirmed: records.length, pending: 0, warnings: 0, possibleDuplicates: 0 },
  validation: { declaredBookingGroups: 46, declaredCovers: 123, reconciled: true, messages: [] }, bookings: records
}

await initializeDevelopmentStore(databasePath)
let db = new PGlite(databasePath)
try {
  let repository = new BookingRepository(db)
  await repository.initialize()
  const preview = await repository.prepareImportPreview(previewInput)
  const imported = await repository.confirmImport(preview.batchId, preview.bookings.map((_, index) => index))
  assert.equal(imported.reservationDate, reservationDate)
  assert.equal(imported.importedBookings, 46)
  assert.equal(imported.importedCovers, 123)

  let live = await repository.list(reservationDate)
  assert.equal(live.length, 46)
  assert.equal(live.reduce((sum, booking) => sum + booking.covers, 0), 123)
  const representative = new Map(live.map(booking => [booking.bookingNumber, booking]))
  assert.deepEqual(['2666735', '2665267', '2663301', '2669053'].map(bookingNumber => {
    const booking = representative.get(bookingNumber)
    return [bookingNumber, booking?.reservationDate, booking?.reservationTime, booking?.covers]
  }), [
    ['2666735', reservationDate, '18:00', 2], ['2665267', reservationDate, '18:00', 3],
    ['2663301', reservationDate, '19:00', 12], ['2669053', reservationDate, '21:30', 3]
  ])
  for (const bookingNumber of ['2666735', '2665267', '2663301', '2669053']) {
    const booking = representative.get(bookingNumber)
    assert(booking)
    assert.equal(booking.bookingStatus, 'confirmed')
    assert.equal(booking.bookingSource, 'activity_program')
    assert.equal(booking.importSource, 'activity_program')
    assert.equal(booking.sourceReportDate, reservationDate)
    assert.equal(booking.sourceFilename, fileName)
    assert(booking.importedBatchId)
    assert(booking.createdAt)
  }

  const repeatedPreview = await repository.prepareImportPreview(previewInput)
  assert.equal(repeatedPreview.duplicateFile, true)
  assert.equal(repeatedPreview.bookings.filter(booking => booking.readiness === 'DUPLICATE').length, 46)
  const repeated = await repository.confirmImport(repeatedPreview.batchId, repeatedPreview.bookings.map((_, index) => index))
  assert.equal(repeated.importedBookings, 0)
  assert.equal(repeated.skippedDuplicates, 46)
  assert.equal((await repository.list(reservationDate)).length, 46)

  assert.equal(serviceDate(new Date('2026-09-07T19:30:00.000Z')), reservationDate)
  assert.equal(serviceDate(new Date('2026-09-08T18:59:59.000Z')), reservationDate)
  assert.equal(live.every(booking => booking.reservationDate === reservationDate), true)
  const snapshotPath = join(storage, 'booking-store.tgz')
  const snapshot = await db.dumpDataDir('gzip')
  await writeFile(snapshotPath, new Uint8Array(await snapshot.arrayBuffer()))
  await db.close()
  const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const reopenVerifier = join(process.cwd(), 'server', 'booking-persistence-reopen-verifier.ts')
  const { stdout } = await execFileAsync(process.execPath, [tsxCli, reopenVerifier, snapshotPath, reservationDate], { cwd: process.cwd(), maxBuffer: 1024 * 1024 })
  const reopened = JSON.parse(stdout) as { freshRead: number; dashboardCovers: number; hostessCovers: number }
  console.log(JSON.stringify({ imported: imported.importedBookings, covers: imported.importedCovers, freshRead: reopened.freshRead, duplicates: repeated.skippedDuplicates, dashboardCovers: reopened.dashboardCovers, hostessCovers: reopened.hostessCovers, dateStable: true }, null, 2))
} finally {
  await db.close().catch(() => undefined)
  await rm(storage, { recursive: true, force: true })
}
