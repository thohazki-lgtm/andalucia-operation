[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ExpectedSha,
    [string]$RepositoryRoot,
    [string]$StoppedRuntimeRecoveryAuthorizationId
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = if ($RepositoryRoot) { [IO.Path]::GetFullPath($RepositoryRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')) }
$canonicalData = [IO.Path]::GetFullPath((Join-Path $projectRoot '.data\postgres'))
$evidenceRoot = Join-Path $projectRoot '.runtime\maintenance-evidence'
$auditPath = Join-Path $evidenceRoot 'audit.jsonl'
$stopScript = Join-Path $PSScriptRoot 'Stop-AndaluciaGuardedApplication.ps1'
$preflightScript = Join-Path $PSScriptRoot 'Test-AndaluciaGuardedUiActivation.ps1'
$activationScript = Join-Path $PSScriptRoot 'Invoke-AndaluciaApprovedUiActivation.ps1'
$startScript = Join-Path $PSScriptRoot 'Start-AndaluciaGuardedApplication.ps1'
$controlScript = Join-Path $projectRoot 'server\requested-backup-activation-control.ts'
$tsxCommand = Join-Path $projectRoot 'node_modules\.bin\tsx.cmd'
$schedulerLock = Join-Path $projectRoot '.backups\.db2\scheduler\job.lock'
$markerPath = Join-Path $canonicalData 'postmaster.pid'
$authorizationId = $null
$stopped = $false

function Write-MaintenanceAudit([string]$State, [hashtable]$Details = @{}) {
    New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
    $record = [ordered]@{ version='andalucia-requested-backup-activation-audit-v2'; recordedAt=[DateTime]::UtcNow.ToString('o'); state=$State; targetSha=$ExpectedSha; authorizationId=$authorizationId; details=$Details }
    Add-Content -LiteralPath $auditPath -Value ($record | ConvertTo-Json -Compress) -Encoding UTF8
}

function Invoke-Control([string]$Command, [string[]]$ExtraArguments = @()) {
    $arguments = @($controlScript,$Command,'--project-root',$projectRoot)
    if ($authorizationId) { $arguments += @('--authorization-id',$authorizationId) }
    $arguments += $ExtraArguments
    $output = & $tsxCommand @arguments
    if ($LASTEXITCODE -ne 0) { throw "REQUESTED_BACKUP_CONTROL_FAILED:$Command`:$($output -join [Environment]::NewLine)" }
    return (($output -join [Environment]::NewLine) | ConvertFrom-Json)
}

function Invoke-GuardedPreviousRuntimeRecovery([string]$Failure) {
    $record = Invoke-Control 'inspect'
    if ($record.state -eq 'AUTHORIZED') { [void](Invoke-Control 'backup-failed' @('--failure',$Failure)); $record = Invoke-Control 'inspect' }
    if ($record.state -eq 'TARGET_CLAIMED') { [void](Invoke-Control 'target-failed' @('--failure',$Failure)); $record = Invoke-Control 'inspect' }
    if ($record.state -notin @('RECOVERY_AUTHORIZED','BACKUP_FAILED','TARGET_FAILED')) { throw "REQUESTED_BACKUP_RECOVERY_STATE_INVALID:$($record.state)" }
    $recovery = Invoke-Control 'claim-recovery'
    $recoveryRoot = Join-Path $projectRoot ".runtime\recovery-source\$authorizationId"
    if (Test-Path -LiteralPath $recoveryRoot) { throw 'REQUESTED_BACKUP_RECOVERY_SOURCE_ALREADY_EXISTS' }
    New-Item -ItemType Directory -Path (Split-Path $recoveryRoot -Parent) -Force | Out-Null
    & git -C $projectRoot worktree add --detach $recoveryRoot ([string]$recovery.previousLiveSha) | Out-Null
    if ($LASTEXITCODE -ne 0) { [void](Invoke-Control 'recovery-failed' @('--failure','RECOVERY_SOURCE_PREPARATION_FAILED')); throw 'REQUESTED_BACKUP_RECOVERY_SOURCE_PREPARATION_FAILED' }
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',$startScript,'-SourceRoot',$recoveryRoot,'-CanonicalProjectRoot',$projectRoot,'-RecoveryAuthorizationId',$authorizationId) -WindowStyle Hidden -PassThru
    $healthy = $null
    $frontendHealthy = $false
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        try {
            $candidate = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -Method Get -TimeoutSec 3
            $frontend = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -Method Get -TimeoutSec 3 -UseBasicParsing
            $frontendHealthy = $frontend.StatusCode -eq 200
            if ($frontendHealthy -and $candidate.ok -and $candidate.application.sha -eq $recovery.previousLiveSha -and $candidate.database.status -eq 'HEALTHY' -and $candidate.database.migrationVersion -eq '027' -and -not $candidate.database.migrationRequired -and -not $candidate.database.recoveryRequired) { $healthy = $candidate; break }
        } catch {}
        if ($process.HasExited) { break }
        Start-Sleep -Seconds 1
    }
    if (-not $healthy) { [void](Invoke-Control 'recovery-failed' @('--failure','RECOVERY_HEALTH_VERIFICATION_FAILED')); throw 'REQUESTED_BACKUP_RECOVERY_HEALTH_VERIFICATION_FAILED' }
    [void](Invoke-Control 'recovery-healthy')
    Write-MaintenanceAudit 'PREVIOUS_RUNTIME_RECOVERY_HEALTH_VERIFIED' @{ previousLiveSha=[string]$recovery.previousLiveSha; originalFailure=$Failure; frontendHealthy=$frontendHealthy; backendHealthy=$true; databaseHealthy=$true }
}

try {
    foreach ($requiredPath in @($controlScript,$tsxCommand,$startScript)) { if (-not (Test-Path -LiteralPath $requiredPath)) { throw "REQUESTED_BACKUP_REQUIRED_CONTROL_MISSING:$requiredPath" } }
    if (@(& git -C $projectRoot status --porcelain --untracked-files=no).Count -gt 0) { throw 'REQUESTED_BACKUP_SOURCE_DIRTY' }
    if (Test-Path -LiteralPath $schedulerLock) { throw 'REQUESTED_BACKUP_SCHEDULER_BUSY' }
    foreach ($operationMarker in @('migration-in-progress','recovery-in-progress')) { if (Test-Path -LiteralPath (Join-Path (Split-Path $canonicalData -Parent) $operationMarker)) { throw "REQUESTED_BACKUP_OPERATION_BLOCKED:$operationMarker" } }

    if ($StoppedRuntimeRecoveryAuthorizationId) {
        $authorizationId = $StoppedRuntimeRecoveryAuthorizationId
        $recoveryRecord = Invoke-Control 'inspect'
        if ($recoveryRecord.state -ne 'RECOVERY_AUTHORIZED' -or $recoveryRecord.authorizationMode -ne 'stopped_runtime_recovery' -or $recoveryRecord.targetSha -ne $ExpectedSha.ToLowerInvariant()) { throw 'REQUESTED_BACKUP_STOPPED_RECOVERY_AUTHORIZATION_INVALID' }
        Write-MaintenanceAudit 'STOPPED_RUNTIME_RECOVERY_AUTHORIZATION_ACCEPTED' @{ previousLiveSha=[string]$recoveryRecord.previousLiveSha; requestId=[string]$recoveryRecord.requestId }
        Invoke-GuardedPreviousRuntimeRecovery -Failure 'AUTHORIZED_STOPPED_RUNTIME_RECOVERY'
        return
    }

    $prepared = Invoke-Control 'prepare' @('--expected-sha',$ExpectedSha)
    $authorizationId = [string]$prepared.authorizationId
    if (-not $authorizationId) { throw 'REQUESTED_BACKUP_AUTHORIZATION_ID_MISSING' }
    $source = $prepared

    $preflightOutput = & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $preflightScript -ExpectedSha $ExpectedSha -RepositoryRoot $projectRoot -AllowReviewedNonUiPaths -AllowApprovedLocalCheckpoint
    $preflightText = $preflightOutput -join [Environment]::NewLine
    $preflight = $preflightText | ConvertFrom-Json
    if ($LASTEXITCODE -eq 0 -or [string]$preflight.blocker -notmatch '^VERIFIED_BACKUP_TOO_OLD:') { throw "REQUESTED_BACKUP_PRE_SHUTDOWN_PREFLIGHT_NOT_EXCLUSIVELY_BACKUP_BLOCKED:$preflightText" }

    Write-MaintenanceAudit 'PRE_SHUTDOWN_VERIFIED' @{ previousLiveSha=[string]$source.previousLiveSha; requestId=[string]$source.requestId; schema='027' }
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

    $bound = Invoke-Control 'bind-backup'
    Write-MaintenanceAudit 'BACKUP_VERIFIED_AND_JOURNAL_BOUND' @{ requestId=[string]$bound.requestId; backupId=[string]$bound.backupId }

    & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $activationScript -ExpectedSha $ExpectedSha -RepositoryRoot $projectRoot -AllowReviewedNonUiPaths -ManagerAuthorizedRestart -MaintenanceAuthorizationId $authorizationId
    if ($LASTEXITCODE -ne 0) { throw "REQUESTED_BACKUP_ACTIVATION_FAILED:$LASTEXITCODE" }
    Write-MaintenanceAudit 'ACTIVATION_HEALTH_VERIFIED' @{ backupId=[string]$bound.backupId }
} catch {
    $failure = $_.Exception.Message
    Write-MaintenanceAudit 'FAILED' @{ error=$failure; runtimeStopped=$stopped; recovery='GUARDED_PREVIOUS_SHA_ONLY' }
    if ($stopped -and $authorizationId) { Invoke-GuardedPreviousRuntimeRecovery -Failure $failure }
    throw
} finally {
    Remove-Item Env:\ANDALUCIA_CONFIRM_LIVE_STORE_EXCLUSIVE -ErrorAction SilentlyContinue
}
