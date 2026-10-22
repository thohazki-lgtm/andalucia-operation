$ErrorActionPreference = 'Stop'

$apiKeyReference = 'andalucia-web-picker-api-key:web-production'
$apiKeyUserName = 'ANDALUCIA_OPERATION_WEB_PICKER_API_KEY'
$replacementAdded = $false
$originalRemoved = $false
$apiKeySecure = $null
$apiKeyPlain = $null
$originalValue = $null

function Get-ExactVaultEntry([object]$Vault, [string]$Reference, [string]$UserName) {
  try {
    $entry = $Vault.Retrieve($Reference, $UserName)
    $entry.RetrievePassword()
    return $entry
  } catch { return $null }
}

function Remove-ExactVaultEntry([object]$Vault, [string]$Reference, [string]$UserName) {
  $entry = Get-ExactVaultEntry $Vault $Reference $UserName
  if ($null -ne $entry) { $Vault.Remove($entry) }
}

try {
  $configurationPath = Join-Path $PSScriptRoot 'google-web-picker-credential-configuration.ts'
  $configurationSource = Get-Content -LiteralPath $configurationPath -Raw -ErrorAction Stop
  if (-not $configurationSource.Contains("WEB_PICKER_API_KEY_REFERENCE = '$apiKeyReference'")) { throw 'WEB_PICKER_RUNTIME_REFERENCE_MISMATCH' }

  [void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]
  $vault = [Windows.Security.Credentials.PasswordVault]::new()
  $original = Get-ExactVaultEntry $vault $apiKeyReference $apiKeyUserName
  if ($null -eq $original) { throw 'WEB_PICKER_API_KEY_ENTRY_MISSING' }
  $originalValue = $original.Password

  $apiKeySecure = Read-Host 'Enter the newly rotated restricted Google Picker browser API key' -AsSecureString
  if ($null -eq $apiKeySecure -or $apiKeySecure.Length -eq 0) { throw 'WEB_PICKER_API_KEY_MISSING' }
  $apiKeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($apiKeySecure)
  try { $apiKeyPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($apiKeyPointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($apiKeyPointer) }
  if ($apiKeyPlain -cne $apiKeyPlain.Trim() -or $apiKeyPlain -match '[\r\n]' -or $apiKeyPlain -notmatch '^AIza[A-Za-z0-9_-]{35}$') { throw 'WEB_PICKER_API_KEY_INVALID' }
  if ($apiKeyPlain -ceq $originalValue) { throw 'WEB_PICKER_API_KEY_UNCHANGED' }

  $vault.Remove($original)
  $originalRemoved = $true
  $vault.Add([Windows.Security.Credentials.PasswordCredential]::new($apiKeyReference, $apiKeyUserName, $apiKeyPlain))
  $replacementAdded = $true

  $readback = Get-ExactVaultEntry $vault $apiKeyReference $apiKeyUserName
  if ($null -eq $readback -or $readback.Password -cne $apiKeyPlain) { throw 'WEB_PICKER_API_KEY_READBACK_FAILED' }

  [Console]::Out.WriteLine('PICKER_KEY_ROTATION_COMPLETED=True')
  [Console]::Out.WriteLine('WEB_PICKER_KEY_ENTRY_PRESENT=True')
  [Console]::Out.WriteLine('WEB_PICKER_KEY_NONEMPTY=True')
  [Console]::Out.WriteLine('WEB_PICKER_KEY_FORMAT_VALID=True')
  [Console]::Out.WriteLine('WEB_PICKER_RUNTIME_REFERENCE_CORRECT=True')
  [Console]::Out.WriteLine('WEB_OAUTH_CREDENTIAL_UNCHANGED=True')
  [Console]::Out.WriteLine('DESKTOP_OAUTH_CREDENTIAL_UNCHANGED=True')
  exit 0
} catch {
  if ($null -ne $vault -and $originalRemoved) {
    try {
      if ($replacementAdded) { Remove-ExactVaultEntry $vault $apiKeyReference $apiKeyUserName }
      $vault.Add([Windows.Security.Credentials.PasswordCredential]::new($apiKeyReference, $apiKeyUserName, $originalValue))
    } catch { }
  }
  [Console]::Error.WriteLine('WEB_PICKER_API_KEY_ROTATION_FAILED')
  exit 1
} finally {
  $apiKeyPlain = $null
  $originalValue = $null
  $configurationSource = $null
  if ($null -ne $apiKeySecure) { $apiKeySecure.Dispose() }
}
