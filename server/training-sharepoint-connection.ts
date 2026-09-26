import { createHash } from 'node:crypto'

export type TrainingSharePointConfiguration = {
  tenantId: string
  clientId: string
  credentialReference: string
  siteId: string
  driveId: string
  workbookItemId: string
  worksheetId: string
  tableId: string
}

export type TrainingSharePointConnectionState = 'READY_FOR_CONFIGURATION' | 'READY_FOR_DISCOVERY' | 'AVAILABLE' | 'UNAVAILABLE'

export type TrainingSharePointStatus = {
  state: TrainingSharePointConnectionState
  configured: boolean
  missingConfiguration: string[]
  authenticationReady: boolean
  readOnly: true
  synchronizationEnabled: false
  message: string
}

export type TrainingSharePointConfigurationDiagnostic = Pick<TrainingSharePointStatus, 'configured' | 'missingConfiguration' | 'authenticationReady'>

export type TrainingSharePointDiscovery = TrainingSharePointStatus & {
  source?: {
    siteId: string
    driveId: string
    workbookItemId: string
    worksheetId: string
    tableId: string
    workbookName: string | null
    workbookETag: string | null
    workbookModifiedAt: string | null
    worksheetName: string | null
    tableName: string | null
  }
}

type GraphFetch = (input: string, init?: RequestInit) => Promise<Response>
type AccessTokenProvider = (configuration: Readonly<TrainingSharePointConfiguration>) => Promise<string>
type SafeEventLogger = (event: { event: 'sharepoint_training_discovery'; result: 'AVAILABLE' | 'UNAVAILABLE'; at: string; message?: string }) => void

const configurationFields: Array<[keyof TrainingSharePointConfiguration, string, string]> = [
  ['tenantId', 'tenantId', 'ANDALUCIA_TRAINING_SHAREPOINT_TENANT_ID'],
  ['clientId', 'clientId', 'ANDALUCIA_TRAINING_SHAREPOINT_CLIENT_ID'],
  ['credentialReference', 'credentialReference', 'ANDALUCIA_TRAINING_SHAREPOINT_CREDENTIAL_REFERENCE'],
  ['siteId', 'siteId', 'ANDALUCIA_TRAINING_SHAREPOINT_SITE_ID'],
  ['driveId', 'driveId', 'ANDALUCIA_TRAINING_SHAREPOINT_DRIVE_ID'],
  ['workbookItemId', 'workbookItemId', 'ANDALUCIA_TRAINING_SHAREPOINT_WORKBOOK_ITEM_ID'],
  ['worksheetId', 'worksheetId', 'ANDALUCIA_TRAINING_SHAREPOINT_WORKSHEET_ID'],
  ['tableId', 'tableId', 'ANDALUCIA_TRAINING_SHAREPOINT_TABLE_ID']
]

export const loadTrainingSharePointConfiguration = (environment: NodeJS.ProcessEnv = process.env): Partial<TrainingSharePointConfiguration> => Object.fromEntries(
  configurationFields.map(([key, , environmentKey]) => [key, environment[environmentKey]?.trim() || '']).filter(([, value]) => value)
)

const missingConfiguration = (configuration: Partial<TrainingSharePointConfiguration>) => configurationFields.filter(([key]) => !configuration[key]?.trim()).map(([, publicName]) => publicName)

export const TRAINING_SHAREPOINT_SOURCE_OWNERSHIP = Object.freeze({
  sharePointOwnedScheduleFields: Object.freeze(['title', 'date', 'startTime', 'endTime', 'trainer', 'location'] as const),
  managerOwnedEvidenceFields: Object.freeze(['completion', 'actualDurationMinutes', 'participants', 'eligibilityCorrections', 'creditedMinutes', 'managerNotes', 'completionActor', 'completionTimestamp', 'staffEvidence', 'monthlyTrainingMetrics'] as const),
  missingSourceBehavior: 'FLAG_MISSING_NEVER_DELETE' as const
})

export const selectSharePointOwnedSchedule = (row: Record<string, unknown>) => ({
  title: row.title,
  date: row.date,
  startTime: row.startTime,
  endTime: row.endTime,
  trainer: row.trainer,
  location: row.location
})

export type TrainingSharePointExternalIdentityInput = {
  outletScopeId: string
  siteId: string
  driveId: string
  workbookItemId: string
  worksheetId: string
  tableId: string
  externalRecordId: string
  externalRevision?: string | null
  sourceRowSha256: string
}

export const trainingSharePointExternalIdentity = (input: TrainingSharePointExternalIdentityInput) => {
  const sourceContainerId = `site:${input.siteId}|drive:${input.driveId}`
  const worksheetIdentity = `worksheet:${input.worksheetId}|table:${input.tableId}`
  const canonical = [input.outletScopeId, 'sharepoint', sourceContainerId, input.workbookItemId, worksheetIdentity, input.externalRecordId].join('\u001f')
  return {
    outletScopeId: input.outletScopeId,
    sourceType: 'sharepoint' as const,
    sourceContainerId,
    sourceDocumentId: input.workbookItemId,
    worksheetIdentity,
    externalRecordId: input.externalRecordId,
    externalRevision: input.externalRevision || null,
    sourceRowSha256: input.sourceRowSha256,
    stableIdentitySha256: createHash('sha256').update(canonical).digest('hex')
  }
}

const graphSegment = (value: string) => encodeURIComponent(value)
const graphJson = async (fetcher: GraphFetch, token: string, url: string) => {
  const response = await fetcher(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Microsoft Graph read failed with HTTP ${response.status}.`)
  return response.json() as Promise<any>
}

export class TrainingSharePointConnection {
  constructor(
    private readonly configuration: Partial<TrainingSharePointConfiguration> = loadTrainingSharePointConfiguration(),
    private readonly dependencies: { accessToken?: AccessTokenProvider; fetcher?: GraphFetch; log?: SafeEventLogger } = {}
  ) {}

  status(): TrainingSharePointStatus {
    const missing = missingConfiguration(this.configuration)
    const authenticationReady = missing.length === 0 && Boolean(this.dependencies.accessToken && this.dependencies.fetcher)
    return {
      state: missing.length ? 'READY_FOR_CONFIGURATION' : authenticationReady ? 'READY_FOR_DISCOVERY' : 'UNAVAILABLE',
      configured: missing.length === 0,
      missingConfiguration: missing,
      authenticationReady,
      readOnly: true,
      synchronizationEnabled: false,
      message: missing.length
        ? 'SharePoint Training discovery is ready for server configuration.'
        : authenticationReady
          ? 'SharePoint Training configuration and server authentication provider are ready for read-only discovery.'
          : 'SharePoint Training identifiers are configured, but the server authentication provider is not ready.'
    }
  }

  diagnostic(): TrainingSharePointConfigurationDiagnostic {
    const { configured, missingConfiguration, authenticationReady } = this.status()
    return { configured, missingConfiguration, authenticationReady }
  }

  async discover(): Promise<TrainingSharePointDiscovery> {
    const status = this.status()
    if (!status.configured) return status
    if (!this.dependencies.accessToken || !this.dependencies.fetcher) return { ...status, state: 'UNAVAILABLE', message: 'SharePoint credential resolution is not available on this server.' }
    const configuration = this.configuration as TrainingSharePointConfiguration
    try {
      const token = await this.dependencies.accessToken(configuration)
      if (!token) throw new Error('Microsoft Graph access token was unavailable.')
      const root = `https://graph.microsoft.com/v1.0/sites/${graphSegment(configuration.siteId)}/drives/${graphSegment(configuration.driveId)}/items/${graphSegment(configuration.workbookItemId)}`
      // App-only Excel workbook endpoints do not support application permissions.
      // Discovery therefore verifies only the approved file through the read-only
      // DriveItem API. A future sync must download and inspect the XLSX locally.
      const workbook = await graphJson(this.dependencies.fetcher, token, `${root}?$select=id,name,eTag,lastModifiedDateTime`)
      this.dependencies.log?.({ event: 'sharepoint_training_discovery', result: 'AVAILABLE', at: new Date().toISOString() })
      return {
        ...status,
        state: 'AVAILABLE',
        message: 'Configured SharePoint Training workbook is available for read-only discovery.',
        source: {
          siteId: configuration.siteId, driveId: configuration.driveId, workbookItemId: workbook.id || configuration.workbookItemId,
          worksheetId: configuration.worksheetId, tableId: configuration.tableId, workbookName: workbook.name || null, workbookETag: workbook.eTag || null,
          workbookModifiedAt: workbook.lastModifiedDateTime || null, worksheetName: null, tableName: null
        }
      }
    } catch {
      this.dependencies.log?.({ event: 'sharepoint_training_discovery', result: 'UNAVAILABLE', at: new Date().toISOString(), message: 'Read-only discovery failed.' })
      return { ...status, state: 'UNAVAILABLE', message: 'SharePoint Training discovery is temporarily unavailable. Local Training remains available.' }
    }
  }
}
