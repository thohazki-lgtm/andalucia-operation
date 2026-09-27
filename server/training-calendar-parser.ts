import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { TrainingImportRecord } from '../src/domain.js'
import { parseTrainingSpreadsheet, type TrainingSpreadsheetParseOptions } from './training-spreadsheet-parser.js'
import { TRAINING_SPREADSHEET_MAX_CELLS, TRAINING_SPREADSHEET_MAX_COLUMNS, TRAINING_SPREADSHEET_MAX_ROWS, TRAINING_SPREADSHEET_MAX_TEXT_LENGTH } from './training-spreadsheet-security.js'

export const TRAINING_CALENDAR_PARSER_VERSION = 'andalucia-training-calendar-v2'

type PdfItem = { text: string; x: number; y: number }
type PdfPage = { items: PdfItem[]; lines: string[] }

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()
const monthNames: Record<string, number> = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 }
const weekdays: Record<string, number> = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 }
const calendarDate = (year: number, month: number, day: number) => { const value = new Date(Date.UTC(year, month - 1, day)); return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '' }
const isoDate = (value: unknown): string => {
  const text = clean(value)
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text)
  if (match) { const year = Number(match[1]); const second = Number(match[2]); const third = Number(match[3]); return second > 12 && third <= 12 ? calendarDate(year, third, second) : calendarDate(year, second, third) }
  match = /^(\d{1,2})[-/.\s]([A-Za-z]{3,9})[-/.\s](\d{2,4})$/.exec(text)
  if (match) { const month = monthNames[match[2].toLowerCase()]; if (month) { const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]); return calendarDate(year, month, Number(match[1])) } }
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(text)
  if (match) { const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]); const first = Number(match[1]); const second = Number(match[2]); return second > 12 && first <= 12 ? calendarDate(year, first, second) : calendarDate(year, second, first) }
  return ''
}
const fullDateIn = (value: string) => value.match(/\b\d{1,2}[-/.](?:[A-Za-z]{3,9}|\d{1,2})[-/.]\d{2,4}\b|\b\d{4}-\d{1,2}-\d{1,2}\b/)?.[0] || ''
const timeValue = (value: unknown) => { const text = clean(value).toLowerCase(); const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/); if (!match) return ''; let hour = Number(match[1]); const minute = Number(match[2] || 0); if (match[3] === 'pm' && hour < 12) hour += 12; if (match[3] === 'am' && hour === 12) hour = 0; if (hour > 23 || minute > 59) return ''; return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` }
const timeRange = (value: unknown): [string, string] => { const parts = clean(value).split(/\s*(?:-|–|—|to)\s*/i); return [timeValue(parts[0]), timeValue(parts[1])] }
const dayFor = (date: string) => date ? new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)) : ''
const record = (values: Partial<TrainingImportRecord>, originalValues: Record<string, string>, extraWarnings: string[] = []): TrainingImportRecord => {
  const output: TrainingImportRecord = { topic: clean(values.topic), date: isoDate(values.date), day: clean(values.day), startTime: timeValue(values.startTime), endTime: timeValue(values.endTime), trainer: clean(values.trainer), location: clean(values.location), originalValues, warnings: [...extraWarnings], readiness: 'READY' }
  if (!output.day && output.date) output.day = dayFor(output.date)
  if (!output.topic) output.warnings.push('Topic is missing.')
  if (!output.date) output.warnings.push('Date is missing or unreadable.')
  if (!output.startTime || !output.endTime) output.warnings.push('Start or end time is missing or unreadable.')
  if (output.startTime && output.endTime && output.endTime <= output.startTime) output.warnings.push('End time must be after start time.')
  if (!output.trainer) output.warnings.push('Trainer is missing.')
  if (!output.location) output.warnings.push('Location is missing.')
  output.warnings = [...new Set(output.warnings)]; output.readiness = output.warnings.length ? 'REVIEW_REQUIRED' : 'READY'; return output
}

const valueFor = (row: Record<string, unknown>, names: string[]) => { const key = Object.keys(row).find(candidate => names.some(name => candidate.toLowerCase().replace(/[^a-z]/g, '').includes(name))); return key ? clean(row[key]) : '' }
function parseRows(rows: unknown[][]): TrainingImportRecord[] {
  const normalized = rows.filter(row => row.some(cell => clean(cell))).map(row => row.map(clean)); const headerIndex = normalized.findIndex(row => row.some(cell => /date/i.test(cell)) && row.some(cell => /topic|training|subject/i.test(cell)))
  if (headerIndex < 0) return parseText(normalized.map(row => row.join('  ')))
  const headers = normalized[headerIndex]
  return normalized.slice(headerIndex + 1).filter(row => row.some(Boolean)).map(row => Object.fromEntries(headers.map((header, index) => [header || `column${index}`, row[index] || '']))).map(row => { const range = timeRange(valueFor(row, ['time'])); const original = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, clean(value)])); return record({ topic: valueFor(row, ['topic', 'training', 'subject']), date: valueFor(row, ['date']), day: valueFor(row, ['day']), startTime: valueFor(row, ['starttime', 'start']) || range[0], endTime: valueFor(row, ['endtime', 'end']) || range[1], trainer: valueFor(row, ['trainer', 'facilitator']), location: valueFor(row, ['location', 'venue']) }, original) }).filter(item => item.topic || item.date || item.startTime)
}

function parseCsv(data: Uint8Array): string[][] {
  const text = new TextDecoder('utf-8').decode(data).replace(/^\uFEFF/, ''); const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false; let cellCount = 0
  const append = () => { if (value.length > TRAINING_SPREADSHEET_MAX_TEXT_LENGTH) throw new Error(`Training spreadsheet rejected: a text cell exceeds ${TRAINING_SPREADSHEET_MAX_TEXT_LENGTH} characters.`); row.push(value); if (row.length > TRAINING_SPREADSHEET_MAX_COLUMNS) throw new Error(`Training spreadsheet rejected: the CSV exceeds ${TRAINING_SPREADSHEET_MAX_COLUMNS} columns.`); value = '' }
  const finish = () => { append(); if (row.some(cell => clean(cell))) { rows.push(row); cellCount += row.length } if (rows.length > TRAINING_SPREADSHEET_MAX_ROWS || cellCount > TRAINING_SPREADSHEET_MAX_CELLS) throw new Error('Training spreadsheet rejected: the CSV exceeds the safe row or cell limit.'); row = [] }
  for (let index = 0; index < text.length; index++) { const character = text[index]; if (character === '"') { if (quoted && text[index + 1] === '"') { value += '"'; index++ } else quoted = !quoted } else if (character === ',' && !quoted) append(); else if ((character === '\n' || character === '\r') && !quoted) { if (character === '\r' && text[index + 1] === '\n') index++; finish() } else value += character }
  if (row.length || value) finish(); return rows
}

const field = (lines: string[], names: string[]) => { const label = new RegExp(`^(?:${names.join('|')})\\s*:\\s*(.*)$`, 'i'); const anyLabel = /^(?:topic|training|subject|time|trainer|facilitator|location|venue)\s*:/i; const index = lines.findIndex(line => label.test(line)); if (index < 0) return ''; const values = [lines[index].match(label)?.[1] || '']; for (let next = index + 1; next < lines.length && !anyLabel.test(lines[next]); next++) values.push(lines[next]); return clean(values.join(' ')) }
function parseText(lines: string[]): TrainingImportRecord[] {
  const records: TrainingImportRecord[] = []; let currentDate = ''; let block: string[] = []
  const finish = () => { if (!block.length) return; const topic = field(block, ['topic', 'training', 'subject']); const time = field(block, ['time']) || block.map(line => line.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:-|–|—|to)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i)?.[0]).find(Boolean) || ''; const range = timeRange(time); const dateText = block.map(fullDateIn).find(Boolean) || currentDate; if (topic || range[0]) records.push(record({ topic, date: dateText, startTime: range[0], endTime: range[1], trainer: field(block, ['trainer', 'facilitator']), location: field(block, ['location', 'venue']) }, { sourceText: block.join(' | ') })); block = [] }
  for (const line of lines.map(clean).filter(Boolean)) { const explicitDate = fullDateIn(line); if (explicitDate && block.some(item => /^(?:topic|training|subject)\s*:/i.test(item))) finish(); if (explicitDate) currentDate = explicitDate; if (/^(?:topic|training|subject)\s*:/i.test(line) && block.some(item => /^(?:topic|training|subject)\s*:/i.test(item))) finish(); if (explicitDate || /^(?:topic|training|subject|time|trainer|facilitator|location|venue)\s*:/i.test(line) || block.length) block.push(line) }
  finish(); return records
}

const contextNumber = (items: PdfItem[], fileName: string, kind: 'year' | 'month') => { const sources = [items.map(item => item.text).join(' '), fileName]; if (kind === 'year') { for (const source of sources) { const values = [...source.matchAll(/\b(20\d{2})\b/g)].map(match => Number(match[1])); if (values.length) return values[0] } return 0 } for (const item of items) { const heading = item.text.match(/^([A-Za-z]+)(?:\s+20\d{2})?$/)?.[1]?.toLowerCase(); if (heading && monthNames[heading]) return monthNames[heading] } for (const word of fileName.match(/[A-Za-z]+/g) || []) { const month = monthNames[word.toLowerCase()]; if (month) return month } return 0 }
function parseCalendarPage(page: PdfPage, fileName: string): TrainingImportRecord[] {
  const headers = page.items.map(item => ({ ...item, weekday: weekdays[item.text.toLowerCase()] })).filter(item => item.weekday !== undefined).sort((a, b) => a.x - b.x)
  if (headers.length < 4) return []
  const year = contextNumber(page.items, fileName, 'year'); const month = contextNumber(page.items, fileName, 'month'); if (!year || !month) return []
  const columns = [...new Map(headers.map(item => [item.weekday, { x: item.x, weekday: item.weekday }])).values()].sort((a, b) => a.x - b.x); const columnFor = (x: number) => columns.reduce((best, candidate, index) => Math.abs(candidate.x - x) < Math.abs(columns[best].x - x) ? index : best, 0)
  const markers = page.items.filter(item => /^\d{1,2}$/.test(item.text) && Number(item.text) >= 1 && Number(item.text) <= 31).map(item => ({ ...item, day: Number(item.text), column: columnFor(item.x) })).filter(item => calendarDate(year, month, item.day)).sort((a, b) => b.y - a.y); const results: TrainingImportRecord[] = []
  for (const marker of markers) { const nextMarkerY = Math.max(-Infinity, ...markers.filter(item => item.column === marker.column && item.y < marker.y - 3).map(item => item.y)); const nextHeaderY = Math.max(-Infinity, ...headers.filter(item => item.weekday === columns[marker.column]?.weekday && item.y < marker.y - 3).map(item => item.y)); const cellBottom = Math.max(nextMarkerY, nextHeaderY); const cellItems = page.items.filter(item => columnFor(item.x) === marker.column && item.y < marker.y - 1 && item.y > cellBottom + 1).sort((a, b) => b.y - a.y || a.x - b.x); const topicIndexes = cellItems.map((item, index) => /^(?:topic|training|subject)\s*:/i.test(item.text) ? index : -1).filter(index => index >= 0)
    for (let position = 0; position < topicIndexes.length; position++) { const start = topicIndexes[position]; const end = topicIndexes[position + 1] ?? cellItems.length; const lines = cellItems.slice(start, end).map(item => item.text); const range = timeRange(field(lines, ['time'])); const date = calendarDate(year, month, marker.day); const expectedWeekday = columns[marker.column]?.weekday; const mismatch = date && expectedWeekday !== undefined && new Date(`${date}T00:00:00Z`).getUTCDay() !== expectedWeekday; results.push(record({ topic: field(lines, ['topic', 'training', 'subject']), date: mismatch ? '' : date, startTime: range[0], endTime: range[1], trainer: field(lines, ['trainer', 'facilitator']), location: field(lines, ['location', 'venue']) }, { sourceText: lines.join(' | '), calendarMonth: String(month), calendarYear: String(year), calendarDay: String(marker.day) }, mismatch ? ['Calendar day and weekday do not align; confirm the date.'] : [])) }
  }
  return results
}

const mergeRecords = (layout: TrainingImportRecord[], text: TrainingImportRecord[]) => { const output = [...layout]; for (const candidate of text) { if (layout.length && !candidate.date) continue; const layoutMatch = output.some(item => item.topic.toLowerCase() === candidate.topic.toLowerCase() && item.startTime === candidate.startTime && item.endTime === candidate.endTime); const exactMatch = output.some(item => `${item.date}|${item.topic}|${item.startTime}|${item.endTime}`.toLowerCase() === `${candidate.date}|${candidate.topic}|${candidate.startTime}|${candidate.endTime}`.toLowerCase()); if (!layoutMatch && !exactMatch) output.push(candidate) } return output }
async function pdfPages(data: Uint8Array): Promise<PdfPage[]> { const document = await getDocument({ data }).promise; const pages: PdfPage[] = []; for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) { const page = await document.getPage(pageNumber); const content = await page.getTextContent(); const items = (content.items as any[]).filter(item => clean(item.str)).map(item => ({ text: clean(item.str), x: Number(item.transform[4]), y: Number(item.transform[5]) })); const rows: PdfItem[][] = []; for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) { const row = rows.find(candidate => Math.abs(candidate[0].y - item.y) < 2.5); if (row) row.push(item); else rows.push([item]) } pages.push({ items, lines: rows.map(row => row.sort((a, b) => a.x - b.x).map(item => item.text).join('  ')) }) } return pages }

export async function parseTrainingCalendar(data: Uint8Array, fileName: string, options: TrainingSpreadsheetParseOptions = {}): Promise<{ fileType: string; records: TrainingImportRecord[] }> {
  const extension = fileName.split('.').pop()?.toLowerCase() || ''
  if (extension === 'csv') return { fileType: 'csv', records: parseRows(parseCsv(data)) }
  if (extension === 'xlsx' || extension === 'xls') return { fileType: extension, records: parseRows(await parseTrainingSpreadsheet(data, fileName, options)) }
  if (extension === 'pdf') { const pages = await pdfPages(data); return { fileType: 'pdf', records: pages.flatMap(page => mergeRecords(parseCalendarPage(page, fileName), parseText(page.lines))) } }
  if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) throw new Error('Image calendar OCR is not available. Upload the HR calendar as XLSX, CSV or a text-based PDF.')
  throw new Error('Unsupported training calendar file. Upload XLSX, XLS, CSV or PDF.')
}
