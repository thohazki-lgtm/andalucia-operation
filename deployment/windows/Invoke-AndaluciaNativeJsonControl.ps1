function Invoke-AndaluciaNativeJsonControl {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$ExecutablePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [Parameter(Mandatory = $true)][string]$Payload
  )

  if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) { throw 'ANDALUCIA_NATIVE_CONTROL_EXECUTABLE_MISSING' }
  $quotedArguments = foreach ($argument in $ArgumentList) {
    if ([string]$argument -match '"') { throw 'ANDALUCIA_NATIVE_CONTROL_ARGUMENT_INVALID' }
    '"{0}"' -f ([string]$argument)
  }
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $ExecutablePath
  $start.Arguments = $quotedArguments -join ' '
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $start
  try {
    if (-not $process.Start()) { throw 'ANDALUCIA_NATIVE_CONTROL_START_FAILED' }
    $process.StandardInput.Write($Payload)
    $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
      $detail = $stderr.Trim()
      if ([string]::IsNullOrWhiteSpace($detail)) { $detail = $stdout.Trim() }
      if ([string]::IsNullOrWhiteSpace($detail)) { $detail = "ANDALUCIA_NATIVE_CONTROL_EXIT_CODE:$($process.ExitCode)" }
      throw $detail
    }
    return $stdout
  } finally {
    $process.Dispose()
    $stdout = $null
    $stderr = $null
  }
}
