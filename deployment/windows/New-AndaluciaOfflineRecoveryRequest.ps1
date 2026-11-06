param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$PreviousHealthySha,
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
  $control = Join-Path $root 'server\offline-recovery-request-control.ts'
  if (-not (Test-Path -LiteralPath $tsx -PathType Leaf) -or -not (Test-Path -LiteralPath $control -PathType Leaf)) { throw 'OFFLINE_RECOVERY_CONTROL_UNAVAILABLE' }
  $output = $payload | & $tsx $control --project-root $root --previous-healthy-sha $PreviousHealthySha 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
  $result = ($output -join [Environment]::NewLine) | ConvertFrom-Json
  if ($result.state -ne 'RECOVERY_AUTHORIZED' -or $result.previousLiveSha -ne $PreviousHealthySha.ToLowerInvariant()) { throw 'OFFLINE_RECOVERY_AUTHORIZATION_INVALID' }
  [pscustomobject]@{ RequestId = $result.requestId; AuthorizationId = $result.authorizationId; PreviousLiveSha = $result.previousLiveSha; TargetSha = $result.targetSha; State = $result.state }
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  $plainPassword = $null; $payload = $null; $securePassword = $null
}
