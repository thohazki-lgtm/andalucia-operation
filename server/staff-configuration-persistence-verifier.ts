import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { StaffRepository } from './staff-repository.js'

const [snapshotPath, staffId, dutyId, employmentId, positionId] = process.argv.slice(2)
if (!snapshotPath || !staffId || !dutyId || !employmentId || !positionId) throw new Error('Snapshot and verification identities are required.')

const snapshot = new Uint8Array(await readFile(snapshotPath))
const repository = new StaffRepository('', new PGlite({ loadDataDir: new Blob([snapshot]) }))
try {
  await repository.initialize()
  const configuration = await repository.configuration()
  const historicalStaff = await repository.find(staffId)
  const duty = configuration.dutyCodes.find(option => option.id === dutyId)
  const employment = configuration.employmentStatuses.find(option => option.id === employmentId)
  const position = configuration.positions.find(option => option.id === positionId)
  process.stdout.write(JSON.stringify({
    dutyCountsAsWorking: duty?.metadata?.countsAsWorking,
    dutyDisplayCode: duty?.metadata?.displayCode,
    employmentActive: employment?.active,
    positionLabel: position?.label,
    staffEmploymentStatus: historicalStaff?.employmentStatus,
    staffPosition: historicalStaff?.position
  }))
} finally {
  await repository.getDatabase().close().catch(() => undefined)
}
