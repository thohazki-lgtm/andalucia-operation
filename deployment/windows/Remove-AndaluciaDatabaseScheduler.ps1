[CmdletBinding()]
param(
  [switch]$DisableOnly,
  [switch]$ConfirmRemoval
)

$ErrorActionPreference = 'Stop'
$taskNames = @(
  'ANDALUCIA OPERATION - Daily Verified Backup',
  'ANDALUCIA OPERATION - Weekly Restore Rehearsal',
  'ANDALUCIA OPERATION - Guarded Application'
)
if ($DisableOnly) {
  foreach ($name in $taskNames) { if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Disable-ScheduledTask -TaskName $name | Out-Null } }
  return
}
if (-not $ConfirmRemoval) { throw 'SCHEDULER_REMOVAL_REQUIRES_CONFIRMATION' }
foreach ($name in $taskNames) { if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $name -Confirm:$false } }
# Backups, inventory, logs, rehearsal evidence, and canonical data are intentionally untouched.
