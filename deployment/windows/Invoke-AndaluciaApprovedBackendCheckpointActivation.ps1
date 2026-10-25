[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ExpectedControlSha,
  [Parameter(Mandatory = $true)][string]$ManagerAuthorization,
  [string]$RepositoryRoot,
  [int]$MaximumBackupAgeHours = 24
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$expectedCheckpointSha = 'f9cd8b03db9d55205e37783aedd141335a9a11e0'
$expectedRuntimeBaselineSha = '40461397f9b5f1d3ffa391be9a0fc5110c6ff020'
$expectedBackendControlSha = 'dd07564c3e13a6f4e86668a34077e9527d3da2ee'
$expectedReviewUiSha = 'bbc348a7cf9ca672d0371ecf35fd2f157f3f27fe'
$expectedReviewUiControlSha = 'e33cbb100dbb5b01cc3399641a59980c68be3b5c'
$expectedFinalReviewUiSha = '6110fd6e6da9f311d5be880eb3a277cb51caae3f'
$expectedPreviousControlShaForCover = '054fb4a77729c63249eb7c86ba4e3e8e1dfac03b'
$expectedCoverSha = '1e3c1001ec6746e8fd627960ef2ee5ef1cd3f2b0'
$expectedPreviousControlShaForDate = '0bb49f54a61c733f0d8b7bcb3e237937df69f360'
$expectedDateCheckpointSha = '572c5694df750b0edf009180e0b297c3d03c3b5d'
$expectedPreviousControlShaForTypography = '91fb31267b983c471d92622e1cac03a313391305'
$expectedTypographyCheckpointSha = '51a35ece8b7cf90b698175b1a532e5bb6d141498'
$expectedPreviousControlShaForDateReset = '8d5872d4e6071eb3568a3b8ce9e1747ba4853d66'
$expectedDateResetCheckpointSha = 'b1d15609a99ad14a0f13ae99c1c3858d4d2d099a'
$expectedPreviousControlShaForWeekly = '701af9bed5f301ae7a94b19f090a96af1324ca00'
$expectedWeeklyReportCheckpointSha = '7c0dbe6be26acfb0e1fa8bef5bffaa7bc3f968ca'
$expectedPreviousControlShaForWeeklyFinalUi = 'efc64b9411a1144fb15692c11d182bf05f02df8e'
$expectedWeeklyReportFinalUiCheckpointSha = '5fd181e4b2dfc55c2dbe5f53e0a59be793d3790b'
$expectedPreviousControlShaForWeeklyTypography = 'ac833893e80897aab984e71ed7565d27c1c2025b'
$expectedWeeklyReportTypographyCheckpointSha = 'e1dd8ade75cc43ef1ea801be14c6fb325de119ce'
$expectedPreviousControlShaForWeeklyTypographyFinal = '1acaa183fcce0d3aa35c8a0ef0b9af899c9c6a01'
$expectedWeeklyReportTypographyFinalCheckpointSha = 'e02a33946b538c6da11750fc551311d854a3224b'
$expectedPreviousControlShaForWeeklyCompact = '672682499f0aa2cc5d36e70ba018c93179f07ccb'
$expectedWeeklyReportCompactCheckpointSha = '4b30543e01b9da1c379d3dc405206fe5316a6d44'
$expectedPreviousControlShaForWeeklyFinalRefinement = '7a703370eb852b51f5a0f3a25ed077c3bf138ce2'
$expectedWeeklyReportFinalRefinementCheckpointSha = '477b148d87c2db2d4b78a892de5c223d98a54867'
$expectedPreviousControlShaForMonthly = 'd904ac43605a82281d6989a0deca1cd77ad20648'
$expectedMonthlyReportCheckpointSha = '98ac6c0e142cebff6154b059bb5b7ee9c48b54c1'
$expectedPreviousControlShaForMonthlyUi = 'e834ad63938ebcbf381aff0e301d2929f7f1a7f8'
$expectedMonthlyReportUiCheckpointSha = 'acc72417bbc857187d01c0288b2269a9c31bd0f9'
$expectedPreviousControlShaForMonthlyCompact = '15b27421f7340e8082b38e7afb91aff8878e6e21'
$expectedMonthlyReportCompactCheckpointSha = '9032042bcb520264949a77b2fb3950b7637d584f'
$expectedPreviousControlShaForMonthlyTypography = '94f6958799e9e64a550a6f56cdae8b23aba31dc7'
$expectedMonthlyReportTypographyCheckpointSha = 'e645140222da9fc63f57b23f2417c335311b17e5'
$expectedPreviousControlShaForMonthlyAlignment = 'f4f4ce237d50bdc59621b90903ceb19a9d692824'
$expectedMonthlyReportAlignmentCheckpointSha = '8ff75ae31e598750ddca1672d660f35b84b0fa35'
$expectedPreviousControlShaForCustomReport = '32d1f255383ec74290dd5c3b1585c6dac34f9b76'
$expectedCustomReportCheckpointSha = '2a4a00e60187b38cab85fda26766e1500b5fd4ad'
$expectedPreviousControlShaForCustomReportFinalUi = '7a9fe44b7d4e045b8c6cbee30e2305ccdb08f9de'
$expectedCustomReportFinalUiCheckpointSha = 'f285c5d32aeead2cbca5659d08c985f6e0e15424'
$expectedPreviousControlShaForLeaveTypes = '13b15cab7bc80f3d96aa8b10724d4521267174d6'
$expectedLeaveTypesCheckpointSha = '4bbc70c7280879c41e73131d9b62212d735a68ca'
$expectedPreviousControlShaForEmployeeEntitlements = 'c3d09f939961ba4f974ee83e67452e828179350c'
$expectedEmployeeEntitlementsCheckpointSha = 'ca28f4f522d6d5c1b6ae78e23d1ad031c87d117b'
$expectedEmployeeEntitlementsIntegrationSha = '8b2d5ead2d895004fa6aa8c5e1a9694891b23926'
$projectRoot = if ($RepositoryRoot) { [IO.Path]::GetFullPath($RepositoryRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')) }
$canonicalData = [IO.Path]::GetFullPath((Join-Path $projectRoot '.data\postgres'))
$markerPath = Join-Path $canonicalData 'postmaster.pid'
$identityPath = Join-Path (Split-Path $canonicalData -Parent) 'andalucia-store-identity.json'
$resolverPath = Join-Path $projectRoot 'deployment\windows\Resolve-AndaluciaApprovedSource.ps1'
$stopScript = Join-Path $projectRoot 'deployment\windows\Stop-AndaluciaGuardedApplication.ps1'
$runtimeTaskName = 'ANDALUCIA OPERATION - Guarded Application'
if ($ManagerAuthorization -notin @('YES_I_APPROVE_EXACT_DAILY_REPORT_BACKEND_ACTIVATION','YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_UI_ACTIVATION','YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_FINAL_UI_ACTIVATION','YES_I_APPROVE_EXACT_DAILY_REPORT_COVER_ACTIVATION','YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_ACTIVATION','YES_I_APPROVE_EXACT_DAILY_REPORT_TYPOGRAPHY_ACTIVATION','YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_RESET_ACTIVATION','YES_I_APPROVE_EXACT_WEEKLY_REPORT_ACTIVATION','YES_I_APPROVE_EXACT_WEEKLY_REPORT_FINAL_UI_ACTIVATION','YES_I_APPROVE_EXACT_WEEKLY_REPORT_TYPOGRAPHY_ACTIVATION','YES_I_APPROVE_EXACT_WEEKLY_REPORT_TYPOGRAPHY_FINAL_ACTIVATION','YES_I_APPROVE_EXACT_WEEKLY_REPORT_COMPACT_ACTIVATION','YES_I_APPROVE_EXACT_WEEKLY_REPORT_FINAL_REFINEMENT_ACTIVATION','YES_I_APPROVE_EXACT_MONTHLY_REPORT_ACTIVATION','YES_I_APPROVE_EXACT_MONTHLY_REPORT_GUEST_EXPERIENCE_ACTIVATION','YES_I_APPROVE_EXACT_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_ACTIVATION','YES_I_APPROVE_EXACT_MONTHLY_REPORT_TYPOGRAPHY_REFINEMENT_ACTIVATION','YES_I_APPROVE_EXACT_MONTHLY_REPORT_TABLE_ALIGNMENT_ACTIVATION','YES_I_APPROVE_EXACT_CUSTOM_REPORT_REDESIGN_ACTIVATION','YES_I_APPROVE_EXACT_CUSTOM_REPORT_FINAL_UI_ACTIVATION','YES_I_APPROVE_EXACT_LEAVE_TYPES_ACTIVATION','YES_I_APPROVE_EXACT_EMPLOYEE_ENTITLEMENTS_ACTIVATION')) { throw 'ANDALUCIA_LOCAL_BACKEND_ACTIVATION_MANAGER_AUTHORIZATION_REQUIRED' }
. $resolverPath

$source = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot
$isBackendCheckpoint = $source.Mode -eq 'approved_local_daily_report_backend_checkpoint' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_BACKEND_ACTIVATION'
$isReviewUiCheckpoint = $source.Mode -eq 'approved_local_daily_report_backend_with_review_ui' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_UI_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedBackendControlSha -and $source.ReviewUiCheckpointSha -eq $expectedReviewUiSha
$isFinalReviewUiCheckpoint = $source.Mode -eq 'approved_local_daily_report_backend_with_final_review_ui' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_FINAL_UI_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedReviewUiControlSha -and $source.ReviewUiCheckpointSha -eq $expectedFinalReviewUiSha
$isCoverCheckpoint = $source.Mode -eq 'approved_local_daily_report_cover_reconciliation' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_COVER_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedPreviousControlShaForCover -and $source.CoverCheckpointSha -eq $expectedCoverSha
$isDateCheckpoint = $source.Mode -eq 'approved_local_daily_report_date_persistence' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedPreviousControlShaForDate -and $source.DateCheckpointSha -eq $expectedDateCheckpointSha
$isTypographyCheckpoint = $source.Mode -eq 'approved_local_daily_report_typography_refinement' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_TYPOGRAPHY_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedPreviousControlShaForTypography -and $source.TypographyCheckpointSha -eq $expectedTypographyCheckpointSha
$isDateResetCheckpoint = $source.Mode -eq 'approved_local_daily_report_date_reset' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_RESET_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedPreviousControlShaForDateReset -and $source.DateResetCheckpointSha -eq $expectedDateResetCheckpointSha
$isWeeklyReportCheckpoint = $source.Mode -eq 'approved_local_weekly_report_checkpoint' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedPreviousControlShaForWeekly -and $source.WeeklyReportCheckpointSha -eq $expectedWeeklyReportCheckpointSha
$isWeeklyReportFinalUiCheckpoint = $source.Mode -eq 'approved_local_weekly_report_final_ui' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_FINAL_UI_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedPreviousControlShaForWeeklyFinalUi -and $source.WeeklyReportFinalUiCheckpointSha -eq $expectedWeeklyReportFinalUiCheckpointSha
$isWeeklyReportTypographyCheckpoint = $source.Mode -eq 'approved_local_weekly_report_typography_correction' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_TYPOGRAPHY_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedPreviousControlShaForWeeklyTypography -and $source.WeeklyReportTypographyCheckpointSha -eq $expectedWeeklyReportTypographyCheckpointSha
$isWeeklyReportTypographyFinalCheckpoint = $source.Mode -eq 'approved_local_weekly_report_typography_final' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_TYPOGRAPHY_FINAL_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedPreviousControlShaForWeeklyTypographyFinal -and $source.WeeklyReportTypographyFinalCheckpointSha -eq $expectedWeeklyReportTypographyFinalCheckpointSha
$isWeeklyReportCompactCheckpoint = $source.Mode -eq 'approved_local_weekly_report_compact_ui' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_COMPACT_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedPreviousControlShaForWeeklyCompact -and $source.WeeklyReportCompactCheckpointSha -eq $expectedWeeklyReportCompactCheckpointSha
$isWeeklyReportFinalRefinementCheckpoint = $source.Mode -eq 'approved_local_weekly_report_final_refinement' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_FINAL_REFINEMENT_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedPreviousControlShaForWeeklyFinalRefinement -and $source.WeeklyReportFinalRefinementCheckpointSha -eq $expectedWeeklyReportFinalRefinementCheckpointSha
$isMonthlyReportCheckpoint = $source.Mode -eq 'approved_local_monthly_report_checkpoint' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedPreviousControlShaForMonthly -and $source.MonthlyReportCheckpointSha -eq $expectedMonthlyReportCheckpointSha
$isMonthlyReportGuestExperienceCheckpoint = $source.Mode -eq 'approved_local_monthly_report_guest_experience_ui' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_GUEST_EXPERIENCE_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedPreviousControlShaForMonthlyUi -and $source.MonthlyReportUiCheckpointSha -eq $expectedMonthlyReportUiCheckpointSha
$isMonthlyReportGuestExperienceCompactCheckpoint = $source.Mode -eq 'approved_local_monthly_report_guest_experience_compact_ui' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedPreviousControlShaForMonthlyCompact -and $source.MonthlyReportCompactCheckpointSha -eq $expectedMonthlyReportCompactCheckpointSha
$isMonthlyReportTypographyCheckpoint = $source.Mode -eq 'approved_local_monthly_report_typography_refinement' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_TYPOGRAPHY_REFINEMENT_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedPreviousControlShaForMonthlyTypography -and $source.MonthlyReportTypographyCheckpointSha -eq $expectedMonthlyReportTypographyCheckpointSha
$isMonthlyReportAlignmentCheckpoint = $source.Mode -eq 'approved_local_monthly_report_table_alignment' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_TABLE_ALIGNMENT_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedPreviousControlShaForMonthlyAlignment -and $source.MonthlyReportAlignmentCheckpointSha -eq $expectedMonthlyReportAlignmentCheckpointSha
$isCustomReportCheckpoint = $source.Mode -eq 'approved_local_custom_report_redesign' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_CUSTOM_REPORT_REDESIGN_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedPreviousControlShaForCustomReport -and $source.CustomReportCheckpointSha -eq $expectedCustomReportCheckpointSha
$isCustomReportFinalUiCheckpoint = $source.Mode -eq 'approved_local_custom_report_final_ui' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_CUSTOM_REPORT_FINAL_UI_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedPreviousControlShaForCustomReportFinalUi -and $source.CustomReportFinalUiCheckpointSha -eq $expectedCustomReportFinalUiCheckpointSha
$isLeaveTypesCheckpoint = $source.Mode -eq 'approved_local_leave_types' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_LEAVE_TYPES_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedPreviousControlShaForLeaveTypes -and $source.LeaveTypesCheckpointSha -eq $expectedLeaveTypesCheckpointSha
$isEmployeeEntitlementsCheckpoint = $source.Mode -eq 'approved_local_employee_entitlements' -and $ManagerAuthorization -eq 'YES_I_APPROVE_EXACT_EMPLOYEE_ENTITLEMENTS_ACTIVATION' -and $source.PreviousControlCommitSha -eq $expectedPreviousControlShaForEmployeeEntitlements -and $source.EmployeeEntitlementsCheckpointSha -eq $expectedEmployeeEntitlementsCheckpointSha -and $source.EmployeeEntitlementsIntegrationSha -eq $expectedEmployeeEntitlementsIntegrationSha
if ((-not $isBackendCheckpoint -and -not $isReviewUiCheckpoint -and -not $isFinalReviewUiCheckpoint -and -not $isCoverCheckpoint -and -not $isDateCheckpoint -and -not $isTypographyCheckpoint -and -not $isDateResetCheckpoint -and -not $isWeeklyReportCheckpoint -and -not $isWeeklyReportFinalUiCheckpoint -and -not $isWeeklyReportTypographyCheckpoint -and -not $isWeeklyReportTypographyFinalCheckpoint -and -not $isWeeklyReportCompactCheckpoint -and -not $isWeeklyReportFinalRefinementCheckpoint -and -not $isMonthlyReportCheckpoint -and -not $isMonthlyReportGuestExperienceCheckpoint -and -not $isMonthlyReportGuestExperienceCompactCheckpoint -and -not $isMonthlyReportTypographyCheckpoint -and -not $isMonthlyReportAlignmentCheckpoint -and -not $isCustomReportCheckpoint -and -not $isCustomReportFinalUiCheckpoint -and -not $isLeaveTypesCheckpoint -and -not $isEmployeeEntitlementsCheckpoint) -or ((-not $isDateCheckpoint -and -not $isTypographyCheckpoint -and -not $isDateResetCheckpoint -and -not $isWeeklyReportCheckpoint -and -not $isWeeklyReportFinalUiCheckpoint -and -not $isWeeklyReportTypographyCheckpoint -and -not $isWeeklyReportTypographyFinalCheckpoint -and -not $isWeeklyReportCompactCheckpoint -and -not $isWeeklyReportFinalRefinementCheckpoint -and -not $isMonthlyReportCheckpoint -and -not $isMonthlyReportGuestExperienceCheckpoint -and -not $isMonthlyReportGuestExperienceCompactCheckpoint -and -not $isMonthlyReportTypographyCheckpoint -and -not $isMonthlyReportAlignmentCheckpoint -and -not $isCustomReportCheckpoint -and -not $isCustomReportFinalUiCheckpoint -and -not $isLeaveTypesCheckpoint -and -not $isEmployeeEntitlementsCheckpoint) -and $source.ReviewedCheckpointSha -ne $expectedCheckpointSha) -or $source.Sha -ne $ExpectedControlSha) { throw 'ANDALUCIA_LOCAL_BACKEND_ACTIVATION_SOURCE_MISMATCH' }
$requiredRuntimeSha = if ($isEmployeeEntitlementsCheckpoint) { $expectedPreviousControlShaForEmployeeEntitlements } elseif ($isLeaveTypesCheckpoint) { $expectedPreviousControlShaForLeaveTypes } elseif ($isCustomReportFinalUiCheckpoint) { $expectedPreviousControlShaForCustomReportFinalUi } elseif ($isCustomReportCheckpoint) { $expectedPreviousControlShaForCustomReport } elseif ($isMonthlyReportAlignmentCheckpoint) { $expectedPreviousControlShaForMonthlyAlignment } elseif ($isMonthlyReportTypographyCheckpoint) { $expectedPreviousControlShaForMonthlyTypography } elseif ($isMonthlyReportGuestExperienceCompactCheckpoint) { $expectedPreviousControlShaForMonthlyCompact } elseif ($isMonthlyReportGuestExperienceCheckpoint) { $expectedPreviousControlShaForMonthlyUi } elseif ($isMonthlyReportCheckpoint) { $expectedPreviousControlShaForMonthly } elseif ($isWeeklyReportFinalRefinementCheckpoint) { $expectedPreviousControlShaForWeeklyFinalRefinement } elseif ($isWeeklyReportCompactCheckpoint) { $expectedPreviousControlShaForWeeklyCompact } elseif ($isWeeklyReportTypographyFinalCheckpoint) { $expectedPreviousControlShaForWeeklyTypographyFinal } elseif ($isWeeklyReportTypographyCheckpoint) { $expectedPreviousControlShaForWeeklyTypography } elseif ($isWeeklyReportFinalUiCheckpoint) { $expectedPreviousControlShaForWeeklyFinalUi } elseif ($isWeeklyReportCheckpoint) { $expectedPreviousControlShaForWeekly } elseif ($isDateResetCheckpoint) { $expectedPreviousControlShaForDateReset } elseif ($isTypographyCheckpoint) { $expectedPreviousControlShaForTypography } elseif ($isDateCheckpoint) { $expectedPreviousControlShaForDate } elseif ($isCoverCheckpoint) { $expectedPreviousControlShaForCover } elseif ($isFinalReviewUiCheckpoint) { $expectedReviewUiControlSha } elseif ($isReviewUiCheckpoint) { $expectedBackendControlSha } else { $expectedRuntimeBaselineSha }
if (-not (Test-Path -LiteralPath $identityPath -PathType Leaf)) { throw 'ANDALUCIA_LOCAL_BACKEND_CANONICAL_IDENTITY_MISSING' }
$identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
if ($identity.role -ne 'canonical' -or [IO.Path]::GetFullPath([string]$identity.databaseDirectory) -ne $canonicalData) { throw 'ANDALUCIA_LOCAL_BACKEND_CANONICAL_IDENTITY_MISMATCH' }

$health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -Method Get -TimeoutSec 5
if (-not $health.ok -or $health.database.status -ne 'HEALTHY' -or $health.database.migrationVersion -ne '027' -or $health.database.migrationRequired -or $health.database.recoveryRequired) { throw 'ANDALUCIA_LOCAL_BACKEND_SCHEMA_OR_HEALTH_GATE_FAILED' }
if ([string]$health.application.sha -ne $requiredRuntimeSha) { throw "ANDALUCIA_LOCAL_BACKEND_RUNTIME_BASELINE_MISMATCH:$($health.application.sha)" }

$runtimeTask = Get-ScheduledTask -TaskName $runtimeTaskName -ErrorAction SilentlyContinue
if (-not $runtimeTask) { throw 'ANDALUCIA_LOCAL_BACKEND_RUNTIME_TASK_MISSING' }
[xml]$taskDefinition = Export-ScheduledTask -TaskName $runtimeTaskName
$taskNamespace = [Xml.XmlNamespaceManager]::new($taskDefinition.NameTable)
$taskNamespace.AddNamespace('t', 'http://schemas.microsoft.com/windows/2004/02/mit/task')
$taskCommand = $taskDefinition.SelectSingleNode('//t:Actions/t:Exec/t:Command', $taskNamespace).InnerText
$taskArguments = $taskDefinition.SelectSingleNode('//t:Actions/t:Exec/t:Arguments', $taskNamespace).InnerText
$taskWorkingDirectory = $taskDefinition.SelectSingleNode('//t:Actions/t:Exec/t:WorkingDirectory', $taskNamespace).InnerText
$allowHardTerminate = $taskDefinition.SelectSingleNode('//t:Settings/t:AllowHardTerminate', $taskNamespace).InnerText
$stopOnIdleEnd = $taskDefinition.SelectSingleNode('//t:Settings/t:IdleSettings/t:StopOnIdleEnd', $taskNamespace).InnerText
$executionTimeLimit = $taskDefinition.SelectSingleNode('//t:Settings/t:ExecutionTimeLimit', $taskNamespace).InnerText
$expectedLauncher = [IO.Path]::GetFullPath((Join-Path $projectRoot 'deployment\windows\Start-AndaluciaGuardedApplication.ps1'))
if ([IO.Path]::GetFullPath($taskWorkingDirectory) -ne $projectRoot -or $taskArguments -notlike "*$expectedLauncher*" -or $taskCommand -notlike '*\WindowsPowerShell\v1.0\powershell.exe') { throw 'ANDALUCIA_LOCAL_BACKEND_RUNTIME_TASK_ACTION_DRIFT' }
if ($allowHardTerminate -ne 'false' -or $stopOnIdleEnd -ne 'false' -or $executionTimeLimit -ne 'PT0S') { throw 'ANDALUCIA_LOCAL_BACKEND_RUNTIME_TASK_SAFETY_DRIFT' }

$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 3001,5173 })
if (@($listeners | Where-Object LocalPort -eq 3001).Count -ne 1 -or @($listeners | Where-Object LocalPort -eq 5173).Count -ne 1) { throw 'ANDALUCIA_LOCAL_BACKEND_RUNTIME_LISTENER_AMBIGUOUS' }
foreach ($listener in $listeners) {
  $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
  if (-not $listenerProcess -or [string]$listenerProcess.CommandLine -notlike "*$projectRoot*") { throw "ANDALUCIA_LOCAL_BACKEND_RUNTIME_OWNER_MISMATCH:$($listener.LocalPort):$($listener.OwningProcess)" }
}
if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { throw 'ANDALUCIA_LOCAL_BACKEND_ACTIVE_MARKER_MISSING' }

$verifiedBackup = $null
foreach ($metadataFile in @(Get-ChildItem -LiteralPath (Join-Path $projectRoot '.backups') -Filter 'backup-metadata.json' -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
  try { $candidate = Get-Content -LiteralPath $metadataFile.FullName -Raw | ConvertFrom-Json } catch { continue }
  if ($candidate.verificationStatus -ne 'VERIFIED' -or $candidate.openTestStatus -ne 'PASS' -or $candidate.preflightStatus -ne 'READY') { continue }
  $restorePath = Join-Path $metadataFile.Directory.FullName 'restore-test.json'
  if (-not (Test-Path -LiteralPath $restorePath -PathType Leaf)) { continue }
  try { $restore = Get-Content -LiteralPath $restorePath -Raw | ConvertFrom-Json } catch { continue }
  if ($restore.status -ne 'RESTORE_TEST_PASSED' -or -not $restore.manifestMatch -or -not $restore.fingerprintMatch -or -not $restore.migrationMatch -or $restore.preflightStatus -ne 'READY') { continue }
  $backupAgeHours = ([DateTime]::UtcNow - [DateTime]::Parse([string]$candidate.createdAt).ToUniversalTime()).TotalHours
  if ($backupAgeHours -le $MaximumBackupAgeHours) { $verifiedBackup = $candidate; break }
}
if (-not $verifiedBackup) { throw 'ANDALUCIA_LOCAL_BACKEND_VERIFIED_RECENT_BACKUP_REQUIRED' }

& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $stopScript
if ($LASTEXITCODE -ne 0) { throw "ANDALUCIA_LOCAL_BACKEND_GUARDED_STOP_FAILED:$LASTEXITCODE" }
$released = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  $activePorts = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 3001,5173,5174 })
  if ($activePorts.Count -eq 0 -and -not (Test-Path -LiteralPath $markerPath)) { $released = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $released) { throw 'ANDALUCIA_LOCAL_BACKEND_GUARDED_SHUTDOWN_RELEASE_NOT_VERIFIED' }

Start-ScheduledTask -TaskName $runtimeTaskName
$activatedHealth = $null
for ($attempt = 0; $attempt -lt 90; $attempt++) {
  try {
    $candidate = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -Method Get -TimeoutSec 3
    if ($candidate.ok -and $candidate.application.sha -eq $ExpectedControlSha -and $candidate.database.status -eq 'HEALTHY' -and $candidate.database.migrationVersion -eq '027' -and -not $candidate.database.migrationRequired -and -not $candidate.database.recoveryRequired) { $activatedHealth = $candidate; break }
  } catch {}
  Start-Sleep -Seconds 1
}
if (-not $activatedHealth) { throw 'ANDALUCIA_LOCAL_BACKEND_GUARDED_START_HEALTH_VERIFICATION_FAILED' }
[ordered]@{ status='HEALTH_VERIFIED'; runtimeSha=[string]$activatedHealth.application.sha; branch=[string]$activatedHealth.application.branch; schema=[string]$activatedHealth.database.migrationVersion; database=[string]$activatedHealth.database.status; backupId=[string]$verifiedBackup.backupId; reviewedCheckpointSha=$expectedCheckpointSha; monthlyReportCheckpointSha=if($isMonthlyReportCheckpoint){$expectedMonthlyReportCheckpointSha}else{$null}; weeklyReportCheckpointSha=if($isWeeklyReportCheckpoint){$expectedWeeklyReportCheckpointSha}else{$null}; weeklyReportFinalUiCheckpointSha=if($isWeeklyReportFinalUiCheckpoint){$expectedWeeklyReportFinalUiCheckpointSha}elseif($isWeeklyReportFinalRefinementCheckpoint){$expectedWeeklyReportFinalRefinementCheckpointSha}else{$null}; weeklyReportTypographyCheckpointSha=if($isWeeklyReportCompactCheckpoint){$expectedWeeklyReportCompactCheckpointSha}elseif($isWeeklyReportTypographyCheckpoint){$expectedWeeklyReportTypographyCheckpointSha}elseif($isWeeklyReportTypographyFinalCheckpoint){$expectedWeeklyReportTypographyFinalCheckpointSha}else{$null}; dateCheckpointSha=if($isDateCheckpoint){$expectedDateCheckpointSha}else{$null}; coverCheckpointSha=if($isCoverCheckpoint){$expectedCoverSha}else{$null}; reviewUiCheckpointSha=if($isFinalReviewUiCheckpoint){$expectedFinalReviewUiSha}elseif($isReviewUiCheckpoint){$expectedReviewUiSha}else{$null}; restartPerformed=$true; markerModifiedManually=$false } | ConvertTo-Json -Depth 5
