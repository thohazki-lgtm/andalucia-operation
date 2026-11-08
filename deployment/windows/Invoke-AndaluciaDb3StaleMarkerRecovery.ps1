[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [string]$LoginIdentifier
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ProjectRoot -ErrorAction Stop).Path
if ([string]::IsNullOrWhiteSpace($LoginIdentifier)) { $LoginIdentifier = Read-Host 'Manager username or email' }
$securePassword = Read-Host 'Manager password' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $payload = @{ identifier = $LoginIdentifier; password = $plainPassword } | ConvertTo-Json -Compress
  $tsx = Join-Path $root 'node_modules\.bin\tsx.cmd'
  $control = Join-Path $root 'server\database-stale-marker-recovery.ts'
  if (-not (Test-Path -LiteralPath $tsx -PathType Leaf) -or -not (Test-Path -LiteralPath $control -PathType Leaf)) { throw 'DB3_STALE_MARKER_CONTROL_UNAVAILABLE' }
  $output = $payload | & $tsx $control --project-root $root 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
  $result = ($output -join [Environment]::NewLine) | ConvertFrom-Json
  if ($result.state -ne 'RECOVERY_HEALTHY' -or $result.schema -ne '027') { throw 'DB3_STALE_MARKER_RECOVERY_NOT_HEALTHY' }
  [pscustomobject]@{ AuthorizationId=$result.authorizationId; State=$result.state; SourceSha=$result.sourceSha; BackupId=$result.backupId; Schema=$result.schema }
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  $plainPassword = $null; $payload = $null; $securePassword = $null
}
