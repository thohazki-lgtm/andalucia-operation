[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$canonicalData = [IO.Path]::GetFullPath((Join-Path $projectRoot '.data\postgres'))
$identityPath = Join-Path (Split-Path $canonicalData -Parent) 'andalucia-store-identity.json'
$markerPath = Join-Path $canonicalData 'postmaster.pid'
$schedulerRoot = Join-Path $projectRoot '.backups\.db2\scheduler'
$frontendShutdownRequest = Join-Path $projectRoot '.runtime\frontend-shutdown.request'

function Test-LoopbackEndpoint([string]$LoopbackHost, [int]$Port) {
  try { $addresses = @([Net.IPAddress]::Parse($LoopbackHost)) }
  catch { $addresses = @([Net.Dns]::GetHostAddresses($LoopbackHost)) }
  foreach ($address in $addresses) {
    $client = [Net.Sockets.TcpClient]::new($address.AddressFamily)
    try {
      $pending = $client.ConnectAsync($address, $Port)
      if ($pending.Wait(300) -and $client.Connected) { return $true }
    } catch { }
    finally { $client.Dispose() }
  }
  return $false
}

function Test-LocalPort([int]$Port, [int]$Attempts = 3) {
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    foreach ($loopbackHost in @('127.0.0.1', '::1', 'localhost')) {
      if (Test-LoopbackEndpoint $loopbackHost $Port) { return $true }
    }
    if ($attempt -lt $Attempts) { Start-Sleep -Milliseconds 150 }
  }
  return $false
}

if (-not (Test-Path -LiteralPath $identityPath -PathType Leaf)) { throw 'ANDALUCIA_CANONICAL_IDENTITY_MISSING' }
$identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
if ($identity.role -ne 'canonical' -or [IO.Path]::GetFullPath([string]$identity.databaseDirectory) -ne $canonicalData) { throw 'ANDALUCIA_CANONICAL_IDENTITY_MISMATCH' }

$apiOpen = Test-LocalPort 3001
$frontOpen = (Test-LocalPort 5173) -or (Test-LocalPort 5174)
# A frontend-only state has no verified database owner and remains blocked. An
# API-only state can be recovered through the API's existing graceful shutdown
# handshake, provided the ports close and PGlite releases its marker naturally.
if (-not $apiOpen -and $frontOpen) { throw 'ANDALUCIA_APPLICATION_PARTIAL_RUNTIME_STATE' }
if (-not $apiOpen) {
  if (Test-Path -LiteralPath $markerPath) { throw 'ANDALUCIA_STOPPED_RUNTIME_MARKER_REQUIRES_DB3_REVIEW' }
  Write-Output 'ANDALUCIA_GUARDED_RUNTIME_ALREADY_STOPPED'
  exit 0
}

$requestId = [Guid]::NewGuid().ToString('N')
$requestRoot = Join-Path $schedulerRoot 'control\requests'
$responsePath = Join-Path $schedulerRoot ("control\responses\{0}.json" -f $requestId)
New-Item -ItemType Directory -Path $requestRoot -Force | Out-Null
$temporaryRequest = Join-Path $requestRoot (".{0}.tmp" -f $requestId)
$requestPath = Join-Path $requestRoot ("{0}.json" -f $requestId)
$request = @{ version='andalucia-scheduler-shutdown-v1'; requestId=$requestId; requestedAt=[DateTime]::UtcNow.ToString('o'); action='graceful_shutdown'; source='guarded_operator' } | ConvertTo-Json -Compress
[IO.File]::WriteAllText($temporaryRequest, $request, [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $temporaryRequest -Destination $requestPath

$deadline = [DateTime]::UtcNow.AddSeconds(90)
do {
  if (Test-Path -LiteralPath $responsePath) {
    $response = Get-Content -LiteralPath $responsePath -Raw | ConvertFrom-Json
    if ($response.state -eq 'failed') { throw "ANDALUCIA_GUARDED_SHUTDOWN_FAILED:$($response.error)" }
    if ($response.state -eq 'completed') { break }
  }
  Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $deadline)

if (-not (Test-Path -LiteralPath $responsePath)) { throw 'ANDALUCIA_GUARDED_SHUTDOWN_TIMEOUT' }
$response = Get-Content -LiteralPath $responsePath -Raw | ConvertFrom-Json
if ($response.state -ne 'completed') { throw 'ANDALUCIA_GUARDED_SHUTDOWN_NOT_CONFIRMED' }

if ($frontOpen) {
  $frontendRuntime = Split-Path $frontendShutdownRequest -Parent
  New-Item -ItemType Directory -Path $frontendRuntime -Force | Out-Null
  $temporaryFrontendRequest = "$frontendShutdownRequest.tmp"
  [IO.File]::WriteAllText($temporaryFrontendRequest, $requestId, [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporaryFrontendRequest -Destination $frontendShutdownRequest -Force
}

$releaseDeadline = [DateTime]::UtcNow.AddSeconds(30)
do {
  $portsClosed = -not (Test-LocalPort 3001 1) -and -not (Test-LocalPort 5173 1) -and -not (Test-LocalPort 5174 1)
  $markerReleased = -not (Test-Path -LiteralPath $markerPath)
  if ($portsClosed -and $markerReleased) { Write-Output 'ANDALUCIA_GUARDED_SHUTDOWN_CONFIRMED'; exit 0 }
  Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $releaseDeadline)

throw 'ANDALUCIA_GUARDED_SHUTDOWN_MARKER_OR_PORTS_REMAIN'
