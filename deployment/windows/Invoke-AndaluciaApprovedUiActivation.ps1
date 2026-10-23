[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExpectedSha,
    [string]$RepositoryRoot,
    [switch]$AllowReviewedNonUiPaths,
    [switch]$ManagerAuthorizedRestart
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = if ($RepositoryRoot) { [IO.Path]::GetFullPath($RepositoryRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')) }
$preflightScript = Join-Path $PSScriptRoot 'Test-AndaluciaGuardedUiActivation.ps1'
$stopScript = Join-Path $projectRoot 'deployment\windows\Stop-AndaluciaGuardedApplication.ps1'
$runtimeTaskName = 'ANDALUCIA OPERATION - Guarded Application'
$canonicalMarker = Join-Path $projectRoot '.data\postgres\postmaster.pid'

$preflightArguments = @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',$preflightScript,'-ExpectedSha',$ExpectedSha,'-RepositoryRoot',$projectRoot)
if ($AllowReviewedNonUiPaths) { $preflightArguments += '-AllowReviewedNonUiPaths' }
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

& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $stopScript
if ($LASTEXITCODE -ne 0) { throw "GUARDED_STOP_FAILED:$LASTEXITCODE" }

$released = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $activePorts = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 3001,5173,5174 })
    if ($activePorts.Count -eq 0 -and -not (Test-Path -LiteralPath $canonicalMarker)) { $released = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $released) { throw 'GUARDED_SHUTDOWN_RELEASE_NOT_VERIFIED; marker and processes were left untouched.' }

Start-ScheduledTask -TaskName $runtimeTaskName
$healthy = $null
for ($attempt = 0; $attempt -lt 90; $attempt++) {
    try {
        $candidate = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -Method Get -TimeoutSec 3
        if ($candidate.ok -and $candidate.application.sha -eq $preflight.targetSha -and $candidate.application.branch -eq 'main' -and $candidate.database.status -eq 'HEALTHY' -and $candidate.database.migrationVersion -eq '027' -and -not $candidate.database.migrationRequired -and -not $candidate.database.recoveryRequired) { $healthy = $candidate; break }
    } catch {}
    Start-Sleep -Seconds 1
}
if (-not $healthy) { throw 'GUARDED_START_HEALTH_VERIFICATION_FAILED; no retry or marker cleanup was attempted.' }

[ordered]@{
    status = 'HEALTH_VERIFIED'
    targetSha = [string]$healthy.application.sha
    runtimeSha = [string]$healthy.application.sha
    schema = [string]$healthy.database.migrationVersion
    database = [string]$healthy.database.status
    browserVerificationRequired = $true
    restartPerformed = $true
} | ConvertTo-Json -Compress
