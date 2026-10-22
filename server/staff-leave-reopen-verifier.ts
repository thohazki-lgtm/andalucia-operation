import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { StaffRepository } from './staff-repository.js'

const [snapshotPath, staffId] = process.argv.slice(2)
if (!snapshotPath || !staffId) throw new Error('Disposable staff snapshot and staff ID are required.')

const snapshot = new Uint8Array(await readFile(snapshotPath))
const repository = new StaffRepository('', new PGlite({ loadDataDir: new Blob([snapshot]) }))
try {
  await repository.initialize()
  const persisted = await repository.leaveRecords('2026-09-01', '2026-09-30', staffId)
  process.stdout.write(JSON.stringify({ sickLeaveDays: persisted.flatMap(record => record.entries).filter(day => day.classification === 'sickLeave').length }))
} finally {
  await repository.getDatabase().close().catch(() => undefined)
}
