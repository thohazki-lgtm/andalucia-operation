[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ReviewedCheckpointSha,
  [Parameter(Mandatory = $true)][string]$ControlCommitSha,
  [Parameter(Mandatory = $true)][string]$ManagerApproval,
  [string]$ReviewUiCheckpointSha,
  [string]$FinalReviewUiCheckpointSha,
  [string]$CoverCheckpointSha,
  [string]$DatePersistenceCheckpointSha,
  [string]$TypographyCheckpointSha,
  [string]$DateResetCheckpointSha,
  [string]$ShutdownCheckpointSha,
  [string]$RepositoryRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$expectedBaselineSha = '40461397f9b5f1d3ffa391be9a0fc5110c6ff020'
$expectedCheckpointSha = 'f9cd8b03db9d55205e37783aedd141335a9a11e0'
$expectedBackendControlSha = 'dd07564c3e13a6f4e86668a34077e9527d3da2ee'
$expectedReviewUiSha = 'bbc348a7cf9ca672d0371ecf35fd2f157f3f27fe'
$expectedReviewUiControlSha = 'e33cbb100dbb5b01cc3399641a59980c68be3b5c'
$expectedFinalReviewUiSha = '6110fd6e6da9f311d5be880eb3a277cb51caae3f'
$expectedPreviousControlShaForCover = '054fb4a77729c63249eb7c86ba4e3e8e1dfac03b'
$expectedAlignmentSha = 'e509f25f4aaf1a501e1396be2079f904f4e17159'
$expectedCoverSha = '1e3c1001ec6746e8fd627960ef2ee5ef1cd3f2b0'
$expectedPreviousControlShaForDate = '0bb49f54a61c733f0d8b7bcb3e237937df69f360'
$expectedDateCheckpointSha = '572c5694df750b0edf009180e0b297c3d03c3b5d'
$expectedPreviousControlShaForTypography = '91fb31267b983c471d92622e1cac03a313391305'
$expectedTypographyCheckpointSha = '51a35ece8b7cf90b698175b1a532e5bb6d141498'
$expectedPreviousControlShaForDateReset = '8d5872d4e6071eb3568a3b8ce9e1747ba4853d66'
$expectedDateResetCheckpointSha = 'b1d15609a99ad14a0f13ae99c1c3858d4d2d099a'
$expectedPreviousControlShaForShutdown = '60591881a56f614e7054c848b54d00e5fa82ccda'
$expectedShutdownCheckpointSha = '7770b19fb1e34bb33f2107419289d13a825fa2e7'
$expectedPreviousUiCheckpointSha = '310b3f36b89555fb90c9d2464a34d7f038e5a2de'
$expectedPreviousControlSha = '072cd10ccd0905601f554020cb489fedd740dd73'
$projectRoot = if ($RepositoryRoot) { [IO.Path]::GetFullPath($RepositoryRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')) }
$resolverPath = Join-Path $projectRoot 'deployment\windows\Resolve-AndaluciaApprovedSource.ps1'
$manifestPath = Join-Path $projectRoot '.runtime\andalucia-local-ui-approval.json'
if ($ManagerApproval -notin @('YES_I_APPROVE_EXACT_DAILY_REPORT_BACKEND_CHECKPOINT','YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_UI_CHECKPOINT','YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_FINAL_UI_CHECKPOINT','YES_I_APPROVE_EXACT_DAILY_REPORT_COVER_CHECKPOINT','YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_CHECKPOINT','YES_I_APPROVE_EXACT_DAILY_REPORT_TYPOGRAPHY_CHECKPOINT','YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_RESET_CHECKPOINT','YES_I_APPROVE_EXACT_WINDOWS_SHUTDOWN_RELIABILITY_CHECKPOINT')) { throw 'ANDALUCIA_LOCAL_BACKEND_MANAGER_APPROVAL_REQUIRED' }
if ($ManagerApproval -ne 'YES_I_APPROVE_EXACT_WINDOWS_SHUTDOWN_RELIABILITY_CHECKPOINT' -and $ReviewedCheckpointSha -ne $expectedCheckpointSha) { throw 'ANDALUCIA_LOCAL_BACKEND_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_UI_CHECKPOINT' -and $ReviewUiCheckpointSha -ne $expectedReviewUiSha) { throw 'ANDALUCIA_LOCAL_BACKEND_UI_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_FINAL_UI_CHECKPOINT' -and $FinalReviewUiCheckpointSha -ne $expectedFinalReviewUiSha) { throw 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_COVER_CHECKPOINT' -and $CoverCheckpointSha -ne $expectedCoverSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_COVER_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_CHECKPOINT' -and $DatePersistenceCheckpointSha -ne $expectedDateCheckpointSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_TYPOGRAPHY_CHECKPOINT' -and $TypographyCheckpointSha -ne $expectedTypographyCheckpointSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_TYPOGRAPHY_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_RESET_CHECKPOINT' -and $DateResetCheckpointSha -ne $expectedDateResetCheckpointSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_RESET_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_WINDOWS_SHUTDOWN_RELIABILITY_CHECKPOINT' -and $ShutdownCheckpointSha -ne $expectedShutdownCheckpointSha) { throw 'ANDALUCIA_LOCAL_WINDOWS_SHUTDOWN_CHECKPOINT_SHA_NOT_APPROVED' }
if (-not (Test-Path -LiteralPath $resolverPath -PathType Leaf)) { throw 'ANDALUCIA_LOCAL_BACKEND_RESOLVER_MISSING' }
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'ANDALUCIA_LOCAL_BACKEND_PRIOR_APPROVAL_MISSING' }
. $resolverPath

$branch = (& git -C $projectRoot branch --show-current 2>$null).Trim()
if ($branch -notmatch '^codex/local-ui-[a-z0-9._-]+$') { throw "ANDALUCIA_LOCAL_BACKEND_BRANCH_NOT_ALLOWED:$branch" }
$trackedChanges = @(& git -C $projectRoot status --porcelain --untracked-files=no)
if ($trackedChanges.Count -gt 0) { throw 'ANDALUCIA_LOCAL_BACKEND_SOURCE_DIRTY' }
$activeSourceSha = Resolve-AndaluciaGitRef $projectRoot 'HEAD'
$approvedMainSha = Resolve-AndaluciaGitRef $projectRoot 'refs/remotes/origin/main'
$resolvedCheckpoint = Resolve-AndaluciaGitRef $projectRoot $ReviewedCheckpointSha
$resolvedControlCommit = Resolve-AndaluciaGitRef $projectRoot $ControlCommitSha
if (($ManagerApproval -ne 'YES_I_APPROVE_EXACT_WINDOWS_SHUTDOWN_RELIABILITY_CHECKPOINT' -and $resolvedCheckpoint -ne $expectedCheckpointSha) -or $resolvedControlCommit -ne $ControlCommitSha -or $resolvedControlCommit -ne $activeSourceSha) { throw 'ANDALUCIA_LOCAL_BACKEND_FULL_SHA_REQUIRED' }

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_WINDOWS_SHUTDOWN_RELIABILITY_CHECKPOINT') {
  $resolvedShutdownCheckpoint = Resolve-AndaluciaGitRef $projectRoot $ShutdownCheckpointSha
  if ($resolvedShutdownCheckpoint -ne $expectedShutdownCheckpointSha) { throw 'ANDALUCIA_LOCAL_WINDOWS_SHUTDOWN_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_WINDOWS_SHUTDOWN_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-backend-ui-approval-v6' -or $priorManifest.mode -ne 'approved_local_daily_report_date_reset' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_RESET_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForShutdown -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForShutdown -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_WINDOWS_SHUTDOWN_PRIOR_APPROVAL_INVALID' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForShutdown $resolvedShutdownCheckpoint 'ANDALUCIA_LOCAL_WINDOWS_SHUTDOWN_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedShutdownCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_WINDOWS_SHUTDOWN_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $shutdownPaths = @(Get-AndaluciaReviewedWindowsShutdownReliabilityPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForShutdown $resolvedShutdownCheckpoint $shutdownPaths 'ANDALUCIA_LOCAL_WINDOWS_SHUTDOWN_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedShutdownCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-system-approval-v1'; mode='approved_local_windows_shutdown_reliability'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForShutdown; shutdownCheckpointSha=$resolvedShutdownCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; shutdownPaths=$shutdownPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); installerSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Install-AndaluciaDatabaseScheduler.ps1'); shutdownSignalSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Signal-AndaluciaWindowsShutdown.cmd'); schedulerSourceSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'server/database-scheduler.ts') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_WINDOWS_SHUTDOWN_RELIABILITY_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_RESET_CHECKPOINT') {
  $resolvedDateResetCheckpoint = Resolve-AndaluciaGitRef $projectRoot $DateResetCheckpointSha
  if ($resolvedDateResetCheckpoint -ne $expectedDateResetCheckpointSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_RESET_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_RESET_PRIOR_APPROVAL_INVALID' }
  $isPriorTypography = $priorManifest.version -eq 'andalucia-local-backend-ui-approval-v5' -and $priorManifest.mode -eq 'approved_local_daily_report_typography_refinement' -and $priorManifest.managerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_TYPOGRAPHY_CHECKPOINT' -and [string]$priorManifest.controlCommitSha -eq $expectedPreviousControlShaForDateReset -and [string]$priorManifest.activeSourceSha -eq $expectedPreviousControlShaForDateReset
  $isDateResetRetry = $priorManifest.version -eq 'andalucia-local-backend-ui-approval-v6' -and $priorManifest.mode -eq 'approved_local_daily_report_date_reset' -and $priorManifest.managerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_RESET_CHECKPOINT' -and [string]$priorManifest.dateResetCheckpointSha -eq $expectedDateResetCheckpointSha -and [string]$priorManifest.previousControlCommitSha -eq $expectedPreviousControlShaForDateReset -and [string]$priorManifest.activeSourceSha -eq [string]$priorManifest.controlCommitSha
  if ((-not $isPriorTypography -and -not $isDateResetRetry) -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_RESET_PRIOR_APPROVAL_INVALID' }
  if ($isDateResetRetry) { Assert-AndaluciaGitAncestor $projectRoot ([string]$priorManifest.controlCommitSha) $resolvedControlCommit 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_RESET_RETRY_NOT_DESCENDANT' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForDateReset $resolvedDateResetCheckpoint 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_RESET_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedDateResetCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_RESET_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $dateResetPaths = @(Get-AndaluciaReviewedDailyReportDateResetPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForDateReset $resolvedDateResetCheckpoint $dateResetPaths 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_RESET_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedDateResetCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-backend-ui-approval-v6'; mode='approved_local_daily_report_date_reset'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForDateReset; dateResetCheckpointSha=$resolvedDateResetCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; dateResetPaths=$dateResetPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; approvalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalUiCheckpoint.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_DAILY_REPORT_DATE_RESET_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_TYPOGRAPHY_CHECKPOINT') {
  $resolvedTypographyCheckpoint = Resolve-AndaluciaGitRef $projectRoot $TypographyCheckpointSha
  if ($resolvedTypographyCheckpoint -ne $expectedTypographyCheckpointSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_TYPOGRAPHY_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_TYPOGRAPHY_PRIOR_APPROVAL_INVALID' }
  $isPriorDate = $priorManifest.version -eq 'andalucia-local-backend-ui-approval-v4' -and $priorManifest.mode -eq 'approved_local_daily_report_date_persistence' -and $priorManifest.managerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_CHECKPOINT' -and [string]$priorManifest.controlCommitSha -eq $expectedPreviousControlShaForTypography -and [string]$priorManifest.activeSourceSha -eq $expectedPreviousControlShaForTypography
  $isTypographyRetry = $priorManifest.version -eq 'andalucia-local-backend-ui-approval-v5' -and $priorManifest.mode -eq 'approved_local_daily_report_typography_refinement' -and $priorManifest.managerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_TYPOGRAPHY_CHECKPOINT' -and [string]$priorManifest.typographyCheckpointSha -eq $expectedTypographyCheckpointSha -and [string]$priorManifest.previousControlCommitSha -eq $expectedPreviousControlShaForTypography -and [string]$priorManifest.activeSourceSha -eq [string]$priorManifest.controlCommitSha
  if ((-not $isPriorDate -and -not $isTypographyRetry) -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_TYPOGRAPHY_PRIOR_APPROVAL_INVALID' }
  if ($isTypographyRetry) { Assert-AndaluciaGitAncestor $projectRoot ([string]$priorManifest.controlCommitSha) $resolvedControlCommit 'ANDALUCIA_LOCAL_DAILY_REPORT_TYPOGRAPHY_RETRY_NOT_DESCENDANT' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForTypography $resolvedTypographyCheckpoint 'ANDALUCIA_LOCAL_DAILY_REPORT_TYPOGRAPHY_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedTypographyCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_DAILY_REPORT_TYPOGRAPHY_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $typographyPaths = @(Get-AndaluciaReviewedDailyReportTypographyPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForTypography $resolvedTypographyCheckpoint $typographyPaths 'ANDALUCIA_LOCAL_DAILY_REPORT_TYPOGRAPHY_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedTypographyCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-backend-ui-approval-v5'; mode='approved_local_daily_report_typography_refinement'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForTypography; typographyCheckpointSha=$resolvedTypographyCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; typographyPaths=$typographyPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; approvalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalUiCheckpoint.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_DAILY_REPORT_TYPOGRAPHY_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_CHECKPOINT') {
  $resolvedDateCheckpoint = Resolve-AndaluciaGitRef $projectRoot $DatePersistenceCheckpointSha
  if ($resolvedDateCheckpoint -ne $expectedDateCheckpointSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_PRIOR_APPROVAL_INVALID' }
  $isPriorCover = $priorManifest.version -eq 'andalucia-local-backend-ui-approval-v3' -and $priorManifest.mode -eq 'approved_local_daily_report_cover_reconciliation' -and $priorManifest.managerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_COVER_CHECKPOINT' -and [string]$priorManifest.controlCommitSha -eq $expectedPreviousControlShaForDate -and [string]$priorManifest.activeSourceSha -eq $expectedPreviousControlShaForDate
  $isPriorDateRetry = $priorManifest.version -eq 'andalucia-local-backend-ui-approval-v4' -and $priorManifest.mode -eq 'approved_local_daily_report_date_persistence' -and $priorManifest.managerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_CHECKPOINT' -and [string]$priorManifest.dateCheckpointSha -eq $expectedDateCheckpointSha -and [string]$priorManifest.previousControlCommitSha -eq $expectedPreviousControlShaForDate -and [string]$priorManifest.activeSourceSha -eq [string]$priorManifest.controlCommitSha
  if ((-not $isPriorCover -and -not $isPriorDateRetry) -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_PRIOR_APPROVAL_INVALID' }
  if ($isPriorDateRetry) { Assert-AndaluciaGitAncestor $projectRoot ([string]$priorManifest.controlCommitSha) $resolvedControlCommit 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_RETRY_NOT_DESCENDANT' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForDate $resolvedDateCheckpoint 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedDateCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $datePaths = @(Get-AndaluciaReviewedDailyReportDatePersistencePaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForDate $resolvedDateCheckpoint $datePaths 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedDateCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-backend-ui-approval-v4'; mode='approved_local_daily_report_date_persistence'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForDate; dateCheckpointSha=$resolvedDateCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; datePaths=$datePaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; approvalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalUiCheckpoint.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_DAILY_REPORT_DATE_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_COVER_CHECKPOINT') {
  $resolvedCover = Resolve-AndaluciaGitRef $projectRoot $CoverCheckpointSha
  if ($resolvedCover -ne $expectedCoverSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_COVER_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_COVER_PRIOR_APPROVAL_INVALID' }
  $isPriorFinalUi = $priorManifest.version -eq 'andalucia-local-backend-ui-approval-v2' -and $priorManifest.mode -eq 'approved_local_daily_report_backend_with_final_review_ui' -and $priorManifest.managerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_FINAL_UI_CHECKPOINT' -and [string]$priorManifest.controlCommitSha -eq $expectedPreviousControlShaForCover -and [string]$priorManifest.activeSourceSha -eq $expectedPreviousControlShaForCover
  $isPriorCoverRetry = $priorManifest.version -eq 'andalucia-local-backend-ui-approval-v3' -and $priorManifest.mode -eq 'approved_local_daily_report_cover_reconciliation' -and $priorManifest.managerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_COVER_CHECKPOINT' -and [string]$priorManifest.coverCheckpointSha -eq $expectedCoverSha -and [string]$priorManifest.previousControlCommitSha -eq $expectedPreviousControlShaForCover -and [string]$priorManifest.activeSourceSha -eq [string]$priorManifest.controlCommitSha
  if ((-not $isPriorFinalUi -and -not $isPriorCoverRetry) -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_COVER_PRIOR_APPROVAL_INVALID' }
  if ($isPriorCoverRetry) { Assert-AndaluciaGitAncestor $projectRoot ([string]$priorManifest.controlCommitSha) $resolvedControlCommit 'ANDALUCIA_LOCAL_DAILY_REPORT_COVER_RETRY_NOT_DESCENDANT' }
  foreach ($pair in @(@($expectedPreviousControlShaForCover,$expectedAlignmentSha),@($expectedAlignmentSha,$resolvedCover),@($resolvedCover,$resolvedControlCommit))) { Assert-AndaluciaGitAncestor $projectRoot $pair[0] $pair[1] 'ANDALUCIA_LOCAL_DAILY_REPORT_COVER_ANCESTRY_MISMATCH' }
  $alignmentPaths = @(Get-AndaluciaReviewedDailyReportAlignmentPaths)
  $coverPaths = @(Get-AndaluciaReviewedDailyReportCoverCorrectionPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForCover $expectedAlignmentSha $alignmentPaths 'ANDALUCIA_LOCAL_DAILY_REPORT_ALIGNMENT_PATH_MISMATCH')
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedAlignmentSha $resolvedCover $coverPaths 'ANDALUCIA_LOCAL_DAILY_REPORT_COVER_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedCover $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-backend-ui-approval-v3'; mode='approved_local_daily_report_cover_reconciliation'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; baselineApprovedSourceSha=$expectedBaselineSha; reviewedCheckpointSha=$expectedCheckpointSha; previousControlCommitSha=$expectedPreviousControlShaForCover; alignmentCheckpointSha=$expectedAlignmentSha; coverCheckpointSha=$resolvedCover; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; alignmentPaths=$alignmentPaths; coverPaths=$coverPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; approvalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalUiCheckpoint.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_DAILY_REPORT_COVER_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_FINAL_UI_CHECKPOINT') {
  $resolvedFinalReviewUi = Resolve-AndaluciaGitRef $projectRoot $FinalReviewUiCheckpointSha
  if ($resolvedFinalReviewUi -ne $expectedFinalReviewUiSha) { throw 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-backend-ui-approval-v1' -or $priorManifest.mode -ne 'approved_local_daily_report_backend_with_review_ui' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_UI_CHECKPOINT') { throw 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_PRIOR_APPROVAL_INVALID' }
  if ([string]$priorManifest.approvedMainSha -ne $approvedMainSha -or [string]$priorManifest.baselineApprovedSourceSha -ne $expectedBaselineSha -or [string]$priorManifest.reviewedCheckpointSha -ne $expectedCheckpointSha -or [string]$priorManifest.previousControlCommitSha -ne $expectedBackendControlSha -or [string]$priorManifest.reviewUiCheckpointSha -ne $expectedReviewUiSha -or [string]$priorManifest.controlCommitSha -ne $expectedReviewUiControlSha -or [string]$priorManifest.activeSourceSha -ne $expectedReviewUiControlSha -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_PRIOR_APPROVAL_IDENTITY_MISMATCH' }
  Assert-AndaluciaGitAncestor $projectRoot $approvedMainSha $expectedBaselineSha 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_BASELINE_NOT_BASED_ON_MAIN'
  Assert-AndaluciaGitAncestor $projectRoot $expectedBaselineSha $expectedCheckpointSha 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_CHECKPOINT_NOT_BASED_ON_BASELINE'
  Assert-AndaluciaGitAncestor $projectRoot $expectedCheckpointSha $expectedBackendControlSha 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_BACKEND_CONTROL_NOT_BASED_ON_CHECKPOINT'
  Assert-AndaluciaGitAncestor $projectRoot $expectedBackendControlSha $expectedReviewUiSha 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_PRIOR_REVIEW_NOT_BASED_ON_BACKEND_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $expectedReviewUiSha $expectedReviewUiControlSha 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_PRIOR_CONTROL_NOT_BASED_ON_REVIEW'
  Assert-AndaluciaGitAncestor $projectRoot $expectedReviewUiControlSha $resolvedFinalReviewUi 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_REVIEW_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedFinalReviewUi $resolvedControlCommit 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_CONTROL_NOT_BASED_ON_REVIEW'
  $reviewedPaths = @(Get-AndaluciaReviewedDailyReportCheckpointPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedBaselineSha $expectedCheckpointSha $reviewedPaths 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_REVIEWED_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $expectedCheckpointSha $expectedBackendControlSha 'backend_control')
  $priorReviewUiPaths = @(Get-AndaluciaReviewedDailyReportReviewUiPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedBackendControlSha $expectedReviewUiSha $priorReviewUiPaths 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_PRIOR_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $expectedReviewUiSha $expectedReviewUiControlSha 'backend_control')
  $reviewUiPaths = @(Get-AndaluciaReviewedDailyReportReviewFinalUiPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedReviewUiControlSha $resolvedFinalReviewUi $reviewUiPaths 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedFinalReviewUi $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{
    version = 'andalucia-local-backend-ui-approval-v2'
    mode = 'approved_local_daily_report_backend_with_final_review_ui'
    managerApproval = $ManagerApproval
    approvedAt = [DateTime]::UtcNow.ToString('o')
    approvedMainSha = $approvedMainSha
    baselineApprovedSourceSha = $expectedBaselineSha
    reviewedCheckpointSha = $expectedCheckpointSha
    backendControlCommitSha = $expectedBackendControlSha
    previousReviewUiCheckpointSha = $expectedReviewUiSha
    previousControlCommitSha = $expectedReviewUiControlSha
    reviewUiCheckpointSha = $resolvedFinalReviewUi
    controlCommitSha = $resolvedControlCommit
    activeSourceSha = $activeSourceSha
    branch = $branch
    reviewedPaths = $reviewedPaths
    reviewUiPaths = $reviewUiPaths
    launcherSha256 = Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment\windows\Start-AndaluciaGuardedApplication.ps1')
    resolverSha256 = Get-AndaluciaFileSha256 $resolverPath
    approvalScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment\windows\Approve-AndaluciaLocalUiCheckpoint.ps1')
    backendApprovalScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment\windows\Approve-AndaluciaLocalBackendCheckpoint.ps1')
    backendActivationScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment\windows\Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1')
  }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_DAILY_REPORT_REVIEW_FINAL_UI_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_UI_CHECKPOINT') {
  $resolvedReviewUi = Resolve-AndaluciaGitRef $projectRoot $ReviewUiCheckpointSha
  if ($resolvedReviewUi -ne $expectedReviewUiSha) { throw 'ANDALUCIA_LOCAL_BACKEND_UI_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_BACKEND_UI_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-backend-approval-v1' -or $priorManifest.mode -ne 'approved_local_daily_report_backend_checkpoint' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_DAILY_REPORT_BACKEND_CHECKPOINT') { throw 'ANDALUCIA_LOCAL_BACKEND_UI_PRIOR_APPROVAL_INVALID' }
  if ([string]$priorManifest.approvedMainSha -ne $approvedMainSha -or [string]$priorManifest.baselineApprovedSourceSha -ne $expectedBaselineSha -or [string]$priorManifest.reviewedCheckpointSha -ne $expectedCheckpointSha -or [string]$priorManifest.controlCommitSha -ne $expectedBackendControlSha -or [string]$priorManifest.activeSourceSha -ne $expectedBackendControlSha -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_BACKEND_UI_PRIOR_APPROVAL_IDENTITY_MISMATCH' }
  Assert-AndaluciaGitAncestor $projectRoot $approvedMainSha $expectedBaselineSha 'ANDALUCIA_LOCAL_BACKEND_UI_BASELINE_NOT_BASED_ON_MAIN'
  Assert-AndaluciaGitAncestor $projectRoot $expectedBaselineSha $expectedCheckpointSha 'ANDALUCIA_LOCAL_BACKEND_UI_CHECKPOINT_NOT_BASED_ON_BASELINE'
  Assert-AndaluciaGitAncestor $projectRoot $expectedCheckpointSha $expectedBackendControlSha 'ANDALUCIA_LOCAL_BACKEND_UI_PRIOR_CONTROL_NOT_BASED_ON_CHECKPOINT'
  Assert-AndaluciaGitAncestor $projectRoot $expectedBackendControlSha $resolvedReviewUi 'ANDALUCIA_LOCAL_BACKEND_UI_REVIEW_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedReviewUi $resolvedControlCommit 'ANDALUCIA_LOCAL_BACKEND_UI_CONTROL_NOT_BASED_ON_REVIEW'
  $reviewedPaths = @(Get-AndaluciaReviewedDailyReportCheckpointPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedBaselineSha $expectedCheckpointSha $reviewedPaths 'ANDALUCIA_LOCAL_BACKEND_UI_REVIEWED_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $expectedCheckpointSha $expectedBackendControlSha 'backend_control')
  $reviewUiPaths = @(Get-AndaluciaReviewedDailyReportReviewUiPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedBackendControlSha $resolvedReviewUi $reviewUiPaths 'ANDALUCIA_LOCAL_BACKEND_UI_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedReviewUi $resolvedControlCommit 'backend_control')

  $manifest = [ordered]@{
    version = 'andalucia-local-backend-ui-approval-v1'
    mode = 'approved_local_daily_report_backend_with_review_ui'
    managerApproval = $ManagerApproval
    approvedAt = [DateTime]::UtcNow.ToString('o')
    approvedMainSha = $approvedMainSha
    baselineApprovedSourceSha = $expectedBaselineSha
    reviewedCheckpointSha = $expectedCheckpointSha
    previousControlCommitSha = $expectedBackendControlSha
    reviewUiCheckpointSha = $resolvedReviewUi
    controlCommitSha = $resolvedControlCommit
    activeSourceSha = $activeSourceSha
    branch = $branch
    reviewedPaths = $reviewedPaths
    reviewUiPaths = $reviewUiPaths
    launcherSha256 = Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment\windows\Start-AndaluciaGuardedApplication.ps1')
    resolverSha256 = Get-AndaluciaFileSha256 $resolverPath
    approvalScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment\windows\Approve-AndaluciaLocalUiCheckpoint.ps1')
    backendApprovalScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment\windows\Approve-AndaluciaLocalBackendCheckpoint.ps1')
    backendActivationScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment\windows\Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1')
  }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_DAILY_REPORT_REVIEW_UI_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_BACKEND_PRIOR_APPROVAL_INVALID' }
if ($priorManifest.version -ne 'andalucia-local-ui-approval-v1' -or $priorManifest.mode -ne 'approved_local_ui_checkpoint' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_LOCAL_UI_CHECKPOINT') { throw 'ANDALUCIA_LOCAL_BACKEND_PRIOR_APPROVAL_INVALID' }
if ([string]$priorManifest.approvedMainSha -ne $approvedMainSha -or [string]$priorManifest.sourceUiCheckpointSha -ne $expectedPreviousUiCheckpointSha -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlSha -or [string]$priorManifest.activeSourceSha -ne $expectedBaselineSha -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_BACKEND_PRIOR_APPROVAL_IDENTITY_MISMATCH' }

Assert-AndaluciaGitAncestor $projectRoot $approvedMainSha $expectedPreviousUiCheckpointSha 'ANDALUCIA_LOCAL_BACKEND_PRIOR_UI_NOT_BASED_ON_MAIN'
Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousUiCheckpointSha $expectedPreviousControlSha 'ANDALUCIA_LOCAL_BACKEND_PRIOR_CONTROL_NOT_BASED_ON_UI'
Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlSha $expectedBaselineSha 'ANDALUCIA_LOCAL_BACKEND_BASELINE_NOT_BASED_ON_CONTROL'
Assert-AndaluciaGitAncestor $projectRoot $expectedBaselineSha $resolvedCheckpoint 'ANDALUCIA_LOCAL_BACKEND_CHECKPOINT_NOT_BASED_ON_BASELINE'
Assert-AndaluciaGitAncestor $projectRoot $resolvedCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_BACKEND_CONTROL_NOT_BASED_ON_CHECKPOINT'
[void](Assert-AndaluciaChangedPaths $projectRoot $approvedMainSha $expectedPreviousUiCheckpointSha 'ui')
[void](Assert-AndaluciaChangedPaths $projectRoot $expectedPreviousUiCheckpointSha $expectedPreviousControlSha 'control')
[void](Assert-AndaluciaChangedPaths $projectRoot $expectedPreviousControlSha $expectedBaselineSha 'ui')
$reviewedPaths = @(Get-AndaluciaReviewedDailyReportCheckpointPaths)
[void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedBaselineSha $resolvedCheckpoint $reviewedPaths 'ANDALUCIA_LOCAL_BACKEND_REVIEWED_PATH_MISMATCH')
[void](Assert-AndaluciaChangedPaths $projectRoot $resolvedCheckpoint $resolvedControlCommit 'backend_control')

$manifest = [ordered]@{
  version = 'andalucia-local-backend-approval-v1'
  mode = 'approved_local_daily_report_backend_checkpoint'
  managerApproval = $ManagerApproval
  approvedAt = [DateTime]::UtcNow.ToString('o')
  approvedMainSha = $approvedMainSha
  baselineApprovedSourceSha = $expectedBaselineSha
  reviewedCheckpointSha = $resolvedCheckpoint
  controlCommitSha = $resolvedControlCommit
  activeSourceSha = $activeSourceSha
  branch = $branch
  reviewedPaths = $reviewedPaths
  launcherSha256 = Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment\windows\Start-AndaluciaGuardedApplication.ps1')
  resolverSha256 = Get-AndaluciaFileSha256 $resolverPath
  approvalScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment\windows\Approve-AndaluciaLocalUiCheckpoint.ps1')
  backendApprovalScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment\windows\Approve-AndaluciaLocalBackendCheckpoint.ps1')
  backendActivationScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment\windows\Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1')
}
New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
$temporaryPath = "$manifestPath.tmp"
[IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
$verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
[ordered]@{ status='APPROVED_LOCAL_DAILY_REPORT_BACKEND_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
