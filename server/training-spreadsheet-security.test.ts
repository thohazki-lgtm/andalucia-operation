import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { parseTrainingCalendar } from './training-calendar-parser.js'
import { parseTrainingSpreadsheet } from './training-spreadsheet-parser.js'
import {
  TRAINING_SPREADSHEET_MAX_COLUMNS,
  TRAINING_SPREADSHEET_MAX_ROWS,
  TRAINING_SPREADSHEET_MAX_TEXT_LENGTH,
  TRAINING_SPREADSHEET_MAX_WORKSHEETS
} from './training-spreadsheet-security.js'

const rows = [
  ['Date', 'Day', 'Topic', 'Time', 'Trainer', 'Location'],
  [new Date(Date.UTC(2026, 8, 12)), 'Saturday', 'Workplace Respect', '17:30-18:00', 'Training Manager', 'Andalucía'],
  ['13-Sep-26', 'Sunday', 'Menu Knowledge', '18:00-18:30', 'Training Manager', 'Andalucía']
]

const workbookBuffer = (bookType: 'xlsx' | 'biff8', inputRows = rows, sheets = 1) => {
  const workbook = XLSX.utils.book_new()
  for (let index = 0; index < sheets; index++) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(inputRows), `Sheet ${index + 1}`)
  return new Uint8Array(XLSX.write(workbook, { type: 'buffer', bookType, cellDates: true }) as Buffer)
}

const xlsx = workbookBuffer('xlsx')
const xls = workbookBuffer('biff8')
assert.deepEqual(Array.from(xls.subarray(0, 8)), [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

const parsedXlsx = await parseTrainingCalendar(xlsx, 'training.xlsx', { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
const parsedXls = await parseTrainingCalendar(xls, 'training.xls', { mimeType: 'application/vnd.ms-excel' })
assert.deepEqual(parsedXlsx.records, parsedXls.records)
assert.deepEqual(parsedXlsx.records.map(record => ({ topic: record.topic, date: record.date, start: record.startTime, end: record.endTime, readiness: record.readiness })), [
  { topic: 'Workplace Respect', date: '2026-09-12', start: '17:30', end: '18:00', readiness: 'READY' },
  { topic: 'Menu Knowledge', date: '2026-09-13', start: '18:00', end: '18:30', readiness: 'READY' }
])

const reordered = workbookBuffer('xlsx', [
  ['Trainer', '', 'Venue', 'Subject', 'End Time', 'Date', 'Start Time'],
  ['Training Manager', '', 'Andalucía', 'Service Standards', '18:30', '14-Sep-26', '18:00']
])
const reorderedParsed = await parseTrainingCalendar(reordered, 'reordered.xlsx')
assert.equal(reorderedParsed.records[0].topic, 'Service Standards')
assert.equal(reorderedParsed.records[0].location, 'Andalucía')
assert.equal(reorderedParsed.records[0].date, '2026-09-14')

const mergedWorkbook = XLSX.utils.book_new()
const mergedSheet = XLSX.utils.aoa_to_sheet(rows)
mergedSheet['!merges'] = [XLSX.utils.decode_range('A4:B4')]
XLSX.utils.book_append_sheet(mergedWorkbook, mergedSheet, 'Training')
const mergedData = new Uint8Array(XLSX.write(mergedWorkbook, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer)
assert.deepEqual((await parseTrainingCalendar(mergedData, 'merged.xlsx')).records, parsedXlsx.records)

const multiSheet = workbookBuffer('xlsx', rows, 2)
assert.deepEqual((await parseTrainingCalendar(multiSheet, 'multi.xlsx')).records, parsedXlsx.records)

await assert.rejects(() => parseTrainingCalendar(xlsx, 'training.xls'), /legacy Excel workbook signature/)
await assert.rejects(() => parseTrainingCalendar(xls, 'training.xlsx'), /Office Open XML ZIP container/)
await assert.rejects(() => parseTrainingCalendar(xlsx, 'training.xlsx', { mimeType: 'application/pdf' }), /content type does not match/)
await assert.rejects(() => parseTrainingCalendar(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), 'broken.xlsx'), /not an Office Open XML ZIP container|ZIP directory is missing or truncated/)
await assert.rejects(() => parseTrainingCalendar(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), 'broken.xls'), /malformed or could not be parsed safely/)

await assert.rejects(() => parseTrainingCalendar(workbookBuffer('xlsx', rows, TRAINING_SPREADSHEET_MAX_WORKSHEETS + 1), 'too-many-sheets.xlsx'), /exceeds 12 worksheets/)

const workbookWithRef = (end: { r: number; c: number }, value: unknown = 'Date') => {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([[value]])
  sheet['!ref'] = `A1:${XLSX.utils.encode_cell(end)}`
  XLSX.utils.book_append_sheet(workbook, sheet, 'Training')
  return new Uint8Array(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
}
await assert.rejects(() => parseTrainingCalendar(workbookWithRef({ r: TRAINING_SPREADSHEET_MAX_ROWS, c: 0 }), 'too-many-rows.xlsx'), /exceeds 10000 rows/)
await assert.rejects(() => parseTrainingCalendar(workbookWithRef({ r: 0, c: TRAINING_SPREADSHEET_MAX_COLUMNS }), 'too-many-columns.xlsx'), /exceeds 128 columns/)
await assert.rejects(() => parseTrainingCalendar(workbookWithRef({ r: 1999, c: 127 }), 'too-many-cells.xlsx'), /exceeds 250000 addressable cells/)

const longText = workbookBuffer('xlsx', [['Date', 'Topic'], ['12-Sep-26', 'X'.repeat(TRAINING_SPREADSHEET_MAX_TEXT_LENGTH + 1)]])
await assert.rejects(() => parseTrainingCalendar(longText, 'long-text.xlsx'), /text cell exceeds 16384 characters/)

const formulaWorkbook = XLSX.utils.book_new()
const formulaSheet = XLSX.utils.aoa_to_sheet(rows)
formulaSheet.C3 = { t: 's', f: 'CONCAT("Menu"," Knowledge")', v: 'Menu Knowledge', w: 'Menu Knowledge' }
XLSX.utils.book_append_sheet(formulaWorkbook, formulaSheet, 'Training')
const formulaData = new Uint8Array(XLSX.write(formulaWorkbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
const formulaParsed = await parseTrainingCalendar(formulaData, 'formula.xlsx')
assert.equal(formulaParsed.records[1].topic, 'Menu Knowledge')

const macroWorkbook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(macroWorkbook, XLSX.utils.aoa_to_sheet(rows), 'Training')
macroWorkbook.vbaraw = Buffer.from([1, 2, 3, 4])
const macroData = new Uint8Array(XLSX.write(macroWorkbook, { type: 'buffer', bookType: 'xlsm', bookVBA: true }) as Buffer)
await assert.rejects(() => parseTrainingCalendar(macroData, 'macro-disguised-as.xlsx'), /macros and external workbook links are not supported/)

const workerSource = await readFile(new URL('./training-spreadsheet-worker.mjs', import.meta.url), 'utf8')
assert.doesNotMatch(workerSource, /PGlite|database-protection|training-repository|ANDALUCIA_DATA_DIR|credential|secret/i)

await assert.rejects(() => parseTrainingSpreadsheet(xlsx, 'timeout.xlsx', { timeoutMs: 1 }), /exceeded the 1 ms safety limit/)
const afterTimeout = await parseTrainingCalendar(xlsx, 'after-timeout.xlsx')
assert.equal(afterTimeout.records.length, 2)

console.log(JSON.stringify({
  xlsxParity: true,
  genuineBinaryXlsParity: true,
  firstWorksheetPreserved: true,
  formattedDatesAndTimes: true,
  reorderedAndBlankColumns: true,
  mergedCellsControlled: true,
  signatureMismatchRejected: true,
  mimeMismatchRejected: true,
  malformedXlsxRejected: true,
  malformedXlsControlled: true,
  worksheetLimit: true,
  rowLimit: true,
  columnLimit: true,
  totalCellLimit: true,
  textCellLimit: true,
  formulaCachedValueOnly: true,
  macroRejected: true,
  workerHasNoDatabaseCapability: true,
  timeoutTerminatesWorker: true,
  parserRecoversAfterTimeout: true
}, null, 2))
