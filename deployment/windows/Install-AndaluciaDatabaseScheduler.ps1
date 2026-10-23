[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$jobScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Invoke-AndaluciaDatabaseJob.ps1'))
$runtimeScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Start-AndaluciaGuardedApplication.ps1'))
$exportRoot = Join-Path $projectRoot '.backups\.db2\scheduler\task-exports'
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$runtimeName = 'ANDALUCIA OPERATION - Guarded Application'
$dailyName = 'ANDALUCIA OPERATION - Daily Verified Backup'
$rehearsalName = 'ANDALUCIA OPERATION - Weekly Restore Rehearsal'

function Assert-AuthoritativeMainCheckout {
  $gitRoot = (& git -C $projectRoot rev-parse --show-toplevel 2>$null).Trim()
  if (-not $gitRoot -or [IO.Path]::GetFullPath($gitRoot) -ne $projectRoot) { throw 'SCHEDULER_INSTALL_REQUIRES_AUTHORITATIVE_GIT_CHECKOUT' }
  $branch = (& git -C $projectRoot branch --show-current 2>$null).Trim()
  if ($branch -ne 'main') { throw "SCHEDULER_INSTALL_REQUIRES_MAIN:$branch" }
  if (@(& git -C $projectRoot status --porcelain --untracked-files=no).Count -gt 0) { throw 'SCHEDULER_INSTALL_REQUIRES_CLEAN_MAIN' }
  $head = (& git -C $projectRoot rev-parse HEAD 2>$null).Trim()
  $approved = (& git -C $projectRoot rev-parse refs/remotes/origin/main 2>$null).Trim()
  if (-not $head -or -not $approved -or $head -ne $approved) { throw "SCHEDULER_INSTALL_REQUIRES_APPROVED_MAIN:${head}:${approved}" }
}

function Assert-RuntimeTaskSafety {
  [xml]$definition = Export-ScheduledTask -TaskName $runtimeName
  $namespace = [Xml.XmlNamespaceManager]::new($definition.NameTable)
  $namespace.AddNamespace('t', 'http://schemas.microsoft.com/windows/2004/02/mit/task')
  $stopOnIdleEnd = $definition.SelectSingleNode('//t:Settings/t:IdleSettings/t:StopOnIdleEnd', $namespace).InnerText
  $hardTerminate = $definition.SelectSingleNode('//t:Settings/t:DisallowHardTerminate', $namespace).InnerText
  $executionLimit = $definition.SelectSingleNode('//t:Settings/t:ExecutionTimeLimit', $namespace).InnerText
  $workingDirectory = $definition.SelectSingleNode('//t:Actions/t:Exec/t:WorkingDirectory', $namespace).InnerText
  if ($stopOnIdleEnd -ne 'false') { throw 'RUNTIME_TASK_SAFETY_DRIFT:StopOnIdleEnd' }
  if ($hardTerminate -ne 'true') { throw 'RUNTIME_TASK_SAFETY_DRIFT:DisallowHardTerminate' }
  if ($executionLimit -ne 'PT0S') { throw 'RUNTIME_TASK_SAFETY_DRIFT:ExecutionTimeLimit' }
  if ([IO.Path]::GetFullPath($workingDirectory) -ne $projectRoot) { throw 'RUNTIME_TASK_SAFETY_DRIFT:WorkingDirectory' }
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

foreach ($path in @($jobScript, $runtimeScript)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "SCHEDULER_SCRIPT_MISSING:$path" } }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.data\postgres\PG_VERSION') -PathType Leaf)) { throw 'ANDALUCIA_CANONICAL_STORE_MISSING' }
Assert-AuthoritativeMainCheckout

$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$commonSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$runtimeSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd -DisallowHardTerminate -ExecutionTimeLimit ([TimeSpan]::Zero)
$powerShell = Join-Path $PSHOME 'powershell.exe'
$runtimeAction = New-ScheduledTaskAction -Execute $powerShell -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"{0}`"" -f $runtimeScript) -WorkingDirectory $projectRoot
$dailyAction = New-ScheduledTaskAction -Execute $powerShell -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"{0}`" -Job DailyBackup" -f $jobScript) -WorkingDirectory $projectRoot
$rehearsalAction = New-ScheduledTaskAction -Execute $powerShell -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"{0}`" -Job WeeklyRestoreRehearsal" -f $jobScript) -WorkingDirectory $projectRoot
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At '02:00'
$rehearsalTrigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Sunday -At '03:30'

Register-ScheduledTask -TaskName $runtimeName -Action $runtimeAction -Principal $principal -Settings $runtimeSettings -Description 'On-demand guarded ANDALUCÍA OPERATION application runtime used to restore the pre-backup running state.' -Force | Out-Null
Register-ScheduledTask -TaskName $dailyName -Action $dailyAction -Trigger $dailyTrigger -Principal $principal -Settings $commonSettings -Description 'Creates an offline DB-2 verified DAILY backup and applies protected seven-generation retention.' -Force | Out-Null
Register-ScheduledTask -TaskName $rehearsalName -Action $rehearsalAction -Trigger $rehearsalTrigger -Principal $principal -Settings $commonSettings -Description 'Runs the DB-2 restore rehearsal against the latest suitable verified backup without promotion.' -Force | Out-Null
Set-RuntimeTaskHardTerminateProtection
Assert-RuntimeTaskSafety

New-Item -ItemType Directory -Path $exportRoot -Force | Out-Null
foreach ($name in @($runtimeName, $dailyName, $rehearsalName)) {
  $safeName = ($name -replace '[^A-Za-z0-9.-]', '_') + '.xml'
  Export-ScheduledTask -TaskName $name | Set-Content -LiteralPath (Join-Path $exportRoot $safeName) -Encoding Unicode
}

Get-ScheduledTask -TaskName $runtimeName,$dailyName,$rehearsalName | Select-Object TaskName,State,TaskPath
