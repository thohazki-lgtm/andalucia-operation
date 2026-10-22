import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { StaffRepository } from './staff-repository.js'

const [snapshotPath, staffId] = process.argv.slice(2)
if (!snapshotPath || !staffId) throw new Error('Disposable staff snapshot and staff ID are required.')

const snapshot = new Uint8Array(await readFile(snapshotPath))
const repository = new StaffRepository('', new PGlite({ loadDataDir: new Blob([snapshot]) }))
try {
  await repository.initialize()
  const persisted = await repository.find(staffId)
  const position = (await repository.configuration()).positions.find(option => option.value === 'Restaurant Supervisor')
  process.stdout.write(JSON.stringify({
    position: persisted?.position,
    identityDocumentNumber: persisted?.identityDocumentNumber,
    employmentStatus: persisted?.employmentStatus,
    serviceAssignmentEligible: position?.metadata?.serviceAssignmentEligible
  }))
} finally {
  await repository.getDatabase().close().catch(() => undefined)
}
