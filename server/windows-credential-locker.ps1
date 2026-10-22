$ErrorActionPreference = 'Stop'
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  [void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]
  $vault = [Windows.Security.Credentials.PasswordVault]::new()
  if ($request.operation -eq 'load-client-secret') {
    if (-not $request.reference -or $request.reference -notmatch '^andalucia-oauth-client-secret:[A-Za-z0-9._-]+$') { throw 'INVALID_REFERENCE' }
    try {
      $entry = $vault.Retrieve($request.reference, 'ANDALUCIA_OPERATION_OAUTH_CLIENT_SECRET')
      $entry.RetrievePassword()
      [Console]::Out.Write((@{ clientSecretCredential = ($entry.Password | ConvertFrom-Json) } | ConvertTo-Json -Compress -Depth 4))
    } catch { [Console]::Out.Write('{"ok":true}') }
    exit 0
  }
  if ($request.operation -eq 'load-web-picker-oauth') {
    if ($request.reference -ne 'andalucia-web-picker-oauth:web-production') { throw 'INVALID_REFERENCE' }
    try {
      $entry = $vault.Retrieve($request.reference, 'ANDALUCIA_OPERATION_WEB_PICKER_OAUTH')
      $entry.RetrievePassword()
      [Console]::Out.Write((@{ clientSecretCredential = ($entry.Password | ConvertFrom-Json) } | ConvertTo-Json -Compress -Depth 4))
    } catch { [Console]::Out.Write('{"ok":true}') }
    exit 0
  }
  if ($request.operation -eq 'load-web-picker-api-key') {
    if ($request.reference -ne 'andalucia-web-picker-api-key:web-production') { throw 'INVALID_REFERENCE' }
    try {
      $entry = $vault.Retrieve($request.reference, 'ANDALUCIA_OPERATION_WEB_PICKER_API_KEY')
      $entry.RetrievePassword()
      [Console]::Out.Write((@{ webPickerApiKey = $entry.Password } | ConvertTo-Json -Compress))
    } catch { [Console]::Out.Write('{"ok":true}') }
    exit 0
  }
  if (-not $request.reference -or $request.reference -notmatch '^andalucia-cloud:[A-Za-z0-9._-]+$') { throw 'INVALID_REFERENCE' }
  $userName = 'ANDALUCIA_OPERATION'
  if ($request.operation -eq 'save') {
    if (-not $request.credential) { throw 'CREDENTIAL_REQUIRED' }
    try { $existing = $vault.Retrieve($request.reference, $userName); $vault.Remove($existing) } catch { }
    $payload = $request.credential | ConvertTo-Json -Compress -Depth 8
    $vault.Add([Windows.Security.Credentials.PasswordCredential]::new($request.reference, $userName, $payload))
    [Console]::Out.Write('{"ok":true}')
  } elseif ($request.operation -eq 'load') {
    try {
      $entry = $vault.Retrieve($request.reference, $userName)
      $entry.RetrievePassword()
      [Console]::Out.Write((@{ credential = ($entry.Password | ConvertFrom-Json) } | ConvertTo-Json -Compress -Depth 8))
    } catch { [Console]::Out.Write('{"ok":true}') }
  } elseif ($request.operation -eq 'remove') {
    try { $entry = $vault.Retrieve($request.reference, $userName); $vault.Remove($entry) } catch { }
    [Console]::Out.Write('{"ok":true}')
  } else { throw 'INVALID_OPERATION' }
  exit 0
} catch {
  [Console]::Error.Write('CREDENTIAL_LOCKER_OPERATION_FAILED')
  exit 1
}
