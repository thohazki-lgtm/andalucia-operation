import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { StaffRepository } from './staff-repository.js'

const [snapshotPath, editedId, rosterReferencedId, attendanceReferencedId, expectedOrderJson] = process.argv.slice(2)
assert.ok(snapshotPath && editedId && rosterReferencedId && attendanceReferencedId && expectedOrderJson, 'Reopen verification arguments are required.')

const snapshot = new Uint8Array(await readFile(snapshotPath))
const repository = new StaffRepository('', new PGlite({ loadDataDir: new Blob([snapshot]) }))
await repository.initialize()
const persisted = await repository.configuration()
const edited = persisted.dutyCodes.find(option => option.id === editedId)
const rosterReferenced = persisted.dutyCodes.find(option => option.id === rosterReferencedId)
const attendanceReferenced = persisted.dutyCodes.find(option => option.id === attendanceReferencedId)
const activeOrder = persisted.dutyCodes.filter(option => option.active).map(option => option.id)
const expectedActiveOrder = JSON.parse(expectedOrderJson) as string[]

assert.ok(edited && rosterReferenced && attendanceReferenced, 'Persisted Duty Code records were not found after reopening.')
assert.equal(edited?.metadata?.displayCode, 'TST2')
assert.equal(edited?.color, '#abcdef')
assert.equal(rosterReferenced?.active, false)
assert.equal(attendanceReferenced?.active, false)
assert.deepEqual(activeOrder, expectedActiveOrder)
await repository.getDatabase().close()

console.log(JSON.stringify({ displayCode: edited.metadata?.displayCode, color: edited.color, rosterReferencedActive: rosterReferenced.active, attendanceReferencedActive: attendanceReferenced.active, activeOrder }))
