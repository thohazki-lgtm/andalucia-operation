[CmdletBinding()]
param(
  [string]$SourceRoot,
  [string]$CanonicalProjectRoot,
  [string]$ProjectRoot
)

$ErrorActionPreference = 'Stop'
$sourceRoot = if ($SourceRoot) { [IO.Path]::GetFullPath($SourceRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')) }
$root = if ($CanonicalProjectRoot) { [IO.Path]::GetFullPath($CanonicalProjectRoot) } elseif ($ProjectRoot) { [IO.Path]::GetFullPath($ProjectRoot) } else { $sourceRoot }
$serviceName = 'AndaluciaShutdownGuard'
$source = Join-Path $PSScriptRoot 'AndaluciaWindowsShutdownService.cs'
$resolver = Join-Path $PSScriptRoot 'Resolve-AndaluciaApprovedSource.ps1'
$serviceRoot = Join-Path $env:ProgramFiles 'ANDALUCIA OPERATION\ShutdownGuard'
$serviceExe = Join-Path $serviceRoot 'AndaluciaWindowsShutdownService.exe'
$serviceExeCandidate = Join-Path $serviceRoot 'AndaluciaWindowsShutdownService.exe.new'
$handshakeSource = Join-Path $PSScriptRoot 'Watch-AndaluciaWindowsShutdown.ps1'
$handshakeInstalled = Join-Path $serviceRoot 'Watch-AndaluciaWindowsShutdown.ps1'
$controlRoot = Join-Path $root '.backups\.db2\scheduler\control'
$logRoot = Join-Path $root '.runtime\logs'
$scExecutable = Join-Path $env:SystemRoot 'System32\sc.exe'

function Invoke-AndaluciaScCommand {
  param(
    [Parameter(Mandatory)][string]$FailureCode,
    [Parameter(Mandatory)][string[]]$Arguments
  )

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # Windows PowerShell converts native stderr into ErrorRecord objects. Keep it
    # non-terminating long enough to preserve the complete SCM diagnostic.
    $ErrorActionPreference = 'Continue'
    $nativeOutput = @(& $scExecutable @Arguments 2>&1)
    $nativeExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($nativeExitCode -ne 0) {
    $nativeDetail = (($nativeOutput | ForEach-Object { $_.ToString().Trim() }) | Where-Object { $_ }) -join ' | '
    if (-not $nativeDetail) { $nativeDetail = 'No diagnostic text was returned by sc.exe.' }
    throw ('{0}:WIN32_EXIT_{1}:{2}' -f $FailureCode, $nativeExitCode, $nativeDetail)
  }

  return $nativeOutput
}

function Set-AndaluciaPreshutdownTimeout {
  param(
    [Parameter(Mandatory)][string]$RegistryPath,
    [Parameter(Mandatory)][ValidateRange(1000,180000)][int]$TimeoutMs
  )

  try {
    New-ItemProperty -LiteralPath $RegistryPath -Name 'PreshutdownTimeout' -PropertyType DWord -Value $TimeoutMs -Force | Out-Null
    $configuredTimeout = [int](Get-ItemPropertyValue -LiteralPath $RegistryPath -Name 'PreshutdownTimeout')
  } catch {
    throw "SHUTDOWN_SERVICE_PRESHUTDOWN_CONFIGURATION_FAILED:$($_.Exception.Message)"
  }
  if ($configuredTimeout -ne $TimeoutMs) { throw 'SHUTDOWN_SERVICE_PRESHUTDOWN_CONFIGURATION_MISMATCH' }
}

function Get-AndaluciaFileSha256 {
  param([Parameter(Mandatory)][string]$Path)
  $stream = [IO.File]::OpenRead($Path)
  try {
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
    finally { $sha256.Dispose() }
  } finally {
    $stream.Dispose()
  }
}

function Install-AndaluciaServiceExecutable {
  param(
    [Parameter(Mandatory)][string]$CandidatePath,
    [Parameter(Mandatory)][string]$DestinationPath
  )

  if (-not (Test-Path -LiteralPath $CandidatePath -PathType Leaf)) { throw 'SHUTDOWN_SERVICE_EXECUTABLE_CANDIDATE_MISSING' }
  $candidateSha256 = Get-AndaluciaFileSha256 -Path $CandidatePath
  if (-not (Test-Path -LiteralPath $DestinationPath -PathType Leaf)) {
    [IO.File]::Move($CandidatePath, $DestinationPath)
    if ((Get-AndaluciaFileSha256 -Path $DestinationPath) -ne $candidateSha256) { throw 'SHUTDOWN_SERVICE_EXECUTABLE_INSTALL_VERIFICATION_FAILED' }
    return [pscustomobject]@{ Status='Installed'; CandidateSha256=$candidateSha256; PreviousSha256=$null; RollbackPath=$null }
  }

  $previousSha256 = Get-AndaluciaFileSha256 -Path $DestinationPath
  if ($previousSha256 -eq $candidateSha256) {
    Remove-Item -LiteralPath $CandidatePath -Force
    return [pscustomobject]@{ Status='Reused'; CandidateSha256=$candidateSha256; PreviousSha256=$previousSha256; RollbackPath=$null }
  }

  # Keep the sibling rollback name compact. Windows PowerShell 5.1 commonly runs
  # this installer from long protected paths, and embedding a 64-character hash
  # in the filename can exceed the legacy Windows path limit before File.Replace
  # has a chance to preserve the old image. The verified hash remains bound in
  # the returned replacement record and is checked before any rollback.
  $rollbackPath = '{0}.rollback.{1}' -f $DestinationPath,[Guid]::NewGuid().ToString('N')
  if (Test-Path -LiteralPath $rollbackPath) { throw 'SHUTDOWN_SERVICE_EXECUTABLE_ROLLBACK_PATH_CONFLICT' }
  [IO.File]::Replace($CandidatePath, $DestinationPath, $rollbackPath, $true)
  if ((Get-AndaluciaFileSha256 -Path $DestinationPath) -ne $candidateSha256 -or (Get-AndaluciaFileSha256 -Path $rollbackPath) -ne $previousSha256) {
    throw "SHUTDOWN_SERVICE_EXECUTABLE_REPLACEMENT_VERIFICATION_FAILED:$rollbackPath"
  }
  return [pscustomobject]@{ Status='Replaced'; CandidateSha256=$candidateSha256; PreviousSha256=$previousSha256; RollbackPath=$rollbackPath }
}

function Restore-AndaluciaServiceExecutable {
  param(
    [Parameter(Mandatory)][string]$DestinationPath,
    [Parameter(Mandatory)][string]$RollbackPath,
    [Parameter(Mandatory)][string]$ExpectedInstalledSha256,
    [Parameter(Mandatory)][string]$ExpectedRollbackSha256
  )

  if (-not (Test-Path -LiteralPath $DestinationPath -PathType Leaf) -or -not (Test-Path -LiteralPath $RollbackPath -PathType Leaf)) { throw 'SHUTDOWN_SERVICE_EXECUTABLE_ROLLBACK_FILE_MISSING' }
  if ((Get-AndaluciaFileSha256 -Path $DestinationPath) -ne $ExpectedInstalledSha256 -or (Get-AndaluciaFileSha256 -Path $RollbackPath) -ne $ExpectedRollbackSha256) { throw 'SHUTDOWN_SERVICE_EXECUTABLE_ROLLBACK_BINDING_INVALID' }
  $failedCandidatePath = '{0}.failed.{1}' -f $DestinationPath,[Guid]::NewGuid().ToString('N')
  [IO.File]::Replace($RollbackPath, $DestinationPath, $failedCandidatePath, $true)
  if ((Get-AndaluciaFileSha256 -Path $DestinationPath) -ne $ExpectedRollbackSha256 -or (Get-AndaluciaFileSha256 -Path $failedCandidatePath) -ne $ExpectedInstalledSha256) { throw 'SHUTDOWN_SERVICE_EXECUTABLE_ROLLBACK_VERIFICATION_FAILED' }
  return [pscustomobject]@{ Status='RolledBack'; RestoredSha256=$ExpectedRollbackSha256; FailedCandidatePath=$failedCandidatePath }
}

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'SHUTDOWN_SERVICE_SOURCE_MISSING' }
if (-not (Test-Path -LiteralPath $handshakeSource -PathType Leaf)) { throw 'SHUTDOWN_SERVICE_HANDSHAKE_SOURCE_MISSING' }
if (-not (Test-Path -LiteralPath $resolver -PathType Leaf)) { throw 'SHUTDOWN_SERVICE_SOURCE_RESOLVER_MISSING' }
. $resolver
$approved = Get-AndaluciaApprovedSourceState -ProjectRoot $sourceRoot -CanonicalProjectRoot $root
if ($approved.Branch -ne 'main') { throw 'SHUTDOWN_SERVICE_APPROVED_MAIN_REQUIRED' }
$git = (Get-Command git.exe -ErrorAction Stop).Source
$identityPath = Join-Path $root '.data\andalucia-store-identity.json'
$identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
$canonicalData = [IO.Path]::GetFullPath((Join-Path $root '.data\postgres'))
if ($identity.role -ne 'canonical' -or [IO.Path]::GetFullPath([string]$identity.databaseDirectory) -ne $canonicalData) { throw 'SHUTDOWN_SERVICE_CANONICAL_IDENTITY_MISMATCH' }

$administrator = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $administrator) { throw 'SHUTDOWN_SERVICE_ADMINISTRATOR_INSTALL_REQUIRED' }
New-Item -ItemType Directory -Path $serviceRoot,$controlRoot,$logRoot -Force | Out-Null
if (Test-Path -LiteralPath $serviceExeCandidate) { Remove-Item -LiteralPath $serviceExeCandidate -Force }
$cscExecutable = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $cscExecutable -PathType Leaf)) { throw 'SHUTDOWN_SERVICE_ARM64_COMPILER_MISSING' }
$previousErrorActionPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = 'Continue'
  $compilerOutput = @(& $cscExecutable /nologo /target:exe /platform:anycpu "/out:$serviceExeCandidate" $source 2>&1)
  $compilerExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}
if ($compilerExitCode -ne 0 -or -not (Test-Path -LiteralPath $serviceExeCandidate -PathType Leaf)) {
  $compilerDetail = (($compilerOutput | ForEach-Object { $_.ToString().Trim() }) | Where-Object { $_ }) -join ' | '
  if (-not $compilerDetail) { $compilerDetail = 'The AnyCPU service image was not produced.' }
  throw "SHUTDOWN_SERVICE_ARM64_COMPILE_FAILED:WIN32_EXIT_${compilerExitCode}:$compilerDetail"
}

$serviceIdentity = "NT SERVICE\$serviceName"
$accountIdentity = 'NT AUTHORITY\LOCAL SERVICE'
$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
$existingServiceConfiguration = if ($existingService) { Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction Stop } else { $null }
$expectedServiceAccount = 'NT AUTHORITY\LocalService'
if ($existingServiceConfiguration -and [string]$existingServiceConfiguration.StartName -ne $expectedServiceAccount) { throw 'SHUTDOWN_SERVICE_EXISTING_ACCOUNT_MISMATCH' }
$existingServiceWasRunning = [bool]($existingService -and $existingService.Status -ne 'Stopped')
if ($existingService -and $existingService.Status -ne 'Stopped') {
  Stop-Service -Name $serviceName
  $existingService.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(15))
}
$handshakeRollbackPath = $null
if (Test-Path -LiteralPath $handshakeInstalled -PathType Leaf) {
  $handshakeRollbackPath = '{0}.rollback.{1}.{2}' -f $handshakeInstalled,(Get-AndaluciaFileSha256 -Path $handshakeInstalled),[Guid]::NewGuid().ToString('N')
  Copy-Item -LiteralPath $handshakeInstalled -Destination $handshakeRollbackPath
}
$executableReplacement = $null
$serviceCreatedThisAttempt = $false
try {
  $executableReplacement = Install-AndaluciaServiceExecutable -CandidatePath $serviceExeCandidate -DestinationPath $serviceExe
  Copy-Item -LiteralPath $handshakeSource -Destination $handshakeInstalled -Force
  $handshakeSha256 = Get-AndaluciaFileSha256 -Path $handshakeInstalled
  $binaryPath = ('\"{0}\" --source-root \"{1}\" --canonical-project-root \"{2}\" --expected-sha {3} --git-path \"{4}\" --handshake-sha256 {5} --timeout-seconds 45' -f $serviceExe, $sourceRoot, $root, $approved.Sha, $git, $handshakeSha256)
  if ($existingService) {
    Invoke-AndaluciaScCommand -FailureCode 'SHUTDOWN_SERVICE_CONFIG_FAILED' -Arguments @('config',$serviceName,'binPath=',$binaryPath,'start=','auto','obj=','NT AUTHORITY\LocalService','DisplayName=','ANDALUCIA OPERATION - Graceful Shutdown Guard') | Out-Null
  } else {
    Invoke-AndaluciaScCommand -FailureCode 'SHUTDOWN_SERVICE_CREATE_FAILED' -Arguments @('create',$serviceName,'binPath=',$binaryPath,'start=','auto','obj=','NT AUTHORITY\LocalService','DisplayName=','ANDALUCIA OPERATION - Graceful Shutdown Guard') | Out-Null
    $serviceCreatedThisAttempt = $true
  }
  Invoke-AndaluciaScCommand -FailureCode 'SHUTDOWN_SERVICE_SID_CONFIGURATION_FAILED' -Arguments @('sidtype',$serviceName,'restricted') | Out-Null
  $serviceRegistryPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName"
  Set-AndaluciaPreshutdownTimeout -RegistryPath $serviceRegistryPath -TimeoutMs 60000

# A restricted service token must pass access checks for both LocalService and the
# restricted service SID. Keep ancestor grants traverse-only and scope read/write
# permissions to the exact runtime evidence and guarded service directories.
function Grant-AndaluciaServiceAcl {
  param([Parameter(Mandatory=$true)][string]$Path,[Parameter(Mandatory=$true)][string]$Rights,[switch]$Replace)
  $verb = if ($Replace) { '/grant:r' } else { '/grant' }
  & icacls.exe $Path $verb "${serviceIdentity}:$Rights" "${accountIdentity}:$Rights" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "SHUTDOWN_SERVICE_ACL_FAILED:${Path}:$Rights" }
}

& icacls.exe $serviceRoot /inheritance:r /grant:r 'SYSTEM:(OI)(CI)(F)' 'BUILTIN\Administrators:(OI)(CI)(F)' "${serviceIdentity}:(OI)(CI)(RX)" "${accountIdentity}:(OI)(CI)(RX)" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'SHUTDOWN_SERVICE_BINARY_ACL_FAILED' }
$profileRoot = [IO.Path]::GetFullPath((Join-Path $env:SystemDrive 'Users'))
if (-not $root.StartsWith(($profileRoot + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) { throw 'SHUTDOWN_SERVICE_PROJECT_ROOT_OUTSIDE_USER_PROFILE' }
$ancestor = [IO.DirectoryInfo]::new($root)
while ($ancestor -and $ancestor.FullName -ne $profileRoot -and $ancestor.Parent) {
  Grant-AndaluciaServiceAcl -Path $ancestor.FullName -Rights '(X)'
  $ancestor = $ancestor.Parent
}
foreach ($path in @((Join-Path $root '.data'),$canonicalData,(Join-Path $root '.backups'),(Join-Path $root '.backups\.db2'),(Join-Path $root '.backups\.db2\scheduler'),(Join-Path $root '.runtime'))) { Grant-AndaluciaServiceAcl -Path $path -Rights '(RX)' }
Grant-AndaluciaServiceAcl -Path $sourceRoot -Rights '(OI)(CI)(RX)'
$gitMetadata = Join-Path $sourceRoot '.git'
if ((Get-Item -LiteralPath $gitMetadata -Force).PSIsContainer) { Grant-AndaluciaServiceAcl -Path $gitMetadata -Rights '(OI)(CI)(RX)' } else { Grant-AndaluciaServiceAcl -Path $gitMetadata -Rights '(R)' }
if ($LASTEXITCODE -ne 0) { throw 'SHUTDOWN_SERVICE_GIT_METADATA_ACL_FAILED' }
$gitCommonMetadata = ((@(& git -C $sourceRoot rev-parse --path-format=absolute --git-common-dir)) -join '').Trim()
if (-not $gitCommonMetadata -or -not (Test-Path -LiteralPath $gitCommonMetadata)) { throw 'SHUTDOWN_SERVICE_GIT_COMMON_METADATA_MISSING' }
Grant-AndaluciaServiceAcl -Path $gitCommonMetadata -Rights '(OI)(CI)(RX)'
if ($LASTEXITCODE -ne 0) { throw 'SHUTDOWN_SERVICE_GIT_COMMON_METADATA_ACL_FAILED' }
Grant-AndaluciaServiceAcl -Path $identityPath -Rights '(R)'
if ($LASTEXITCODE -ne 0) { throw 'SHUTDOWN_SERVICE_IDENTITY_ACL_FAILED' }
$runtimeApprovalPath = Join-Path $root '.runtime\approved-runtime-source.json'
Grant-AndaluciaServiceAcl -Path $runtimeApprovalPath -Rights '(R)'
foreach ($path in @($controlRoot,$logRoot)) { Grant-AndaluciaServiceAcl -Path $path -Rights '(OI)(CI)(M)' }

  Start-Service -Name $serviceName
  $service = Get-Service -Name $serviceName
  if ($service.Status -ne 'Running') { throw 'SHUTDOWN_SERVICE_NOT_RUNNING' }
  $legacyTask = 'ANDALUCIA OPERATION - Graceful Windows Shutdown'
  if (Get-ScheduledTask -TaskName $legacyTask -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $legacyTask -Confirm:$false }
  [pscustomobject]@{ Service=$serviceName; Status=$service.Status; SourceSha=$approved.Sha; Account='NT AUTHORITY\LocalService'; PreshutdownTimeoutMs=60000; ExecutableStatus=$executableReplacement.Status; RollbackExecutable=$executableReplacement.RollbackPath }
} catch {
  $installFailure = $_.Exception.Message
  $rollbackFailures = [Collections.Generic.List[string]]::new()
  try {
    $currentService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($currentService -and $currentService.Status -ne 'Stopped') { Stop-Service -Name $serviceName -Force; $currentService.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(15)) }
  } catch { $rollbackFailures.Add("service-stop:$($_.Exception.Message)") }
  if ($executableReplacement -and $executableReplacement.Status -eq 'Replaced') {
    try { Restore-AndaluciaServiceExecutable -DestinationPath $serviceExe -RollbackPath $executableReplacement.RollbackPath -ExpectedInstalledSha256 $executableReplacement.CandidateSha256 -ExpectedRollbackSha256 $executableReplacement.PreviousSha256 | Out-Null } catch { $rollbackFailures.Add("executable:$($_.Exception.Message)") }
  }
  if ($handshakeRollbackPath) {
    try { Copy-Item -LiteralPath $handshakeRollbackPath -Destination $handshakeInstalled -Force } catch { $rollbackFailures.Add("handshake:$($_.Exception.Message)") }
  }
  if ($serviceCreatedThisAttempt) {
    try { Invoke-AndaluciaScCommand -FailureCode 'SHUTDOWN_SERVICE_ROLLBACK_DELETE_FAILED' -Arguments @('delete',$serviceName) | Out-Null } catch { $rollbackFailures.Add("service-delete:$($_.Exception.Message)") }
  } elseif ($existingServiceConfiguration) {
    $previousStartMode = switch ([string]$existingServiceConfiguration.StartMode) { 'Auto' { 'auto' } 'Manual' { 'demand' } 'Disabled' { 'disabled' } default { $null } }
    if (-not $previousStartMode) {
      $rollbackFailures.Add("configuration:SHUTDOWN_SERVICE_ROLLBACK_START_MODE_UNSUPPORTED:$($existingServiceConfiguration.StartMode)")
    } else {
      try {
        Invoke-AndaluciaScCommand -FailureCode 'SHUTDOWN_SERVICE_ROLLBACK_CONFIG_FAILED' -Arguments @('config',$serviceName,'binPath=',([string]$existingServiceConfiguration.PathName),'start=',$previousStartMode,'obj=',([string]$existingServiceConfiguration.StartName),'DisplayName=',([string]$existingServiceConfiguration.DisplayName)) | Out-Null
      } catch { $rollbackFailures.Add("configuration:$($_.Exception.Message)") }
    }
  }
  if ($existingServiceWasRunning) {
    try { Start-Service -Name $serviceName; (Get-Service -Name $serviceName).WaitForStatus([ServiceProcess.ServiceControllerStatus]::Running,[TimeSpan]::FromSeconds(15)) } catch { $rollbackFailures.Add("service-start:$($_.Exception.Message)") }
  }
  if ($rollbackFailures.Count -gt 0) { throw "SHUTDOWN_SERVICE_INSTALL_FAILED_ROLLBACK_FAILED:${installFailure}:$($rollbackFailures -join '|')" }
  throw "SHUTDOWN_SERVICE_INSTALL_FAILED_ROLLED_BACK:${installFailure}"
}
