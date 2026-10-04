import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { GoogleDesktopOAuthCoordinator, GoogleDriveRestTransport, WindowsCredentialLockerStore, safeCloudError } from './google-drive-cloud-client.js'
import {
  LoopbackOAuthCallbackServer,
  ManagerControlledCloudProvisioning,
  PROVISIONING_CONFIRM_DESTINATION,
  PROVISIONING_CONFIRM_IDENTITY,
  PROVISIONING_CONFIRM_PUBLICATION,
  type ManagerApprovalBoundary,
  type ProvisioningInput
} from './google-drive-provisioning.js'

const allowedArguments = new Set([
  'client-id', 'credential-reference', 'folder-id', 'destination-label', 'relationship', 'drive-id',
  'approved-root', 'artifact', 'sidecar', 'backup-id', 'schema', 'manifest-sha256', 'callback-timeout-seconds'
])

const parseArguments = (values: string[]) => {
  const parsed = new Map<string, string>()
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index]
    const value = values[index + 1]
    if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) throw new Error('PROVISIONING_ARGUMENTS_INVALID')
    const name = flag.slice(2)
    if (!allowedArguments.has(name) || parsed.has(name)) throw new Error('PROVISIONING_ARGUMENTS_INVALID')
    parsed.set(name, value)
  }
  const required = (name: string) => {
    const value = parsed.get(name)?.trim()
    if (!value) throw new Error(`PROVISIONING_${name.replace(/-/g, '_').toUpperCase()}_MISSING`)
    return value
  }
  const relationship = required('relationship')
  if (relationship !== 'MY_DRIVE' && relationship !== 'SHARED_DRIVE') throw new Error('PROVISIONING_RELATIONSHIP_INVALID')
  const timeoutSeconds = parsed.has('callback-timeout-seconds') ? Number(parsed.get('callback-timeout-seconds')) : 300
  if (!Number.isInteger(timeoutSeconds)) throw new Error('OAUTH_CALLBACK_TIMEOUT_INVALID')
  return {
    clientId: required('client-id'), credentialReference: required('credential-reference'),
    destination: { folderId: required('folder-id'), label: required('destination-label'), relationship, driveId: parsed.get('drive-id')?.trim() || undefined },
    approvedRoot: required('approved-root'), artifactPath: required('artifact'), sidecarPath: required('sidecar'),
    expectedBackupId: required('backup-id'), expectedSchema: required('schema'), expectedManifestSha256: required('manifest-sha256'),
    callbackTimeoutMs: timeoutSeconds * 1_000
  } satisfies ProvisioningInput
}

class ConsoleManagerApproval implements ManagerApprovalBoundary {
  private readonly terminal = createInterface({ input: stdin, output: stdout, terminal: true })

  async authorizationReady(localAuthorizationUrl: string) {
    stdout.write('\nLocal authorization is ready. No Google credential or OAuth code will be shown in this terminal.\n')
    stdout.write(`Open this local address in a browser: ${localAuthorizationUrl}\n`)
    stdout.write('Review the Google account and drive.file permission in the browser, then complete or cancel there.\n\n')
  }

  approveIdentity(identity: { maskedEmail: string; permissionFingerprint: string }) {
    return this.confirm(
      `Google identity: ${identity.maskedEmail} (${identity.permissionFingerprint})`,
      PROVISIONING_CONFIRM_IDENTITY
    )
  }

  approveDestination(destination: { label: string; folderId: string; relationship: 'MY_DRIVE' | 'SHARED_DRIVE'; driveId?: string }) {
    return this.confirm(
      `Drive destination: ${destination.label} | ${destination.relationship} | folder ${destination.folderId}${destination.driveId ? ` | drive ${destination.driveId}` : ''}`,
      PROVISIONING_CONFIRM_DESTINATION
    )
  }

  approvePublication(pair: { backupId: string; artifactName: string; sidecarName: string; artifactSha256: string }) {
    return this.confirm(
      `Verified recovery pair: ${pair.backupId} | ${pair.artifactName} | ${pair.sidecarName} | SHA-256 ${pair.artifactSha256}`,
      PROVISIONING_CONFIRM_PUBLICATION
    )
  }

  close() { this.terminal.close() }

  private async confirm(summary: string, requiredPhrase: string) {
    stdout.write(`\n${summary}\n`)
    const answer = await this.terminal.question(`Type exactly "${requiredPhrase}" to continue, or press Enter to cancel: `)
    return answer === requiredPhrase
  }
}

const manager = new ConsoleManagerApproval()
try {
  const input = parseArguments(process.argv.slice(2))
  const credentials = WindowsCredentialLockerStore.production()
  const drive = new GoogleDriveRestTransport()
  const runner = new ManagerControlledCloudProvisioning({
    credentials,
    drive,
    createOAuth: configuration => new GoogleDesktopOAuthCoordinator({ configuration, credentials }),
    createCallback: timeoutMs => LoopbackOAuthCallbackServer.listen(timeoutMs),
    manager
  })
  const result = await runner.execute(input)
  stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = 0
} catch (error) {
  stdout.write(`${JSON.stringify(safeCloudError(error))}\n`)
  process.exitCode = 1
} finally {
  manager.close()
}
