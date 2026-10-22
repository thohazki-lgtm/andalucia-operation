import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { GoogleDriveRestTransport, WindowsCredentialLockerStore, WindowsWebPickerConfigurationStore, safeCloudError } from './google-drive-cloud-client.js'
import {
  GoogleWebPickerProvisioningService,
  WEB_PICKER_APPROVAL_PHRASE
} from './google-web-picker-provisioning.js'
import { GOOGLE_DRIVE_FILE_SCOPE } from './secure-cloud-upload.js'

const allowedArguments = new Set(['credential-reference', 'destination-label'])
const values = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index]
  const value = process.argv[index + 1]
  if (!flag?.startsWith('--') || !value || value.startsWith('--')) throw new Error('WEB_PICKER_ARGUMENTS_INVALID')
  const name = flag.slice(2)
  if (!allowedArguments.has(name) || values.has(name)) throw new Error('WEB_PICKER_ARGUMENTS_INVALID')
  values.set(name, value.trim())
}
const credentialReference = values.get('credential-reference') || 'andalucia-cloud:web-picker-production'
const destinationLabel = values.get('destination-label') || 'Encrypted database backups'
if (!/^andalucia-cloud:[A-Za-z0-9._-]+$/.test(credentialReference) || !destinationLabel) throw new Error('WEB_PICKER_ARGUMENTS_INVALID')

const terminal = createInterface({ input: stdin, output: stdout, terminal: true })
const service = new GoogleWebPickerProvisioningService({
  configurationStore: WindowsWebPickerConfigurationStore.production(),
  drive: new GoogleDriveRestTransport()
})

try {
  await service.listen()
  const session = await service.createSession()
  stdout.write('R2.4G Web Picker provisioning is ready.\n')
  stdout.write(`OAuth scope: ${GOOGLE_DRIVE_FILE_SCOPE}\n`)
  stdout.write(`Open this loopback address: ${session.localUrl}\n`)
  stdout.write(`Session expiry: ${session.expiresAt}\n`)
  stdout.write('No Google Drive mutation is authorized by this step.\n\n')
  const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', session.localUrl], { detached: true, stdio: 'ignore', windowsHide: true })
  browser.once('error', () => stdout.write('The default browser could not be opened. Open the loopback address above manually.\n'))
  browser.unref()

  const sessionId = session.localUrl.split('/').at(-1) || ''
  const checkpoint = await service.waitForCheckpoint(sessionId)
  stdout.write(`\nGoogle identity: ${checkpoint.identity.maskedEmail} (${checkpoint.identity.permissionFingerprint})\n`)
  stdout.write(`Drive destination: ${checkpoint.destination.name} | ${checkpoint.destination.relationship} | writable=${checkpoint.destination.writable}\n`)
  stdout.write('No final credential has been retained. No Drive object has been modified.\n')
  const answer = await terminal.question(`Type exactly "${WEB_PICKER_APPROVAL_PHRASE}" to retain the destination-bound credential, or press Enter to cancel: `)
  if (answer !== WEB_PICKER_APPROVAL_PHRASE) throw new Error('WEB_PICKER_MANAGER_APPROVAL_REQUIRED')
  const result = await service.approveDestination(sessionId, answer, WindowsCredentialLockerStore.production(), credentialReference, destinationLabel)
  stdout.write(`${JSON.stringify({ WEB_PICKER_DESTINATION_APPROVED: result.stored, CREDENTIAL_REFERENCE: result.credentialReference, DESTINATION_NAME: result.destination.name, RELATIONSHIP: result.destination.relationship })}\n`)
  process.exitCode = 0
} catch (error) {
  stdout.write(`${JSON.stringify(safeCloudError(error))}\n`)
  process.exitCode = 1
} finally {
  terminal.close()
  await service.close().catch(() => undefined)
}
