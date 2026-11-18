[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ProjectRoot,
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ExpectedSha,
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{32}$')][string]$RecoveryAuthorizationId,
  [string]$LoginIdentifier
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ProjectRoot -ErrorAction Stop).Path
if ([string]::IsNullOrWhiteSpace($LoginIdentifier)) { $LoginIdentifier = Read-Host 'Manager username or email' }
$securePassword = Read-Host 'Manager password' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $payload = @{ identifier=$LoginIdentifier; password=$plainPassword } | ConvertTo-Json -Compress
  $nativeControl = Join-Path $PSScriptRoot 'Invoke-AndaluciaNativeJsonControl.ps1'
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $tsx = Join-Path $root 'node_modules\tsx\dist\cli.mjs'
  $control = Join-Path $root 'server\requested-backup-activation-control.ts'
  if (-not (Test-Path -LiteralPath $nativeControl -PathType Leaf) -or -not (Test-Path -LiteralPath $tsx -PathType Leaf) -or -not (Test-Path -LiteralPath $control -PathType Leaf)) { throw 'STOPPED_MAIN_ACTIVATION_CONTROL_UNAVAILABLE' }
  . $nativeControl
  $output = Invoke-AndaluciaNativeJsonControl -ExecutablePath $node -ArgumentList @($tsx,$control,'prepare-stopped-main-activation','--project-root',$root,'--expected-sha',$ExpectedSha.ToLowerInvariant(),'--recovery-authorization-id',$RecoveryAuthorizationId.ToLowerInvariant()) -Payload $payload
  $result = $output | ConvertFrom-Json
  if ($result.state -ne 'BACKUP_VERIFIED' -or $result.authorizationMode -ne 'stopped_main_runtime_activation' -or $result.targetSha -ne $ExpectedSha.ToLowerInvariant() -or $result.schema -ne '028') { throw 'STOPPED_MAIN_ACTIVATION_AUTHORIZATION_NOT_READY' }
  [pscustomobject]@{ AuthorizationId=$result.authorizationId; State=$result.state; SourceSha=$result.targetSha; BackupId=$result.backupId; Schema=$result.schema; ExpiresAt=$result.expiresAt }
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  $plainPassword=$null; $payload=$null; $securePassword=$null
}
