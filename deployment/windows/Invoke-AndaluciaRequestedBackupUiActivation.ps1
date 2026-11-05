[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ExpectedSha,
    [Parameter(Mandatory = $true)][string]$ManagerAuthorization,
    [string]$RepositoryRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($ManagerAuthorization -ne 'YES_I_APPROVE_ONE_GUARDED_REQUESTED_BACKUP_ACTIVATION_WINDOW') { throw 'REQUESTED_BACKUP_MAINTENANCE_AUTHORIZATION_REQUIRED' }
$projectRoot = if ($RepositoryRoot) { [IO.Path]::GetFullPath($RepositoryRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')) }
$canonicalData = [IO.Path]::GetFullPath((Join-Path $projectRoot '.data\postgres'))
$identityPath = Join-Path (Split-Path $canonicalData -Parent) 'andalucia-store-identity.json'
$approvalPath = Join-Path $projectRoot '.runtime\andalucia-local-ui-approval.json'
$evidenceRoot = Join-Path $projectRoot '.runtime\maintenance-evidence'
$auditPath = Join-Path $evidenceRoot 'audit.jsonl'
$stopScript = Join-Path $PSScriptRoot 'Stop-AndaluciaGuardedApplication.ps1'
$preflightScript = Join-Path $PSScriptRoot 'Test-AndaluciaGuardedUiActivation.ps1'
$activationScript = Join-Path $PSScriptRoot 'Invoke-AndaluciaApprovedUiActivation.ps1'
$resolverPath = Join-Path $PSScriptRoot 'Resolve-AndaluciaApprovedSource.ps1'
$schedulerLock = Join-Path $projectRoot '.backups\.db2\scheduler\job.lock'
$markerPath = Join-Path $canonicalData 'postmaster.pid'
$stopped = $false

function Write-MaintenanceAudit([string]$State, [hashtable]$Details = @{}) {
    New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
    $record = [ordered]@{ version='andalucia-requested-backup-activation-audit-v1'; recordedAt=[DateTime]::UtcNow.ToString('o'); state=$State; targetSha=$ExpectedSha; details=$Details }
    Add-Content -LiteralPath $auditPath -Value ($record | ConvertTo-Json -Compress) -Encoding UTF8
}

try {
    . $resolverPath
    $source = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot
    if ($source.Mode -notin @('approved_local_reviewed_ui_checkpoint','approved_local_reviewed_backend_checkpoint') -or $source.Sha -ne $ExpectedSha) { throw 'REQUESTED_BACKUP_APPROVED_SOURCE_MISMATCH' }
    if (@(& git -C $projectRoot status --porcelain --untracked-files=no).Count -gt 0) { throw 'REQUESTED_BACKUP_SOURCE_DIRTY' }
    if (Test-Path -LiteralPath $schedulerLock) { throw 'REQUESTED_BACKUP_SCHEDULER_BUSY' }
    foreach ($operationMarker in @('migration-in-progress','recovery-in-progress')) { if (Test-Path -LiteralPath (Join-Path (Split-Path $canonicalData -Parent) $operationMarker)) { throw "REQUESTED_BACKUP_OPERATION_BLOCKED:$operationMarker" } }

    $requestFiles = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot '.backups\.db2\requests') -Filter '*.json' -File -ErrorAction SilentlyContinue)
    $pending = @($requestFiles | ForEach-Object { try { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json } catch { $null } } | Where-Object { $_ -and $_.state -eq 'pending' })
    if ($pending.Count -ne 1) { throw "REQUESTED_BACKUP_PENDING_REQUEST_COUNT_INVALID:$($pending.Count)" }
    if ($pending[0].category -ne 'manual' -or -not [string]$pending[0].requestedBy.userId -or -not [string]$pending[0].requestedBy.displayName) { throw 'REQUESTED_BACKUP_AUTHENTICATED_REQUEST_INVALID' }

    $healthCapturedAt = [DateTime]::UtcNow
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -Method Get -TimeoutSec 5
    if (-not $health.ok -or [string]$health.application.sha -ne [string]$source.PreviousLiveSha -or $health.database.status -ne 'HEALTHY' -or $health.database.migrationVersion -ne '027' -or $health.database.migrationRequired -or $health.database.recoveryRequired) { throw 'REQUESTED_BACKUP_PRE_SHUTDOWN_HEALTH_INVALID' }
    $identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
    if ($identity.role -ne 'canonical' -or [IO.Path]::GetFullPath([string]$identity.databaseDirectory) -ne $canonicalData) { throw 'REQUESTED_BACKUP_CANONICAL_IDENTITY_INVALID' }
    if ([string]$health.database.storeId -ne [string]$identity.storeId -or -not [string]$health.application.branch) { throw 'REQUESTED_BACKUP_PRE_SHUTDOWN_HEALTH_BINDING_INVALID' }

    $preflightOutput = & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $preflightScript -ExpectedSha $ExpectedSha -RepositoryRoot $projectRoot -AllowReviewedNonUiPaths -AllowApprovedLocalCheckpoint
    $preflightText = $preflightOutput -join [Environment]::NewLine
    $preflight = $preflightText | ConvertFrom-Json
    if ($LASTEXITCODE -eq 0 -or [string]$preflight.blocker -notmatch '^VERIFIED_BACKUP_TOO_OLD:') { throw "REQUESTED_BACKUP_PRE_SHUTDOWN_PREFLIGHT_NOT_EXCLUSIVELY_BACKUP_BLOCKED:$preflightText" }

    Write-MaintenanceAudit 'PRE_SHUTDOWN_VERIFIED' @{ previousLiveSha=[string]$source.PreviousLiveSha; requestId=[string]$pending[0].id; schema='027' }
    & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $stopScript
    if ($LASTEXITCODE -ne 0) { throw "REQUESTED_BACKUP_GUARDED_STOP_FAILED:$LASTEXITCODE" }
    $stopped = $true

    $activePorts = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 3001,5173,5174 })
    if ($activePorts.Count -ne 0 -or (Test-Path -LiteralPath $markerPath)) { throw 'REQUESTED_BACKUP_EXCLUSIVE_ACCESS_NOT_VERIFIED' }

    $env:ANDALUCIA_DATA_DIR = $canonicalData
    $env:ANDALUCIA_STORE_ROLE = 'canonical'
    $env:ANDALUCIA_CONFIRM_LIVE_STORE_EXCLUSIVE = 'YES_I_CONFIRM_ANDALUCIA_APP_IS_STOPPED'
    $env:ANDALUCIA_REQUIRED_SCHEMA_VERSION = '027'
    $jobOutput = @(& npm.cmd run db:backup:job -- requested 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "REQUESTED_BACKUP_JOB_FAILED:$($jobOutput | Select-Object -Last 1)" }

    $requestFile = $requestFiles | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json).id -eq $pending[0].id } | Select-Object -First 1
    $completedRequest = Get-Content -LiteralPath $requestFile.FullName -Raw | ConvertFrom-Json
    if ($completedRequest.state -ne 'completed' -or -not $completedRequest.backupId) { throw 'REQUESTED_BACKUP_REQUEST_NOT_COMPLETED' }
    $backupFolder = Join-Path $projectRoot ".backups\$($completedRequest.backupId)"
    $metadata = Get-Content -LiteralPath (Join-Path $backupFolder 'backup-metadata.json') -Raw | ConvertFrom-Json
    $restore = Get-Content -LiteralPath (Join-Path $backupFolder 'restore-test.json') -Raw | ConvertFrom-Json
    if ($metadata.verificationStatus -ne 'VERIFIED' -or $metadata.openTestStatus -ne 'PASS' -or $metadata.preflightStatus -ne 'READY' -or $restore.status -ne 'RESTORE_TEST_PASSED' -or -not $restore.manifestMatch -or -not $restore.fingerprintMatch -or -not $restore.migrationMatch -or $restore.preflightStatus -ne 'READY') { throw 'REQUESTED_BACKUP_VERIFICATION_OR_RESTORE_READINESS_FAILED' }

    New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
    $nonce = [Guid]::NewGuid().ToString('N')
    $issuedAt = [DateTime]::UtcNow
    $evidencePath = Join-Path $evidenceRoot "stopped-runtime-$nonce.json"
    $evidence = [ordered]@{
        version='andalucia-stopped-runtime-evidence-v1'; nonce=$nonce; issuedAt=$issuedAt.ToString('o'); expiresAt=$issuedAt.AddMinutes(10).ToString('o')
        authorization=$ManagerAuthorization; requestId=[string]$completedRequest.id; backupId=[string]$completedRequest.backupId
        previousLiveSha=[string]$source.PreviousLiveSha; targetSha=$ExpectedSha; branch=[string]$source.Branch
        databaseStatus='HEALTHY'; schema='027'; migrationRequired=$false; recoveryRequired=$false
        canonicalStoreId=[string]$identity.storeId; canonicalIdentitySha256=(Get-FileHash -LiteralPath $identityPath -Algorithm SHA256).Hash.ToLowerInvariant()
        approvalManifestSha256=(Get-FileHash -LiteralPath $approvalPath -Algorithm SHA256).Hash.ToLowerInvariant()
        preShutdownHealthCapturedAt=$healthCapturedAt.ToString('o'); preShutdownRuntimeBranch=[string]$health.application.branch
        preShutdownDatabaseStoreId=[string]$health.database.storeId; portsReleased=$true; ownershipMarkerReleased=$true
    }
    [IO.File]::WriteAllText($evidencePath, (($evidence | ConvertTo-Json -Depth 6) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    $evidenceHash = (Get-FileHash -LiteralPath $evidencePath -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-MaintenanceAudit 'BACKUP_VERIFIED_STOPPED_RUNTIME_EVIDENCE_CREATED' @{ requestId=[string]$completedRequest.id; backupId=[string]$completedRequest.backupId; evidenceSha256=$evidenceHash }

    & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $activationScript -ExpectedSha $ExpectedSha -RepositoryRoot $projectRoot -AllowReviewedNonUiPaths -ManagerAuthorizedRestart -StoppedRuntimeEvidencePath $evidencePath -StoppedRuntimeEvidenceSha256 $evidenceHash -MaintenanceAuthorization $ManagerAuthorization
    if ($LASTEXITCODE -ne 0) { throw "REQUESTED_BACKUP_ACTIVATION_FAILED:$LASTEXITCODE" }
    Write-MaintenanceAudit 'ACTIVATION_HEALTH_VERIFIED' @{ backupId=[string]$completedRequest.backupId; evidenceSha256=$evidenceHash }
} catch {
    Write-MaintenanceAudit 'FAILED' @{ error=$_.Exception.Message; runtimeStopped=$stopped; recovery='FAIL_CLOSED_REQUIRES_EXISTING_GUARDED_RECOVERY_REVIEW;NO_AUTOMATIC_RETRY' }
    throw
} finally {
    Remove-Item Env:\ANDALUCIA_CONFIRM_LIVE_STORE_EXCLUSIVE -ErrorAction SilentlyContinue
}
