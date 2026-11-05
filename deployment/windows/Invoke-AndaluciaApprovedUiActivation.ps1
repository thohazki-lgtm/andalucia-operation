[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExpectedSha,
    [string]$RepositoryRoot,
    [switch]$AllowReviewedNonUiPaths,
    [switch]$ManagerAuthorizedRestart,
    [string]$MaintenanceAuthorizationId
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = if ($RepositoryRoot) { [IO.Path]::GetFullPath($RepositoryRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')) }
$preflightScript = Join-Path $PSScriptRoot 'Test-AndaluciaGuardedUiActivation.ps1'
$stopScript = Join-Path $projectRoot 'deployment\windows\Stop-AndaluciaGuardedApplication.ps1'
$runtimeTaskName = 'ANDALUCIA OPERATION - Guarded Application'
$canonicalMarker = Join-Path $projectRoot '.data\postgres\postmaster.pid'
$controlScript = Join-Path $projectRoot 'server\requested-backup-activation-control.ts'
$tsxCommand = Join-Path $projectRoot 'node_modules\.bin\tsx.cmd'

$resolverPath = Join-Path $projectRoot 'deployment\windows\Resolve-AndaluciaApprovedSource.ps1'
if (-not (Test-Path -LiteralPath $resolverPath -PathType Leaf)) { throw 'APPROVED_SOURCE_RESOLVER_MISSING' }
. $resolverPath
$approvedSource = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot
$isApprovedLocalCheckpoint = $approvedSource.Mode -in @('approved_local_reviewed_ui_checkpoint', 'approved_local_reviewed_backend_checkpoint')
if ($approvedSource.Sha -ne $ExpectedSha) { throw "APPROVED_SOURCE_SHA_MISMATCH:$($approvedSource.Sha):$ExpectedSha" }

$preflightArguments = @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',$preflightScript,'-ExpectedSha',$ExpectedSha,'-RepositoryRoot',$projectRoot)
if ($AllowReviewedNonUiPaths -or $isApprovedLocalCheckpoint) { $preflightArguments += '-AllowReviewedNonUiPaths' }
if ($isApprovedLocalCheckpoint) { $preflightArguments += '-AllowApprovedLocalCheckpoint' }
if ($MaintenanceAuthorizationId) {
    $preflightArguments += @('-MaintenanceAuthorizationId',$MaintenanceAuthorizationId)
}
$preflightOutput = & powershell.exe @preflightArguments
if ($LASTEXITCODE -ne 0) { $preflightOutput; exit $LASTEXITCODE }
$preflight = ($preflightOutput -join [Environment]::NewLine) | ConvertFrom-Json

if ($preflight.status -eq 'ALREADY_ACTIVE') {
    [ordered]@{ status='HEALTH_VERIFIED'; targetSha=$preflight.targetSha; runtimeSha=$preflight.runtimeSha; browserVerificationRequired=$true; restartPerformed=$false } | ConvertTo-Json -Compress
    exit 0
}
if (-not $ManagerAuthorizedRestart) {
    [ordered]@{ status='READY_AWAITING_RESTART_AUTHORIZATION'; targetSha=$preflight.targetSha; runtimeSha=$preflight.runtimeSha; backupId=$preflight.backupId; browserVerificationRequired=$true; restartPerformed=$false } | ConvertTo-Json -Compress
    exit 0
}

if ($preflight.status -ne 'READY_STOPPED_RUNTIME') {
    & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $stopScript
    if ($LASTEXITCODE -ne 0) { throw "GUARDED_STOP_FAILED:$LASTEXITCODE" }
}

$released = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $activePorts = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 3001,5173,5174 })
    if ($activePorts.Count -eq 0 -and -not (Test-Path -LiteralPath $canonicalMarker)) { $released = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $released) { throw 'GUARDED_SHUTDOWN_RELEASE_NOT_VERIFIED; marker and processes were left untouched.' }

if ($preflight.status -eq 'READY_STOPPED_RUNTIME') {
    if (-not $MaintenanceAuthorizationId -or -not (Test-Path -LiteralPath $controlScript -PathType Leaf) -or -not (Test-Path -LiteralPath $tsxCommand -PathType Leaf)) { throw 'STOPPED_RUNTIME_MAINTENANCE_AUTHORIZATION_REQUIRED' }
    $claimOutput = & $tsxCommand $controlScript claim-target --project-root $projectRoot --authorization-id $MaintenanceAuthorizationId
    if ($LASTEXITCODE -ne 0) { throw "STOPPED_RUNTIME_AUTHORIZATION_CLAIM_FAILED:$($claimOutput -join [Environment]::NewLine)" }
}

Start-ScheduledTask -TaskName $runtimeTaskName
$healthy = $null
for ($attempt = 0; $attempt -lt 90; $attempt++) {
    try {
        $candidate = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -Method Get -TimeoutSec 3
        if ($candidate.ok -and $candidate.application.sha -eq $preflight.targetSha -and $candidate.application.branch -eq $preflight.branch -and $candidate.database.status -eq 'HEALTHY' -and $candidate.database.migrationVersion -eq '027' -and -not $candidate.database.migrationRequired -and -not $candidate.database.recoveryRequired) { $healthy = $candidate; break }
    } catch {}
    Start-Sleep -Seconds 1
}
if (-not $healthy) {
    if ($MaintenanceAuthorizationId) { & $tsxCommand $controlScript target-failed --project-root $projectRoot --authorization-id $MaintenanceAuthorizationId --failure 'GUARDED_START_HEALTH_VERIFICATION_FAILED' | Out-Null }
    throw 'GUARDED_START_HEALTH_VERIFICATION_FAILED; guarded recovery authorization is required before any retry.'
}

if ($MaintenanceAuthorizationId) {
    $completeOutput = & $tsxCommand $controlScript target-healthy --project-root $projectRoot --authorization-id $MaintenanceAuthorizationId
    if ($LASTEXITCODE -ne 0) { throw "STOPPED_RUNTIME_AUTHORIZATION_COMPLETION_FAILED:$($completeOutput -join [Environment]::NewLine)" }
}

[ordered]@{
    status = 'HEALTH_VERIFIED'
    targetSha = [string]$healthy.application.sha
    runtimeSha = [string]$healthy.application.sha
    schema = [string]$healthy.database.migrationVersion
    database = [string]$healthy.database.status
    browserVerificationRequired = $true
    restartPerformed = $true
} | ConvertTo-Json -Compress
