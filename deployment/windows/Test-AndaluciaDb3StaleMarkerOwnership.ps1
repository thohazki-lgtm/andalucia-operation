[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$MarkerPath,
  [Parameter(Mandatory = $true)][string]$CanonicalRoot,
  [int]$InspectorProcessId
)

$ErrorActionPreference = 'Stop'
$marker = [IO.Path]::GetFullPath($MarkerPath)
$canonical = [IO.Path]::GetFullPath($CanonicalRoot).TrimEnd('\')
if (-not $marker.StartsWith("$canonical\", [StringComparison]::OrdinalIgnoreCase)) { throw 'DB3_MARKER_OUTSIDE_CANONICAL_ROOT' }
if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { throw 'DB3_MARKER_MISSING' }

$lines = @(Get-Content -LiteralPath $marker)
$sentinel = if ($lines.Count) { [string]$lines[0] } else { '' }
$exclusive = $false
try {
  $stream = [IO.File]::Open($marker, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
  $exclusive = $true
} catch { }
finally { if ($stream) { $stream.Dispose() } }

$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 3001,5173,5432 } |
  Select-Object LocalAddress,LocalPort,OwningProcess)
$owners = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.ProcessId -ne $PID -and $_.ProcessId -ne $InspectorProcessId -and $_.CommandLine -and
    ($_.CommandLine.IndexOf($canonical, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
      $_.CommandLine.IndexOf('/pglite/data', [StringComparison]::OrdinalIgnoreCase) -ge 0)
  } | Select-Object ProcessId,Name,ExecutablePath,CommandLine,CreationDate)
$runningTasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue |
  Where-Object { $_.TaskName -match 'ANDALUCIA OPERATION' -and [string]$_.State -eq 'Running' } |
  Select-Object TaskName,TaskPath,State)
$item = Get-Item -LiteralPath $marker

[pscustomobject]@{
  markerPath = $marker
  markerSha256 = (Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash.ToLowerInvariant()
  markerLength = $item.Length
  markerLastWriteUtc = $item.LastWriteTimeUtc.ToString('o')
  sentinel = $sentinel.Trim()
  exclusiveRead = $exclusive
  listeners = $listeners
  matchingProcesses = $owners
  runningTasks = $runningTasks
  ownershipState = if ($sentinel.Trim() -eq '-42' -and $exclusive -and $listeners.Count -eq 0 -and $owners.Count -eq 0 -and $runningTasks.Count -eq 0) { 'STALE' } else { 'AMBIGUOUS' }
} | ConvertTo-Json -Depth 6
