export const TRAINING_UPLOAD_MAX_BYTES = 20 * 1024 * 1024
export const TRAINING_SPREADSHEET_MAX_WORKSHEETS = 12
export const TRAINING_SPREADSHEET_MAX_ROWS = 10_000
export const TRAINING_SPREADSHEET_MAX_COLUMNS = 128
export const TRAINING_SPREADSHEET_MAX_CELLS = 250_000
export const TRAINING_SPREADSHEET_MAX_TEXT_LENGTH = 16_384
export const TRAINING_SPREADSHEET_MAX_ZIP_ENTRIES = 4_096
export const TRAINING_SPREADSHEET_MAX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024
export const TRAINING_SPREADSHEET_MAX_ENTRY_BYTES = 64 * 1024 * 1024
export const TRAINING_SPREADSHEET_TIMEOUT_MS = 5_000

export type TrainingSpreadsheetExtension = 'xls' | 'xlsx'

const XLS_SIGNATURE = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
const MIME_TYPES: Record<TrainingSpreadsheetExtension, Set<string>> = {
  xls: new Set(['application/vnd.ms-excel', 'application/octet-stream']),
  xlsx: new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'])
}

const spreadsheetError = (message: string) => new Error(`Training spreadsheet rejected: ${message}`)
const extensionFor = (fileName: string) => fileName.split('.').pop()?.toLowerCase() || ''
const beginsWith = (data: Uint8Array, signature: Uint8Array) => signature.every((value, index) => data[index] === value)
const uint16 = (data: Uint8Array, offset: number) => data[offset] | (data[offset + 1] << 8)
const uint32 = (data: Uint8Array, offset: number) => (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0

const zipEntries = (data: Uint8Array) => {
  const minimumEocd = 22
  if (data.length < minimumEocd || !beginsWith(data, Uint8Array.from([0x50, 0x4b]))) throw spreadsheetError('the .xlsx content is not an Office Open XML ZIP container.')
  const searchStart = Math.max(0, data.length - 65_557)
  let eocd = -1
  for (let offset = data.length - minimumEocd; offset >= searchStart; offset--) {
    if (uint32(data, offset) === 0x06054b50) { eocd = offset; break }
  }
  if (eocd < 0) throw spreadsheetError('the .xlsx ZIP directory is missing or truncated.')
  const count = uint16(data, eocd + 10)
  const directoryBytes = uint32(data, eocd + 12)
  const directoryOffset = uint32(data, eocd + 16)
  if (count === 0xffff || directoryBytes === 0xffffffff || directoryOffset === 0xffffffff) throw spreadsheetError('ZIP64 workbooks are not supported for Training import.')
  if (count < 1 || count > TRAINING_SPREADSHEET_MAX_ZIP_ENTRIES) throw spreadsheetError(`the workbook contains too many ZIP entries (maximum ${TRAINING_SPREADSHEET_MAX_ZIP_ENTRIES}).`)
  if (directoryOffset + directoryBytes > data.length || directoryOffset >= eocd) throw spreadsheetError('the .xlsx ZIP directory is invalid.')
  const decoder = new TextDecoder('utf-8', { fatal: false })
  const entries: Array<{ name: string; compressed: number; uncompressed: number }> = []
  let offset = directoryOffset
  let totalUncompressed = 0
  for (let index = 0; index < count; index++) {
    if (offset + 46 > data.length || uint32(data, offset) !== 0x02014b50) throw spreadsheetError('the .xlsx ZIP directory is malformed.')
    const flags = uint16(data, offset + 8)
    if ((flags & 0x1) !== 0) throw spreadsheetError('encrypted workbook entries are not supported.')
    const compressed = uint32(data, offset + 20)
    const uncompressed = uint32(data, offset + 24)
    const nameLength = uint16(data, offset + 28)
    const extraLength = uint16(data, offset + 30)
    const commentLength = uint16(data, offset + 32)
    const next = offset + 46 + nameLength + extraLength + commentLength
    if (!nameLength || next > data.length) throw spreadsheetError('the .xlsx ZIP entry is malformed.')
    const name = decoder.decode(data.subarray(offset + 46, offset + 46 + nameLength)).replace(/\\/g, '/')
    if (name.startsWith('/') || name.split('/').includes('..')) throw spreadsheetError('the workbook contains an unsafe ZIP entry path.')
    if (uncompressed > TRAINING_SPREADSHEET_MAX_ENTRY_BYTES) throw spreadsheetError(`a workbook entry exceeds ${TRAINING_SPREADSHEET_MAX_ENTRY_BYTES / 1024 / 1024} MB.`)
    totalUncompressed += uncompressed
    if (totalUncompressed > TRAINING_SPREADSHEET_MAX_UNCOMPRESSED_BYTES) throw spreadsheetError(`expanded workbook content exceeds ${TRAINING_SPREADSHEET_MAX_UNCOMPRESSED_BYTES / 1024 / 1024} MB.`)
    if (uncompressed > 1024 * 1024 && compressed > 0 && uncompressed / compressed > 500) throw spreadsheetError('the workbook compression ratio is unsafe.')
    entries.push({ name, compressed, uncompressed })
    offset = next
  }
  const normalized = new Set(entries.map(entry => entry.name.toLowerCase()))
  if (!normalized.has('[content_types].xml') || !normalized.has('xl/workbook.xml')) throw spreadsheetError('the .xlsx container does not contain the required workbook structure.')
  if ([...normalized].some(name => name === 'xl/vbaproject.bin' || name.startsWith('xl/externallinks/'))) throw spreadsheetError('macros and external workbook links are not supported for Training import.')
  return entries
}

export function validateTrainingSpreadsheetFile(data: Uint8Array, fileName: string, mimeType?: string | null): TrainingSpreadsheetExtension {
  const extension = extensionFor(fileName)
  if (extension !== 'xls' && extension !== 'xlsx') throw spreadsheetError('only .xls and .xlsx files are accepted by the spreadsheet parser.')
  if (!data.length) throw spreadsheetError('the uploaded file is empty.')
  if (data.length > TRAINING_UPLOAD_MAX_BYTES) throw spreadsheetError(`the file exceeds the ${TRAINING_UPLOAD_MAX_BYTES / 1024 / 1024} MB upload limit.`)
  const normalizedMime = String(mimeType || '').split(';')[0].trim().toLowerCase()
  if (normalizedMime && !MIME_TYPES[extension].has(normalizedMime)) throw spreadsheetError(`the declared content type does not match .${extension}.`)
  if (extension === 'xls') {
    if (!beginsWith(data, XLS_SIGNATURE)) throw spreadsheetError('the file extension does not match a legacy Excel workbook signature.')
  } else zipEntries(data)
  return extension
}

export function validateTrainingSpreadsheetRows(value: unknown): unknown[][] {
  if (!Array.isArray(value)) throw spreadsheetError('the parser returned an invalid row collection.')
  if (value.length > TRAINING_SPREADSHEET_MAX_ROWS) throw spreadsheetError(`the selected worksheet exceeds ${TRAINING_SPREADSHEET_MAX_ROWS} rows.`)
  let cells = 0
  const rows = value.map((candidate, rowIndex) => {
    if (!Array.isArray(candidate)) throw spreadsheetError(`row ${rowIndex + 1} is invalid.`)
    if (candidate.length > TRAINING_SPREADSHEET_MAX_COLUMNS) throw spreadsheetError(`the selected worksheet exceeds ${TRAINING_SPREADSHEET_MAX_COLUMNS} columns.`)
    cells += candidate.length
    if (cells > TRAINING_SPREADSHEET_MAX_CELLS) throw spreadsheetError(`the selected worksheet exceeds ${TRAINING_SPREADSHEET_MAX_CELLS} processed cells.`)
    return candidate.map(cell => {
      if (cell === null || cell === undefined || typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean') {
        if (typeof cell === 'string' && cell.length > TRAINING_SPREADSHEET_MAX_TEXT_LENGTH) throw spreadsheetError(`a text cell exceeds ${TRAINING_SPREADSHEET_MAX_TEXT_LENGTH} characters.`)
        return cell
      }
      throw spreadsheetError('the parser returned an unsupported cell value.')
    })
  })
  return rows
}
