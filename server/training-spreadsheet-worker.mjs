import { parentPort, workerData } from 'node:worker_threads'
import * as XLSX from 'xlsx'

const limits = workerData.limits

try {
  const data = new Uint8Array(workerData.data)
  const workbook = XLSX.read(data, {
    type: 'array',
    cellDates: true,
    cellFormula: false,
    cellHTML: false,
    bookVBA: false,
    bookFiles: false,
    bookDeps: false
  })
  if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length < 1) throw new Error('No worksheet was found in the Training workbook.')
  if (workbook.SheetNames.length > limits.worksheets) throw new Error(`Training spreadsheet rejected: the workbook exceeds ${limits.worksheets} worksheets.`)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('No worksheet was found in the Training workbook.')
  if (sheet['!ref']) {
    const range = XLSX.utils.decode_range(sheet['!ref'])
    const rows = range.e.r - range.s.r + 1
    const columns = range.e.c - range.s.c + 1
    if (rows > limits.rows) throw new Error(`Training spreadsheet rejected: the selected worksheet exceeds ${limits.rows} rows.`)
    if (columns > limits.columns) throw new Error(`Training spreadsheet rejected: the selected worksheet exceeds ${limits.columns} columns.`)
    if (rows * columns > limits.cells) throw new Error(`Training spreadsheet rejected: the selected worksheet exceeds ${limits.cells} addressable cells.`)
  }
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith('!') || !cell || cell.t !== 'd' || !(cell.v instanceof Date) || Number.isNaN(cell.v.getTime())) continue
    cell.w = `${cell.v.getUTCFullYear()}-${String(cell.v.getUTCMonth() + 1).padStart(2, '0')}-${String(cell.v.getUTCDate()).padStart(2, '0')}`
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', blankrows: false })
  parentPort.postMessage({ ok: true, sheetCount: workbook.SheetNames.length, selectedSheet: workbook.SheetNames[0], rows })
} catch (error) {
  parentPort.postMessage({ ok: false, message: error instanceof Error ? error.message : 'The Training spreadsheet could not be parsed.' })
}
