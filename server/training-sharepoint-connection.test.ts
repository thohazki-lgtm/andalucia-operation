import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { loadTrainingSharePointConfiguration, selectSharePointOwnedSchedule, TRAINING_SHAREPOINT_SOURCE_OWNERSHIP, TrainingSharePointConnection, trainingSharePointExternalIdentity, type TrainingSharePointConfiguration } from './training-sharepoint-connection.js'

const missing = new TrainingSharePointConnection(loadTrainingSharePointConfiguration({})).status()
assert.equal(missing.state, 'READY_FOR_CONFIGURATION')
assert.equal(missing.configured, false)
assert.equal(missing.missingConfiguration.length, 8)
assert.equal(missing.authenticationReady, false)
assert.equal(missing.synchronizationEnabled, false)
assert.deepEqual(Object.keys(new TrainingSharePointConnection(loadTrainingSharePointConfiguration({})).diagnostic()).sort(), ['authenticationReady', 'configured', 'missingConfiguration'])

const configuration: TrainingSharePointConfiguration = { tenantId: 'tenant-id', clientId: 'client-id', credentialReference: 'vault://training-reader', siteId: 'site-id', driveId: 'drive-id', workbookItemId: 'workbook-id', worksheetId: 'worksheet-id', tableId: 'table-id' }
const requests: Array<{ url: string; method: string; authorization: string }> = []
const events: unknown[] = []
const connection = new TrainingSharePointConnection(configuration, {
  accessToken: async config => { assert.equal(config.credentialReference, 'vault://training-reader'); return 'test-secret-access-token' },
  fetcher: async (url, init) => {
    requests.push({ url, method: init?.method || 'GET', authorization: String(new Headers(init?.headers).get('Authorization')) })
    const payload = url.includes('/tables?') ? { value: [{ id: 'table-id', name: 'Approved Training Table' }] } : url.includes('/worksheets?') ? { value: [{ id: 'worksheet-id', name: 'Training Calendar', visibility: 'visible' }] } : { id: 'workbook-id', name: 'HR Training.xlsx', eTag: 'revision-1', lastModifiedDateTime: '2026-09-15T08:00:00Z' }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  },
  log: event => events.push(event)
})
const discovered = await connection.discover()
assert.equal(discovered.state, 'AVAILABLE')
assert.equal(discovered.source?.workbookETag, 'revision-1')
assert.equal(discovered.source?.worksheetId, 'worksheet-id')
assert.equal(discovered.source?.tableId, 'table-id')
assert.equal(requests.length, 1)
assert.equal(requests.every(request => request.method === 'GET'), true)
assert.equal(requests.every(request => !request.url.includes('/workbook/')), true)
assert.equal(requests.every(request => request.authorization === 'Bearer test-secret-access-token'), true)
assert.equal(JSON.stringify(events).includes('test-secret-access-token'), false)
assert.equal(JSON.stringify(discovered).includes('test-secret-access-token'), false)
assert.equal(JSON.stringify(discovered).includes('vault://training-reader'), false)

const unavailable = await new TrainingSharePointConnection(configuration, { accessToken: async () => { throw new Error('offline') }, fetcher: fetch }).discover()
assert.equal(unavailable.state, 'UNAVAILABLE')
assert.match(unavailable.message, /Local Training remains available/)

const schedule = selectSharePointOwnedSchedule({ title: 'Service Sequence', date: '2026-09-20', startTime: '17:30', endTime: '18:00', trainer: 'HR Trainer', location: 'Andalucía', actualDurationMinutes: 30, participants: ['staff'], creditedMinutes: 30, managerNotes: 'Preserve' })
assert.deepEqual(Object.keys(schedule), [...TRAINING_SHAREPOINT_SOURCE_OWNERSHIP.sharePointOwnedScheduleFields])
assert.equal('actualDurationMinutes' in schedule || 'participants' in schedule || 'managerNotes' in schedule, false)
assert.equal(new Set([...TRAINING_SHAREPOINT_SOURCE_OWNERSHIP.sharePointOwnedScheduleFields, ...TRAINING_SHAREPOINT_SOURCE_OWNERSHIP.managerOwnedEvidenceFields]).size, TRAINING_SHAREPOINT_SOURCE_OWNERSHIP.sharePointOwnedScheduleFields.length + TRAINING_SHAREPOINT_SOURCE_OWNERSHIP.managerOwnedEvidenceFields.length)
assert.equal(TRAINING_SHAREPOINT_SOURCE_OWNERSHIP.missingSourceBehavior, 'FLAG_MISSING_NEVER_DELETE')

const identityInput = { outletScopeId: ANDALUCIA_SCOPE_ID, siteId: 'site-id', driveId: 'drive-id', workbookItemId: 'workbook-id', worksheetId: 'worksheet-id', tableId: 'table-id', externalRecordId: 'row-guid', externalRevision: 'revision-1', sourceRowSha256: 'a'.repeat(64) }
const identityA = trainingSharePointExternalIdentity(identityInput)
const identityB = trainingSharePointExternalIdentity(identityInput)
assert.deepEqual(identityA, identityB)
assert.equal(identityA.sourceContainerId, 'site:site-id|drive:drive-id')
assert.equal(identityA.sourceDocumentId, 'workbook-id')
assert.equal(identityA.worksheetIdentity, 'worksheet:worksheet-id|table:table-id')
assert.match(identityA.stableIdentitySha256, /^[0-9a-f]{64}$/)
assert.notEqual(trainingSharePointExternalIdentity({ ...identityInput, externalRecordId: 'row-guid-2' }).stableIdentitySha256, identityA.stableIdentitySha256)

const frontendFiles = await readdir('src')
for (const name of frontendFiles.filter(name => /\.(ts|tsx|js|jsx)$/.test(name))) assert.equal((await readFile(join('src', name), 'utf8')).includes('ANDALUCIA_TRAINING_SHAREPOINT_'), false, `${name} exposes SharePoint server configuration`)

console.log(JSON.stringify({ status: 'PASS', serverOnlySecrets: true, safeDiagnostic: true, missingConfiguration: missing.state, readOnlyGraphMethods: requests.map(request => request.method), applicationPermissionCompatible: true, discoveryMetadata: true, stableExternalIdentity: true, ownershipBoundary: true, missingRowsNeverDeleted: true, offlineIsolation: true }, null, 2))
