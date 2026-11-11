param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$PreviousHealthySha,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ApprovedControlSha,
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
  $control = Join-Path $root 'server\offline-recovery-approval-binding-control.ts'
  if (-not (Test-Path -LiteralPath $tsx -PathType Leaf) -or -not (Test-Path -LiteralPath $control -PathType Leaf)) { throw 'RECOVERY_APPROVAL_REGISTRATION_CONTROL_UNAVAILABLE' }
  $output = $payload | & $tsx $control --project-root $root --previous-healthy-sha $PreviousHealthySha --approved-control-sha $ApprovedControlSha 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
  $result = ($output -join [Environment]::NewLine) | ConvertFrom-Json
  if ($result.state -ne 'REGISTERED' -or $result.previousLiveSha -ne $PreviousHealthySha.ToLowerInvariant() -or $result.approvedControlSha -ne $ApprovedControlSha.ToLowerInvariant()) { throw 'RECOVERY_APPROVAL_REGISTRATION_INVALID' }
  [pscustomobject]@{ BindingId = $result.bindingId; PreviousLiveSha = $result.previousLiveSha; ApprovedControlSha = $result.approvedControlSha; RegistrationSourceSha = $result.registrationSourceSha; ExpiresAt = $result.expiresAt; State = $result.state }
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  $plainPassword = $null; $payload = $null; $securePassword = $null
}
