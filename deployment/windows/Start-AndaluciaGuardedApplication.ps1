[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$packagePath = Join-Path $projectRoot 'package.json'
$canonicalData = [IO.Path]::GetFullPath((Join-Path $projectRoot '.data\postgres'))
$identityPath = Join-Path (Split-Path $canonicalData -Parent) 'andalucia-store-identity.json'
$sourceResolver = Join-Path $PSScriptRoot 'Resolve-AndaluciaApprovedSource.ps1'
$startupLogRoot = Join-Path $projectRoot '.runtime\logs'
$startupLog = Join-Path $startupLogRoot 'guarded-startup.jsonl'
$nodeRoot = Join-Path $env:ProgramFiles 'nodejs'
$gitRoot = Join-Path $env:ProgramFiles 'Git\cmd'
$npmCommand = Join-Path $nodeRoot 'npm.cmd'
$gitCommand = Join-Path $gitRoot 'git.exe'

function Write-StartupLog([string]$State, [string]$Detail) {
  New-Item -ItemType Directory -Path $startupLogRoot -Force | Out-Null
  $entry = [ordered]@{ version='andalucia-guarded-startup-v1'; recordedAt=[DateTime]::UtcNow.ToString('o'); state=$State; detail=$Detail }
  Add-Content -LiteralPath $startupLog -Value ($entry | ConvertTo-Json -Compress) -Encoding UTF8
}

function Wait-StartupDependencies([int]$TimeoutSeconds = 90) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $attempt = 0
  do {
    $attempt += 1
    $missing = @(
      @($packagePath, (Join-Path $canonicalData 'PG_VERSION'), $identityPath, $sourceResolver, $npmCommand, $gitCommand) |
        Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) }
    )
    $markerPresent = Test-Path -LiteralPath (Join-Path $canonicalData 'postmaster.pid')
    if ($missing.Count -eq 0 -and -not $markerPresent) { return }
    if ($attempt -eq 1 -or [DateTime]::UtcNow.AddSeconds(5) -ge $deadline) {
      Write-StartupLog 'WAITING' ("attempt={0};missing={1};databaseMarkerPresent={2}" -f $attempt, ($missing -join ','), $markerPresent)
    }
    Start-Sleep -Seconds 5
  } while ([DateTime]::UtcNow -lt $deadline)
  if (Test-Path -LiteralPath (Join-Path $canonicalData 'postmaster.pid')) { throw 'ANDALUCIA_STARTUP_DATABASE_MARKER_PRESENT_REQUIRES_DB3_REVIEW' }
  throw "ANDALUCIA_STARTUP_DEPENDENCY_TIMEOUT:$($missing -join ',')"
}

function Get-ApprovedSourceState {
  if (-not (Test-Path -LiteralPath $sourceResolver -PathType Leaf)) { throw 'ANDALUCIA_RUNTIME_SOURCE_RESOLVER_MISSING' }
  . $sourceResolver
  return Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot
}

try {
  Write-StartupLog 'STARTING' "projectRoot=$projectRoot"
  Wait-StartupDependencies
  $env:PATH = "$nodeRoot;$gitRoot;$env:SystemRoot\System32;$env:SystemRoot;$env:PATH"
  $identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
  if ($identity.role -ne 'canonical' -or [IO.Path]::GetFullPath([string]$identity.databaseDirectory) -ne $canonicalData) { throw 'ANDALUCIA_CANONICAL_IDENTITY_MISMATCH' }
  $source = Get-ApprovedSourceState

  Set-Location -LiteralPath $projectRoot
  $env:ANDALUCIA_DATA_DIR = $canonicalData
  $env:ANDALUCIA_STORE_ROLE = 'canonical'
  $env:ANDALUCIA_CANONICAL_STARTUP_AUTHORIZATION = 'YES_I_APPROVE_GUARDED_CANONICAL_STARTUP'
  $env:ANDALUCIA_ACTIVE_SOURCE_SHA = $source.Sha
  $env:ANDALUCIA_ACTIVE_SOURCE_BRANCH = $source.Branch
# Vite 8 closes its listener when a non-interactive launcher's stdin ends
# unless CI mode is enabled. The guarded Task Scheduler runtime is intentionally
# non-interactive, so keep the frontend listener alive without weakening any
# database or process-ownership guard.
  $env:CI = 'true'
# Start only against the currently reviewed schema. A caller may explicitly
# provide the immediately previous reviewed version for a controlled recovery.
  if (-not $env:ANDALUCIA_REQUIRED_SCHEMA_VERSION) { $env:ANDALUCIA_REQUIRED_SCHEMA_VERSION = '027' }
  $startedAtUtc = [DateTime]::UtcNow
  Write-StartupLog 'SOURCE_APPROVED' "sha=$($source.Sha);branch=$($source.Branch);mode=$($source.Mode)"
  & $npmCommand run dev:canonical
  $runtimeExit = $LASTEXITCODE
  if ($runtimeExit -ne 0) {
    $responseRoot = Join-Path $projectRoot '.backups\.db2\scheduler\control\responses'
    $gracefulSchedulerStop = Get-ChildItem -LiteralPath $responseRoot -Filter '*.json' -File -ErrorAction SilentlyContinue | ForEach-Object {
      try { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json } catch { $null }
    } | Where-Object { $_.state -eq 'completed' -and [DateTime]::Parse([string]$_.completedAt).ToUniversalTime() -ge $startedAtUtc } | Select-Object -First 1
    if ($gracefulSchedulerStop) { $runtimeExit = 0 }
  }
  Write-StartupLog 'EXITED' "exitCode=$runtimeExit"
  exit $runtimeExit
} catch {
  Write-StartupLog 'FAILED' $_.Exception.Message
  throw
}
