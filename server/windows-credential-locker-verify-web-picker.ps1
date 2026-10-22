$ErrorActionPreference = 'Stop'

$oauthReference = 'andalucia-web-picker-oauth:web-production'
$apiKeyReference = 'andalucia-web-picker-api-key:web-production'
$oauthUserName = 'ANDALUCIA_OPERATION_WEB_PICKER_OAUTH'
$apiKeyUserName = 'ANDALUCIA_OPERATION_WEB_PICKER_API_KEY'
$expectedProjectNumber = '716191827546'

$oauthStored = $false
$apiKeyStored = $false
$projectNumberValid = $expectedProjectNumber -match '^\d{12}$'

try {
  [void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]
  $vault = [Windows.Security.Credentials.PasswordVault]::new()

  try {
    $oauthEntry = $vault.Retrieve($oauthReference, $oauthUserName)
    $oauthEntry.RetrievePassword()
    $oauth = $oauthEntry.Password | ConvertFrom-Json
    $oauthStored = -not [string]::IsNullOrWhiteSpace([string]$oauth.clientId) -and
      ([string]$oauth.clientId) -match '^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$' -and
      -not [string]::IsNullOrWhiteSpace([string]$oauth.clientSecret)
  } catch { $oauthStored = $false }

  try {
    $apiKeyEntry = $vault.Retrieve($apiKeyReference, $apiKeyUserName)
    $apiKeyEntry.RetrievePassword()
    $apiKeyStored = $apiKeyEntry.Password -match '^AIza[A-Za-z0-9_-]{35}$'
  } catch { $apiKeyStored = $false }

  [Console]::Out.WriteLine("WEB_OAUTH_CREDENTIAL_STORED=$oauthStored")
  [Console]::Out.WriteLine("WEB_PICKER_API_KEY_STORED=$apiKeyStored")
  [Console]::Out.WriteLine("WEB_PICKER_PROJECT_NUMBER_VALID=$projectNumberValid")
  if (-not ($oauthStored -and $apiKeyStored -and $projectNumberValid)) { exit 1 }
  exit 0
} catch {
  [Console]::Error.WriteLine('WEB_PICKER_CREDENTIAL_VERIFICATION_FAILED')
  exit 1
}
