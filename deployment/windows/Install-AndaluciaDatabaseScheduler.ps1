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

foreach ($path in @($jobScript, $runtimeScript)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "SCHEDULER_SCRIPT_MISSING:$path" } }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.data\postgres\PG_VERSION') -PathType Leaf)) { throw 'ANDALUCIA_CANONICAL_STORE_MISSING' }

$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$commonSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$runtimeSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
$powerShell = Join-Path $PSHOME 'powershell.exe'
$runtimeAction = New-ScheduledTaskAction -Execute $powerShell -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"{0}`"" -f $runtimeScript) -WorkingDirectory $projectRoot
$dailyAction = New-ScheduledTaskAction -Execute $powerShell -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"{0}`" -Job DailyBackup" -f $jobScript) -WorkingDirectory $projectRoot
$rehearsalAction = New-ScheduledTaskAction -Execute $powerShell -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"{0}`" -Job WeeklyRestoreRehearsal" -f $jobScript) -WorkingDirectory $projectRoot
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At '02:00'
$rehearsalTrigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Sunday -At '03:30'

Register-ScheduledTask -TaskName $runtimeName -Action $runtimeAction -Principal $principal -Settings $runtimeSettings -Description 'On-demand guarded ANDALUCÍA OPERATION application runtime used to restore the pre-backup running state.' -Force | Out-Null
Register-ScheduledTask -TaskName $dailyName -Action $dailyAction -Trigger $dailyTrigger -Principal $principal -Settings $commonSettings -Description 'Creates an offline DB-2 verified DAILY backup and applies protected seven-generation retention.' -Force | Out-Null
Register-ScheduledTask -TaskName $rehearsalName -Action $rehearsalAction -Trigger $rehearsalTrigger -Principal $principal -Settings $commonSettings -Description 'Runs the DB-2 restore rehearsal against the latest suitable verified backup without promotion.' -Force | Out-Null

New-Item -ItemType Directory -Path $exportRoot -Force | Out-Null
foreach ($name in @($runtimeName, $dailyName, $rehearsalName)) {
  $safeName = ($name -replace '[^A-Za-z0-9.-]', '_') + '.xml'
  Export-ScheduledTask -TaskName $name | Set-Content -LiteralPath (Join-Path $exportRoot $safeName) -Encoding Unicode
}

Get-ScheduledTask -TaskName $runtimeName,$dailyName,$rehearsalName | Select-Object TaskName,State,TaskPath
