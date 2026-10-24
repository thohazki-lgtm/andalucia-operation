[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$jobScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Invoke-AndaluciaDatabaseJob.ps1'))
$runtimeScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Start-AndaluciaGuardedApplication.ps1'))
$shutdownScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Stop-AndaluciaGuardedApplication.ps1'))
$sourceResolver = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Resolve-AndaluciaApprovedSource.ps1'))
$exportRoot = Join-Path $projectRoot '.backups\.db2\scheduler\task-exports'
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$runtimeName = 'ANDALUCIA OPERATION - Guarded Application'
$shutdownName = 'ANDALUCIA OPERATION - Graceful Windows Shutdown'
$dailyName = 'ANDALUCIA OPERATION - Daily Verified Backup'
$rehearsalName = 'ANDALUCIA OPERATION - Weekly Restore Rehearsal'

function Assert-ApprovedCheckout {
  if (-not (Test-Path -LiteralPath $sourceResolver -PathType Leaf)) { throw 'SCHEDULER_INSTALL_SOURCE_RESOLVER_MISSING' }
  . $sourceResolver
  return Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot
}

function Assert-RuntimeTaskSafety {
  [xml]$definition = Export-ScheduledTask -TaskName $runtimeName
  $namespace = [Xml.XmlNamespaceManager]::new($definition.NameTable)
  $namespace.AddNamespace('t', 'http://schemas.microsoft.com/windows/2004/02/mit/task')
  $stopOnIdleEnd = $definition.SelectSingleNode('//t:Settings/t:IdleSettings/t:StopOnIdleEnd', $namespace).InnerText
  $allowHardTerminate = $definition.SelectSingleNode('//t:Settings/t:AllowHardTerminate', $namespace).InnerText
  $executionLimit = $definition.SelectSingleNode('//t:Settings/t:ExecutionTimeLimit', $namespace).InnerText
  $workingDirectory = $definition.SelectSingleNode('//t:Actions/t:Exec/t:WorkingDirectory', $namespace).InnerText
  if ($stopOnIdleEnd -ne 'false') { throw 'RUNTIME_TASK_SAFETY_DRIFT:StopOnIdleEnd' }
  if ($allowHardTerminate -ne 'false') { throw 'RUNTIME_TASK_SAFETY_DRIFT:AllowHardTerminate' }
  if ($executionLimit -ne 'PT0S') { throw 'RUNTIME_TASK_SAFETY_DRIFT:ExecutionTimeLimit' }
  if ([IO.Path]::GetFullPath($workingDirectory) -ne $projectRoot) { throw 'RUNTIME_TASK_SAFETY_DRIFT:WorkingDirectory' }
}

function Register-GracefulShutdownTask([string]$PowerShellPath) {
  $service = New-Object -ComObject 'Schedule.Service'
  $service.Connect()
  $folder = $service.GetFolder('\')
  $definition = $service.NewTask(0)
  $definition.RegistrationInfo.Description = 'Gracefully releases the Andalucía canonical PGlite owner before a Windows shutdown or restart.'
  $definition.Principal.UserId = $currentUser
  # The User32 1074 event is raised while Windows is already tearing down the
  # interactive desktop session. An InteractiveToken task can therefore fail
  # before PowerShell initializes (NTSTATUS 0xC0000142), leaving PGlite's
  # ownership marker behind. S4U keeps the same limited user identity but lets
  # Task Scheduler launch the local shutdown handshake independently of the
  # closing interactive session; no password is stored and no elevation is used.
  $definition.Principal.LogonType = 2
  $definition.Principal.RunLevel = 0
  $definition.Settings.Enabled = $true
  $definition.Settings.StartWhenAvailable = $true
  $definition.Settings.MultipleInstances = 2
  $definition.Settings.DisallowStartIfOnBatteries = $false
  $definition.Settings.StopIfGoingOnBatteries = $false
  $definition.Settings.ExecutionTimeLimit = 'PT2M'
  $definition.Settings.AllowHardTerminate = $false
  $trigger = $definition.Triggers.Create(0)
  $trigger.Enabled = $true
  $trigger.Subscription = "<QueryList><Query Id='0' Path='System'><Select Path='System'>*[System[Provider[@Name='User32'] and EventID=1074]]</Select></Query></QueryList>"
  $action = $definition.Actions.Create(0)
  $action.Path = $PowerShellPath
  $action.Arguments = ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"{0}`"" -f $shutdownScript)
  $action.WorkingDirectory = $projectRoot
  $taskCreateOrUpdate = 6
  $taskLogonS4U = 2
  $folder.RegisterTaskDefinition($shutdownName, $definition, $taskCreateOrUpdate, $currentUser, $null, $taskLogonS4U, $null) | Out-Null
}

function Assert-ShutdownTaskSafety {
  [xml]$definition = Export-ScheduledTask -TaskName $shutdownName
  $namespace = [Xml.XmlNamespaceManager]::new($definition.NameTable)
  $namespace.AddNamespace('t', 'http://schemas.microsoft.com/windows/2004/02/mit/task')
  $subscription = $definition.SelectSingleNode('//t:Triggers/t:EventTrigger/t:Subscription', $namespace).InnerText
  $command = $definition.SelectSingleNode('//t:Actions/t:Exec/t:Command', $namespace).InnerText
  $arguments = $definition.SelectSingleNode('//t:Actions/t:Exec/t:Arguments', $namespace).InnerText
  $workingDirectory = $definition.SelectSingleNode('//t:Actions/t:Exec/t:WorkingDirectory', $namespace).InnerText
  $allowHardTerminate = $definition.SelectSingleNode('//t:Settings/t:AllowHardTerminate', $namespace).InnerText
  $logonType = $definition.SelectSingleNode('//t:Principals/t:Principal/t:LogonType', $namespace).InnerText
  if ($subscription -notmatch 'EventID=1074' -or $subscription -notmatch "Provider\[@Name='User32'\]") { throw 'SHUTDOWN_TASK_SAFETY_DRIFT:EventTrigger' }
  if ([IO.Path]::GetFullPath($command) -ne [IO.Path]::GetFullPath((Join-Path $PSHOME 'powershell.exe'))) { throw 'SHUTDOWN_TASK_SAFETY_DRIFT:PowerShell' }
  if ($arguments -notlike "*$shutdownScript*") { throw 'SHUTDOWN_TASK_SAFETY_DRIFT:Script' }
  if ([IO.Path]::GetFullPath($workingDirectory) -ne $projectRoot) { throw 'SHUTDOWN_TASK_SAFETY_DRIFT:WorkingDirectory' }
  if ($allowHardTerminate -ne 'false') { throw 'SHUTDOWN_TASK_SAFETY_DRIFT:AllowHardTerminate' }
  if ($logonType -ne 'S4U') { throw 'SHUTDOWN_TASK_SAFETY_DRIFT:LogonType' }
}

function Set-RuntimeTaskHardTerminateProtection {
  # On this Windows Task Scheduler provider, New-ScheduledTaskSettingsSet
  # accepts -DisallowHardTerminate but does not serialize the setting. The
  # supported COM API exposes the inverse AllowHardTerminate property.
  $service = New-Object -ComObject 'Schedule.Service'
  $service.Connect()
  $folder = $service.GetFolder('\')
  $task = $folder.GetTask($runtimeName)
  $definition = $task.Definition
  $definition.Settings.AllowHardTerminate = $false
  $taskCreateOrUpdate = 6
  $taskLogonInteractiveToken = 3
  $folder.RegisterTaskDefinition($runtimeName, $definition, $taskCreateOrUpdate, $currentUser, $null, $taskLogonInteractiveToken, $null) | Out-Null
}

foreach ($path in @($jobScript, $runtimeScript, $shutdownScript, $sourceResolver)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "SCHEDULER_SCRIPT_MISSING:$path" } }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.data\postgres\PG_VERSION') -PathType Leaf)) { throw 'ANDALUCIA_CANONICAL_STORE_MISSING' }
$approvedSource = Assert-ApprovedCheckout

$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$commonSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$runtimeSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd -DisallowHardTerminate -ExecutionTimeLimit ([TimeSpan]::Zero)
$powerShell = Join-Path $PSHOME 'powershell.exe'
$runtimeAction = New-ScheduledTaskAction -Execute $powerShell -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"{0}`"" -f $runtimeScript) -WorkingDirectory $projectRoot
$dailyAction = New-ScheduledTaskAction -Execute $powerShell -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"{0}`" -Job DailyBackup" -f $jobScript) -WorkingDirectory $projectRoot
$rehearsalAction = New-ScheduledTaskAction -Execute $powerShell -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"{0}`" -Job WeeklyRestoreRehearsal" -f $jobScript) -WorkingDirectory $projectRoot
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At '02:00'
$rehearsalTrigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Sunday -At '03:30'
$runtimeTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$runtimeTrigger.Delay = 'PT45S'

Register-ScheduledTask -TaskName $runtimeName -Action $runtimeAction -Trigger $runtimeTrigger -Principal $principal -Settings $runtimeSettings -Description 'Guarded ANDALUCÍA OPERATION runtime started after Windows logon and used to restore the pre-backup running state.' -Force | Out-Null
Register-ScheduledTask -TaskName $dailyName -Action $dailyAction -Trigger $dailyTrigger -Principal $principal -Settings $commonSettings -Description 'Creates an offline DB-2 verified DAILY backup and applies protected seven-generation retention.' -Force | Out-Null
Register-ScheduledTask -TaskName $rehearsalName -Action $rehearsalAction -Trigger $rehearsalTrigger -Principal $principal -Settings $commonSettings -Description 'Runs the DB-2 restore rehearsal against the latest suitable verified backup without promotion.' -Force | Out-Null
Set-RuntimeTaskHardTerminateProtection
Assert-RuntimeTaskSafety
Register-GracefulShutdownTask $powerShell
Assert-ShutdownTaskSafety

New-Item -ItemType Directory -Path $exportRoot -Force | Out-Null
foreach ($name in @($runtimeName, $shutdownName, $dailyName, $rehearsalName)) {
  $safeName = ($name -replace '[^A-Za-z0-9.-]', '_') + '.xml'
  Export-ScheduledTask -TaskName $name | Set-Content -LiteralPath (Join-Path $exportRoot $safeName) -Encoding Unicode
}

Get-ScheduledTask -TaskName $runtimeName,$shutdownName,$dailyName,$rehearsalName | Select-Object TaskName,State,TaskPath
