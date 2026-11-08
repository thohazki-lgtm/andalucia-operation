[CmdletBinding()]
param(
  [string]$ProjectRoot,
  [string]$SimulationEventPath,
  [switch]$PreshutdownOnce,
  [string]$ScmValidatedSourceSha,
  [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
$root = if ($ProjectRoot) { [IO.Path]::GetFullPath($ProjectRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')) }
$canonicalData = [IO.Path]::GetFullPath((Join-Path $root '.data\postgres'))
$identityPath = Join-Path $root '.data\andalucia-store-identity.json'
$markerPath = Join-Path $canonicalData 'postmaster.pid'
$controlRoot = Join-Path $root '.backups\.db2\scheduler\control'
$signalPath = Join-Path $controlRoot 'windows-shutdown.signal'
$responseRoot = Join-Path $controlRoot 'responses'
$logPath = Join-Path $root '.runtime\logs\windows-shutdown-watcher.jsonl'
$resolver = Join-Path $root 'deployment\windows\Resolve-AndaluciaApprovedSource.ps1'

function Write-WatcherLog([string]$State, [string]$Detail) {
  New-Item -ItemType Directory -Path (Split-Path $logPath -Parent) -Force | Out-Null
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value (([ordered]@{ version='andalucia-windows-shutdown-watcher-v1'; recordedAt=[DateTime]::UtcNow.ToString('o'); state=$State; detail=($Detail -replace '[\r\n]+',' ') } | ConvertTo-Json -Compress))
}

if (-not (Test-Path -LiteralPath $identityPath -PathType Leaf)) { throw 'SHUTDOWN_WATCHER_CANONICAL_IDENTITY_MISSING' }
$identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
if ($SimulationEventPath) {
  if ($identity.role -notin @('test','development','disposable')) { throw 'SHUTDOWN_WATCHER_SIMULATION_CANONICAL_FORBIDDEN' }
} else {
  if ($identity.role -ne 'canonical' -or [IO.Path]::GetFullPath([string]$identity.databaseDirectory) -ne $canonicalData) { throw 'SHUTDOWN_WATCHER_CANONICAL_IDENTITY_MISMATCH' }
  if ($PreshutdownOnce) {
    if ($ScmValidatedSourceSha -notmatch '^[0-9a-f]{40}$') { throw 'SHUTDOWN_WATCHER_SCM_SOURCE_BINDING_MISSING' }
    Write-WatcherLog 'ARMED' "sha=$ScmValidatedSourceSha;source=SCM_VALIDATED_MAIN"
  } else {
    if (-not (Test-Path -LiteralPath $resolver -PathType Leaf)) { throw 'SHUTDOWN_WATCHER_SOURCE_RESOLVER_MISSING' }
    . $resolver
    $approvedSource = Get-AndaluciaApprovedSourceState -ProjectRoot $root
    Write-WatcherLog 'ARMED' "sha=$($approvedSource.Sha);branch=$($approvedSource.Branch)"
  }
}

function Invoke-GuardedShutdownSignal([string]$Reason) {
  $started = [DateTime]::UtcNow
  if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { Write-WatcherLog 'NO_OWNER' "reason=$Reason"; return }
  New-Item -ItemType Directory -Path $controlRoot -Force | Out-Null
  $temporary = Join-Path $controlRoot ('.windows-shutdown.signal.{0}.tmp' -f [Guid]::NewGuid().ToString('N'))
  [IO.File]::WriteAllText($temporary, 'ANDALUCIA_WINDOWS_SHUTDOWN', [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $signalPath -Force
  Write-WatcherLog 'SIGNALLED' "reason=$Reason"
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $response = Get-ChildItem -LiteralPath $responseRoot -Filter '*.json' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | ForEach-Object {
      try { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json } catch { $null }
    } | Where-Object { $_.source -eq 'windows_shutdown_signal' -and $_.state -eq 'completed' -and [DateTime]::Parse([string]$_.completedAt).ToUniversalTime() -ge $started } | Select-Object -First 1
    if ($response -and -not (Test-Path -LiteralPath $markerPath)) { Write-WatcherLog 'ACKNOWLEDGED' "reason=$Reason;requestId=$($response.requestId)"; return }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  Write-WatcherLog 'FAILED' "reason=$Reason;error=SHUTDOWN_WATCHER_ACKNOWLEDGEMENT_TIMEOUT"
  throw 'SHUTDOWN_WATCHER_ACKNOWLEDGEMENT_TIMEOUT'
}

if ($SimulationEventPath) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while (-not (Test-Path -LiteralPath $SimulationEventPath) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
  if (-not (Test-Path -LiteralPath $SimulationEventPath)) { throw 'SHUTDOWN_WATCHER_SIMULATION_EVENT_TIMEOUT' }
  Invoke-GuardedShutdownSignal 'DISPOSABLE_SIMULATION'
  exit 0
}

if (-not $PreshutdownOnce) { throw 'SHUTDOWN_WATCHER_SCM_PRESHUTDOWN_REQUIRED' }
Invoke-GuardedShutdownSignal 'WINDOWS_SCM_PRESHUTDOWN'
