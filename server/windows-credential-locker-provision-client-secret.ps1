param(
  [string]$Reference = 'andalucia-oauth-client-secret:desktop-production'
)

$ErrorActionPreference = 'Stop'
try {
  if ($Reference -notmatch '^andalucia-oauth-client-secret:[A-Za-z0-9._-]+$') { throw 'INVALID_REFERENCE' }
  $credentialsPath = Read-Host 'Enter the full local path to the downloaded Google Desktop OAuth credentials JSON'
  $resolved = (Resolve-Path -LiteralPath $credentialsPath -ErrorAction Stop).Path
  $file = Get-Item -LiteralPath $resolved -Force
  if (-not $file.PSIsContainer -and -not ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    $document = Get-Content -LiteralPath $resolved -Raw | ConvertFrom-Json
    $desktop = $document.installed
    if (-not $desktop.client_id -or -not $desktop.client_secret) { throw 'DESKTOP_OAUTH_CREDENTIALS_INVALID' }
    $payload = @{ clientId = [string]$desktop.client_id; clientSecret = [string]$desktop.client_secret } | ConvertTo-Json -Compress
    [void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]
    $vault = [Windows.Security.Credentials.PasswordVault]::new()
    $userName = 'ANDALUCIA_OPERATION_OAUTH_CLIENT_SECRET'
    try { $existing = $vault.Retrieve($Reference, $userName); $vault.Remove($existing) } catch { }
    $vault.Add([Windows.Security.Credentials.PasswordCredential]::new($Reference, $userName, $payload))
    [Console]::Out.WriteLine('OAUTH_CLIENT_SECRET_STORED=True')
    [Console]::Out.WriteLine("CREDENTIAL_REFERENCE=$Reference")
    [Console]::Out.WriteLine("CLIENT_ID=$($desktop.client_id)")
  } else { throw 'DESKTOP_OAUTH_CREDENTIALS_FILE_INVALID' }
  exit 0
} catch {
  [Console]::Error.WriteLine('OAUTH_CLIENT_SECRET_PROVISIONING_FAILED')
  exit 1
}
