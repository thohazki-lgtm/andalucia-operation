[CmdletBinding()]
param([string]$ProjectRoot)

$ErrorActionPreference = 'Stop'
$root = if ($ProjectRoot) { [IO.Path]::GetFullPath($ProjectRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')) }
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

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'SHUTDOWN_SERVICE_SOURCE_MISSING' }
if (-not (Test-Path -LiteralPath $handshakeSource -PathType Leaf)) { throw 'SHUTDOWN_SERVICE_HANDSHAKE_SOURCE_MISSING' }
if (-not (Test-Path -LiteralPath $resolver -PathType Leaf)) { throw 'SHUTDOWN_SERVICE_SOURCE_RESOLVER_MISSING' }
. $resolver
$approved = Get-AndaluciaApprovedSourceState -ProjectRoot $root
if ($approved.Branch -ne 'main') { throw 'SHUTDOWN_SERVICE_APPROVED_MAIN_REQUIRED' }
$git = (Get-Command git.exe -ErrorAction Stop).Source
$identityPath = Join-Path $root '.data\andalucia-store-identity.json'
$identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
$canonicalData = [IO.Path]::GetFullPath((Join-Path $root '.data\postgres'))
if ($identity.role -ne 'canonical' -or [IO.Path]::GetFullPath([string]$identity.databaseDirectory) -ne $canonicalData) { throw 'SHUTDOWN_SERVICE_CANONICAL_IDENTITY_MISMATCH' }

$administrator = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $administrator) { throw 'SHUTDOWN_SERVICE_ADMINISTRATOR_INSTALL_REQUIRED' }
New-Item -ItemType Directory -Path $serviceRoot,$controlRoot,$logRoot -Force | Out-Null
$typeDefinition = Get-Content -LiteralPath $source -Raw
if (Test-Path -LiteralPath $serviceExeCandidate) { Remove-Item -LiteralPath $serviceExeCandidate -Force }
Add-Type -TypeDefinition $typeDefinition -OutputAssembly $serviceExeCandidate -OutputType ConsoleApplication

$serviceIdentity = "NT SERVICE\$serviceName"
$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existingService -and $existingService.Status -ne 'Stopped') {
  Stop-Service -Name $serviceName
  $existingService.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(15))
}
Move-Item -LiteralPath $serviceExeCandidate -Destination $serviceExe -Force
Copy-Item -LiteralPath $handshakeSource -Destination $handshakeInstalled -Force
$handshakeSha256 = (Get-FileHash -LiteralPath $handshakeInstalled -Algorithm SHA256).Hash.ToLowerInvariant()
$binaryPath = ('"{0}" --project-root "{1}" --expected-sha {2} --git-path "{3}" --handshake-sha256 {4} --timeout-seconds 45' -f $serviceExe, $root, $approved.Sha, $git, $handshakeSha256)
if ($existingService) {
  & sc.exe config $serviceName binPath= $binaryPath start= auto obj= 'NT AUTHORITY\LocalService' DisplayName= 'ANDALUCIA OPERATION - Graceful Shutdown Guard' | Out-Null
} else {
  & sc.exe create $serviceName binPath= $binaryPath start= auto obj= 'NT AUTHORITY\LocalService' DisplayName= 'ANDALUCIA OPERATION - Graceful Shutdown Guard' | Out-Null
}
if ($LASTEXITCODE -ne 0) { throw 'SHUTDOWN_SERVICE_CREATE_FAILED' }
& sc.exe sidtype $serviceName restricted | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'SHUTDOWN_SERVICE_SID_CONFIGURATION_FAILED' }
& sc.exe preshutdown $serviceName 60000 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'SHUTDOWN_SERVICE_PRESHUTDOWN_CONFIGURATION_FAILED' }

# Grant the service only traversal/read access needed to validate identity and marker state,
# plus modify access to its guarded control and durable log directories.
& icacls.exe $serviceRoot /inheritance:r /grant:r 'SYSTEM:(OI)(CI)(F)' 'BUILTIN\Administrators:(OI)(CI)(F)' "${serviceIdentity}:(OI)(CI)(RX)" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'SHUTDOWN_SERVICE_BINARY_ACL_FAILED' }
foreach ($path in @($root,(Join-Path $root '.data'),$canonicalData,(Join-Path $root '.backups'),(Join-Path $root '.backups\.db2'),(Join-Path $root '.backups\.db2\scheduler'),(Join-Path $root '.runtime'))) { & icacls.exe $path /grant "${serviceIdentity}:(RX)" | Out-Null; if ($LASTEXITCODE -ne 0) { throw "SHUTDOWN_SERVICE_ACL_FAILED:$path" } }
$gitMetadata = Join-Path $root '.git'
if ((Get-Item -LiteralPath $gitMetadata).PSIsContainer) { & icacls.exe $gitMetadata /grant "${serviceIdentity}:(OI)(CI)(RX)" | Out-Null } else { & icacls.exe $gitMetadata /grant "${serviceIdentity}:(R)" | Out-Null }
if ($LASTEXITCODE -ne 0) { throw 'SHUTDOWN_SERVICE_GIT_METADATA_ACL_FAILED' }
& icacls.exe $identityPath /grant "${serviceIdentity}:(R)" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'SHUTDOWN_SERVICE_IDENTITY_ACL_FAILED' }
foreach ($path in @($controlRoot,$logRoot)) { & icacls.exe $path /grant "${serviceIdentity}:(OI)(CI)(M)" | Out-Null; if ($LASTEXITCODE -ne 0) { throw "SHUTDOWN_SERVICE_WRITE_ACL_FAILED:$path" } }

$legacyTask = 'ANDALUCIA OPERATION - Graceful Windows Shutdown'
if (Get-ScheduledTask -TaskName $legacyTask -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $legacyTask -Confirm:$false }
Start-Service -Name $serviceName
$service = Get-Service -Name $serviceName
if ($service.Status -ne 'Running') { throw 'SHUTDOWN_SERVICE_NOT_RUNNING' }
[pscustomobject]@{ Service=$serviceName; Status=$service.Status; SourceSha=$approved.Sha; Account='NT AUTHORITY\LocalService'; PreshutdownTimeoutMs=60000 }
