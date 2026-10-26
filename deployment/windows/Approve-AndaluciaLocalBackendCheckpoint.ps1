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
  [string]$WeeklyReportCheckpointSha,
  [string]$WeeklyReportFinalUiCheckpointSha,
  [string]$WeeklyReportTypographyCheckpointSha,
  [string]$WeeklyReportTypographyFinalCheckpointSha,
  [string]$WeeklyReportCompactCheckpointSha,
  [string]$WeeklyReportFinalRefinementCheckpointSha,
  [string]$MonthlyReportCheckpointSha,
  [string]$MonthlyReportUiCheckpointSha,
  [string]$MonthlyReportCompactCheckpointSha,
  [string]$MonthlyReportTypographyCheckpointSha,
  [string]$MonthlyReportAlignmentCheckpointSha,
  [string]$CustomReportCheckpointSha,
  [string]$CustomReportFinalUiCheckpointSha,
  [string]$LeaveTypesCheckpointSha,
  [string]$EmployeeEntitlementsCheckpointSha,
  [string]$OffDaysSummaryCheckpointSha,
  [string]$EntitlementBalanceSimplificationCheckpointSha,
  [string]$EntitlementManageCleanupCheckpointSha,
  [string]$LeaveRenewalRulesCheckpointSha,
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
$expectedReviewedEmployeeEntitlementsParentSha = '114a35c12914a4cde3d43e8dd281918251a11140'
$expectedEmployeeEntitlementsCheckpointSha = 'ca28f4f522d6d5c1b6ae78e23d1ad031c87d117b'
$expectedEmployeeEntitlementsIntegrationSha = '8b2d5ead2d895004fa6aa8c5e1a9694891b23926'
$expectedPreviousControlShaForOffDaysSummary = '94e51d45ebae0e20da5d50e18a67b17a06d3cf41'
$expectedOffDaysSummaryCheckpointSha = 'bffece4a6e2ae6b8601c10adcd088f9cf08d8ff1'
$expectedOffDaysSummaryIntegrationSha = '5ecd4a86b1d1e021d11a4c01b4aa6f5869016ee8'
$expectedPreviousControlShaForEntitlementBalanceSimplification = 'cf9d12e593dc4431124107f712f11b8201bddef6'
$expectedEntitlementBalanceSimplificationCheckpointSha = '3c0eac9c07d90f29e0b91ebcab77ca3651437df6'
$expectedEntitlementBalanceSimplificationIntegrationSha = 'b498106e9d1506f8d2e2e09517adbbfd57334ecd'
$expectedPreviousControlShaForEntitlementManageCleanup = 'bc2423f24656c5871955f4cf2aa33ab15eefb478'
$expectedEntitlementManageCleanupCheckpointSha = '2418cdad39a4e1816bfce3d401521fb9666a8d33'
$expectedPreviousControlShaForLeaveRenewalRules = '3c6b0270f1ce3d4a0aa1b412b5dafdde4ea53aac'
$expectedLeaveRenewalRulesCheckpointSha = 'b8d641909ce62bef9ca9741f584b663d59dfea68'
$expectedPreviousUiCheckpointSha = '310b3f36b89555fb90c9d2464a34d7f038e5a2de'
$expectedPreviousControlSha = '072cd10ccd0905601f554020cb489fedd740dd73'
$projectRoot = if ($RepositoryRoot) { [IO.Path]::GetFullPath($RepositoryRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')) }
$resolverPath = Join-Path $projectRoot 'deployment\windows\Resolve-AndaluciaApprovedSource.ps1'
$manifestPath = Join-Path $projectRoot '.runtime\andalucia-local-ui-approval.json'
if ($ManagerApproval -notin @('YES_I_APPROVE_EXACT_DAILY_REPORT_BACKEND_CHECKPOINT','YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_UI_CHECKPOINT','YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_FINAL_UI_CHECKPOINT','YES_I_APPROVE_EXACT_DAILY_REPORT_COVER_CHECKPOINT','YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_CHECKPOINT','YES_I_APPROVE_EXACT_DAILY_REPORT_TYPOGRAPHY_CHECKPOINT','YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_RESET_CHECKPOINT','YES_I_APPROVE_EXACT_WINDOWS_SHUTDOWN_RELIABILITY_CHECKPOINT','YES_I_APPROVE_EXACT_WEEKLY_REPORT_CHECKPOINT','YES_I_APPROVE_EXACT_WEEKLY_REPORT_FINAL_UI_CHECKPOINT','YES_I_APPROVE_EXACT_WEEKLY_REPORT_TYPOGRAPHY_CHECKPOINT','YES_I_APPROVE_EXACT_WEEKLY_REPORT_TYPOGRAPHY_FINAL_CHECKPOINT','YES_I_APPROVE_EXACT_WEEKLY_REPORT_COMPACT_CHECKPOINT','YES_I_APPROVE_EXACT_WEEKLY_REPORT_FINAL_REFINEMENT_CHECKPOINT','YES_I_APPROVE_EXACT_MONTHLY_REPORT_CHECKPOINT','YES_I_APPROVE_EXACT_MONTHLY_REPORT_GUEST_EXPERIENCE_CHECKPOINT','YES_I_APPROVE_EXACT_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_CHECKPOINT','YES_I_APPROVE_EXACT_MONTHLY_REPORT_TYPOGRAPHY_REFINEMENT_CHECKPOINT','YES_I_APPROVE_EXACT_MONTHLY_REPORT_TABLE_ALIGNMENT_CHECKPOINT','YES_I_APPROVE_EXACT_CUSTOM_REPORT_REDESIGN_CHECKPOINT','YES_I_APPROVE_EXACT_CUSTOM_REPORT_FINAL_UI_CHECKPOINT','YES_I_APPROVE_EXACT_LEAVE_TYPES_CHECKPOINT','YES_I_APPROVE_EXACT_EMPLOYEE_ENTITLEMENTS_CHECKPOINT','YES_I_APPROVE_EXACT_OFF_DAYS_SUMMARY_CHECKPOINT','YES_I_APPROVE_EXACT_ENTITLEMENT_BALANCE_SIMPLIFICATION_CHECKPOINT','YES_I_APPROVE_EXACT_ENTITLEMENT_MANAGE_CLEANUP_CHECKPOINT','YES_I_APPROVE_EXACT_LEAVE_RENEWAL_RULES_CHECKPOINT')) { throw 'ANDALUCIA_LOCAL_BACKEND_MANAGER_APPROVAL_REQUIRED' }
if ($ManagerApproval -notin @('YES_I_APPROVE_EXACT_WINDOWS_SHUTDOWN_RELIABILITY_CHECKPOINT','YES_I_APPROVE_EXACT_WEEKLY_REPORT_CHECKPOINT','YES_I_APPROVE_EXACT_WEEKLY_REPORT_FINAL_UI_CHECKPOINT','YES_I_APPROVE_EXACT_WEEKLY_REPORT_TYPOGRAPHY_CHECKPOINT','YES_I_APPROVE_EXACT_WEEKLY_REPORT_TYPOGRAPHY_FINAL_CHECKPOINT','YES_I_APPROVE_EXACT_WEEKLY_REPORT_COMPACT_CHECKPOINT','YES_I_APPROVE_EXACT_WEEKLY_REPORT_FINAL_REFINEMENT_CHECKPOINT','YES_I_APPROVE_EXACT_MONTHLY_REPORT_CHECKPOINT','YES_I_APPROVE_EXACT_MONTHLY_REPORT_GUEST_EXPERIENCE_CHECKPOINT','YES_I_APPROVE_EXACT_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_CHECKPOINT','YES_I_APPROVE_EXACT_MONTHLY_REPORT_TYPOGRAPHY_REFINEMENT_CHECKPOINT','YES_I_APPROVE_EXACT_MONTHLY_REPORT_TABLE_ALIGNMENT_CHECKPOINT','YES_I_APPROVE_EXACT_CUSTOM_REPORT_REDESIGN_CHECKPOINT','YES_I_APPROVE_EXACT_CUSTOM_REPORT_FINAL_UI_CHECKPOINT','YES_I_APPROVE_EXACT_LEAVE_TYPES_CHECKPOINT','YES_I_APPROVE_EXACT_EMPLOYEE_ENTITLEMENTS_CHECKPOINT','YES_I_APPROVE_EXACT_OFF_DAYS_SUMMARY_CHECKPOINT','YES_I_APPROVE_EXACT_ENTITLEMENT_BALANCE_SIMPLIFICATION_CHECKPOINT','YES_I_APPROVE_EXACT_ENTITLEMENT_MANAGE_CLEANUP_CHECKPOINT','YES_I_APPROVE_EXACT_LEAVE_RENEWAL_RULES_CHECKPOINT') -and $ReviewedCheckpointSha -ne $expectedCheckpointSha) { throw 'ANDALUCIA_LOCAL_BACKEND_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_UI_CHECKPOINT' -and $ReviewUiCheckpointSha -ne $expectedReviewUiSha) { throw 'ANDALUCIA_LOCAL_BACKEND_UI_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_FINAL_UI_CHECKPOINT' -and $FinalReviewUiCheckpointSha -ne $expectedFinalReviewUiSha) { throw 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_COVER_CHECKPOINT' -and $CoverCheckpointSha -ne $expectedCoverSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_COVER_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_CHECKPOINT' -and $DatePersistenceCheckpointSha -ne $expectedDateCheckpointSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_TYPOGRAPHY_CHECKPOINT' -and $TypographyCheckpointSha -ne $expectedTypographyCheckpointSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_TYPOGRAPHY_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_RESET_CHECKPOINT' -and $DateResetCheckpointSha -ne $expectedDateResetCheckpointSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_RESET_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_WINDOWS_SHUTDOWN_RELIABILITY_CHECKPOINT' -and $ShutdownCheckpointSha -ne $expectedShutdownCheckpointSha) { throw 'ANDALUCIA_LOCAL_WINDOWS_SHUTDOWN_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_CHECKPOINT' -and $WeeklyReportCheckpointSha -ne $expectedWeeklyReportCheckpointSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_FINAL_UI_CHECKPOINT' -and $WeeklyReportFinalUiCheckpointSha -ne $expectedWeeklyReportFinalUiCheckpointSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_UI_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_TYPOGRAPHY_CHECKPOINT' -and $WeeklyReportTypographyCheckpointSha -ne $expectedWeeklyReportTypographyCheckpointSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_TYPOGRAPHY_FINAL_CHECKPOINT' -and $WeeklyReportTypographyFinalCheckpointSha -ne $expectedWeeklyReportTypographyFinalCheckpointSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_FINAL_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_COMPACT_CHECKPOINT' -and $WeeklyReportCompactCheckpointSha -ne $expectedWeeklyReportCompactCheckpointSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_COMPACT_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_FINAL_REFINEMENT_CHECKPOINT' -and $WeeklyReportFinalRefinementCheckpointSha -ne $expectedWeeklyReportFinalRefinementCheckpointSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_REFINEMENT_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_CHECKPOINT' -and $MonthlyReportCheckpointSha -ne $expectedMonthlyReportCheckpointSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_GUEST_EXPERIENCE_CHECKPOINT' -and $MonthlyReportUiCheckpointSha -ne $expectedMonthlyReportUiCheckpointSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_CHECKPOINT' -and $MonthlyReportCompactCheckpointSha -ne $expectedMonthlyReportCompactCheckpointSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_TYPOGRAPHY_REFINEMENT_CHECKPOINT' -and $MonthlyReportTypographyCheckpointSha -ne $expectedMonthlyReportTypographyCheckpointSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_TYPOGRAPHY_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_TABLE_ALIGNMENT_CHECKPOINT' -and $MonthlyReportAlignmentCheckpointSha -ne $expectedMonthlyReportAlignmentCheckpointSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_ALIGNMENT_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_CUSTOM_REPORT_REDESIGN_CHECKPOINT' -and $CustomReportCheckpointSha -ne $expectedCustomReportCheckpointSha) { throw 'ANDALUCIA_LOCAL_CUSTOM_REPORT_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_CUSTOM_REPORT_FINAL_UI_CHECKPOINT' -and $CustomReportFinalUiCheckpointSha -ne $expectedCustomReportFinalUiCheckpointSha) { throw 'ANDALUCIA_LOCAL_CUSTOM_REPORT_FINAL_UI_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_LEAVE_TYPES_CHECKPOINT' -and $LeaveTypesCheckpointSha -ne $expectedLeaveTypesCheckpointSha) { throw 'ANDALUCIA_LOCAL_LEAVE_TYPES_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_EMPLOYEE_ENTITLEMENTS_CHECKPOINT' -and $EmployeeEntitlementsCheckpointSha -ne $expectedEmployeeEntitlementsCheckpointSha) { throw 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_OFF_DAYS_SUMMARY_CHECKPOINT' -and $OffDaysSummaryCheckpointSha -ne $expectedOffDaysSummaryCheckpointSha) { throw 'ANDALUCIA_LOCAL_OFF_DAYS_SUMMARY_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_ENTITLEMENT_BALANCE_SIMPLIFICATION_CHECKPOINT' -and $EntitlementBalanceSimplificationCheckpointSha -ne $expectedEntitlementBalanceSimplificationCheckpointSha) { throw 'ANDALUCIA_LOCAL_ENTITLEMENT_BALANCE_SIMPLIFICATION_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_ENTITLEMENT_MANAGE_CLEANUP_CHECKPOINT' -and $EntitlementManageCleanupCheckpointSha -ne $expectedEntitlementManageCleanupCheckpointSha) { throw 'ANDALUCIA_LOCAL_ENTITLEMENT_MANAGE_CLEANUP_CHECKPOINT_SHA_NOT_APPROVED' }
if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_LEAVE_RENEWAL_RULES_CHECKPOINT' -and $LeaveRenewalRulesCheckpointSha -ne $expectedLeaveRenewalRulesCheckpointSha) { throw 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_CHECKPOINT_SHA_NOT_APPROVED' }
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
if (($ManagerApproval -notin @('YES_I_APPROVE_EXACT_WINDOWS_SHUTDOWN_RELIABILITY_CHECKPOINT','YES_I_APPROVE_EXACT_WEEKLY_REPORT_CHECKPOINT','YES_I_APPROVE_EXACT_WEEKLY_REPORT_FINAL_UI_CHECKPOINT','YES_I_APPROVE_EXACT_WEEKLY_REPORT_TYPOGRAPHY_CHECKPOINT','YES_I_APPROVE_EXACT_WEEKLY_REPORT_TYPOGRAPHY_FINAL_CHECKPOINT','YES_I_APPROVE_EXACT_WEEKLY_REPORT_COMPACT_CHECKPOINT','YES_I_APPROVE_EXACT_WEEKLY_REPORT_FINAL_REFINEMENT_CHECKPOINT','YES_I_APPROVE_EXACT_MONTHLY_REPORT_CHECKPOINT','YES_I_APPROVE_EXACT_MONTHLY_REPORT_GUEST_EXPERIENCE_CHECKPOINT','YES_I_APPROVE_EXACT_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_CHECKPOINT','YES_I_APPROVE_EXACT_MONTHLY_REPORT_TYPOGRAPHY_REFINEMENT_CHECKPOINT','YES_I_APPROVE_EXACT_MONTHLY_REPORT_TABLE_ALIGNMENT_CHECKPOINT','YES_I_APPROVE_EXACT_CUSTOM_REPORT_REDESIGN_CHECKPOINT','YES_I_APPROVE_EXACT_CUSTOM_REPORT_FINAL_UI_CHECKPOINT','YES_I_APPROVE_EXACT_LEAVE_TYPES_CHECKPOINT','YES_I_APPROVE_EXACT_EMPLOYEE_ENTITLEMENTS_CHECKPOINT','YES_I_APPROVE_EXACT_OFF_DAYS_SUMMARY_CHECKPOINT','YES_I_APPROVE_EXACT_ENTITLEMENT_BALANCE_SIMPLIFICATION_CHECKPOINT','YES_I_APPROVE_EXACT_ENTITLEMENT_MANAGE_CLEANUP_CHECKPOINT','YES_I_APPROVE_EXACT_LEAVE_RENEWAL_RULES_CHECKPOINT') -and $resolvedCheckpoint -ne $expectedCheckpointSha) -or $resolvedControlCommit -ne $ControlCommitSha -or $resolvedControlCommit -ne $activeSourceSha) { throw 'ANDALUCIA_LOCAL_BACKEND_FULL_SHA_REQUIRED' }

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_LEAVE_RENEWAL_RULES_CHECKPOINT') {
  $resolvedLeaveRenewalRulesCheckpoint = Resolve-AndaluciaGitRef $projectRoot $LeaveRenewalRulesCheckpointSha
  if ($resolvedLeaveRenewalRulesCheckpoint -ne $expectedLeaveRenewalRulesCheckpointSha -or $resolvedCheckpoint -ne $expectedLeaveRenewalRulesCheckpointSha) { throw 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-workforce-approval-v6' -or $priorManifest.mode -ne 'approved_local_entitlement_manage_cleanup' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_ENTITLEMENT_MANAGE_CLEANUP_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForLeaveRenewalRules -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForLeaveRenewalRules -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_PRIOR_APPROVAL_INVALID' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForLeaveRenewalRules $resolvedLeaveRenewalRulesCheckpoint 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedLeaveRenewalRulesCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $leaveRenewalRulesPaths = @(Get-AndaluciaReviewedLeaveRenewalRulesPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForLeaveRenewalRules $resolvedLeaveRenewalRulesCheckpoint $leaveRenewalRulesPaths 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_REVIEWED_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedLeaveRenewalRulesCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-workforce-approval-v7'; mode='approved_local_leave_renewal_rules'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForLeaveRenewalRules; leaveRenewalRulesCheckpointSha=$resolvedLeaveRenewalRulesCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; leaveRenewalRulesPaths=$leaveRenewalRulesPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_LEAVE_RENEWAL_RULES_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_ENTITLEMENT_MANAGE_CLEANUP_CHECKPOINT') {
  $resolvedEntitlementManageCleanupCheckpoint = Resolve-AndaluciaGitRef $projectRoot $EntitlementManageCleanupCheckpointSha
  if ($resolvedEntitlementManageCleanupCheckpoint -ne $expectedEntitlementManageCleanupCheckpointSha -or $resolvedCheckpoint -ne $expectedEntitlementManageCleanupCheckpointSha) { throw 'ANDALUCIA_LOCAL_ENTITLEMENT_MANAGE_CLEANUP_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_ENTITLEMENT_MANAGE_CLEANUP_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-workforce-approval-v5' -or $priorManifest.mode -ne 'approved_local_entitlement_balance_simplification' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_ENTITLEMENT_BALANCE_SIMPLIFICATION_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForEntitlementManageCleanup -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForEntitlementManageCleanup -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_ENTITLEMENT_MANAGE_CLEANUP_PRIOR_APPROVAL_INVALID' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForEntitlementManageCleanup $resolvedEntitlementManageCleanupCheckpoint 'ANDALUCIA_LOCAL_ENTITLEMENT_MANAGE_CLEANUP_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedEntitlementManageCleanupCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_ENTITLEMENT_MANAGE_CLEANUP_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $entitlementManageCleanupPaths = @(Get-AndaluciaReviewedEntitlementManageCleanupPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForEntitlementManageCleanup $resolvedEntitlementManageCleanupCheckpoint $entitlementManageCleanupPaths 'ANDALUCIA_LOCAL_ENTITLEMENT_MANAGE_CLEANUP_REVIEWED_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedEntitlementManageCleanupCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-workforce-approval-v6'; mode='approved_local_entitlement_manage_cleanup'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForEntitlementManageCleanup; entitlementManageCleanupCheckpointSha=$resolvedEntitlementManageCleanupCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; entitlementManageCleanupPaths=$entitlementManageCleanupPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_ENTITLEMENT_MANAGE_CLEANUP_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_ENTITLEMENT_BALANCE_SIMPLIFICATION_CHECKPOINT') {
  $resolvedEntitlementBalanceSimplificationCheckpoint = Resolve-AndaluciaGitRef $projectRoot $EntitlementBalanceSimplificationCheckpointSha
  if ($resolvedEntitlementBalanceSimplificationCheckpoint -ne $expectedEntitlementBalanceSimplificationCheckpointSha -or $resolvedCheckpoint -ne $expectedEntitlementBalanceSimplificationCheckpointSha) { throw 'ANDALUCIA_LOCAL_ENTITLEMENT_BALANCE_SIMPLIFICATION_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_ENTITLEMENT_BALANCE_SIMPLIFICATION_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-workforce-approval-v4' -or $priorManifest.mode -ne 'approved_local_off_days_summary' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_OFF_DAYS_SUMMARY_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForEntitlementBalanceSimplification -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForEntitlementBalanceSimplification -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_ENTITLEMENT_BALANCE_SIMPLIFICATION_PRIOR_APPROVAL_INVALID' }
  $resolvedIntegrationCheckpoint = Resolve-AndaluciaGitRef $projectRoot $expectedEntitlementBalanceSimplificationIntegrationSha
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForEntitlementBalanceSimplification $resolvedIntegrationCheckpoint 'ANDALUCIA_LOCAL_ENTITLEMENT_BALANCE_SIMPLIFICATION_INTEGRATION_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedIntegrationCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_ENTITLEMENT_BALANCE_SIMPLIFICATION_CONTROL_NOT_BASED_ON_INTEGRATION'
  $entitlementBalanceSimplificationPaths = @(Get-AndaluciaReviewedEntitlementBalanceSimplificationPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedOffDaysSummaryCheckpointSha $resolvedEntitlementBalanceSimplificationCheckpoint $entitlementBalanceSimplificationPaths 'ANDALUCIA_LOCAL_ENTITLEMENT_BALANCE_SIMPLIFICATION_REVIEWED_PATH_MISMATCH')
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForEntitlementBalanceSimplification $resolvedIntegrationCheckpoint $entitlementBalanceSimplificationPaths 'ANDALUCIA_LOCAL_ENTITLEMENT_BALANCE_SIMPLIFICATION_INTEGRATION_PATH_MISMATCH')
  Assert-AndaluciaPathContentMatches $projectRoot $resolvedEntitlementBalanceSimplificationCheckpoint $resolvedIntegrationCheckpoint $entitlementBalanceSimplificationPaths 'ANDALUCIA_LOCAL_ENTITLEMENT_BALANCE_SIMPLIFICATION_CONTENT_MISMATCH'
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedIntegrationCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-workforce-approval-v5'; mode='approved_local_entitlement_balance_simplification'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForEntitlementBalanceSimplification; entitlementBalanceSimplificationCheckpointSha=$resolvedEntitlementBalanceSimplificationCheckpoint; entitlementBalanceSimplificationIntegrationSha=$resolvedIntegrationCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; entitlementBalanceSimplificationPaths=$entitlementBalanceSimplificationPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_ENTITLEMENT_BALANCE_SIMPLIFICATION_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_OFF_DAYS_SUMMARY_CHECKPOINT') {
  $resolvedOffDaysSummaryCheckpoint = Resolve-AndaluciaGitRef $projectRoot $OffDaysSummaryCheckpointSha
  if ($resolvedOffDaysSummaryCheckpoint -ne $expectedOffDaysSummaryCheckpointSha -or $resolvedCheckpoint -ne $expectedOffDaysSummaryCheckpointSha) { throw 'ANDALUCIA_LOCAL_OFF_DAYS_SUMMARY_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_OFF_DAYS_SUMMARY_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-workforce-approval-v3' -or $priorManifest.mode -ne 'approved_local_employee_entitlements' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_EMPLOYEE_ENTITLEMENTS_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForOffDaysSummary -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForOffDaysSummary -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_OFF_DAYS_SUMMARY_PRIOR_APPROVAL_INVALID' }
  $resolvedIntegrationCheckpoint = Resolve-AndaluciaGitRef $projectRoot $expectedOffDaysSummaryIntegrationSha
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForOffDaysSummary $resolvedIntegrationCheckpoint 'ANDALUCIA_LOCAL_OFF_DAYS_SUMMARY_INTEGRATION_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedIntegrationCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_OFF_DAYS_SUMMARY_CONTROL_NOT_BASED_ON_INTEGRATION'
  $offDaysSummaryPaths = @(Get-AndaluciaReviewedOffDaysSummaryPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForOffDaysSummary $resolvedOffDaysSummaryCheckpoint $offDaysSummaryPaths 'ANDALUCIA_LOCAL_OFF_DAYS_SUMMARY_REVIEWED_PATH_MISMATCH')
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForOffDaysSummary $resolvedIntegrationCheckpoint $offDaysSummaryPaths 'ANDALUCIA_LOCAL_OFF_DAYS_SUMMARY_INTEGRATION_PATH_MISMATCH')
  Assert-AndaluciaPathContentMatches $projectRoot $resolvedOffDaysSummaryCheckpoint $resolvedIntegrationCheckpoint $offDaysSummaryPaths 'ANDALUCIA_LOCAL_OFF_DAYS_SUMMARY_CONTENT_MISMATCH'
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedIntegrationCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-workforce-approval-v4'; mode='approved_local_off_days_summary'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForOffDaysSummary; offDaysSummaryCheckpointSha=$resolvedOffDaysSummaryCheckpoint; offDaysSummaryIntegrationSha=$resolvedIntegrationCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; offDaysSummaryPaths=$offDaysSummaryPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_OFF_DAYS_SUMMARY_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_EMPLOYEE_ENTITLEMENTS_CHECKPOINT') {
  $resolvedEmployeeEntitlementsCheckpoint = Resolve-AndaluciaGitRef $projectRoot $EmployeeEntitlementsCheckpointSha
  if ($resolvedEmployeeEntitlementsCheckpoint -ne $expectedEmployeeEntitlementsCheckpointSha -or $resolvedCheckpoint -ne $expectedEmployeeEntitlementsCheckpointSha) { throw 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-workforce-approval-v2' -or $priorManifest.mode -ne 'approved_local_employee_entitlements' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_EMPLOYEE_ENTITLEMENTS_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForEmployeeEntitlements -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForEmployeeEntitlements -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_PRIOR_APPROVAL_INVALID' }
  $resolvedIntegrationCheckpoint = Resolve-AndaluciaGitRef $projectRoot $expectedEmployeeEntitlementsIntegrationSha
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForEmployeeEntitlements $resolvedIntegrationCheckpoint 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_INTEGRATION_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedIntegrationCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_CONTROL_NOT_BASED_ON_INTEGRATION'
  $employeeEntitlementsPaths = @(Get-AndaluciaReviewedEmployeeEntitlementsPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedReviewedEmployeeEntitlementsParentSha $resolvedEmployeeEntitlementsCheckpoint $employeeEntitlementsPaths 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_REVIEWED_PATH_MISMATCH')
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForEmployeeEntitlements $resolvedIntegrationCheckpoint $employeeEntitlementsPaths 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_INTEGRATION_PATH_MISMATCH')
  Assert-AndaluciaPathContentMatches $projectRoot $resolvedEmployeeEntitlementsCheckpoint $resolvedIntegrationCheckpoint $employeeEntitlementsPaths 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_CONTENT_MISMATCH'
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedIntegrationCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-workforce-approval-v3'; mode='approved_local_employee_entitlements'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForEmployeeEntitlements; employeeEntitlementsCheckpointSha=$resolvedEmployeeEntitlementsCheckpoint; employeeEntitlementsIntegrationSha=$resolvedIntegrationCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; employeeEntitlementsPaths=$employeeEntitlementsPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_EMPLOYEE_ENTITLEMENTS_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_LEAVE_TYPES_CHECKPOINT') {
  $resolvedLeaveTypesCheckpoint = Resolve-AndaluciaGitRef $projectRoot $LeaveTypesCheckpointSha
  if ($resolvedLeaveTypesCheckpoint -ne $expectedLeaveTypesCheckpointSha -or $resolvedCheckpoint -ne $expectedLeaveTypesCheckpointSha) { throw 'ANDALUCIA_LOCAL_LEAVE_TYPES_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_LEAVE_TYPES_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-monthly-report-approval-v7' -or $priorManifest.mode -ne 'approved_local_custom_report_final_ui' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_CUSTOM_REPORT_FINAL_UI_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForLeaveTypes -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForLeaveTypes -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_LEAVE_TYPES_PRIOR_APPROVAL_INVALID' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForLeaveTypes $resolvedLeaveTypesCheckpoint 'ANDALUCIA_LOCAL_LEAVE_TYPES_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedLeaveTypesCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_LEAVE_TYPES_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $leaveTypesPaths = @(Get-AndaluciaReviewedLeaveTypesPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForLeaveTypes $resolvedLeaveTypesCheckpoint $leaveTypesPaths 'ANDALUCIA_LOCAL_LEAVE_TYPES_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedLeaveTypesCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-workforce-approval-v1'; mode='approved_local_leave_types'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForLeaveTypes; leaveTypesCheckpointSha=$resolvedLeaveTypesCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; leaveTypesPaths=$leaveTypesPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_LEAVE_TYPES_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_CUSTOM_REPORT_FINAL_UI_CHECKPOINT') {
  $resolvedCustomReportFinalUiCheckpoint = Resolve-AndaluciaGitRef $projectRoot $CustomReportFinalUiCheckpointSha
  if ($resolvedCustomReportFinalUiCheckpoint -ne $expectedCustomReportFinalUiCheckpointSha -or $resolvedCheckpoint -ne $expectedCustomReportFinalUiCheckpointSha) { throw 'ANDALUCIA_LOCAL_CUSTOM_REPORT_FINAL_UI_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_CUSTOM_REPORT_FINAL_UI_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-monthly-report-approval-v6' -or $priorManifest.mode -ne 'approved_local_custom_report_redesign' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_CUSTOM_REPORT_REDESIGN_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForCustomReportFinalUi -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForCustomReportFinalUi -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_CUSTOM_REPORT_FINAL_UI_PRIOR_APPROVAL_INVALID' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForCustomReportFinalUi $resolvedCustomReportFinalUiCheckpoint 'ANDALUCIA_LOCAL_CUSTOM_REPORT_FINAL_UI_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedCustomReportFinalUiCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_CUSTOM_REPORT_FINAL_UI_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $customReportFinalUiPaths = @(Get-AndaluciaReviewedCustomReportFinalUiPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForCustomReportFinalUi $resolvedCustomReportFinalUiCheckpoint $customReportFinalUiPaths 'ANDALUCIA_LOCAL_CUSTOM_REPORT_FINAL_UI_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedCustomReportFinalUiCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-monthly-report-approval-v7'; mode='approved_local_custom_report_final_ui'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForCustomReportFinalUi; customReportFinalUiCheckpointSha=$resolvedCustomReportFinalUiCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; customReportFinalUiPaths=$customReportFinalUiPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_CUSTOM_REPORT_FINAL_UI_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_CUSTOM_REPORT_REDESIGN_CHECKPOINT') {
  $resolvedCustomReportCheckpoint = Resolve-AndaluciaGitRef $projectRoot $CustomReportCheckpointSha
  if ($resolvedCustomReportCheckpoint -ne $expectedCustomReportCheckpointSha -or $resolvedCheckpoint -ne $expectedCustomReportCheckpointSha) { throw 'ANDALUCIA_LOCAL_CUSTOM_REPORT_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_CUSTOM_REPORT_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-monthly-report-approval-v5' -or $priorManifest.mode -ne 'approved_local_monthly_report_table_alignment' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_TABLE_ALIGNMENT_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForCustomReport -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForCustomReport -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_CUSTOM_REPORT_PRIOR_APPROVAL_INVALID' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForCustomReport $resolvedCustomReportCheckpoint 'ANDALUCIA_LOCAL_CUSTOM_REPORT_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedCustomReportCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_CUSTOM_REPORT_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $customReportPaths = @(Get-AndaluciaReviewedCustomReportRedesignPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForCustomReport $resolvedCustomReportCheckpoint $customReportPaths 'ANDALUCIA_LOCAL_CUSTOM_REPORT_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedCustomReportCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-monthly-report-approval-v6'; mode='approved_local_custom_report_redesign'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForCustomReport; customReportCheckpointSha=$resolvedCustomReportCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; customReportPaths=$customReportPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_CUSTOM_REPORT_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_TABLE_ALIGNMENT_CHECKPOINT') {
  $resolvedAlignmentCheckpoint = Resolve-AndaluciaGitRef $projectRoot $MonthlyReportAlignmentCheckpointSha
  if ($resolvedAlignmentCheckpoint -ne $expectedMonthlyReportAlignmentCheckpointSha -or $resolvedCheckpoint -ne $expectedMonthlyReportAlignmentCheckpointSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_ALIGNMENT_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_ALIGNMENT_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-monthly-report-approval-v4' -or $priorManifest.mode -ne 'approved_local_monthly_report_typography_refinement' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_TYPOGRAPHY_REFINEMENT_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForMonthlyAlignment -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForMonthlyAlignment -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_ALIGNMENT_PRIOR_APPROVAL_INVALID' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForMonthlyAlignment $resolvedAlignmentCheckpoint 'ANDALUCIA_LOCAL_MONTHLY_REPORT_ALIGNMENT_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedAlignmentCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_MONTHLY_REPORT_ALIGNMENT_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $alignmentPaths = @(Get-AndaluciaReviewedMonthlyReportAlignmentPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForMonthlyAlignment $resolvedAlignmentCheckpoint $alignmentPaths 'ANDALUCIA_LOCAL_MONTHLY_REPORT_ALIGNMENT_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedAlignmentCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-monthly-report-approval-v5'; mode='approved_local_monthly_report_table_alignment'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForMonthlyAlignment; monthlyReportAlignmentCheckpointSha=$resolvedAlignmentCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; monthlyReportAlignmentPaths=$alignmentPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_MONTHLY_REPORT_ALIGNMENT_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_TYPOGRAPHY_REFINEMENT_CHECKPOINT') {
  $resolvedTypographyCheckpoint = Resolve-AndaluciaGitRef $projectRoot $MonthlyReportTypographyCheckpointSha
  if ($resolvedTypographyCheckpoint -ne $expectedMonthlyReportTypographyCheckpointSha -or $resolvedCheckpoint -ne $expectedMonthlyReportTypographyCheckpointSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_TYPOGRAPHY_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_TYPOGRAPHY_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-monthly-report-approval-v3' -or $priorManifest.mode -ne 'approved_local_monthly_report_guest_experience_compact_ui' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForMonthlyTypography -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForMonthlyTypography -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_TYPOGRAPHY_PRIOR_APPROVAL_INVALID' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForMonthlyTypography $resolvedTypographyCheckpoint 'ANDALUCIA_LOCAL_MONTHLY_REPORT_TYPOGRAPHY_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedTypographyCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_MONTHLY_REPORT_TYPOGRAPHY_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $typographyPaths = @(Get-AndaluciaReviewedMonthlyReportGuestExperiencePaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForMonthlyTypography $resolvedTypographyCheckpoint $typographyPaths 'ANDALUCIA_LOCAL_MONTHLY_REPORT_TYPOGRAPHY_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedTypographyCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-monthly-report-approval-v4'; mode='approved_local_monthly_report_typography_refinement'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForMonthlyTypography; monthlyReportTypographyCheckpointSha=$resolvedTypographyCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; monthlyReportTypographyPaths=$typographyPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_MONTHLY_REPORT_TYPOGRAPHY_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_CHECKPOINT') {
  $resolvedCompactCheckpoint = Resolve-AndaluciaGitRef $projectRoot $MonthlyReportCompactCheckpointSha
  if ($resolvedCompactCheckpoint -ne $expectedMonthlyReportCompactCheckpointSha -or $resolvedCheckpoint -ne $expectedMonthlyReportCompactCheckpointSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-monthly-report-approval-v2' -or $priorManifest.mode -ne 'approved_local_monthly_report_guest_experience_ui' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_GUEST_EXPERIENCE_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForMonthlyCompact -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForMonthlyCompact -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_PRIOR_APPROVAL_INVALID' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForMonthlyCompact $resolvedCompactCheckpoint 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedCompactCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $compactPaths = @(Get-AndaluciaReviewedMonthlyReportGuestExperiencePaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForMonthlyCompact $resolvedCompactCheckpoint $compactPaths 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedCompactCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-monthly-report-approval-v3'; mode='approved_local_monthly_report_guest_experience_compact_ui'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForMonthlyCompact; monthlyReportCompactCheckpointSha=$resolvedCompactCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; monthlyReportCompactPaths=$compactPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_GUEST_EXPERIENCE_CHECKPOINT') {
  $resolvedUiCheckpoint = Resolve-AndaluciaGitRef $projectRoot $MonthlyReportUiCheckpointSha
  if ($resolvedUiCheckpoint -ne $expectedMonthlyReportUiCheckpointSha -or $resolvedCheckpoint -ne $expectedMonthlyReportUiCheckpointSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-monthly-report-approval-v1' -or $priorManifest.mode -ne 'approved_local_monthly_report_checkpoint' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForMonthlyUi -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForMonthlyUi -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_PRIOR_APPROVAL_INVALID' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForMonthlyUi $resolvedUiCheckpoint 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedUiCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $uiPaths = @(Get-AndaluciaReviewedMonthlyReportGuestExperiencePaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForMonthlyUi $resolvedUiCheckpoint $uiPaths 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedUiCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-monthly-report-approval-v2'; mode='approved_local_monthly_report_guest_experience_ui'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForMonthlyUi; monthlyReportUiCheckpointSha=$resolvedUiCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; monthlyReportUiPaths=$uiPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_CHECKPOINT') {
  $resolvedMonthlyCheckpoint = Resolve-AndaluciaGitRef $projectRoot $MonthlyReportCheckpointSha
  if ($resolvedMonthlyCheckpoint -ne $expectedMonthlyReportCheckpointSha -or $resolvedCheckpoint -ne $expectedMonthlyReportCheckpointSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-weekly-report-approval-v6' -or $priorManifest.mode -ne 'approved_local_weekly_report_final_refinement' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_FINAL_REFINEMENT_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForMonthly -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForMonthly -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_PRIOR_APPROVAL_INVALID' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForMonthly $resolvedMonthlyCheckpoint 'ANDALUCIA_LOCAL_MONTHLY_REPORT_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedMonthlyCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_MONTHLY_REPORT_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $monthlyReportPaths = @(Get-AndaluciaReviewedMonthlyReportCheckpointPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForMonthly $resolvedMonthlyCheckpoint $monthlyReportPaths 'ANDALUCIA_LOCAL_MONTHLY_REPORT_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedMonthlyCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-monthly-report-approval-v1'; mode='approved_local_monthly_report_checkpoint'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForMonthly; monthlyReportCheckpointSha=$resolvedMonthlyCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; monthlyReportPaths=$monthlyReportPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_MONTHLY_REPORT_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_FINAL_REFINEMENT_CHECKPOINT') {
  $resolvedRefinementCheckpoint = Resolve-AndaluciaGitRef $projectRoot $WeeklyReportFinalRefinementCheckpointSha
  if ($resolvedRefinementCheckpoint -ne $expectedWeeklyReportFinalRefinementCheckpointSha -or $resolvedCheckpoint -ne $expectedWeeklyReportFinalRefinementCheckpointSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_REFINEMENT_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_REFINEMENT_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-weekly-report-approval-v5' -or $priorManifest.mode -ne 'approved_local_weekly_report_compact_ui' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_COMPACT_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForWeeklyFinalRefinement -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForWeeklyFinalRefinement -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_REFINEMENT_PRIOR_APPROVAL_INVALID' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForWeeklyFinalRefinement $resolvedRefinementCheckpoint 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_REFINEMENT_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedRefinementCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_REFINEMENT_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $refinementPaths = @(Get-AndaluciaReviewedWeeklyReportRefinementPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForWeeklyFinalRefinement $resolvedRefinementCheckpoint $refinementPaths 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_REFINEMENT_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedRefinementCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-weekly-report-approval-v6'; mode='approved_local_weekly_report_final_refinement'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForWeeklyFinalRefinement; weeklyReportFinalRefinementCheckpointSha=$resolvedRefinementCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; weeklyReportRefinementPaths=$refinementPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_WEEKLY_REPORT_FINAL_REFINEMENT_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_COMPACT_CHECKPOINT') {
  $resolvedCompactCheckpoint = Resolve-AndaluciaGitRef $projectRoot $WeeklyReportCompactCheckpointSha
  if ($resolvedCompactCheckpoint -ne $expectedWeeklyReportCompactCheckpointSha -or $resolvedCheckpoint -ne $expectedWeeklyReportCompactCheckpointSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_COMPACT_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_COMPACT_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-weekly-report-approval-v4' -or $priorManifest.mode -ne 'approved_local_weekly_report_typography_final' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_TYPOGRAPHY_FINAL_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForWeeklyCompact -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForWeeklyCompact -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_COMPACT_PRIOR_APPROVAL_INVALID' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForWeeklyCompact $resolvedCompactCheckpoint 'ANDALUCIA_LOCAL_WEEKLY_REPORT_COMPACT_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedCompactCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_WEEKLY_REPORT_COMPACT_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $compactPaths = @(Get-AndaluciaReviewedWeeklyReportFinalUiPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForWeeklyCompact $resolvedCompactCheckpoint $compactPaths 'ANDALUCIA_LOCAL_WEEKLY_REPORT_COMPACT_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedCompactCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-weekly-report-approval-v5'; mode='approved_local_weekly_report_compact_ui'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForWeeklyCompact; weeklyReportCompactCheckpointSha=$resolvedCompactCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; weeklyReportTypographyPaths=$compactPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_WEEKLY_REPORT_COMPACT_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_TYPOGRAPHY_FINAL_CHECKPOINT') {
  $resolvedTypographyCheckpoint = Resolve-AndaluciaGitRef $projectRoot $WeeklyReportTypographyFinalCheckpointSha
  if ($resolvedTypographyCheckpoint -ne $expectedWeeklyReportTypographyFinalCheckpointSha -or $resolvedCheckpoint -ne $expectedWeeklyReportTypographyFinalCheckpointSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_FINAL_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_FINAL_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-weekly-report-approval-v3' -or $priorManifest.mode -ne 'approved_local_weekly_report_typography_correction' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_TYPOGRAPHY_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForWeeklyTypographyFinal -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForWeeklyTypographyFinal -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_FINAL_PRIOR_APPROVAL_INVALID' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForWeeklyTypographyFinal $resolvedTypographyCheckpoint 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_FINAL_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedTypographyCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_FINAL_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $typographyPaths = @(Get-AndaluciaReviewedWeeklyReportFinalUiPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForWeeklyTypographyFinal $resolvedTypographyCheckpoint $typographyPaths 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_FINAL_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedTypographyCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-weekly-report-approval-v4'; mode='approved_local_weekly_report_typography_final'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForWeeklyTypographyFinal; weeklyReportTypographyFinalCheckpointSha=$resolvedTypographyCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; weeklyReportTypographyPaths=$typographyPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_FINAL_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_TYPOGRAPHY_CHECKPOINT') {
  $resolvedTypographyCheckpoint = Resolve-AndaluciaGitRef $projectRoot $WeeklyReportTypographyCheckpointSha
  if ($resolvedTypographyCheckpoint -ne $expectedWeeklyReportTypographyCheckpointSha -or $resolvedCheckpoint -ne $expectedWeeklyReportTypographyCheckpointSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-weekly-report-approval-v2' -or $priorManifest.mode -ne 'approved_local_weekly_report_final_ui' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_FINAL_UI_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForWeeklyTypography -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForWeeklyTypography -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_PRIOR_APPROVAL_INVALID' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForWeeklyTypography $resolvedTypographyCheckpoint 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedTypographyCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $typographyPaths = @(Get-AndaluciaReviewedWeeklyReportFinalUiPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForWeeklyTypography $resolvedTypographyCheckpoint $typographyPaths 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedTypographyCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-weekly-report-approval-v3'; mode='approved_local_weekly_report_typography_correction'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForWeeklyTypography; weeklyReportTypographyCheckpointSha=$resolvedTypographyCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; weeklyReportTypographyPaths=$typographyPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_FINAL_UI_CHECKPOINT') {
  $resolvedFinalUiCheckpoint = Resolve-AndaluciaGitRef $projectRoot $WeeklyReportFinalUiCheckpointSha
  if ($resolvedFinalUiCheckpoint -ne $expectedWeeklyReportFinalUiCheckpointSha -or $resolvedCheckpoint -ne $expectedWeeklyReportFinalUiCheckpointSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_UI_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_UI_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-weekly-report-approval-v1' -or $priorManifest.mode -ne 'approved_local_weekly_report_checkpoint' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForWeeklyFinalUi -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForWeeklyFinalUi -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_UI_PRIOR_APPROVAL_INVALID' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForWeeklyFinalUi $resolvedFinalUiCheckpoint 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_UI_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedFinalUiCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_UI_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $finalUiPaths = @(Get-AndaluciaReviewedWeeklyReportFinalUiPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForWeeklyFinalUi $resolvedFinalUiCheckpoint $finalUiPaths 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_UI_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedFinalUiCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-weekly-report-approval-v2'; mode='approved_local_weekly_report_final_ui'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForWeeklyFinalUi; weeklyReportFinalUiCheckpointSha=$resolvedFinalUiCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; weeklyReportFinalUiPaths=$finalUiPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_WEEKLY_REPORT_FINAL_UI_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_CHECKPOINT') {
  $resolvedWeeklyReportCheckpoint = Resolve-AndaluciaGitRef $projectRoot $WeeklyReportCheckpointSha
  if ($resolvedWeeklyReportCheckpoint -ne $expectedWeeklyReportCheckpointSha -or $resolvedCheckpoint -ne $expectedWeeklyReportCheckpointSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FULL_SHA_REQUIRED' }
  try { $priorManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_PRIOR_APPROVAL_INVALID' }
  if ($priorManifest.version -ne 'andalucia-local-system-approval-v1' -or $priorManifest.mode -ne 'approved_local_windows_shutdown_reliability' -or $priorManifest.managerApproval -ne 'YES_I_APPROVE_EXACT_WINDOWS_SHUTDOWN_RELIABILITY_CHECKPOINT' -or [string]$priorManifest.controlCommitSha -ne $expectedPreviousControlShaForWeekly -or [string]$priorManifest.activeSourceSha -ne $expectedPreviousControlShaForWeekly -or [string]$priorManifest.branch -ne $branch) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_PRIOR_APPROVAL_INVALID' }
  Assert-AndaluciaGitAncestor $projectRoot $expectedPreviousControlShaForWeekly $resolvedWeeklyReportCheckpoint 'ANDALUCIA_LOCAL_WEEKLY_REPORT_NOT_BASED_ON_PRIOR_CONTROL'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedWeeklyReportCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_WEEKLY_REPORT_CONTROL_NOT_BASED_ON_CHECKPOINT'
  $weeklyReportPaths = @(Get-AndaluciaReviewedWeeklyReportCheckpointPaths)
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $expectedPreviousControlShaForWeekly $resolvedWeeklyReportCheckpoint $weeklyReportPaths 'ANDALUCIA_LOCAL_WEEKLY_REPORT_PATH_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedWeeklyReportCheckpoint $resolvedControlCommit 'backend_control')
  $manifest = [ordered]@{ version='andalucia-local-weekly-report-approval-v1'; mode='approved_local_weekly_report_checkpoint'; managerApproval=$ManagerApproval; approvedAt=[DateTime]::UtcNow.ToString('o'); approvedMainSha=$approvedMainSha; previousControlCommitSha=$expectedPreviousControlShaForWeekly; weeklyReportCheckpointSha=$resolvedWeeklyReportCheckpoint; controlCommitSha=$resolvedControlCommit; activeSourceSha=$activeSourceSha; branch=$branch; weeklyReportPaths=$weeklyReportPaths; launcherSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 $resolverPath; backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_WEEKLY_REPORT_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 7
  exit 0
}

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
