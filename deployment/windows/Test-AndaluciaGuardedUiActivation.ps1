[CmdletBinding()]
param(
    [string]$ExpectedSha,
    [string]$RepositoryRoot,
    [int]$MaximumBackupAgeHours = 24,
    [switch]$AllowReviewedNonUiPaths
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

    $gitRoot = (& git -C $projectRoot rev-parse --show-toplevel 2>$null).Trim()
    if (-not $gitRoot -or [IO.Path]::GetFullPath($gitRoot) -ne $projectRoot) { Stop-Readiness 'SOURCE_NOT_AUTHORITATIVE' $projectRoot }
    $branch = (& git -C $projectRoot branch --show-current 2>$null).Trim()
    if ($branch -ne 'main') { Stop-Readiness 'SOURCE_BRANCH_NOT_MAIN' $branch }
    $trackedChanges = @(& git -C $projectRoot status --porcelain --untracked-files=no)
    if ($trackedChanges.Count -gt 0) { Stop-Readiness 'SOURCE_TRACKED_CHANGES_PRESENT' ($trackedChanges -join '; ') }
    $headSha = (& git -C $projectRoot rev-parse HEAD 2>$null).Trim()
    $originSha = (& git -C $projectRoot rev-parse refs/remotes/origin/main 2>$null).Trim()
    if (-not $ExpectedSha) { $ExpectedSha = $originSha }
    $expectedFullSha = (& git -C $projectRoot rev-parse $ExpectedSha 2>$null).Trim()
    if (-not $headSha -or $headSha -ne $originSha -or $headSha -ne $expectedFullSha) { Stop-Readiness 'SOURCE_SHA_MISMATCH' "head=$headSha origin=$originSha expected=$expectedFullSha" }

    if (-not (Test-Path -LiteralPath (Join-Path $canonicalData 'PG_VERSION') -PathType Leaf)) { Stop-Readiness 'CANONICAL_STORE_MISSING' $canonicalData }
    if (-not (Test-Path -LiteralPath $identityPath -PathType Leaf)) { Stop-Readiness 'CANONICAL_IDENTITY_MISSING' $identityPath }
    $identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
    if ($identity.role -ne 'canonical' -or [IO.Path]::GetFullPath([string]$identity.databaseDirectory) -ne $canonicalData) { Stop-Readiness 'CANONICAL_IDENTITY_MISMATCH' ([string]$identity.storeId) }

    try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -Method Get -TimeoutSec 5 } catch { Stop-Readiness 'RUNTIME_HEALTH_UNAVAILABLE' $_.Exception.Message }
    if (-not $health.ok -or $health.database.status -ne 'HEALTHY') { Stop-Readiness 'DATABASE_NOT_HEALTHY' ([string]$health.database.status) }
    if ($health.database.migrationVersion -ne '027' -or $health.database.migrationRequired -or $health.database.recoveryRequired) { Stop-Readiness 'SCHEMA_GATE_FAILED' ($health.database | ConvertTo-Json -Compress) }
    $runtimeSha = [string]$health.application.sha
    if (-not $runtimeSha) { Stop-Readiness 'RUNTIME_SHA_MISSING' 'The health response did not identify its source.' }
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

    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 3001, 5173 })
    if (@($listeners | Where-Object LocalPort -eq 3001).Count -ne 1 -or @($listeners | Where-Object LocalPort -eq 5173).Count -ne 1) { Stop-Readiness 'RUNTIME_LISTENER_AMBIGUOUS' (($listeners | Select-Object LocalPort,OwningProcess | ConvertTo-Json -Compress)) }
    foreach ($listener in $listeners) {
        $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
        if (-not $listenerProcess -or [string]$listenerProcess.CommandLine -notlike "*$projectRoot*") { Stop-Readiness 'RUNTIME_OWNER_MISMATCH' "port=$($listener.LocalPort) pid=$($listener.OwningProcess)" }
    }
    $markerPath = Join-Path $canonicalData 'postmaster.pid'
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { Stop-Readiness 'ACTIVE_RUNTIME_MARKER_MISSING' $markerPath }

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
    $backupAgeHours = ([DateTime]::UtcNow - [DateTime]::Parse([string]$latestBackup.createdAt).ToUniversalTime()).TotalHours
    if ($backupAgeHours -gt $MaximumBackupAgeHours) { Stop-Readiness 'VERIFIED_BACKUP_TOO_OLD' ([Math]::Round($backupAgeHours, 2).ToString()) }

    [ordered]@{
        status = if ($runtimeSha -eq $headSha) { 'ALREADY_ACTIVE' } else { 'READY' }
        targetSha = $headSha
        runtimeSha = $runtimeSha
        branch = $branch
        schema = [string]$health.database.migrationVersion
        database = [string]$health.database.status
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
