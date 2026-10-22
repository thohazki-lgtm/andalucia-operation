import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { StaffRepository } from './staff-repository.js'

const [snapshotPath, staffId] = process.argv.slice(2)
if (!snapshotPath || !staffId) throw new Error('Snapshot path and staff ID are required')

const snapshot = await readFile(snapshotPath)
const database = new PGlite({ loadDataDir: new Blob([snapshot]) })
const repository = new StaffRepository('snapshot-verification', database)

try {
  await repository.initialize()
  const balance = await repository.entitlementBalance(staffId, 2026, '2026-09-14', '2026-09-20')
  console.log(JSON.stringify({
    annualLeave: balance.annualLeave,
    publicHoliday: balance.publicHoliday,
    weeklyOffStatus: balance.weeklyOff.status
  }))
} finally {
  await database.close()
}
