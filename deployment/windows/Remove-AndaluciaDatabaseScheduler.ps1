[CmdletBinding()]
param(
  [switch]$DisableOnly,
  [switch]$ConfirmRemoval
)

$ErrorActionPreference = 'Stop'
$shutdownServiceName = 'AndaluciaShutdownGuard'
$taskNames = @(
  'ANDALUCIA OPERATION - Daily Verified Backup',
  'ANDALUCIA OPERATION - Weekly Restore Rehearsal',
  'ANDALUCIA OPERATION - Guarded Application'
)
if ($DisableOnly) {
  foreach ($name in $taskNames) { if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Disable-ScheduledTask -TaskName $name | Out-Null } }
  if (Get-Service -Name $shutdownServiceName -ErrorAction SilentlyContinue) { Set-Service -Name $shutdownServiceName -StartupType Disabled }
  return
}
if (-not $ConfirmRemoval) { throw 'SCHEDULER_REMOVAL_REQUIRES_CONFIRMATION' }
foreach ($name in $taskNames) { if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $name -Confirm:$false } }
if (Get-Service -Name $shutdownServiceName -ErrorAction SilentlyContinue) {
  Stop-Service -Name $shutdownServiceName -ErrorAction SilentlyContinue
  & sc.exe delete $shutdownServiceName | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'SHUTDOWN_SERVICE_REMOVAL_FAILED' }
}
# Backups, inventory, logs, rehearsal evidence, and canonical data are intentionally untouched.
