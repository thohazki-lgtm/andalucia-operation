import { Worker } from 'node:worker_threads'
import {
  TRAINING_SPREADSHEET_MAX_CELLS,
  TRAINING_SPREADSHEET_MAX_COLUMNS,
  TRAINING_SPREADSHEET_MAX_ROWS,
  TRAINING_SPREADSHEET_MAX_WORKSHEETS,
  TRAINING_SPREADSHEET_TIMEOUT_MS,
  validateTrainingSpreadsheetFile,
  validateTrainingSpreadsheetRows
} from './training-spreadsheet-security.js'

export type TrainingSpreadsheetParseOptions = { mimeType?: string | null; timeoutMs?: number }

type WorkerResult = { ok: true; sheetCount: number; selectedSheet: string; rows: unknown } | { ok: false; message: string }

const safeMessage = (message: unknown) => {
  const text = String(message || '').replace(/[\r\n]+/g, ' ').trim()
  if (/^Training spreadsheet rejected:/.test(text) || /^No worksheet was found/.test(text)) return text
  return 'The Training spreadsheet is malformed or could not be parsed safely.'
}

export async function parseTrainingSpreadsheet(data: Uint8Array, fileName: string, options: TrainingSpreadsheetParseOptions = {}): Promise<unknown[][]> {
  validateTrainingSpreadsheetFile(data, fileName, options.mimeType)
  const transferable = data.slice().buffer
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? TRAINING_SPREADSHEET_TIMEOUT_MS, TRAINING_SPREADSHEET_TIMEOUT_MS))
  return new Promise((resolve, reject) => {
    let settled = false
    const worker = new Worker(new URL('./training-spreadsheet-worker.mjs', import.meta.url), {
      workerData: { data: transferable, limits: { worksheets: TRAINING_SPREADSHEET_MAX_WORKSHEETS, rows: TRAINING_SPREADSHEET_MAX_ROWS, columns: TRAINING_SPREADSHEET_MAX_COLUMNS, cells: TRAINING_SPREADSHEET_MAX_CELLS } },
      transferList: [transferable],
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 }
    })
    const finish = (action: () => void) => { if (settled) return; settled = true; clearTimeout(timer); action() }
    const timer = setTimeout(() => finish(() => { void worker.terminate(); reject(new Error(`Training spreadsheet parsing exceeded the ${timeoutMs} ms safety limit.`)) }), timeoutMs)
    worker.once('message', (message: WorkerResult) => finish(() => {
      void worker.terminate()
      if (!message || message.ok !== true) { reject(new Error(safeMessage(message && 'message' in message ? message.message : ''))); return }
      try { resolve(validateTrainingSpreadsheetRows(message.rows)) } catch (error) { reject(error) }
    }))
    worker.once('error', error => finish(() => { void worker.terminate(); reject(new Error(safeMessage(error instanceof Error ? error.message : error))) }))
    worker.once('exit', code => { if (!settled && code !== 0) finish(() => reject(new Error('The isolated Training spreadsheet parser stopped unexpectedly.'))) })
  })
}
