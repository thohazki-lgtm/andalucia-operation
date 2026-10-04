$ErrorActionPreference = 'Stop'
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if (-not $request.reference -or $request.reference -notmatch '^andalucia-cloud:[A-Za-z0-9._-]+$') { throw 'INVALID_REFERENCE' }
  [void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]
  $vault = [Windows.Security.Credentials.PasswordVault]::new()
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
