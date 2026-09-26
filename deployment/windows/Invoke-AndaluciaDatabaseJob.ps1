[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateSet('DailyBackup', 'WeeklyRestoreRehearsal')]
  [string]$Job
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$canonicalData = [IO.Path]::GetFullPath((Join-Path $projectRoot '.data\postgres'))
$backupRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '.backups'))
$schedulerRoot = Join-Path $backupRoot '.db2\scheduler'
$logRoot = Join-Path $schedulerRoot 'logs'
$runtimeTask = 'ANDALUCIA OPERATION - Guarded Application'
$identityPath = Join-Path (Split-Path $canonicalData -Parent) 'andalucia-store-identity.json'
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$logPath = Join-Path $logRoot ("windows-{0}-{1}.log" -f $Job.ToLowerInvariant(), $stamp)
$runningBefore = $false
$restartResult = 'NOT_REQUIRED'

function Write-JobLog([string]$Message) {
  $line = "{0} {1}" -f [DateTime]::UtcNow.ToString('o'), $Message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}
function Write-MachineEvent([string]$State, [string]$Classification, [int]$ExitCode) {
  $entry = [ordered]@{ version='andalucia-windows-scheduler-event-v1'; event='windows_task_finished'; task=$Job; finishedAt=[DateTime]::UtcNow.ToString('o'); result=$State; exitCode=$ExitCode; classification=$Classification; restartResult=$restartResult }
  Add-Content -LiteralPath (Join-Path $logRoot 'windows-task-events.jsonl') -Value ($entry | ConvertTo-Json -Compress) -Encoding UTF8
}
function Test-LocalPort([int]$Port) {
  foreach ($hostName in @('localhost', '127.0.0.1', '::1')) {
    $client = [Net.Sockets.TcpClient]::new()
    try { $pending = $client.ConnectAsync($hostName, $Port); if ($pending.Wait(1000) -and $client.Connected) { return $true } }
    catch { }
    finally { $client.Dispose() }
  }
  $listeners = & (Join-Path $env:SystemRoot 'System32\netstat.exe') -ano
  return [bool]($listeners | Select-String -Pattern ("^\s*TCP\s+\S+:{0}\s+\S+\s+LISTENING\s+\d+\s*$" -f $Port) -Quiet)
}
function Wait-PortsClosed([int]$TimeoutSeconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (-not (Test-LocalPort 3001) -and -not (Test-LocalPort 5173) -and -not (Test-LocalPort 5174)) { return $true }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  return $false
}
function Invoke-LocalHttpGet([string]$Uri) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 5 -Proxy $null
    if ([int]$response.StatusCode -ne 200) { return $null }
    return [string]$response.Content
  } catch { return $null }
}
function Test-ApplicationReadyOnce {
  if (-not (Test-LocalPort 3001) -or (-not (Test-LocalPort 5173) -and -not (Test-LocalPort 5174))) { return $false }
  $healthBody = Invoke-LocalHttpGet 'http://127.0.0.1:3001/api/health'
  try { $health = $healthBody | ConvertFrom-Json } catch { return $false }
  if (-not $health.ok -or $health.database.status -ne 'HEALTHY' -or $health.database.recoveryRequired) { return $false }
  $frontendBase = if (Test-LocalPort 5173) { 'http://localhost:5173' } else { 'http://localhost:5174' }
  $indexBody = Invoke-LocalHttpGet "$frontendBase/"
  $mainBody = Invoke-LocalHttpGet "$frontendBase/src/main.tsx"
  $appBody = Invoke-LocalHttpGet "$frontendBase/src/App.tsx"
  return [bool]($indexBody -match 'id=["'']root["'']' -and $mainBody -match 'createRoot' -and $appBody -match 'function App')
}
function Wait-ApplicationReady([int]$TimeoutSeconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $consecutiveReadyChecks = 0
  do {
    if (Test-ApplicationReadyOnce) { $consecutiveReadyChecks += 1 } else { $consecutiveReadyChecks = 0 }
    if ($consecutiveReadyChecks -ge 3) { return $true }
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $deadline)
  return $false
}
function Start-GuardedApplicationIfRequired {
  if (-not $runningBefore) { return }
  try {
    $script:restartResult = 'STARTING'
    Start-ScheduledTask -TaskName $runtimeTask
    if (-not (Wait-ApplicationReady 120)) { throw 'ANDALUCIA_GUARDED_RESTART_FAILED' }
    $script:restartResult = 'SUCCEEDED'
    Write-JobLog 'restartResult=SUCCEEDED apiHealth=HTTP_200 frontendHealth=HTTP_200 reactModule=HTTP_200 stabilityChecks=3'
  } catch {
    $script:restartResult = 'FAILED'
    throw
  }
}

try {
  New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
  Write-JobLog "task=$Job state=STARTED"
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'package.json') -PathType Leaf)) { throw 'ANDALUCIA_PROJECT_DIRECTORY_INVALID' }
  if (-not (Test-Path -LiteralPath (Join-Path $canonicalData 'PG_VERSION') -PathType Leaf)) { throw 'ANDALUCIA_CANONICAL_STORE_MISSING' }
  if (-not (Test-Path -LiteralPath $identityPath -PathType Leaf)) { throw 'ANDALUCIA_CANONICAL_IDENTITY_MISSING' }
  $identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
  if ($identity.role -ne 'canonical' -or [IO.Path]::GetFullPath([string]$identity.databaseDirectory) -ne $canonicalData) { throw 'ANDALUCIA_CANONICAL_IDENTITY_MISMATCH' }

  Set-Location -LiteralPath $projectRoot
  $env:ANDALUCIA_DATA_DIR = $canonicalData
  $env:ANDALUCIA_STORE_ROLE = 'canonical'

  if ($Job -eq 'DailyBackup') {
    $apiOpen = Test-LocalPort 3001
    $frontOpen = (Test-LocalPort 5173) -or (Test-LocalPort 5174)
    Write-JobLog "apiOpen=$apiOpen frontendOpen=$frontOpen"
    if ($apiOpen -xor $frontOpen) { throw 'ANDALUCIA_APPLICATION_PARTIAL_RUNTIME_STATE' }
    $runningBefore = $apiOpen -and $frontOpen
    Write-JobLog "applicationRunningBefore=$runningBefore"
    if ($runningBefore) {
      $requestId = [Guid]::NewGuid().ToString('N')
      $requestRoot = Join-Path $schedulerRoot 'control\requests'
      $responsePath = Join-Path $schedulerRoot ("control\responses\{0}.json" -f $requestId)
      New-Item -ItemType Directory -Path $requestRoot -Force | Out-Null
      $temporaryRequest = Join-Path $requestRoot (".{0}.tmp" -f $requestId)
      $requestPath = Join-Path $requestRoot ("{0}.json" -f $requestId)
      $request = @{ version='andalucia-scheduler-shutdown-v1'; requestId=$requestId; requestedAt=[DateTime]::UtcNow.ToString('o'); action='graceful_shutdown'; source='windows_task_scheduler' } | ConvertTo-Json -Compress
      [IO.File]::WriteAllText($temporaryRequest, $request, [Text.UTF8Encoding]::new($false))
      Move-Item -LiteralPath $temporaryRequest -Destination $requestPath
      $deadline = [DateTime]::UtcNow.AddSeconds(90)
      $completed = $false
      do {
        if (Test-Path -LiteralPath $responsePath) {
          $response = Get-Content -LiteralPath $responsePath -Raw | ConvertFrom-Json
          if ($response.state -eq 'failed') { throw "ANDALUCIA_GRACEFUL_SHUTDOWN_FAILED:$($response.error)" }
          if ($response.state -eq 'completed') { $completed = $true; break }
        }
        Start-Sleep -Milliseconds 500
      } while ([DateTime]::UtcNow -lt $deadline)
      if (-not $completed -or -not (Wait-PortsClosed 30)) { throw 'ANDALUCIA_GRACEFUL_SHUTDOWN_NOT_CONFIRMED' }
      Write-JobLog 'gracefulShutdown=CONFIRMED'
    } elseif (-not (Wait-PortsClosed 1)) { throw 'ANDALUCIA_LIVE_STORE_NOT_EXCLUSIVE' }

    $env:ANDALUCIA_CONFIRM_LIVE_STORE_EXCLUSIVE = 'YES_I_CONFIRM_ANDALUCIA_APP_IS_STOPPED'
    & npm.cmd run db:backup:job -- daily 2>&1 | ForEach-Object { Add-Content -LiteralPath $logPath -Value ([string]$_) -Encoding UTF8 }
    $jobExit = $LASTEXITCODE
    if ($jobExit -ne 0) { throw "ANDALUCIA_DAILY_BACKUP_FAILED:$jobExit" }
    Write-JobLog 'verificationResult=VERIFIED exitCode=0'
    Start-GuardedApplicationIfRequired
  } else {
    & npm.cmd run db:restore:rehearse 2>&1 | ForEach-Object { Add-Content -LiteralPath $logPath -Value ([string]$_) -Encoding UTF8 }
    $jobExit = $LASTEXITCODE
    if ($jobExit -ne 0) { throw "ANDALUCIA_RESTORE_REHEARSAL_FAILED:$jobExit" }
    Write-JobLog 'restoreRehearsalResult=RESTORE_TEST_PASSED exitCode=0'
  }
  Write-JobLog "task=$Job state=SUCCEEDED restartResult=$restartResult exitCode=0"
  Write-MachineEvent 'SUCCEEDED' '' 0
  exit 0
} catch {
  $failure = $_.Exception.Message.Replace("`r", ' ').Replace("`n", ' ')
  Write-JobLog "task=$Job state=FAILED classification=$failure restartResult=$restartResult exitCode=1"
  if ($Job -eq 'DailyBackup' -and $runningBefore -and -not (Test-ApplicationReadyOnce)) {
    try { Start-GuardedApplicationIfRequired } catch { Write-JobLog "restartResult=FAILED classification=$($_.Exception.Message)" }
  }
  Write-MachineEvent 'FAILED' $failure 1
  Write-Error $failure
  exit 1
} finally {
  Remove-Item Env:\ANDALUCIA_CONFIRM_LIVE_STORE_EXCLUSIVE -ErrorAction SilentlyContinue
}
