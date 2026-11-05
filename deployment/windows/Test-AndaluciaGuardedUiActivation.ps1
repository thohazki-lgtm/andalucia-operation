[CmdletBinding()]
param(
    [string]$ExpectedSha,
    [string]$RepositoryRoot,
    [int]$MaximumBackupAgeHours = 24,
    [switch]$AllowReviewedNonUiPaths,
    [switch]$AllowApprovedLocalCheckpoint,
    [string]$StoppedRuntimeEvidencePath,
    [string]$StoppedRuntimeEvidenceSha256,
    [string]$MaintenanceAuthorization
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Stop-Readiness {
    param([string]$Code, [string]$Detail)
    throw "$Code`:$Detail"
}

try {
    $scriptProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
    $projectRoot = if ($RepositoryRoot) { [IO.Path]::GetFullPath($RepositoryRoot) } else { $scriptProjectRoot }
    $canonicalData = [IO.Path]::GetFullPath((Join-Path $projectRoot '.data\postgres'))
    $identityPath = Join-Path (Split-Path $canonicalData -Parent) 'andalucia-store-identity.json'
    $runtimeTaskName = 'ANDALUCIA OPERATION - Guarded Application'
    $approvalManifestPath = Join-Path $projectRoot '.runtime\andalucia-local-ui-approval.json'
    $stoppedRuntimeMode = [bool]$StoppedRuntimeEvidencePath

    $gitRoot = (& git -C $projectRoot rev-parse --show-toplevel 2>$null).Trim()
    if (-not $gitRoot -or [IO.Path]::GetFullPath($gitRoot) -ne $projectRoot) { Stop-Readiness 'SOURCE_NOT_AUTHORITATIVE' $projectRoot }
    $branch = (& git -C $projectRoot branch --show-current 2>$null).Trim()
    $approvedSource = $null
    $trackedChanges = @(& git -C $projectRoot status --porcelain --untracked-files=no)
    if ($trackedChanges.Count -gt 0) { Stop-Readiness 'SOURCE_TRACKED_CHANGES_PRESENT' ($trackedChanges -join '; ') }
    $headSha = (& git -C $projectRoot rev-parse HEAD 2>$null).Trim()
    $originSha = (& git -C $projectRoot rev-parse refs/remotes/origin/main 2>$null).Trim()
    if ($branch -ne 'main') {
        if (-not $AllowApprovedLocalCheckpoint) { Stop-Readiness 'SOURCE_BRANCH_NOT_MAIN' $branch }
        $resolverPath = Join-Path $projectRoot 'deployment\windows\Resolve-AndaluciaApprovedSource.ps1'
        if (-not (Test-Path -LiteralPath $resolverPath -PathType Leaf)) { Stop-Readiness 'APPROVED_SOURCE_RESOLVER_MISSING' $resolverPath }
        . $resolverPath
        try { $approvedSource = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot } catch { Stop-Readiness 'APPROVED_LOCAL_SOURCE_INVALID' $_.Exception.Message }
        if ($approvedSource.Mode -notin @('approved_local_reviewed_ui_checkpoint', 'approved_local_reviewed_backend_checkpoint') -or $approvedSource.Sha -ne $headSha) { Stop-Readiness 'APPROVED_LOCAL_SOURCE_MODE_MISMATCH' ([string]$approvedSource.Mode) }
    }
    if (-not $ExpectedSha) { $ExpectedSha = if ($branch -eq 'main') { $originSha } else { $headSha } }
    $expectedFullSha = (& git -C $projectRoot rev-parse $ExpectedSha 2>$null).Trim()
    if (-not $headSha -or $headSha -ne $expectedFullSha -or ($branch -eq 'main' -and $headSha -ne $originSha)) { Stop-Readiness 'SOURCE_SHA_MISMATCH' "head=$headSha origin=$originSha expected=$expectedFullSha" }

    if (-not (Test-Path -LiteralPath (Join-Path $canonicalData 'PG_VERSION') -PathType Leaf)) { Stop-Readiness 'CANONICAL_STORE_MISSING' $canonicalData }
    if (-not (Test-Path -LiteralPath $identityPath -PathType Leaf)) { Stop-Readiness 'CANONICAL_IDENTITY_MISSING' $identityPath }
    $identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
    if ($identity.role -ne 'canonical' -or [IO.Path]::GetFullPath([string]$identity.databaseDirectory) -ne $canonicalData) { Stop-Readiness 'CANONICAL_IDENTITY_MISMATCH' ([string]$identity.storeId) }

    $health = $null
    $evidence = $null
    if ($stoppedRuntimeMode) {
        if ($MaintenanceAuthorization -ne 'YES_I_APPROVE_ONE_GUARDED_REQUESTED_BACKUP_ACTIVATION_WINDOW') { Stop-Readiness 'STOPPED_RUNTIME_MAINTENANCE_AUTHORIZATION_REQUIRED' 'Explicit one-time maintenance authorization is required.' }
        if (-not $StoppedRuntimeEvidenceSha256) { Stop-Readiness 'STOPPED_RUNTIME_EVIDENCE_HASH_REQUIRED' 'A caller-held evidence hash is required.' }
        $evidenceRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '.runtime\maintenance-evidence'))
        $resolvedEvidencePath = [IO.Path]::GetFullPath($StoppedRuntimeEvidencePath)
        if (-not $resolvedEvidencePath.StartsWith($evidenceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $resolvedEvidencePath -PathType Leaf)) { Stop-Readiness 'STOPPED_RUNTIME_EVIDENCE_PATH_INVALID' $resolvedEvidencePath }
        if (Test-Path -LiteralPath "$resolvedEvidencePath.consumed.json") { Stop-Readiness 'STOPPED_RUNTIME_EVIDENCE_ALREADY_CONSUMED' $resolvedEvidencePath }
        $actualEvidenceHash = (Get-FileHash -LiteralPath $resolvedEvidencePath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualEvidenceHash -ne $StoppedRuntimeEvidenceSha256.ToLowerInvariant()) { Stop-Readiness 'STOPPED_RUNTIME_EVIDENCE_HASH_MISMATCH' $actualEvidenceHash }
        try { $evidence = Get-Content -LiteralPath $resolvedEvidencePath -Raw | ConvertFrom-Json } catch { Stop-Readiness 'STOPPED_RUNTIME_EVIDENCE_INVALID' $_.Exception.Message }
        if ($evidence.version -ne 'andalucia-stopped-runtime-evidence-v1') { Stop-Readiness 'STOPPED_RUNTIME_EVIDENCE_VERSION_INVALID' ([string]$evidence.version) }
        $issuedAt = [DateTime]::Parse([string]$evidence.issuedAt).ToUniversalTime()
        $expiresAt = [DateTime]::Parse([string]$evidence.expiresAt).ToUniversalTime()
        $healthCapturedAt = [DateTime]::Parse([string]$evidence.preShutdownHealthCapturedAt).ToUniversalTime()
        $now = [DateTime]::UtcNow
        if ($issuedAt -gt $now.AddMinutes(1) -or $issuedAt -lt $now.AddMinutes(-10) -or $expiresAt -le $now -or $expiresAt -gt $issuedAt.AddMinutes(10)) { Stop-Readiness 'STOPPED_RUNTIME_EVIDENCE_EXPIRED' "issued=$issuedAt expires=$expiresAt" }
        if ($healthCapturedAt -gt $issuedAt -or $healthCapturedAt -lt $issuedAt.AddMinutes(-60)) { Stop-Readiness 'STOPPED_RUNTIME_PRE_SHUTDOWN_HEALTH_STALE' "captured=$healthCapturedAt issued=$issuedAt" }
        if ([string]$evidence.authorization -ne $MaintenanceAuthorization) { Stop-Readiness 'STOPPED_RUNTIME_EVIDENCE_AUTHORIZATION_MISMATCH' 'Maintenance authorization is not bound to the evidence.' }
        if ([string]$evidence.targetSha -ne $headSha -or [string]$evidence.targetSha -ne $expectedFullSha -or [string]$evidence.branch -ne $branch) { Stop-Readiness 'STOPPED_RUNTIME_EVIDENCE_TARGET_MISMATCH' ([string]$evidence.targetSha) }
        if ([string]$evidence.schema -ne '027' -or [string]$evidence.databaseStatus -ne 'HEALTHY' -or [bool]$evidence.migrationRequired -or [bool]$evidence.recoveryRequired) { Stop-Readiness 'STOPPED_RUNTIME_EVIDENCE_DATABASE_INVALID' ($evidence | ConvertTo-Json -Compress) }
        $approvalHash = (Get-FileHash -LiteralPath $approvalManifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
        $identityHash = (Get-FileHash -LiteralPath $identityPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ([string]$evidence.approvalManifestSha256 -ne $approvalHash -or [string]$evidence.canonicalIdentitySha256 -ne $identityHash -or [string]$evidence.canonicalStoreId -ne [string]$identity.storeId) { Stop-Readiness 'STOPPED_RUNTIME_EVIDENCE_BINDING_MISMATCH' 'Approval or canonical identity changed after shutdown.' }
        if (-not $approvedSource -or [string]$approvedSource.PreviousLiveSha -ne [string]$evidence.previousLiveSha) { Stop-Readiness 'STOPPED_RUNTIME_EVIDENCE_PREVIOUS_LIVE_MISMATCH' ([string]$evidence.previousLiveSha) }
        if ([string]$evidence.preShutdownDatabaseStoreId -ne [string]$identity.storeId -or -not [string]$evidence.preShutdownRuntimeBranch) { Stop-Readiness 'STOPPED_RUNTIME_PRE_SHUTDOWN_HEALTH_BINDING_INVALID' 'Runtime branch or database store identity was not captured.' }
        $requestId = [string]$evidence.requestId
        if (-not $requestId -or [IO.Path]::GetFileName($requestId) -ne $requestId) { Stop-Readiness 'STOPPED_RUNTIME_EVIDENCE_REQUEST_INVALID' $requestId }
        $requestPath = Join-Path $projectRoot ".backups\.db2\requests\$requestId.json"
        if (-not (Test-Path -LiteralPath $requestPath -PathType Leaf)) { Stop-Readiness 'STOPPED_RUNTIME_EVIDENCE_REQUEST_MISSING' $requestPath }
        try { $request = Get-Content -LiteralPath $requestPath -Raw | ConvertFrom-Json } catch { Stop-Readiness 'STOPPED_RUNTIME_EVIDENCE_REQUEST_INVALID' $_.Exception.Message }
        if ($request.state -ne 'completed' -or $request.category -ne 'manual' -or -not [string]$request.requestedBy.userId -or [string]$request.backupId -ne [string]$evidence.backupId) { Stop-Readiness 'STOPPED_RUNTIME_EVIDENCE_REQUEST_BINDING_MISMATCH' ($request | ConvertTo-Json -Compress) }
        $runtimeSha = [string]$evidence.previousLiveSha
    } else {
        try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -Method Get -TimeoutSec 5 } catch { Stop-Readiness 'RUNTIME_HEALTH_UNAVAILABLE' $_.Exception.Message }
        if (-not $health.ok -or $health.database.status -ne 'HEALTHY') { Stop-Readiness 'DATABASE_NOT_HEALTHY' ([string]$health.database.status) }
        if ($health.database.migrationVersion -ne '027' -or $health.database.migrationRequired -or $health.database.recoveryRequired) { Stop-Readiness 'SCHEMA_GATE_FAILED' ($health.database | ConvertTo-Json -Compress) }
        $runtimeSha = [string]$health.application.sha
        if (-not $runtimeSha) { Stop-Readiness 'RUNTIME_SHA_MISSING' 'The health response did not identify its source.' }
    }
    & git -C $projectRoot merge-base --is-ancestor $runtimeSha $headSha 2>$null
    if ($LASTEXITCODE -ne 0) { Stop-Readiness 'RUNTIME_NOT_ANCESTOR_OF_TARGET' "runtime=$runtimeSha target=$headSha" }

    $changedFiles = @(& git -C $projectRoot diff --name-only "$runtimeSha..$headSha")
    $uiSafePattern = '^(src/|public/|docs/|AGENTS\.md$|server/[^/]*(browser|responsive|ui|interface)[^/]*\.test\.(ts|tsx|mjs)$)'
    $reviewedNonUiFiles = @($changedFiles | Where-Object { $_ -notmatch $uiSafePattern })
    if ($reviewedNonUiFiles.Count -gt 0 -and -not $AllowReviewedNonUiPaths) { Stop-Readiness 'NON_UI_REVIEW_REQUIRED' ($reviewedNonUiFiles -join ', ') }

    $runtimeTask = Get-ScheduledTask -TaskName $runtimeTaskName -ErrorAction SilentlyContinue
    if (-not $runtimeTask) { Stop-Readiness 'RUNTIME_TASK_MISSING' $runtimeTaskName }
    [xml]$taskDefinition = Export-ScheduledTask -TaskName $runtimeTaskName
    $taskNamespace = [Xml.XmlNamespaceManager]::new($taskDefinition.NameTable)
    $taskNamespace.AddNamespace('t', 'http://schemas.microsoft.com/windows/2004/02/mit/task')
    $taskCommand = $taskDefinition.SelectSingleNode('//t:Actions/t:Exec/t:Command', $taskNamespace).InnerText
    $taskArguments = $taskDefinition.SelectSingleNode('//t:Actions/t:Exec/t:Arguments', $taskNamespace).InnerText
    $taskWorkingDirectory = $taskDefinition.SelectSingleNode('//t:Actions/t:Exec/t:WorkingDirectory', $taskNamespace).InnerText
    $allowHardTerminate = $taskDefinition.SelectSingleNode('//t:Settings/t:AllowHardTerminate', $taskNamespace).InnerText
    $stopOnIdleEnd = $taskDefinition.SelectSingleNode('//t:Settings/t:IdleSettings/t:StopOnIdleEnd', $taskNamespace).InnerText
    $executionTimeLimit = $taskDefinition.SelectSingleNode('//t:Settings/t:ExecutionTimeLimit', $taskNamespace).InnerText
    $expectedLauncher = [IO.Path]::GetFullPath((Join-Path $projectRoot 'deployment\windows\Start-AndaluciaGuardedApplication.ps1'))
    if ([IO.Path]::GetFullPath($taskWorkingDirectory) -ne $projectRoot -or $taskArguments -notlike "*$expectedLauncher*" -or $taskCommand -notlike '*\WindowsPowerShell\v1.0\powershell.exe') { Stop-Readiness 'RUNTIME_TASK_ACTION_DRIFT' "$taskCommand $taskArguments $taskWorkingDirectory" }
    if ($allowHardTerminate -ne 'false' -or $stopOnIdleEnd -ne 'false' -or $executionTimeLimit -ne 'PT0S') { Stop-Readiness 'RUNTIME_TASK_SAFETY_DRIFT' "AllowHardTerminate=$allowHardTerminate StopOnIdleEnd=$stopOnIdleEnd ExecutionTimeLimit=$executionTimeLimit" }

    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 3001, 5173, 5174 })
    $markerPath = Join-Path $canonicalData 'postmaster.pid'
    if ($stoppedRuntimeMode) {
        if ($listeners.Count -ne 0 -or (Test-Path -LiteralPath $markerPath)) { Stop-Readiness 'STOPPED_RUNTIME_EXCLUSIVITY_NOT_VERIFIED' (($listeners | Select-Object LocalPort,OwningProcess | ConvertTo-Json -Compress)) }
        if (-not [bool]$evidence.portsReleased -or -not [bool]$evidence.ownershipMarkerReleased) { Stop-Readiness 'STOPPED_RUNTIME_EVIDENCE_RELEASE_INVALID' 'Evidence did not record complete release.' }
    } else {
        if (@($listeners | Where-Object LocalPort -eq 3001).Count -ne 1 -or @($listeners | Where-Object LocalPort -eq 5173).Count -ne 1) { Stop-Readiness 'RUNTIME_LISTENER_AMBIGUOUS' (($listeners | Select-Object LocalPort,OwningProcess | ConvertTo-Json -Compress)) }
        foreach ($listener in $listeners) {
            $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
            if (-not $listenerProcess -or [string]$listenerProcess.CommandLine -notlike "*$projectRoot*") { Stop-Readiness 'RUNTIME_OWNER_MISMATCH' "port=$($listener.LocalPort) pid=$($listener.OwningProcess)" }
        }
        if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { Stop-Readiness 'ACTIVE_RUNTIME_MARKER_MISSING' $markerPath }
    }

    $backupMetadataFiles = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot '.backups') -Filter 'backup-metadata.json' -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    $latestBackup = $null
    $latestRestore = $null
    foreach ($metadataFile in $backupMetadataFiles) {
        try { $candidate = Get-Content -LiteralPath $metadataFile.FullName -Raw | ConvertFrom-Json } catch { continue }
        if ($candidate.verificationStatus -ne 'VERIFIED' -or $candidate.openTestStatus -ne 'PASS' -or $candidate.preflightStatus -ne 'READY') { continue }
        $restorePath = Join-Path $metadataFile.Directory.FullName 'restore-test.json'
        if (-not (Test-Path -LiteralPath $restorePath -PathType Leaf)) { continue }
        try { $restore = Get-Content -LiteralPath $restorePath -Raw | ConvertFrom-Json } catch { continue }
        if ($restore.status -ne 'RESTORE_TEST_PASSED' -or -not $restore.manifestMatch -or -not $restore.fingerprintMatch -or -not $restore.migrationMatch -or $restore.preflightStatus -ne 'READY') { continue }
        $latestBackup = $candidate
        $latestRestore = $restore
        break
    }
    if (-not $latestBackup) { Stop-Readiness 'VERIFIED_BACKUP_REQUIRED' 'No verified and restore-tested backup was found.' }
    if ($stoppedRuntimeMode -and ([string]$evidence.backupId -ne [string]$latestBackup.backupId -or [string]$latestBackup.category -ne 'manual')) { Stop-Readiness 'STOPPED_RUNTIME_EVIDENCE_BACKUP_MISMATCH' "evidence=$($evidence.backupId) latest=$($latestBackup.backupId) category=$($latestBackup.category)" }
    $backupAgeHours = ([DateTime]::UtcNow - [DateTime]::Parse([string]$latestBackup.createdAt).ToUniversalTime()).TotalHours
    if ($backupAgeHours -gt $MaximumBackupAgeHours) { Stop-Readiness 'VERIFIED_BACKUP_TOO_OLD' ([Math]::Round($backupAgeHours, 2).ToString()) }

    [ordered]@{
        status = if ($stoppedRuntimeMode) { 'READY_STOPPED_RUNTIME' } elseif ($runtimeSha -eq $headSha) { 'ALREADY_ACTIVE' } else { 'READY' }
        targetSha = $headSha
        runtimeSha = $runtimeSha
        branch = $branch
        schema = if ($stoppedRuntimeMode) { [string]$evidence.schema } else { [string]$health.database.migrationVersion }
        database = if ($stoppedRuntimeMode) { [string]$evidence.databaseStatus } else { [string]$health.database.status }
        canonicalStoreId = [string]$identity.storeId
        runtimeTaskState = [string]$runtimeTask.State
        backupId = [string]$latestBackup.backupId
        backupAgeHours = [Math]::Round($backupAgeHours, 2)
        restoreStatus = [string]$latestRestore.status
        changedFiles = $changedFiles
        reviewedNonUiFiles = $reviewedNonUiFiles
        reviewedNonUiAuthorizationUsed = [bool]$AllowReviewedNonUiPaths
        mutationPerformed = $false
    } | ConvertTo-Json -Depth 6
} catch {
    [ordered]@{ status='BLOCKED'; blocker=$_.Exception.Message; mutationPerformed=$false } | ConvertTo-Json -Compress
    exit 1
}
