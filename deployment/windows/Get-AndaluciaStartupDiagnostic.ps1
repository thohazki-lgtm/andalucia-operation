[CmdletBinding()]
param(
  [string]$RepositoryRoot,
  [string]$RuntimeSourceRoot,
  [string]$StartupLogPath,
  [switch]$NoLiveProbe
)

$ErrorActionPreference = 'Stop'
$projectRoot = if ($RepositoryRoot) { [IO.Path]::GetFullPath($RepositoryRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')) }
$candidateRuntimeRoot = if ($RuntimeSourceRoot) { [IO.Path]::GetFullPath($RuntimeSourceRoot) } else { [IO.Path]::GetFullPath((Join-Path $projectRoot '.runtime\live-main-source')) }
$runtimeRoot = if (Test-Path -LiteralPath $candidateRuntimeRoot -PathType Container) { $candidateRuntimeRoot } else { $projectRoot }
$startupLog = if ($StartupLogPath) { [IO.Path]::GetFullPath($StartupLogPath) } else { Join-Path $projectRoot '.runtime\logs\guarded-startup.jsonl' }
$canonicalData = Join-Path $projectRoot '.data\postgres'
$markerPath = Join-Path $canonicalData 'postmaster.pid'
$identityPath = Join-Path $projectRoot '.data\andalucia-store-identity.json'
$taskName = 'ANDALUCIA OPERATION - Guarded Application'
$serviceName = 'AndaluciaShutdownGuard'

function Get-Endpoint([string]$Uri, [switch]$Json) {
  try {
    if ($Json) { return [ordered]@{ status='HEALTHY'; response=(Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 3) } }
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 3
    return [ordered]@{ status=if ($response.StatusCode -eq 200) { 'HEALTHY' } else { 'UNHEALTHY' }; httpStatus=[int]$response.StatusCode }
  } catch { return [ordered]@{ status='UNAVAILABLE'; error=$_.Exception.Message } }
}

function Get-ListenerOwnership([int]$Port) {
  try {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | ForEach-Object {
      $process = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
      [ordered]@{ address=[string]$_.LocalAddress; processId=[int]$_.OwningProcess; process=if ($process) { [string]$process.ProcessName } else { $null } }
    })
    return [ordered]@{ status=if ($listeners.Count) { 'LISTENING' } else { 'NOT_LISTENING' }; listeners=$listeners }
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

function Get-SourceApproval {
  $resolver = Join-Path $PSScriptRoot 'Resolve-AndaluciaApprovedSource.ps1'
  try {
    if (-not (Test-Path -LiteralPath $resolver -PathType Leaf)) { throw 'ANDALUCIA_RUNTIME_SOURCE_RESOLVER_MISSING' }
    . $resolver
    $state = Get-AndaluciaApprovedSourceState -ProjectRoot $runtimeRoot -CanonicalProjectRoot $projectRoot
    return [ordered]@{ status='APPROVED'; sha=[string]$state.Sha; branch=[string]$state.Branch; mode=[string]$state.Mode; root=$runtimeRoot }
  } catch { return [ordered]@{ status='BLOCKED'; root=$runtimeRoot; error=$_.Exception.Message } }
}

$identity = if (Test-Path -LiteralPath $identityPath -PathType Leaf) { Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json } else { $null }
$frontend = [ordered]@{ status='NOT_CHECKED' }
$backend = [ordered]@{ status='NOT_CHECKED' }
$authentication = [ordered]@{ status='NOT_CHECKED' }
$bindings = [ordered]@{ frontend=[ordered]@{ status='NOT_CHECKED' }; backend=[ordered]@{ status='NOT_CHECKED' } }
$scheduler = [ordered]@{ status='NOT_CHECKED' }
$shutdownService = [ordered]@{ status='NOT_CHECKED' }

if (-not $NoLiveProbe) {
  $frontendIpv4 = Get-Endpoint 'http://127.0.0.1:5173/'
  $frontend = [ordered]@{ status=$frontendIpv4.status; ipv4=$frontendIpv4; ipv6=Get-Endpoint 'http://[::1]:5173/'; localhost=Get-Endpoint 'http://localhost:5173/' }
  $backend = Get-Endpoint 'http://127.0.0.1:3001/api/health' -Json
  $authentication = Get-Endpoint 'http://127.0.0.1:3001/api/auth/bootstrap-status' -Json
  $bindings = [ordered]@{ frontend=Get-ListenerOwnership 5173; backend=Get-ListenerOwnership 3001 }
  try {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
    $scheduler = [ordered]@{ status=[string]$task.State; lastRunTime=$info.LastRunTime.ToUniversalTime().ToString('o'); lastTaskResult=[long]$info.LastTaskResult }
  } catch { $scheduler = [ordered]@{ status='UNAVAILABLE'; error=$_.Exception.Message } }
  try {
    $service = Get-Service -Name $serviceName -ErrorAction Stop
    $shutdownService = [ordered]@{ status=[string]$service.Status; startType=[string]$service.StartType }
  } catch { $shutdownService = [ordered]@{ status='UNAVAILABLE'; error=$_.Exception.Message } }
}

$dbOwnership = if (-not (Test-Path -LiteralPath $markerPath)) { 'RELEASED' } elseif ($backend.status -eq 'HEALTHY') { 'ACTIVE' } elseif ($NoLiveProbe) { 'MARKER_PRESENT_UNVERIFIED' } else {
  $inspector = Join-Path $projectRoot 'deployment\windows\Test-AndaluciaDb3StaleMarkerOwnership.ps1'
  try {
    $ownership = (& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $inspector -MarkerPath $markerPath -CanonicalRoot $canonicalData -InspectorProcessId $PID | ConvertFrom-Json).ownershipState
    if ($ownership) { [string]$ownership } else { 'UNVERIFIED' }
  } catch { 'UNVERIFIED' }
}
$health = if ($backend.status -eq 'HEALTHY') { $backend.response } else { $null }
$firstFatal = Get-StartupFailure $startupLog
if (-not $firstFatal -and $scheduler.Contains('lastTaskResult') -and [long]$scheduler.lastTaskResult -ne 0) { $firstFatal = [ordered]@{ recordedAt=[string]$scheduler.lastRunTime; cause="RUNTIME_TERMINATED_WITHOUT_FINAL_RECORD:lastTaskResult=$($scheduler.lastTaskResult)" } }

[ordered]@{
  version='andalucia-startup-diagnostic-v2'
  frontend=$frontend
  backend=if ($health) { [ordered]@{ status='HEALTHY'; application=$health.application; database=$health.database } } else { $backend }
  authentication=$authentication
  bindings=$bindings
  scheduler=$scheduler
  shutdownService=$shutdownService
  database=[ordered]@{ ownership=$dbOwnership; canonicalStoreId=if ($identity) { [string]$identity.storeId } else { $null }; role=if ($identity) { [string]$identity.role } else { $null }; schema=if ($health) { [string]$health.database.migrationVersion } else { 'UNKNOWN_WHILE_BACKEND_OFFLINE' } }
  source=Get-SourceApproval
  firstFatalError=$firstFatal
} | ConvertTo-Json -Depth 10
