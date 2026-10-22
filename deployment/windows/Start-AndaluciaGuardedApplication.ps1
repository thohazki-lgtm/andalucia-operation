[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$packagePath = Join-Path $projectRoot 'package.json'
$canonicalData = [IO.Path]::GetFullPath((Join-Path $projectRoot '.data\postgres'))
$identityPath = Join-Path (Split-Path $canonicalData -Parent) 'andalucia-store-identity.json'

if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { throw 'ANDALUCIA_PROJECT_DIRECTORY_INVALID' }
if (-not (Test-Path -LiteralPath (Join-Path $canonicalData 'PG_VERSION') -PathType Leaf)) { throw 'ANDALUCIA_CANONICAL_STORE_MISSING' }
if (-not (Test-Path -LiteralPath $identityPath -PathType Leaf)) { throw 'ANDALUCIA_CANONICAL_IDENTITY_MISSING' }
$identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
if ($identity.role -ne 'canonical' -or [IO.Path]::GetFullPath([string]$identity.databaseDirectory) -ne $canonicalData) { throw 'ANDALUCIA_CANONICAL_IDENTITY_MISMATCH' }

Set-Location -LiteralPath $projectRoot
$env:ANDALUCIA_DATA_DIR = $canonicalData
$env:ANDALUCIA_STORE_ROLE = 'canonical'
$env:ANDALUCIA_CANONICAL_STARTUP_AUTHORIZATION = 'YES_I_APPROVE_GUARDED_CANONICAL_STARTUP'
# Vite 8 closes its listener when a non-interactive launcher's stdin ends
# unless CI mode is enabled. The guarded Task Scheduler runtime is intentionally
# non-interactive, so keep the frontend listener alive without weakening any
# database or process-ownership guard.
$env:CI = 'true'
# Start only against the currently reviewed schema. A caller may explicitly
# provide the immediately previous reviewed version for a controlled recovery.
if (-not $env:ANDALUCIA_REQUIRED_SCHEMA_VERSION) { $env:ANDALUCIA_REQUIRED_SCHEMA_VERSION = '027' }
$startedAtUtc = [DateTime]::UtcNow
& npm.cmd run dev:canonical
$runtimeExit = $LASTEXITCODE
if ($runtimeExit -ne 0) {
  $responseRoot = Join-Path $projectRoot '.backups\.db2\scheduler\control\responses'
  $gracefulSchedulerStop = Get-ChildItem -LiteralPath $responseRoot -Filter '*.json' -File -ErrorAction SilentlyContinue | ForEach-Object {
    try { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json } catch { $null }
  } | Where-Object { $_.state -eq 'completed' -and [DateTime]::Parse([string]$_.completedAt).ToUniversalTime() -ge $startedAtUtc } | Select-Object -First 1
  if ($gracefulSchedulerStop) { $runtimeExit = 0 }
}
exit $runtimeExit
