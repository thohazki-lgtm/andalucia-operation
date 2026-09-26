# Training R2 SharePoint connection contract

Phase 1 is server-only, read-only discovery. It does not synchronize Training rows and does not write to SharePoint.

Required server configuration:

- `ANDALUCIA_TRAINING_SHAREPOINT_TENANT_ID`
- `ANDALUCIA_TRAINING_SHAREPOINT_CLIENT_ID`
- `ANDALUCIA_TRAINING_SHAREPOINT_CREDENTIAL_REFERENCE`
- `ANDALUCIA_TRAINING_SHAREPOINT_SITE_ID`
- `ANDALUCIA_TRAINING_SHAREPOINT_DRIVE_ID`
- `ANDALUCIA_TRAINING_SHAREPOINT_WORKBOOK_ITEM_ID`
- `ANDALUCIA_TRAINING_SHAREPOINT_WORKSHEET_ID`
- `ANDALUCIA_TRAINING_SHAREPOINT_TABLE_ID`

The credential reference must resolve through a future approved server-side secret provider. Secrets must not be stored in source code, frontend environment variables, browser storage, logs, API responses, or Training records. The future application registration should receive only the Microsoft Graph permissions required to read the approved HR Training workbook.

## Microsoft Entra and Graph configuration

Register a single-tenant confidential server application. Record the Directory (tenant) ID and Application (client) ID. Use an app-only credential so scheduled discovery never depends on a manager's interactive Microsoft session. Prefer a certificate held in Windows Certificate Store or an approved enterprise secret vault; the server configuration contains only its reference/thumbprint, never private-key or secret material.

Preferred practical least privilege is Microsoft Graph **Application** permission `Sites.Selected`, followed by an explicit `read` grant for only the approved SharePoint site. A separately authorized Microsoft 365 administrator performs that one-time site grant; the Andalucía runtime identity must not receive permission-management or write scopes. Where the tenant's provisioning policy supports file-selected permissions, `Files.SelectedOperations.Selected` with an explicit `read` grant on only the workbook is an even narrower alternative.

Do not grant `Files.ReadWrite`, `Files.ReadWrite.All`, `Sites.ReadWrite.All`, or `Sites.FullControl.All` to the runtime application. Do not use the Microsoft Graph Excel `/workbook/worksheets` or `/tables` endpoints: Microsoft does not support application permissions for those endpoints and their delegated permission is write-capable. The approved real-integration path is read-only DriveItem metadata/content access followed by local XLSX inspection on the server. Phase 1.1 verifies metadata only and performs no authentication until every identifier and the credential provider are present.

The Microsoft/IT handoff must provide the exact immutable identifiers for the approved source: SharePoint Site ID, document-library Drive ID, workbook DriveItem ID, worksheet ID/name, and Excel table ID/name. Names are useful for manager verification; stable IDs remain the integration identity. The workbook should contain a stable unique row identifier column before synchronization is approved.

The authenticated configuration diagnostic exposes only `configured`, `missingConfiguration`, and `authenticationReady`. It never returns configured values, a credential reference, access tokens, or secret material.

SharePoint owns only the schedule projection: title, date, start time, end time, trainer, and location. Manager-confirmed completion evidence, actual duration, participants, eligibility corrections, credited minutes, notes/evidence, completion actor/time, staff evidence, and frozen monthly metrics are locally owned and must never be overwritten by synchronization.

Stable source identity maps to schema 016 as follows:

- `source_container_id`: stable SharePoint site ID plus drive/library ID
- `source_document_id`: stable workbook item ID
- `worksheet_identity`: stable worksheet ID plus table ID
- `external_record_id`: stable external row identity supplied by the source table
- `external_revision`: source revision/eTag where available
- `source_row_sha256`: canonical source-row hash

Topic/date/time are not identity. Rows missing from a later source read must be flagged as missing and never automatically deleted. SharePoint outages are contained to discovery status; local Training lists, completion, evidence, and performance remain available.
