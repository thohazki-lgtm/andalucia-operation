$ErrorActionPreference = 'Stop'

$oauthReference = 'andalucia-web-picker-oauth:web-production'
$apiKeyReference = 'andalucia-web-picker-api-key:web-production'
$oauthUserName = 'ANDALUCIA_OPERATION_WEB_PICKER_OAUTH'
$apiKeyUserName = 'ANDALUCIA_OPERATION_WEB_PICKER_API_KEY'
$expectedOrigin = 'http://127.0.0.1:4175'
$expectedRedirectUri = 'http://127.0.0.1:4175/oauth/google/callback'
$expectedProjectNumber = '716191827546'

$oauthAdded = $false
$apiKeyAdded = $false
$apiKeySecure = $null
$apiKeyPlain = $null
$oauthPayload = $null

function Get-ExactVaultEntry([object]$Vault, [string]$Reference, [string]$UserName) {
  try {
    $entry = $Vault.Retrieve($Reference, $UserName)
    $entry.RetrievePassword()
    return $entry
  } catch { return $null }
}

function Assert-ResourceUnused([object]$Vault, [string]$Reference) {
  $matches = @($Vault.RetrieveAll() | Where-Object { $_.Resource -eq $Reference })
  if ($matches.Count -ne 0) { throw 'WEB_PICKER_CREDENTIAL_ENTRY_ALREADY_EXISTS' }
}

function Remove-ExactVaultEntry([object]$Vault, [string]$Reference, [string]$UserName) {
  $entry = Get-ExactVaultEntry $Vault $Reference $UserName
  if ($null -ne $entry) { $Vault.Remove($entry) }
}

try {
  if ($expectedProjectNumber -notmatch '^\d{12}$') { throw 'WEB_PICKER_PROJECT_NUMBER_INVALID' }
  $credentialsPath = Read-Host 'Enter the full local path to the downloaded Google Web OAuth credentials JSON'
  if ([string]::IsNullOrWhiteSpace($credentialsPath)) { throw 'WEB_OAUTH_CREDENTIALS_PATH_MISSING' }
  $resolved = (Resolve-Path -LiteralPath $credentialsPath -ErrorAction Stop).Path
  $file = Get-Item -LiteralPath $resolved -Force
  if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'WEB_OAUTH_CREDENTIALS_FILE_INVALID' }

  $document = Get-Content -LiteralPath $resolved -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  $web = $document.web
  if ($null -eq $web) { throw 'WEB_OAUTH_CREDENTIAL_TYPE_INVALID' }
  $clientId = ([string]$web.client_id).Trim()
  $clientSecret = ([string]$web.client_secret).Trim()
  if ([string]::IsNullOrWhiteSpace($clientId) -or $clientId -notmatch '^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$') { throw 'WEB_OAUTH_CLIENT_ID_MISSING' }
  if ([string]::IsNullOrWhiteSpace($clientSecret)) { throw 'WEB_OAUTH_CLIENT_SECRET_MISSING' }
  if (@($web.javascript_origins) -notcontains $expectedOrigin) { throw 'WEB_OAUTH_ORIGIN_MISSING' }
  if (@($web.redirect_uris) -notcontains $expectedRedirectUri) { throw 'WEB_OAUTH_REDIRECT_URI_MISSING' }

  $apiKeySecure = Read-Host 'Enter the restricted Google Picker browser API key' -AsSecureString
  if ($null -eq $apiKeySecure -or $apiKeySecure.Length -eq 0) { throw 'WEB_PICKER_API_KEY_MISSING' }
  $apiKeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($apiKeySecure)
  try { $apiKeyPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($apiKeyPointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($apiKeyPointer) }
  if ($apiKeyPlain -notmatch '^AIza[A-Za-z0-9_-]{35}$') { throw 'WEB_PICKER_API_KEY_INVALID' }

  [void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]
  $vault = [Windows.Security.Credentials.PasswordVault]::new()
  Assert-ResourceUnused $vault $oauthReference
  Assert-ResourceUnused $vault $apiKeyReference

  $oauthPayload = @{ clientId = $clientId; clientSecret = $clientSecret } | ConvertTo-Json -Compress
  $vault.Add([Windows.Security.Credentials.PasswordCredential]::new($oauthReference, $oauthUserName, $oauthPayload))
  $oauthAdded = $true
  $oauthReadback = Get-ExactVaultEntry $vault $oauthReference $oauthUserName
  if ($null -eq $oauthReadback) { throw 'WEB_OAUTH_CREDENTIAL_STORAGE_FAILED' }
  $oauthReadbackValue = $oauthReadback.Password | ConvertFrom-Json
  if ($oauthReadbackValue.clientId -ne $clientId -or $oauthReadbackValue.clientSecret -ne $clientSecret) { throw 'WEB_OAUTH_CREDENTIAL_READBACK_FAILED' }

  $vault.Add([Windows.Security.Credentials.PasswordCredential]::new($apiKeyReference, $apiKeyUserName, $apiKeyPlain))
  $apiKeyAdded = $true
  $apiKeyReadback = Get-ExactVaultEntry $vault $apiKeyReference $apiKeyUserName
  if ($null -eq $apiKeyReadback -or $apiKeyReadback.Password -ne $apiKeyPlain) { throw 'WEB_PICKER_API_KEY_READBACK_FAILED' }

  [Console]::Out.WriteLine('WEB_OAUTH_CREDENTIAL_STORED=True')
  [Console]::Out.WriteLine('WEB_PICKER_API_KEY_STORED=True')
  [Console]::Out.WriteLine('WEB_PICKER_PROJECT_NUMBER_VALID=True')
  exit 0
} catch {
  if ($null -ne $vault) {
    if ($apiKeyAdded) { try { Remove-ExactVaultEntry $vault $apiKeyReference $apiKeyUserName } catch { } }
    if ($oauthAdded) { try { Remove-ExactVaultEntry $vault $oauthReference $oauthUserName } catch { } }
  }
  [Console]::Error.WriteLine('WEB_PICKER_CREDENTIAL_PROVISIONING_FAILED')
  exit 1
} finally {
  $apiKeyPlain = $null
  $oauthPayload = $null
  $clientSecret = $null
  if ($null -ne $apiKeySecure) { $apiKeySecure.Dispose() }
}
