[CmdletBinding()]
param(
  [string]$RepositoryRoot,
  [string]$StartupLogPath,
  [switch]$NoLiveProbe
)

$ErrorActionPreference = 'Stop'
$projectRoot = if ($RepositoryRoot) { [IO.Path]::GetFullPath($RepositoryRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')) }
$startupLog = if ($StartupLogPath) { [IO.Path]::GetFullPath($StartupLogPath) } else { Join-Path $projectRoot '.runtime\logs\guarded-startup.jsonl' }
$canonicalRoot = Join-Path $projectRoot '.data\postgres'
$markerPath = Join-Path $canonicalRoot 'postmaster.pid'
$identityPath = Join-Path $projectRoot '.data\andalucia-store-identity.json'
$taskName = 'ANDALUCIA OPERATION - Guarded Application'

function Get-Endpoint([string]$Uri, [switch]$Json) {
  try {
    if ($Json) { return [ordered]@{ status='HEALTHY'; response=(Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 3) } }
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 3
    return [ordered]@{ status=if ($response.StatusCode -eq 200) { 'HEALTHY' } else { 'UNHEALTHY' }; httpStatus=[int]$response.StatusCode }
  } catch { return [ordered]@{ status='UNAVAILABLE'; error=$_.Exception.Message } }
}

function Get-StartupFailure([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  $records = @(Get-Content -LiteralPath $Path -Tail 250 -ErrorAction SilentlyContinue | ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } | Where-Object { $_ })
  $start = -1
  for ($index = 0; $index -lt $records.Count; $index++) { if ($records[$index].state -eq 'STARTING') { $start = $index } }
  if ($start -lt 0) { return $null }
  $attempt = @($records[$start..($records.Count - 1)])
  $failure = $attempt | Where-Object { $_.state -eq 'FAILED' } | Select-Object -First 1
  if ($failure) { return [ordered]@{ recordedAt=[string]$failure.recordedAt; cause=[string]$failure.detail } }
  $exit = $attempt | Where-Object { $_.state -eq 'EXITED' -and [string]$_.detail -notmatch 'exitCode=0(?:;|$)' } | Select-Object -First 1
  if ($exit) { return [ordered]@{ recordedAt=[string]$exit.recordedAt; cause=[string]$exit.detail } }
  return $null
}

$sourceSha = (& git -C $projectRoot rev-parse HEAD 2>$null)
$sourceBranch = (& git -C $projectRoot branch --show-current 2>$null)
$identity = if (Test-Path -LiteralPath $identityPath -PathType Leaf) { Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json } else { $null }
$frontend = [ordered]@{ status='NOT_CHECKED' }
$backend = [ordered]@{ status='NOT_CHECKED' }
$scheduler = [ordered]@{ status='NOT_CHECKED' }

if (-not $NoLiveProbe) {
  $frontend = Get-Endpoint 'http://127.0.0.1:5173/'
  $backend = Get-Endpoint 'http://127.0.0.1:3001/api/health' -Json
  try {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
    $scheduler = [ordered]@{ status=[string]$task.State; lastRunTime=$info.LastRunTime.ToUniversalTime().ToString('o'); lastTaskResult=[int]$info.LastTaskResult }
  } catch { $scheduler = [ordered]@{ status='UNAVAILABLE'; error=$_.Exception.Message } }
}

$dbOwnership = if (-not (Test-Path -LiteralPath $markerPath)) { 'RELEASED' } elseif ($backend.status -eq 'HEALTHY') { 'ACTIVE' } elseif ($NoLiveProbe) { 'MARKER_PRESENT_UNVERIFIED' } else {
  $inspector = Join-Path $projectRoot 'deployment\windows\Test-AndaluciaDb3StaleMarkerOwnership.ps1'
  try { [string]((& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $inspector -MarkerPath $markerPath -CanonicalRoot $canonicalRoot -InspectorProcessId $PID | ConvertFrom-Json).ownershipState) } catch { 'UNVERIFIED' }
}

$health = if ($backend.status -eq 'HEALTHY') { $backend.response } else { $null }
[ordered]@{
  version='andalucia-startup-diagnostic-v1'
  frontend=$frontend
  backend=if ($health) { [ordered]@{ status='HEALTHY'; application=$health.application; database=$health.database } } else { $backend }
  scheduler=$scheduler
  database=[ordered]@{ ownership=$dbOwnership; canonicalStoreId=if ($identity) { [string]$identity.storeId } else { $null }; schema=if ($health) { [string]$health.database.migrationVersion } else { $null } }
  source=[ordered]@{ sha=([string]$sourceSha).Trim(); branch=([string]$sourceBranch).Trim() }
  firstFatalError=Get-StartupFailure $startupLog
} | ConvertTo-Json -Depth 8
