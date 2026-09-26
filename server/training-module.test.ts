import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import * as XLSX from 'xlsx'
import { TrainingRepository } from './training-repository.js'
import { parseTrainingCalendar } from './training-calendar-parser.js'
import { prepareTrainingImport } from './training-import-service.js'
import { defaultTrainingImportAction, defaultTrainingReplacementAction, trainingImportSelectionSummary } from '../src/training-import-review.js'

const folder = await mkdtemp(join(tmpdir(), 'andalucia-training-'))
const db = new PGlite(join(folder, 'postgres'))
await db.exec(await readFile('database/schema.sql', 'utf8'))
await db.exec("alter table training_sessions add column if not exists outlet_scope_id uuid not null default '00000000-0000-4000-8000-00000000a001'")
const repository = new TrainingRepository(db); await repository.initialize()
const configuration = await repository.configuration()
assert(configuration.statuses.some(option => option.metadata?.trainingStage === 'upcoming'))
const category = configuration.categories.find(option => option.active)!.value
const status = configuration.statuses.find(option => option.metadata?.trainingStage === 'planned')!.value
const base = { id: randomUUID(), title: 'Sequence of Service', category, date: '2026-09-10', time: '17:30', startTime: '17:30', endTime: '18:00', trainer: 'Thoha / Rahul', location: 'Andalucía', status, notes: 'Operational sequence', description: 'Operational sequence', active: true, attendees: [], source: 'manual' as const }
const created = await repository.save(base)
assert.equal(created.endTime, '18:00'); assert.equal(created.location, 'Andalucía'); assert.equal(created.source, 'manual')
await assert.rejects(() => repository.save({ ...base, id: randomUUID() }), /same date, topic and time/)
const edited = await repository.save({ ...created, trainer: 'Rahul', endTime: '18:15' }); assert.equal(edited.trainer, 'Rahul'); assert.equal(edited.endTime, '18:15')
const archived = await repository.archive(created.id); assert.equal(archived.active, false)

const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  ['Date', 'Day', 'Topic', 'Time', 'Trainer', 'Location'],
  ['12-Sep-26', 'Saturday', 'Workplace Respect', '17:30-18:00', 'Thoha / Rahul', 'Andalucía'],
  ['13-Sep-26', 'Sunday', 'Menu Knowledge', '18:00-18:30', '', 'Andalucía']
]), 'September')
const xlsx = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
const parsed = await parseTrainingCalendar(new Uint8Array(xlsx), 'HR Training Calendar.xlsx')
assert.equal(parsed.records.length, 2); assert.equal(parsed.records[0].date, '2026-09-12'); assert.equal(parsed.records[0].startTime, '17:30'); assert.equal(parsed.records[0].endTime, '18:00'); assert.equal(parsed.records[0].readiness, 'READY'); assert.equal(parsed.records[1].readiness, 'REVIEW_REQUIRED')
const parsedCsv = await parseTrainingCalendar(new Uint8Array(Buffer.from('Date,Day,Topic,Time,Trainer,Location\n05-Sep-26,Saturday,Allergy Safety Awareness,17:30-18:00,Thoha/Rahul,Andalucía\n')), 'HR Training Calendar.csv')
assert.equal(parsedCsv.records[0].date, '2026-09-05'); assert.equal(parsedCsv.records[0].readiness, 'READY')

const pdfContent = "BT\n/F1 12 Tf\n50 760 Td\n(14-Sep-26) Tj\n0 -18 Td\n(Topic: Guest Experience) Tj\n0 -18 Td\n(Time: 17:30-18:00) Tj\n0 -18 Td\n(Trainer: Thoha / Rahul) Tj\n0 -18 Td\n(Location: Andalucia) Tj\nET"
const pdfObjects = [
  '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
  '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
  '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
  `4 0 obj\n<< /Length ${Buffer.byteLength(pdfContent)} >>\nstream\n${pdfContent}\nendstream\nendobj\n`,
  '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
]
let pdfBody = '%PDF-1.4\n'; const offsets: number[] = []
for (const object of pdfObjects) { offsets.push(Buffer.byteLength(pdfBody)); pdfBody += object }
const xref = Buffer.byteLength(pdfBody); pdfBody += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
const parsedPdf = await parseTrainingCalendar(new Uint8Array(Buffer.from(pdfBody)), 'HR Training Calendar.pdf')
assert.equal(parsedPdf.records.length, 1); assert.equal(parsedPdf.records[0].topic, 'Guest Experience'); assert.equal(parsedPdf.records[0].readiness, 'READY')

const positionedPdf = (items: Array<{ text: string; x: number; y: number }>) => {
  const escape = (value: string) => value.replace(/([\\()])/g, '\\$1')
  const content = items.map(item => `BT\n/F1 8 Tf\n${item.x} ${item.y} Td\n(${escape(item.text)}) Tj\nET`).join('\n')
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
  ]
  let body = '%PDF-1.4\n'; const positions: number[] = []; for (const object of objects) { positions.push(Buffer.byteLength(body)); body += object }
  const crossReference = Buffer.byteLength(body); body += `xref\n0 6\n0000000000 65535 f \n${positions.map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${crossReference}\n%%EOF\n`; return Buffer.from(body)
}
const columns = [['Monday', 40], ['Tuesday', 120], ['Wednesday', 200], ['Thursday', 280], ['Friday', 360], ['Saturday', 440], ['Sunday', 520]] as const
const calendarItems = [{ text: 'SEPTEMBER', x: 260, y: 780 }, { text: '2026', x: 285, y: 765 }, ...columns.map(([text, x]) => ({ text, x, y: 740 })),
  ...[[1, 120], [2, 200], [3, 280], [4, 360], [5, 440], [6, 520]].map(([day, x]) => ({ text: String(day), x, y: 720 })),
  { text: 'Topic: Workplace Respect', x: 360, y: 700 }, { text: 'Preventing Harassment', x: 360, y: 689 }, { text: 'Time: 17:30-18:00', x: 360, y: 678 }, { text: 'Trainer: Thoha/Rahul', x: 360, y: 667 }, { text: 'Location: Andalucia', x: 360, y: 656 },
  ...[[7, 40], [8, 120], [9, 200], [10, 280], [11, 360], [12, 440], [13, 520]].map(([day, x]) => ({ text: String(day), x, y: 620 })),
  { text: 'Topic: Allergy Safety Awareness', x: 40, y: 600 }, { text: 'Time: 17:30-18:00', x: 40, y: 589 }, { text: 'Trainer: Thoha', x: 40, y: 578 }, { text: 'Location: Andalucia', x: 40, y: 567 },
  { text: 'Topic: Code of Conduct', x: 280, y: 600 }, { text: 'and Business Ethics', x: 280, y: 589 }, { text: 'Time: 18:00-18:30', x: 280, y: 578 }, { text: 'Trainer: Rahul', x: 280, y: 567 }, { text: 'Location: Andalucia', x: 280, y: 556 }]
const calendarPdf = await parseTrainingCalendar(new Uint8Array(positionedPdf(calendarItems)), 'FBS Andalucia Training calendar - 2026.pdf')
assert.equal(calendarPdf.records.length, 3); assert.deepEqual(calendarPdf.records.map(item => item.date), ['2026-09-04', '2026-09-07', '2026-09-10']); assert(calendarPdf.records.every(item => item.readiness === 'READY')); assert.equal(calendarPdf.records[0].topic, 'Workplace Respect Preventing Harassment')

const realCalendarSessions = [
  { day: 1, x: 120, y: 700, topic: ['Sequence of service'] },
  { day: 4, x: 360, y: 700, topic: ['Workplace Respect', 'Preventing Harassment'] },
  { day: 7, x: 40, y: 600, topic: ['Allergy safety awareness'] },
  { day: 11, x: 360, y: 600, topic: ['Code of Conduct and', 'Business Ethics'] },
  { day: 14, x: 40, y: 500, topic: ['How to improve Slow service'] },
  { day: 18, x: 360, y: 500, topic: ['Grooming Standards and', 'Personal Hygiene'] },
  { day: 21, x: 40, y: 400, topic: ['15 Mistakes to avoid', 'better guest experience'] },
  { day: 24, x: 280, y: 400, topic: ['Why menu knowledge is important'] },
  { day: 27, x: 520, y: 400, topic: ['Importance of guest farewell'] },
  { day: 30, x: 200, y: 300, topic: ['How to serve wine by glass', 'and bottles'] }
]
const realCalendarMarkers = [
  ...[[31, 40], [1, 120], [2, 200], [3, 280], [4, 360], [5, 440], [6, 520]].map(([day, x]) => ({ text: String(day), x, y: 720 })),
  ...[[7, 40], [8, 120], [9, 200], [10, 280], [11, 360], [12, 440], [13, 520]].map(([day, x]) => ({ text: String(day), x, y: 620 })),
  ...[[14, 40], [15, 120], [16, 200], [17, 280], [18, 360], [19, 440], [20, 520]].map(([day, x]) => ({ text: String(day), x, y: 520 })),
  ...[[21, 40], [22, 120], [23, 200], [24, 280], [25, 360], [26, 440], [27, 520]].map(([day, x]) => ({ text: String(day), x, y: 420 })),
  ...[[28, 40], [29, 120], [30, 200], [1, 280], [2, 360], [3, 440], [4, 520]].map(([day, x]) => ({ text: String(day), x, y: 320 }))
]
const realCalendarContent = realCalendarSessions.flatMap(session => {
  const topicLines = session.topic.map((text, index) => ({ text: `${index ? '' : 'Topic: '}${text}`, x: session.x, y: session.y - (index * 11) }))
  const fieldY = session.y - (session.topic.length * 11)
  return [...topicLines, { text: 'Time: 17:30-18:00', x: session.x, y: fieldY }, { text: 'Trainer: Thoha/Rahul', x: session.x, y: fieldY - 11 }, { text: 'Location: Andalucia', x: session.x, y: fieldY - 22 }]
})
const repeatedHeaderCalendarPdf = await parseTrainingCalendar(new Uint8Array(positionedPdf([
  { text: 'SEPTEMBER', x: 260, y: 780 }, { text: '2026', x: 285, y: 765 },
  ...columns.map(([text, x]) => ({ text, x, y: 740 })), ...realCalendarMarkers.slice(0, 28),
  ...columns.map(([text, x]) => ({ text, x, y: 340 })), ...realCalendarMarkers.slice(28), ...realCalendarContent
])), 'FBS Andalucia Training calendar - 2026.pdf')
assert.equal(repeatedHeaderCalendarPdf.records.length, 10)
assert.deepEqual(repeatedHeaderCalendarPdf.records.map(item => item.date), ['2026-09-01', '2026-09-04', '2026-09-07', '2026-09-11', '2026-09-14', '2026-09-18', '2026-09-21', '2026-09-24', '2026-09-27', '2026-09-30'])
assert(repeatedHeaderCalendarPdf.records.every(item => item.readiness === 'READY'))
assert(repeatedHeaderCalendarPdf.records.every(item => defaultTrainingReplacementAction(item) === 'IMPORT_ANYWAY'))
assert.equal(repeatedHeaderCalendarPdf.records[1].topic, 'Workplace Respect Preventing Harassment')
assert.equal(repeatedHeaderCalendarPdf.records[3].topic, 'Code of Conduct and Business Ethics')

const chronologicalPdf = await parseTrainingCalendar(new Uint8Array(positionedPdf([
  { text: 'Date', x: 40, y: 750 }, { text: 'Day', x: 140, y: 750 }, { text: 'September', x: 240, y: 750 },
  { text: '01-Sep-26', x: 40, y: 720 }, { text: 'Tuesday', x: 140, y: 720 }, { text: 'Topic: Sequence of Service', x: 40, y: 700 }, { text: 'Time: 17:30-18:00', x: 40, y: 688 }, { text: 'Trainer: Thoha/Rahul', x: 40, y: 676 }, { text: 'Location: Andalucia', x: 40, y: 664 },
  { text: '03-Sep-26', x: 40, y: 630 }, { text: 'Thursday', x: 140, y: 630 }, { text: 'Topic: Grooming Standards', x: 40, y: 610 }, { text: 'and Personal Hygiene', x: 40, y: 598 }, { text: 'Time: 17:30-18:00', x: 40, y: 586 }, { text: 'Trainer: Rahul', x: 40, y: 574 }, { text: 'Location: Andalucia', x: 40, y: 562 }
])), 'Chronological Training Calendar 2026.pdf')
assert.equal(chronologicalPdf.records.length, 2); assert.deepEqual(chronologicalPdf.records.map(item => item.date), ['2026-09-01', '2026-09-03']); assert.equal(chronologicalPdf.records[1].topic, 'Grooming Standards and Personal Hygiene')

const missingDatePdf = await parseTrainingCalendar(new Uint8Array(positionedPdf([{ text: 'Topic: Workplace Respect', x: 40, y: 720 }, { text: 'Time: 17:30-18:00', x: 40, y: 708 }, { text: 'Trainer: Thoha/Rahul', x: 40, y: 696 }, { text: 'Location: Andalucia', x: 40, y: 684 }])), 'Training Calendar.pdf')
assert.equal(missingDatePdf.records[0].readiness, 'REVIEW_REQUIRED'); assert.equal(defaultTrainingImportAction(missingDatePdf.records[0]), 'EDIT_BEFORE_IMPORT')
const corrected = { ...missingDatePdf.records[0], date: '2026-09-04' }; const allSkipped = trainingImportSelectionSummary([corrected], { 0: 'SKIP' }); assert.equal(allSkipped.selected, 0); assert.equal(allSkipped.skipped, 1)
const editedSelection = trainingImportSelectionSummary([corrected], { 0: 'EDIT_BEFORE_IMPORT' }); assert.equal(editedSelection.selected, 1); assert.equal(editedSelection.invalidSelected, 0)
await assert.rejects(() => parseTrainingCalendar(new Uint8Array([1, 2, 3]), 'calendar.png'), /OCR is not available/)

const importId = randomUUID(); const hash = 'training-test-hash'; await repository.createImportBatch(importId, 'HR Training Calendar.xlsx', hash, 'xlsx')
await repository.save({ ...base, id: randomUUID(), title: parsed.records[0].topic, date: parsed.records[0].date, time: parsed.records[0].startTime, startTime: parsed.records[0].startTime, endTime: parsed.records[0].endTime, trainer: parsed.records[0].trainer, location: parsed.records[0].location, source: 'hr_calendar', sourceFileName: 'HR Training Calendar.xlsx', importBatchId: importId, importedAt: new Date().toISOString(), sourceData: parsed.records[0].originalValues })
assert(await repository.importBatchByHash(hash)); assert(await repository.findDuplicate('2026-09-12', 'Workplace Respect', '17:30', '18:00'))
const imported = (await repository.list()).find(item => item.importBatchId === importId)!; assert.equal(imported.sourceFileName, 'HR Training Calendar.xlsx'); assert.equal(imported.source, 'hr_calendar'); assert(imported.sourceData)

const batchView = await repository.importBatch(importId); assert.equal(batchView?.sessionCount, 1); assert.equal(batchView?.sessions[0].title, 'Workplace Respect'); assert.equal(batchView?.active, true)
const removedCount = await repository.removeImportBatch(importId); assert.equal(removedCount, 1); assert.equal((await repository.find(imported.id))?.active, false); assert.equal((await repository.importBatch(importId))?.removalAction, 'removed'); assert.equal(await repository.importBatchByHash(hash), null)

const replacementSourceBatch = randomUUID(); await repository.createImportBatch(replacementSourceBatch, 'HR Training Calendar.xlsx', hash, 'xlsx')
const replacementSource = await repository.save({ ...base, id: randomUUID(), title: 'Workplace Respect', date: '2026-09-12', time: '17:30', startTime: '17:30', endTime: '18:00', source: 'hr_calendar', sourceFileName: 'HR Training Calendar.xlsx', importBatchId: replacementSourceBatch, importedAt: new Date().toISOString() })
const protectedManual = await repository.save({ ...base, id: randomUUID(), title: 'Manual Leadership Briefing', date: '2026-09-20', time: '16:00', startTime: '16:00', endTime: '16:30', source: 'manual', active: true })
const otherBatchId = randomUUID(); await repository.createImportBatch(otherBatchId, 'Other Calendar.csv', 'other-training-hash', 'csv'); const otherImport = await repository.save({ ...base, id: randomUUID(), title: 'Other Import Session', date: '2026-09-22', time: '16:00', startTime: '16:00', endTime: '16:30', source: 'hr_calendar', sourceFileName: 'Other Calendar.csv', importBatchId: otherBatchId, importedAt: new Date().toISOString() })
const failedBatchId = randomUUID(); await assert.rejects(() => repository.replaceImportBatch(replacementSourceBatch, { id: failedBatchId, fileName: 'Invalid Replacement.xlsx', fileHash: 'invalid-replacement-hash', fileType: 'xlsx' }, [{ ...base, id: randomUUID(), title: protectedManual.title, date: protectedManual.date, time: protectedManual.time, startTime: protectedManual.startTime, endTime: protectedManual.endTime, source: 'hr_calendar', importBatchId: failedBatchId, active: true }]), /same date, topic and time/)
assert.equal((await repository.importBatch(replacementSourceBatch))?.active, true); assert.equal((await repository.find(replacementSource.id))?.active, true); assert.equal(await repository.importBatch(failedBatchId), null)
const replacementBatchId = randomUUID(); const replacement = await repository.replaceImportBatch(replacementSourceBatch, { id: replacementBatchId, fileName: 'Corrected Calendar.xlsx', fileHash: 'corrected-training-hash', fileType: 'xlsx' }, [{ ...base, id: randomUUID(), title: 'Corrected Workplace Respect', date: '2026-09-12', time: '17:30', startTime: '17:30', endTime: '18:00', source: 'hr_calendar', sourceFileName: 'Corrected Calendar.xlsx', importBatchId: replacementBatchId, importedAt: new Date().toISOString(), active: true }]); assert.equal(replacement.removed, 1); assert.equal(replacement.importedIds.length, 1)
assert.equal((await repository.importBatch(replacementSourceBatch))?.replacementBatchId, replacementBatchId); assert.equal((await repository.importBatch(replacementSourceBatch))?.removalAction, 'replaced'); assert.equal((await repository.find(protectedManual.id))?.active, true); assert.equal((await repository.find(otherImport.id))?.active, true)
const batchAudits = await db.query<{ action: string }>('select action from audit_logs where entity_type=$1 and entity_id in ($2,$3) order by created_at', ['training_import_batch', importId, replacementSourceBatch]); assert.deepEqual(batchAudits.rows.map(row => row.action), ['removed', 'replaced'])

const manualCount = await db.query<{ count: string }>('select count(*)::text as count from training_sessions where source = $1', ['manual']); assert.equal(Number(manualCount.rows[0].count), 2)

const firstImportDb = new PGlite(join(folder, 'ten-session-first-import-postgres')); await firstImportDb.exec(await readFile('database/schema.sql', 'utf8')); await firstImportDb.exec("alter table training_sessions add column if not exists outlet_scope_id uuid not null default '00000000-0000-4000-8000-00000000a001'")
const firstImportRepository = new TrainingRepository(firstImportDb); await firstImportRepository.initialize()
const firstImportPreview = { batchId: randomUUID(), fileName: 'FBS Andalucia Training calendar - 2026.pdf', fileHash: 'first-import-real-file-hash', fileType: 'pdf', duplicateFile: false, records: repeatedHeaderCalendarPdf.records, summary: { detected: 10, ready: 10, requiresReview: 0, duplicates: 0 }, replacementSummary: { ready: 10, requiresReview: 0, duplicatesWithinFile: 0 } }
const firstImportPrepared = await prepareTrainingImport(firstImportRepository, firstImportPreview, repeatedHeaderCalendarPdf.records.map((item, index) => ({ index, action: defaultTrainingImportAction(item) }))); assert.equal(firstImportPrepared.pending.length, 10)
await firstImportRepository.createImportBatch(firstImportPreview.batchId, firstImportPreview.fileName, firstImportPreview.fileHash, firstImportPreview.fileType); for (const session of firstImportPrepared.pending) await firstImportRepository.save(session)
assert.equal((await firstImportRepository.list()).filter(item => item.active && item.importBatchId === firstImportPreview.batchId).length, 10); await firstImportDb.close()

const exactReplacementPath = join(folder, 'exact-replacement-postgres')
const exactReplacementDb = new PGlite(exactReplacementPath); await exactReplacementDb.exec(await readFile('database/schema.sql', 'utf8')); await exactReplacementDb.exec("alter table training_sessions add column if not exists outlet_scope_id uuid not null default '00000000-0000-4000-8000-00000000a001'")
const exactReplacementRepository = new TrainingRepository(exactReplacementDb); await exactReplacementRepository.initialize()
const exactConfiguration = await exactReplacementRepository.configuration(); const exactCategory = exactConfiguration.categories.find(option => option.active)!.value; const exactStatus = exactConfiguration.statuses.find(option => option.active)!.value
const exactBase = { id: randomUUID(), title: '', category: exactCategory, date: '', time: '', startTime: '', endTime: '', trainer: '', location: 'Andalucía', status: exactStatus, notes: '', description: '', active: true, attendees: [], source: 'hr_calendar' as const, sourceFileName: 'FBS Andalucia Training calendar - 2026.pdf', importedAt: new Date().toISOString() }
const oldBatchId = randomUUID(); await exactReplacementRepository.createImportBatch(oldBatchId, exactBase.sourceFileName, 'same-real-file-hash', 'pdf')
const oldSource = repeatedHeaderCalendarPdf.records[0]; const oldSession = await exactReplacementRepository.save({ ...exactBase, id: randomUUID(), title: oldSource.topic, date: oldSource.date, time: oldSource.startTime, startTime: oldSource.startTime, endTime: oldSource.endTime, trainer: oldSource.trainer, location: oldSource.location, importBatchId: oldBatchId, sourceData: oldSource.originalValues })
for (const [index, date] of ['2026-09-02', '2026-09-03'].entries()) await exactReplacementRepository.save({ ...exactBase, id: randomUUID(), title: `Protected Manual Session ${index + 1}`, date, time: '16:00', startTime: '16:00', endTime: '16:30', trainer: 'Venue Manager', source: 'manual', sourceFileName: null, importBatchId: null, sourceData: null })
const replacementBatchId10 = randomUUID(); const replacementRecords = repeatedHeaderCalendarPdf.records.map((item, index) => ({ ...item, readiness: 'DUPLICATE' as const, duplicateTrainingId: index === 0 ? oldSession.id : undefined, duplicateWithinFile: false }))
const replacementPreview = { batchId: replacementBatchId10, fileName: exactBase.sourceFileName, fileHash: 'same-real-file-hash', fileType: 'pdf', duplicateFile: true, records: replacementRecords, existingImport: (await exactReplacementRepository.importBatch(oldBatchId))!, summary: { detected: 10, ready: 0, requiresReview: 0, duplicates: 10 }, replacementSummary: { ready: 10, requiresReview: 0, duplicatesWithinFile: 0 } }
const replacementDecisions = replacementRecords.map((item, index) => ({ index, action: defaultTrainingReplacementAction(item, new Set([oldSession.id])) })); assert.equal(replacementDecisions.filter(item => item.action !== 'SKIP').length, 10)
const preparedReplacement = await prepareTrainingImport(exactReplacementRepository, replacementPreview, replacementDecisions, { replacing: true, allowedDuplicateIds: new Set([oldSession.id]) }); assert.equal(preparedReplacement.pending.length, 10); assert.equal(preparedReplacement.duplicates, 0)
const skippedReplacement = await prepareTrainingImport(exactReplacementRepository, replacementPreview, replacementDecisions.map((item, index) => index === 9 ? { ...item, action: 'SKIP' as const } : item), { replacing: true, allowedDuplicateIds: new Set([oldSession.id]) }); assert.equal(skippedReplacement.pending.length, 9); assert.equal(skippedReplacement.skipped, 1)
const exactReplacement = await exactReplacementRepository.replaceImportBatch(oldBatchId, { id: replacementBatchId10, fileName: replacementPreview.fileName, fileHash: replacementPreview.fileHash, fileType: replacementPreview.fileType }, preparedReplacement.pending); assert.equal(exactReplacement.removed, 1); assert.equal(exactReplacement.importedIds.length, 10)
const activeSeptember = (await exactReplacementRepository.list()).filter(item => item.active && item.date.startsWith('2026-09')); assert.equal(activeSeptember.length, 12); assert.equal(activeSeptember.filter(item => item.source === 'manual').length, 2); assert.deepEqual(activeSeptember.filter(item => item.importBatchId === replacementBatchId10).map(item => item.date).sort(), repeatedHeaderCalendarPdf.records.map(item => item.date).sort())
await exactReplacementDb.close(); const reopenedExactDb = new PGlite(exactReplacementPath); const reopenedExactRepository = new TrainingRepository(reopenedExactDb); const reopenedSeptember = (await reopenedExactRepository.list()).filter(item => item.active && item.date.startsWith('2026-09')); assert.equal(reopenedSeptember.length, 12); await reopenedExactDb.close()

console.log(JSON.stringify({ manualAddEditArchive: true, existingManualTrainingPreserved: true, exactDuplicateRejected: true, xlsxExtraction: true, csvDatePreserved: true, chronologicalPdfExtraction: true, calendarPdfExtraction: true, repeatedWeekdayHeaderExtraction: true, calendarDateReconstruction: true, multiplePdfSessions: true, missingDateRequiresReview: true, editBeforeImportDefault: true, zeroSelectionProtection: true, imageUncertaintyVisible: true, readyAndReviewClassification: true, sourceProvenance: true, duplicateFileHash: true, duplicateNaturalKey: true, importBatchView: true, importBatchRemoval: true, reuploadAfterRemoval: true, replacementTransactionRollback: true, replacementAudit: true, unrelatedImportPreserved: true, tenSessionFirstImport: true, tenReadySelectedByDefault: true, oneToTenReplacement: true, replacementSkipOne: true, exactManualCountPreserved: true, replacementRestartPersistence: true }, null, 2))
await db.close(); await rm(folder, { recursive: true, force: true })
