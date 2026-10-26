Set-StrictMode -Version Latest

function Get-AndaluciaFileSha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  $hasher = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($Path)))).Replace('-', '')
  } finally {
    $hasher.Dispose()
  }
}

function Resolve-AndaluciaGitRef {
  param([string]$ProjectRoot, [string]$Reference)
  $value = (& git -C $ProjectRoot rev-parse $Reference 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $value) { throw "ANDALUCIA_SOURCE_REF_INVALID:$Reference" }
  return $value
}

function Assert-AndaluciaGitAncestor {
  param([string]$ProjectRoot, [string]$Ancestor, [string]$Descendant, [string]$Code)
  & git -C $ProjectRoot merge-base --is-ancestor $Ancestor $Descendant 2>$null
  if ($LASTEXITCODE -ne 0) { throw $Code }
}

function Assert-AndaluciaChangedPaths {
  param([string]$ProjectRoot, [string]$From, [string]$To, [string]$Mode)
  $paths = @(& git -C $ProjectRoot diff --name-only "$From..$To")
  $uiPattern = '^(src/|public/|server/[^/]*(browser|responsive|ui|interface)[^/]*\.test\.(ts|tsx|mjs)$)'
  $controlPaths = @(
    'deployment/windows/Start-AndaluciaGuardedApplication.ps1',
    'deployment/windows/Install-AndaluciaDatabaseScheduler.ps1',
    'deployment/windows/Resolve-AndaluciaApprovedSource.ps1',
    'deployment/windows/Approve-AndaluciaLocalUiCheckpoint.ps1',
    'server/local-ui-activation.test.ts',
    'server/database-scheduler.test.ts'
  )
  $backendControlPaths = @(
    'deployment/windows/Resolve-AndaluciaApprovedSource.ps1',
    'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1',
    'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1',
    'server/local-backend-checkpoint-activation.test.ts'
  )
  $invalid = @(if ($Mode -eq 'ui') {
    @($paths | Where-Object { $_ -notmatch $uiPattern })
  } elseif ($Mode -eq 'backend_control') {
    @($paths | Where-Object { $_ -notin $backendControlPaths })
  } else {
    @($paths | Where-Object { $_ -notin $controlPaths })
  })
  if ($invalid.Count -gt 0) { throw "ANDALUCIA_LOCAL_UI_PATH_NOT_APPROVED:${Mode}:$($invalid -join ',')" }
  return $paths
}

function Get-AndaluciaReviewedDailyReportCheckpointPaths {
  return @(
    'server/booking-walk-in-r2.test.ts',
    'server/daily-report-historical-browser.test.ts',
    'server/daily-report-service-charges-browser.test.ts',
    'server/daily-report-service.test.ts',
    'server/daily-report-service.ts',
    'server/daily-report-snapshot-foundation.test.ts',
    'server/daily-report-snapshot-repository.ts',
    'server/daily-report-whatsapp-export.test.ts',
    'server/reports-daily-sections-browser.test.ts',
    'server/reports-date-default.test.ts',
    'src/daily-report-manual.ts',
    'src/daily-report-save-integrity.ts',
    'src/daily-report-whatsapp.ts',
    'src/domain.ts',
    'src/report-date-selection.ts',
    'src/reports.css',
    'src/reports.tsx'
  )
}

function Get-AndaluciaReviewedDailyReportReviewUiPaths {
  return @(
    'server/reports-daily-sections-browser.test.ts',
    'src/reports.css',
    'src/reports.tsx'
  )
}

function Get-AndaluciaReviewedDailyReportReviewFinalUiPaths {
  return @(
    'server/reports-daily-sections-browser.test.ts',
    'src/reports.css',
    'src/reports.tsx'
  )
}

function Get-AndaluciaReviewedDailyReportAlignmentPaths {
  return @(
    'server/daily-report-service.test.ts',
    'server/daily-report-service.ts',
    'server/daily-report-whatsapp-export.test.ts',
    'server/reports-daily-sections-browser.test.ts',
    'src/daily-report-whatsapp.ts',
    'src/reports.css'
  )
}

function Get-AndaluciaReviewedDailyReportCoverCorrectionPaths {
  return @(
    'server/daily-report-service.test.ts',
    'server/daily-report-service.ts'
  )
}

function Get-AndaluciaReviewedDailyReportDatePersistencePaths {
  return @(
    'server/daily-report-historical-browser.test.ts',
    'server/reports-date-default.test.ts',
    'src/report-date-selection.ts',
    'src/reports.tsx'
  )
}

function Get-AndaluciaReviewedDailyReportTypographyPaths {
  return @(
    'server/reports-daily-sections-browser.test.ts',
    'src/reports.css'
  )
}

function Get-AndaluciaReviewedDailyReportDateResetPaths {
  return @(
    'server/daily-report-historical-browser.test.ts',
    'server/reports-date-default.test.ts',
    'src/report-date-selection.ts',
    'src/reports.tsx'
  )
}

function Get-AndaluciaReviewedWindowsShutdownReliabilityPaths {
  return @(
    'deployment/windows/Install-AndaluciaDatabaseScheduler.ps1',
    'deployment/windows/Signal-AndaluciaWindowsShutdown.cmd',
    'server/database-scheduler.test.ts',
    'server/database-scheduler.ts'
  )
}

function Get-AndaluciaReviewedWeeklyReportCheckpointPaths {
  return @(
    'server/weekly-report-service.test.ts',
    'server/weekly-report-service.ts',
    'server/weekly-report-ui-browser.test.ts',
    'src/domain.ts',
    'src/reports.css',
    'src/reports.tsx'
  )
}

function Get-AndaluciaReviewedWeeklyReportFinalUiPaths {
  return @(
    'server/weekly-report-ui-browser.test.ts',
    'src/reports.css'
  )
}

function Get-AndaluciaReviewedWeeklyReportRefinementPaths {
  return @(
    'server/weekly-report-ui-browser.test.ts',
    'src/reports.css',
    'src/reports.tsx'
  )
}

function Get-AndaluciaReviewedMonthlyReportCheckpointPaths {
  return @(
    'server/monthly-report-service.test.ts',
    'server/monthly-report-service.ts',
    'server/monthly-report-ui-browser.test.ts',
    'src/domain.ts',
    'src/reports.css',
    'src/reports.tsx'
  )
}

function Get-AndaluciaReviewedMonthlyReportGuestExperiencePaths {
  return @(
    'server/monthly-report-ui-browser.test.ts',
    'src/reports.css',
    'src/reports.tsx'
  )
}

function Get-AndaluciaReviewedMonthlyReportAlignmentPaths {
  return @(
    'server/monthly-report-ui-browser.test.ts',
    'src/reports.css'
  )
}

function Get-AndaluciaReviewedCustomReportRedesignPaths {
  return @(
    'server/reports-custom-monthly-browser.test.ts',
    'src/reports.css',
    'src/reports.tsx'
  )
}

function Get-AndaluciaReviewedCustomReportFinalUiPaths {
  return @(
    'server/reports-custom-monthly-browser.test.ts',
    'src/reports.css'
  )
}

function Get-AndaluciaReviewedLeaveTypesPaths {
  return @(
    'server/accumulated-off-migration-026.test.ts',
    'server/accumulated-off-service.ts',
    'server/leave-entitlements-foundation.test.mjs',
    'server/leave-types-ui-browser.test.ts',
    'src/workforce.css',
    'src/workforce.tsx'
  )
}

function Get-AndaluciaReviewedEmployeeEntitlementsPaths {
  return @(
    'server/employee-entitlements-ui.test.mjs',
    'server/leave-types-ui-browser.test.ts',
    'src/workforce.css',
    'src/workforce.tsx'
  )
}

function Get-AndaluciaReviewedOffDaysSummaryPaths {
  return @(
    'server/employee-entitlements-ui.test.mjs',
    'server/index.ts',
    'server/leave-types-ui-browser.test.ts',
    'server/staff-repository.ts',
    'server/workforce-entitlement-balances-reopen-verifier.ts',
    'server/workforce-entitlement-balances.test.ts',
    'src/domain.ts',
    'src/workforce.css',
    'src/workforce.tsx'
  )
}

function Get-AndaluciaReviewedEntitlementBalanceSimplificationPaths {
  return @(
    'server/employee-entitlements-ui.test.mjs',
    'server/leave-types-ui-browser.test.ts',
    'src/workforce.css',
    'src/workforce.tsx'
  )
}

function Get-AndaluciaReviewedEntitlementManageCleanupPaths {
  return @(
    'server/employee-entitlements-ui.test.mjs',
    'server/leave-types-ui-browser.test.ts',
    'src/workforce.css',
    'src/workforce.tsx'
  )
}

function Get-AndaluciaReviewedLeaveRenewalRulesPaths {
  return @(
    'server/leave-renewal-rules.test.ts',
    'server/staff-repository.ts',
    'server/yearly-leave-entitlement-calculator.ts'
  )
}

function Get-AndaluciaReviewedLeaveBalancePolishPaths {
  return @(
    'server/employee-entitlements-ui.test.mjs',
    'server/leave-types-ui-browser.test.ts',
    'src/workforce.css'
  )
}

function Get-AndaluciaReviewedEmployeeEntitlementsFinalCleanupPaths {
  return @(
    'server/employee-entitlement-modals.test.mjs',
    'server/employee-entitlements-ui.test.mjs',
    'server/leave-types-ui-browser.test.ts',
    'src/workforce.css',
    'src/workforce.tsx'
  )
}

function Get-AndaluciaReviewedPublicHolidayCalendarPaths {
  return @(
    'server/leave-types-ui-browser.test.ts',
    'src/workforce.css',
    'src/workforce.tsx'
  )
}

function Get-AndaluciaReviewedBookingCustomizationPaths {
  return @(
    'server/bookings-customization-ui-browser.test.ts',
    'src/booking-service.css',
    'src/bookings.tsx'
  )
}

function Get-AndaluciaReviewedBookingAlignmentPaths {
  return @(
    'server/booking-correction-workflow.test.ts',
    'server/booking-import-review.test.ts',
    'server/booking-import.test.ts',
    'server/booking-repository.ts',
    'server/booking-walk-in-r2.test.ts',
    'server/bookings-customization-ui-browser.test.ts',
    'src/booking-service.css',
    'src/bookings.tsx'
  )
}

function Assert-AndaluciaPathContentMatches {
  param([string]$ProjectRoot, [string]$ReviewedRef, [string]$IntegratedRef, [string[]]$ExpectedPaths, [string]$Code)
  foreach ($path in $ExpectedPaths) {
    $reviewedBlob = (& git -C $ProjectRoot rev-parse "$ReviewedRef`:$path" 2>$null).Trim()
    $integratedBlob = (& git -C $ProjectRoot rev-parse "$IntegratedRef`:$path" 2>$null).Trim()
    if (-not $reviewedBlob -or -not $integratedBlob -or $reviewedBlob -ne $integratedBlob) { throw "$Code`:$path" }
  }
}

function Assert-AndaluciaExactChangedPaths {
  param([string]$ProjectRoot, [string]$From, [string]$To, [string[]]$ExpectedPaths, [string]$Code)
  $actual = @(& git -C $ProjectRoot diff --name-only "$From..$To" | Sort-Object)
  $expected = @($ExpectedPaths | Sort-Object)
  $difference = @(Compare-Object -ReferenceObject $expected -DifferenceObject $actual)
  if ($difference.Count -gt 0) { $details = @(($difference | ForEach-Object { "$($_.SideIndicator)$($_.InputObject)" }) | Sort-Object) -join ','; throw "${Code}:$details" }
  return $actual
}

function Get-AndaluciaApprovedSourceState {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [string]$ManifestPath = (Join-Path $ProjectRoot '.runtime\andalucia-local-ui-approval.json')
  )

  $gitRoot = (& git -C $ProjectRoot rev-parse --show-toplevel 2>$null).Trim()
  if (-not $gitRoot -or [IO.Path]::GetFullPath($gitRoot) -ne [IO.Path]::GetFullPath($ProjectRoot)) { throw 'ANDALUCIA_RUNTIME_SOURCE_NOT_AUTHORITATIVE_GIT_CHECKOUT' }
  $trackedChanges = @(& git -C $ProjectRoot status --porcelain --untracked-files=no)
  if ($trackedChanges.Count -gt 0) { throw 'ANDALUCIA_RUNTIME_SOURCE_DIRTY' }

  $branch = (& git -C $ProjectRoot branch --show-current 2>$null).Trim()
  $headSha = Resolve-AndaluciaGitRef $ProjectRoot 'HEAD'
  $originMainSha = Resolve-AndaluciaGitRef $ProjectRoot 'refs/remotes/origin/main'
  if ($branch -eq 'main') {
    if ($headSha -ne $originMainSha) { throw "ANDALUCIA_RUNTIME_SOURCE_NOT_APPROVED_MAIN:${headSha}:${originMainSha}" }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='verified_main'; ApprovedMainSha=$originMainSha }
  }

  if ($branch -notmatch '^codex/local-ui-[a-z0-9._-]+$') { throw "ANDALUCIA_RUNTIME_SOURCE_BRANCH_NOT_APPROVED:$branch" }
  if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { throw 'ANDALUCIA_LOCAL_UI_APPROVAL_MANIFEST_MISSING' }
  try { $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json } catch { throw 'ANDALUCIA_LOCAL_UI_APPROVAL_MANIFEST_INVALID' }
  $isUiApproval = $manifest.version -eq 'andalucia-local-ui-approval-v1' -and $manifest.mode -eq 'approved_local_ui_checkpoint' -and $manifest.managerApproval -eq 'YES_I_APPROVE_LOCAL_UI_CHECKPOINT'
  $isDailyReportBackendApproval = $manifest.version -eq 'andalucia-local-backend-approval-v1' -and $manifest.mode -eq 'approved_local_daily_report_backend_checkpoint' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_BACKEND_CHECKPOINT'
  $isDailyReportBackendUiApproval = $manifest.version -eq 'andalucia-local-backend-ui-approval-v1' -and $manifest.mode -eq 'approved_local_daily_report_backend_with_review_ui' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_UI_CHECKPOINT'
  $isDailyReportBackendFinalUiApproval = $manifest.version -eq 'andalucia-local-backend-ui-approval-v2' -and $manifest.mode -eq 'approved_local_daily_report_backend_with_final_review_ui' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_REVIEW_FINAL_UI_CHECKPOINT'
  $isDailyReportCoverApproval = $manifest.version -eq 'andalucia-local-backend-ui-approval-v3' -and $manifest.mode -eq 'approved_local_daily_report_cover_reconciliation' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_COVER_CHECKPOINT'
  $isDailyReportDateApproval = $manifest.version -eq 'andalucia-local-backend-ui-approval-v4' -and $manifest.mode -eq 'approved_local_daily_report_date_persistence' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_CHECKPOINT'
  $isDailyReportTypographyApproval = $manifest.version -eq 'andalucia-local-backend-ui-approval-v5' -and $manifest.mode -eq 'approved_local_daily_report_typography_refinement' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_TYPOGRAPHY_CHECKPOINT'
  $isDailyReportDateResetApproval = $manifest.version -eq 'andalucia-local-backend-ui-approval-v6' -and $manifest.mode -eq 'approved_local_daily_report_date_reset' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_DAILY_REPORT_DATE_RESET_CHECKPOINT'
  $isWindowsShutdownApproval = $manifest.version -eq 'andalucia-local-system-approval-v1' -and $manifest.mode -eq 'approved_local_windows_shutdown_reliability' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_WINDOWS_SHUTDOWN_RELIABILITY_CHECKPOINT'
  $isWeeklyReportApproval = $manifest.version -eq 'andalucia-local-weekly-report-approval-v1' -and $manifest.mode -eq 'approved_local_weekly_report_checkpoint' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_CHECKPOINT'
  $isWeeklyReportFinalUiApproval = $manifest.version -eq 'andalucia-local-weekly-report-approval-v2' -and $manifest.mode -eq 'approved_local_weekly_report_final_ui' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_FINAL_UI_CHECKPOINT'
  $isWeeklyReportTypographyApproval = $manifest.version -eq 'andalucia-local-weekly-report-approval-v3' -and $manifest.mode -eq 'approved_local_weekly_report_typography_correction' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_TYPOGRAPHY_CHECKPOINT'
  $isWeeklyReportTypographyFinalApproval = $manifest.version -eq 'andalucia-local-weekly-report-approval-v4' -and $manifest.mode -eq 'approved_local_weekly_report_typography_final' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_TYPOGRAPHY_FINAL_CHECKPOINT'
  $isWeeklyReportCompactApproval = $manifest.version -eq 'andalucia-local-weekly-report-approval-v5' -and $manifest.mode -eq 'approved_local_weekly_report_compact_ui' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_COMPACT_CHECKPOINT'
  $isWeeklyReportFinalRefinementApproval = $manifest.version -eq 'andalucia-local-weekly-report-approval-v6' -and $manifest.mode -eq 'approved_local_weekly_report_final_refinement' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_WEEKLY_REPORT_FINAL_REFINEMENT_CHECKPOINT'
  $isMonthlyReportApproval = $manifest.version -eq 'andalucia-local-monthly-report-approval-v1' -and $manifest.mode -eq 'approved_local_monthly_report_checkpoint' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_CHECKPOINT'
  $isMonthlyReportGuestExperienceApproval = $manifest.version -eq 'andalucia-local-monthly-report-approval-v2' -and $manifest.mode -eq 'approved_local_monthly_report_guest_experience_ui' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_GUEST_EXPERIENCE_CHECKPOINT'
  $isMonthlyReportGuestExperienceCompactApproval = $manifest.version -eq 'andalucia-local-monthly-report-approval-v3' -and $manifest.mode -eq 'approved_local_monthly_report_guest_experience_compact_ui' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_CHECKPOINT'
  $isMonthlyReportTypographyApproval = $manifest.version -eq 'andalucia-local-monthly-report-approval-v4' -and $manifest.mode -eq 'approved_local_monthly_report_typography_refinement' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_TYPOGRAPHY_REFINEMENT_CHECKPOINT'
  $isMonthlyReportAlignmentApproval = $manifest.version -eq 'andalucia-local-monthly-report-approval-v5' -and $manifest.mode -eq 'approved_local_monthly_report_table_alignment' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_MONTHLY_REPORT_TABLE_ALIGNMENT_CHECKPOINT'
  $isCustomReportRedesignApproval = $manifest.version -eq 'andalucia-local-monthly-report-approval-v6' -and $manifest.mode -eq 'approved_local_custom_report_redesign' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_CUSTOM_REPORT_REDESIGN_CHECKPOINT'
  $isCustomReportFinalUiApproval = $manifest.version -eq 'andalucia-local-monthly-report-approval-v7' -and $manifest.mode -eq 'approved_local_custom_report_final_ui' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_CUSTOM_REPORT_FINAL_UI_CHECKPOINT'
  $isLeaveTypesApproval = $manifest.version -eq 'andalucia-local-workforce-approval-v1' -and $manifest.mode -eq 'approved_local_leave_types' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_LEAVE_TYPES_CHECKPOINT'
  $isEmployeeEntitlementsApproval = $manifest.version -eq 'andalucia-local-workforce-approval-v3' -and $manifest.mode -eq 'approved_local_employee_entitlements' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_EMPLOYEE_ENTITLEMENTS_CHECKPOINT'
  $isOffDaysSummaryApproval = $manifest.version -eq 'andalucia-local-workforce-approval-v4' -and $manifest.mode -eq 'approved_local_off_days_summary' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_OFF_DAYS_SUMMARY_CHECKPOINT'
  $isEntitlementBalanceSimplificationApproval = $manifest.version -eq 'andalucia-local-workforce-approval-v5' -and $manifest.mode -eq 'approved_local_entitlement_balance_simplification' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_ENTITLEMENT_BALANCE_SIMPLIFICATION_CHECKPOINT'
  $isEntitlementManageCleanupApproval = $manifest.version -eq 'andalucia-local-workforce-approval-v6' -and $manifest.mode -eq 'approved_local_entitlement_manage_cleanup' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_ENTITLEMENT_MANAGE_CLEANUP_CHECKPOINT'
  $isLeaveRenewalRulesApproval = $manifest.version -eq 'andalucia-local-workforce-approval-v7' -and $manifest.mode -eq 'approved_local_leave_renewal_rules' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_LEAVE_RENEWAL_RULES_CHECKPOINT'
  $isLeaveRenewalRulesTestFixApproval = $manifest.version -eq 'andalucia-local-workforce-approval-v8' -and $manifest.mode -eq 'approved_local_leave_renewal_rules_with_test_fix' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_LEAVE_RENEWAL_RULES_TEST_FIX_CHECKPOINT'
  $isLeaveBalancePolishApproval = $manifest.version -eq 'andalucia-local-workforce-approval-v9' -and $manifest.mode -eq 'approved_local_leave_balance_polish' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_LEAVE_BALANCE_POLISH_CHECKPOINT'
  $isEmployeeEntitlementsFinalCleanupApproval = $manifest.version -eq 'andalucia-local-workforce-approval-v10' -and $manifest.mode -eq 'approved_local_employee_entitlements_final_cleanup' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_EMPLOYEE_ENTITLEMENTS_FINAL_CLEANUP_CHECKPOINT'
  $isPublicHolidayCalendarApproval = $manifest.version -eq 'andalucia-local-workforce-approval-v11' -and $manifest.mode -eq 'approved_local_public_holiday_calendar' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_PUBLIC_HOLIDAY_CALENDAR_CHECKPOINT'
  $isBookingCustomizationApproval = $manifest.version -eq 'andalucia-local-bookings-approval-v1' -and $manifest.mode -eq 'approved_local_booking_customization' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_BOOKING_CUSTOMIZATION_CHECKPOINT'
  $isBookingAlignmentApproval = $manifest.version -eq 'andalucia-local-bookings-approval-v2' -and $manifest.mode -eq 'approved_local_booking_alignment' -and $manifest.managerApproval -eq 'YES_I_APPROVE_EXACT_BOOKING_ALIGNMENT_CHECKPOINT'
  if (-not $isUiApproval -and -not $isDailyReportBackendApproval -and -not $isDailyReportBackendUiApproval -and -not $isDailyReportBackendFinalUiApproval -and -not $isDailyReportCoverApproval -and -not $isDailyReportDateApproval -and -not $isDailyReportTypographyApproval -and -not $isDailyReportDateResetApproval -and -not $isWindowsShutdownApproval -and -not $isWeeklyReportApproval -and -not $isWeeklyReportFinalUiApproval -and -not $isWeeklyReportTypographyApproval -and -not $isWeeklyReportTypographyFinalApproval -and -not $isWeeklyReportCompactApproval -and -not $isWeeklyReportFinalRefinementApproval -and -not $isMonthlyReportApproval -and -not $isMonthlyReportGuestExperienceApproval -and -not $isMonthlyReportGuestExperienceCompactApproval -and -not $isMonthlyReportTypographyApproval -and -not $isMonthlyReportAlignmentApproval -and -not $isCustomReportRedesignApproval -and -not $isCustomReportFinalUiApproval -and -not $isLeaveTypesApproval -and -not $isEmployeeEntitlementsApproval -and -not $isOffDaysSummaryApproval -and -not $isEntitlementBalanceSimplificationApproval -and -not $isEntitlementManageCleanupApproval -and -not $isLeaveRenewalRulesApproval -and -not $isLeaveRenewalRulesTestFixApproval -and -not $isLeaveBalancePolishApproval -and -not $isEmployeeEntitlementsFinalCleanupApproval -and -not $isPublicHolidayCalendarApproval -and -not $isBookingCustomizationApproval -and -not $isBookingAlignmentApproval) { throw 'ANDALUCIA_LOCAL_APPROVAL_MANIFEST_INVALID' }
  if ([string]$manifest.branch -ne $branch -or [string]$manifest.activeSourceSha -ne $headSha -or [string]$manifest.approvedMainSha -ne $originMainSha) { throw 'ANDALUCIA_LOCAL_UI_APPROVAL_SOURCE_MISMATCH' }

  if ($isBookingAlignmentApproval) {
    $expectedPreviousControlSha = '822596e34372e60fdde2959a8e820ee1e985ea3f'
    $expectedBookingCheckpointSha = 'fbf2572b94cc2a7ee8f1853215d1d01bd56df12a'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.bookingAlignmentCheckpointSha -ne $expectedBookingCheckpointSha) { throw 'ANDALUCIA_LOCAL_BOOKING_ALIGNMENT_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_BOOKING_ALIGNMENT_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedBookingCheckpointSha 'ANDALUCIA_LOCAL_BOOKING_ALIGNMENT_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedBookingCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_BOOKING_ALIGNMENT_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $bookingPaths = @(Get-AndaluciaReviewedBookingAlignmentPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedBookingCheckpointSha $bookingPaths 'ANDALUCIA_LOCAL_BOOKING_ALIGNMENT_REVIEWED_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedBookingCheckpointSha $controlCommitSha 'backend_control')
    Assert-AndaluciaPathContentMatches $ProjectRoot $expectedBookingCheckpointSha $controlCommitSha $bookingPaths 'ANDALUCIA_LOCAL_BOOKING_ALIGNMENT_CONTENT_MISMATCH'
    if (@(Compare-Object ($bookingPaths | Sort-Object) @($manifest.bookingAlignmentPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_BOOKING_ALIGNMENT_MANIFEST_PATH_MISMATCH' }
    if ([string]$manifest.launcherSha256 -ne (Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1')) -or [string]$manifest.resolverSha256 -ne (Get-AndaluciaFileSha256 $PSCommandPath) -or [string]$manifest.backendApprovalScriptSha256 -ne (Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1')) -or [string]$manifest.backendActivationScriptSha256 -ne (Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1'))) { throw 'ANDALUCIA_LOCAL_BOOKING_ALIGNMENT_CONTROL_HASH_MISMATCH' }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_booking_alignment'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; BookingAlignmentCheckpointSha=$expectedBookingCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isBookingCustomizationApproval) {
    $expectedPreviousControlSha = '8bfbc280336096b13121b669a3303d7d5df98dd7'
    $expectedBookingCheckpointSha = '160db95b49c8403dbbce423c1b268f8c03e1a2de'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.bookingCustomizationCheckpointSha -ne $expectedBookingCheckpointSha) { throw 'ANDALUCIA_LOCAL_BOOKING_CUSTOMIZATION_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_BOOKING_CUSTOMIZATION_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedBookingCheckpointSha 'ANDALUCIA_LOCAL_BOOKING_CUSTOMIZATION_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedBookingCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_BOOKING_CUSTOMIZATION_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $bookingPaths = @(Get-AndaluciaReviewedBookingCustomizationPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedBookingCheckpointSha $bookingPaths 'ANDALUCIA_LOCAL_BOOKING_CUSTOMIZATION_REVIEWED_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedBookingCheckpointSha $controlCommitSha 'backend_control')
    Assert-AndaluciaPathContentMatches $ProjectRoot $expectedBookingCheckpointSha $controlCommitSha $bookingPaths 'ANDALUCIA_LOCAL_BOOKING_CUSTOMIZATION_CONTENT_MISMATCH'
    if (@(Compare-Object ($bookingPaths | Sort-Object) @($manifest.bookingCustomizationPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_BOOKING_CUSTOMIZATION_MANIFEST_PATH_MISMATCH' }
    if ([string]$manifest.launcherSha256 -ne (Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1')) -or [string]$manifest.resolverSha256 -ne (Get-AndaluciaFileSha256 $PSCommandPath) -or [string]$manifest.backendApprovalScriptSha256 -ne (Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1')) -or [string]$manifest.backendActivationScriptSha256 -ne (Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1'))) { throw 'ANDALUCIA_LOCAL_BOOKING_CUSTOMIZATION_CONTROL_HASH_MISMATCH' }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_booking_customization'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; BookingCustomizationCheckpointSha=$expectedBookingCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isPublicHolidayCalendarApproval) {
    $expectedPreviousControlSha = '614b598e5dc962d1e3ba7e1abb904dfe49cbe229'
    $expectedCalendarCheckpointSha = 'ae951424705563f8f9bde812d03fb3772b713d2b'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.publicHolidayCalendarCheckpointSha -ne $expectedCalendarCheckpointSha) { throw 'ANDALUCIA_LOCAL_PUBLIC_HOLIDAY_CALENDAR_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_PUBLIC_HOLIDAY_CALENDAR_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedCalendarCheckpointSha 'ANDALUCIA_LOCAL_PUBLIC_HOLIDAY_CALENDAR_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedCalendarCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_PUBLIC_HOLIDAY_CALENDAR_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $calendarPaths = @(Get-AndaluciaReviewedPublicHolidayCalendarPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedCalendarCheckpointSha $calendarPaths 'ANDALUCIA_LOCAL_PUBLIC_HOLIDAY_CALENDAR_REVIEWED_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedCalendarCheckpointSha $controlCommitSha 'backend_control')
    Assert-AndaluciaPathContentMatches $ProjectRoot $expectedCalendarCheckpointSha $controlCommitSha $calendarPaths 'ANDALUCIA_LOCAL_PUBLIC_HOLIDAY_CALENDAR_CONTENT_MISMATCH'
    if (@(Compare-Object ($calendarPaths | Sort-Object) @($manifest.publicHolidayCalendarPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_PUBLIC_HOLIDAY_CALENDAR_MANIFEST_PATH_MISMATCH' }
    if ([string]$manifest.launcherSha256 -ne (Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1')) -or [string]$manifest.resolverSha256 -ne (Get-AndaluciaFileSha256 $PSCommandPath) -or [string]$manifest.backendApprovalScriptSha256 -ne (Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1')) -or [string]$manifest.backendActivationScriptSha256 -ne (Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1'))) { throw 'ANDALUCIA_LOCAL_PUBLIC_HOLIDAY_CALENDAR_CONTROL_HASH_MISMATCH' }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_public_holiday_calendar'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; PublicHolidayCalendarCheckpointSha=$expectedCalendarCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isEmployeeEntitlementsFinalCleanupApproval) {
    $expectedPreviousControlSha = 'ebfc95da6ae438b47142742e7fd9dd034806f31d'
    $expectedCleanupCheckpointSha = 'f93628908b2a7820a4cd294213a17ff827387d7c'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.employeeEntitlementsFinalCleanupCheckpointSha -ne $expectedCleanupCheckpointSha) { throw 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_FINAL_CLEANUP_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_FINAL_CLEANUP_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedCleanupCheckpointSha 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_FINAL_CLEANUP_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedCleanupCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_FINAL_CLEANUP_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $cleanupPaths = @(Get-AndaluciaReviewedEmployeeEntitlementsFinalCleanupPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedCleanupCheckpointSha $cleanupPaths 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_FINAL_CLEANUP_REVIEWED_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedCleanupCheckpointSha $controlCommitSha 'backend_control')
    Assert-AndaluciaPathContentMatches $ProjectRoot $expectedCleanupCheckpointSha $controlCommitSha $cleanupPaths 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_FINAL_CLEANUP_CONTENT_MISMATCH'
    if (@(Compare-Object ($cleanupPaths | Sort-Object) @($manifest.employeeEntitlementsFinalCleanupPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_FINAL_CLEANUP_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_FINAL_CLEANUP_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_employee_entitlements_final_cleanup'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; EmployeeEntitlementsFinalCleanupCheckpointSha=$expectedCleanupCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isLeaveBalancePolishApproval) {
    $expectedPreviousControlSha = 'd8145add55e674ff5acd4525ca027f961ad0160c'
    $expectedPolishCheckpointSha = 'df08221297fceb2cba302175d529f46c79860602'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.leaveBalancePolishCheckpointSha -ne $expectedPolishCheckpointSha) { throw 'ANDALUCIA_LOCAL_LEAVE_BALANCE_POLISH_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_LEAVE_BALANCE_POLISH_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedPolishCheckpointSha 'ANDALUCIA_LOCAL_LEAVE_BALANCE_POLISH_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPolishCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_LEAVE_BALANCE_POLISH_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $leaveBalancePolishPaths = @(Get-AndaluciaReviewedLeaveBalancePolishPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedPolishCheckpointSha $leaveBalancePolishPaths 'ANDALUCIA_LOCAL_LEAVE_BALANCE_POLISH_REVIEWED_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedPolishCheckpointSha $controlCommitSha 'backend_control')
    Assert-AndaluciaPathContentMatches $ProjectRoot $expectedPolishCheckpointSha $controlCommitSha $leaveBalancePolishPaths 'ANDALUCIA_LOCAL_LEAVE_BALANCE_POLISH_CONTENT_MISMATCH'
    if (@(Compare-Object ($leaveBalancePolishPaths | Sort-Object) @($manifest.leaveBalancePolishPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_LEAVE_BALANCE_POLISH_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_LEAVE_BALANCE_POLISH_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_leave_balance_polish'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; LeaveBalancePolishCheckpointSha=$expectedPolishCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isLeaveRenewalRulesTestFixApproval) {
    $expectedPreviousControlSha = '3c6b0270f1ce3d4a0aa1b412b5dafdde4ea53aac'
    $expectedLeaveRenewalRulesCheckpointSha = 'b8d641909ce62bef9ca9741f584b663d59dfea68'
    $expectedPreparedControlSha = 'ff838104c11fab2449cbfc3c68088756532eaeed'
    $expectedTestFixCheckpointSha = '289f476a59724a1e20ecb67ddd82241d90e504f2'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.leaveRenewalRulesCheckpointSha -ne $expectedLeaveRenewalRulesCheckpointSha -or [string]$manifest.preparedControlCommitSha -ne $expectedPreparedControlSha -or [string]$manifest.testFixCheckpointSha -ne $expectedTestFixCheckpointSha) { throw 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_TEST_FIX_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_TEST_FIX_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedLeaveRenewalRulesCheckpointSha 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_TEST_FIX_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedLeaveRenewalRulesCheckpointSha $expectedPreparedControlSha 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_TEST_FIX_PREPARED_CONTROL_NOT_BASED_ON_CHECKPOINT'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreparedControlSha $expectedTestFixCheckpointSha 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_TEST_FIX_NOT_BASED_ON_PREPARED_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedTestFixCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_TEST_FIX_CONTROL_NOT_BASED_ON_TEST_FIX'
    $leaveRenewalRulesPaths = @(Get-AndaluciaReviewedLeaveRenewalRulesPaths)
    $testFixPaths = @('server/annual-leave-opening-balance-workflow.test.ts')
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedLeaveRenewalRulesCheckpointSha $leaveRenewalRulesPaths 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_TEST_FIX_REVIEWED_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedLeaveRenewalRulesCheckpointSha $expectedPreparedControlSha 'backend_control')
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreparedControlSha $expectedTestFixCheckpointSha $testFixPaths 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_TEST_FIX_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedTestFixCheckpointSha $controlCommitSha 'backend_control')
    Assert-AndaluciaPathContentMatches $ProjectRoot $expectedLeaveRenewalRulesCheckpointSha $controlCommitSha $leaveRenewalRulesPaths 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_TEST_FIX_CONTENT_MISMATCH'
    if (@(Compare-Object ($leaveRenewalRulesPaths | Sort-Object) @($manifest.leaveRenewalRulesPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0 -or @(Compare-Object ($testFixPaths | Sort-Object) @($manifest.testFixPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_TEST_FIX_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_TEST_FIX_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_leave_renewal_rules_with_test_fix'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; LeaveRenewalRulesCheckpointSha=$expectedLeaveRenewalRulesCheckpointSha; PreparedControlCommitSha=$expectedPreparedControlSha; TestFixCheckpointSha=$expectedTestFixCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isLeaveRenewalRulesApproval) {
    $expectedPreviousControlSha = '3c6b0270f1ce3d4a0aa1b412b5dafdde4ea53aac'
    $expectedLeaveRenewalRulesCheckpointSha = 'b8d641909ce62bef9ca9741f584b663d59dfea68'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.leaveRenewalRulesCheckpointSha -ne $expectedLeaveRenewalRulesCheckpointSha) { throw 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedLeaveRenewalRulesCheckpointSha 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedLeaveRenewalRulesCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $leaveRenewalRulesPaths = @(Get-AndaluciaReviewedLeaveRenewalRulesPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedLeaveRenewalRulesCheckpointSha $leaveRenewalRulesPaths 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_REVIEWED_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedLeaveRenewalRulesCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($leaveRenewalRulesPaths | Sort-Object) @($manifest.leaveRenewalRulesPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_LEAVE_RENEWAL_RULES_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_leave_renewal_rules'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; LeaveRenewalRulesCheckpointSha=$expectedLeaveRenewalRulesCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isEntitlementManageCleanupApproval) {
    $expectedPreviousControlSha = 'bc2423f24656c5871955f4cf2aa33ab15eefb478'
    $expectedEntitlementManageCleanupCheckpointSha = '2418cdad39a4e1816bfce3d401521fb9666a8d33'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.entitlementManageCleanupCheckpointSha -ne $expectedEntitlementManageCleanupCheckpointSha) { throw 'ANDALUCIA_LOCAL_ENTITLEMENT_MANAGE_CLEANUP_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_ENTITLEMENT_MANAGE_CLEANUP_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedEntitlementManageCleanupCheckpointSha 'ANDALUCIA_LOCAL_ENTITLEMENT_MANAGE_CLEANUP_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedEntitlementManageCleanupCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_ENTITLEMENT_MANAGE_CLEANUP_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $entitlementManageCleanupPaths = @(Get-AndaluciaReviewedEntitlementManageCleanupPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedEntitlementManageCleanupCheckpointSha $entitlementManageCleanupPaths 'ANDALUCIA_LOCAL_ENTITLEMENT_MANAGE_CLEANUP_REVIEWED_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedEntitlementManageCleanupCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($entitlementManageCleanupPaths | Sort-Object) @($manifest.entitlementManageCleanupPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_ENTITLEMENT_MANAGE_CLEANUP_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_ENTITLEMENT_MANAGE_CLEANUP_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_entitlement_manage_cleanup'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; EntitlementManageCleanupCheckpointSha=$expectedEntitlementManageCleanupCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isEntitlementBalanceSimplificationApproval) {
    $expectedPreviousControlSha = 'cf9d12e593dc4431124107f712f11b8201bddef6'
    $expectedEntitlementBalanceSimplificationCheckpointSha = '3c0eac9c07d90f29e0b91ebcab77ca3651437df6'
    $expectedEntitlementBalanceSimplificationIntegrationSha = 'b498106e9d1506f8d2e2e09517adbbfd57334ecd'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.entitlementBalanceSimplificationCheckpointSha -ne $expectedEntitlementBalanceSimplificationCheckpointSha -or [string]$manifest.entitlementBalanceSimplificationIntegrationSha -ne $expectedEntitlementBalanceSimplificationIntegrationSha) { throw 'ANDALUCIA_LOCAL_ENTITLEMENT_BALANCE_SIMPLIFICATION_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_ENTITLEMENT_BALANCE_SIMPLIFICATION_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedEntitlementBalanceSimplificationIntegrationSha 'ANDALUCIA_LOCAL_ENTITLEMENT_BALANCE_SIMPLIFICATION_INTEGRATION_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedEntitlementBalanceSimplificationIntegrationSha $controlCommitSha 'ANDALUCIA_LOCAL_ENTITLEMENT_BALANCE_SIMPLIFICATION_CONTROL_NOT_BASED_ON_INTEGRATION'
    $entitlementBalanceSimplificationPaths = @(Get-AndaluciaReviewedEntitlementBalanceSimplificationPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot 'bffece4a6e2ae6b8601c10adcd088f9cf08d8ff1' $expectedEntitlementBalanceSimplificationCheckpointSha $entitlementBalanceSimplificationPaths 'ANDALUCIA_LOCAL_ENTITLEMENT_BALANCE_SIMPLIFICATION_REVIEWED_PATH_MISMATCH')
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedEntitlementBalanceSimplificationIntegrationSha $entitlementBalanceSimplificationPaths 'ANDALUCIA_LOCAL_ENTITLEMENT_BALANCE_SIMPLIFICATION_INTEGRATION_PATH_MISMATCH')
    Assert-AndaluciaPathContentMatches $ProjectRoot $expectedEntitlementBalanceSimplificationCheckpointSha $expectedEntitlementBalanceSimplificationIntegrationSha $entitlementBalanceSimplificationPaths 'ANDALUCIA_LOCAL_ENTITLEMENT_BALANCE_SIMPLIFICATION_CONTENT_MISMATCH'
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedEntitlementBalanceSimplificationIntegrationSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($entitlementBalanceSimplificationPaths | Sort-Object) @($manifest.entitlementBalanceSimplificationPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_ENTITLEMENT_BALANCE_SIMPLIFICATION_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_ENTITLEMENT_BALANCE_SIMPLIFICATION_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_entitlement_balance_simplification'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; EntitlementBalanceSimplificationCheckpointSha=$expectedEntitlementBalanceSimplificationCheckpointSha; EntitlementBalanceSimplificationIntegrationSha=$expectedEntitlementBalanceSimplificationIntegrationSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isOffDaysSummaryApproval) {
    $expectedPreviousControlSha = '94e51d45ebae0e20da5d50e18a67b17a06d3cf41'
    $expectedOffDaysSummaryCheckpointSha = 'bffece4a6e2ae6b8601c10adcd088f9cf08d8ff1'
    $expectedOffDaysSummaryIntegrationSha = '5ecd4a86b1d1e021d11a4c01b4aa6f5869016ee8'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.offDaysSummaryCheckpointSha -ne $expectedOffDaysSummaryCheckpointSha -or [string]$manifest.offDaysSummaryIntegrationSha -ne $expectedOffDaysSummaryIntegrationSha) { throw 'ANDALUCIA_LOCAL_OFF_DAYS_SUMMARY_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_OFF_DAYS_SUMMARY_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedOffDaysSummaryIntegrationSha 'ANDALUCIA_LOCAL_OFF_DAYS_SUMMARY_INTEGRATION_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedOffDaysSummaryIntegrationSha $controlCommitSha 'ANDALUCIA_LOCAL_OFF_DAYS_SUMMARY_CONTROL_NOT_BASED_ON_INTEGRATION'
    $offDaysSummaryPaths = @(Get-AndaluciaReviewedOffDaysSummaryPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedOffDaysSummaryCheckpointSha $offDaysSummaryPaths 'ANDALUCIA_LOCAL_OFF_DAYS_SUMMARY_REVIEWED_PATH_MISMATCH')
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedOffDaysSummaryIntegrationSha $offDaysSummaryPaths 'ANDALUCIA_LOCAL_OFF_DAYS_SUMMARY_INTEGRATION_PATH_MISMATCH')
    Assert-AndaluciaPathContentMatches $ProjectRoot $expectedOffDaysSummaryCheckpointSha $expectedOffDaysSummaryIntegrationSha $offDaysSummaryPaths 'ANDALUCIA_LOCAL_OFF_DAYS_SUMMARY_CONTENT_MISMATCH'
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedOffDaysSummaryIntegrationSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($offDaysSummaryPaths | Sort-Object) @($manifest.offDaysSummaryPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_OFF_DAYS_SUMMARY_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_OFF_DAYS_SUMMARY_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_off_days_summary'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; OffDaysSummaryCheckpointSha=$expectedOffDaysSummaryCheckpointSha; OffDaysSummaryIntegrationSha=$expectedOffDaysSummaryIntegrationSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isEmployeeEntitlementsApproval) {
    $expectedPreviousControlSha = 'c3d09f939961ba4f974ee83e67452e828179350c'
    $expectedReviewedCheckpointParentSha = '114a35c12914a4cde3d43e8dd281918251a11140'
    $expectedEmployeeEntitlementsCheckpointSha = 'ca28f4f522d6d5c1b6ae78e23d1ad031c87d117b'
    $expectedEmployeeEntitlementsIntegrationSha = '8b2d5ead2d895004fa6aa8c5e1a9694891b23926'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.employeeEntitlementsCheckpointSha -ne $expectedEmployeeEntitlementsCheckpointSha -or [string]$manifest.employeeEntitlementsIntegrationSha -ne $expectedEmployeeEntitlementsIntegrationSha) { throw 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedEmployeeEntitlementsIntegrationSha 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_INTEGRATION_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedEmployeeEntitlementsIntegrationSha $controlCommitSha 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_CONTROL_NOT_BASED_ON_INTEGRATION'
    $employeeEntitlementsPaths = @(Get-AndaluciaReviewedEmployeeEntitlementsPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedReviewedCheckpointParentSha $expectedEmployeeEntitlementsCheckpointSha $employeeEntitlementsPaths 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_REVIEWED_PATH_MISMATCH')
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedEmployeeEntitlementsIntegrationSha $employeeEntitlementsPaths 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_INTEGRATION_PATH_MISMATCH')
    Assert-AndaluciaPathContentMatches $ProjectRoot $expectedEmployeeEntitlementsCheckpointSha $expectedEmployeeEntitlementsIntegrationSha $employeeEntitlementsPaths 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_CONTENT_MISMATCH'
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedEmployeeEntitlementsIntegrationSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($employeeEntitlementsPaths | Sort-Object) @($manifest.employeeEntitlementsPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_EMPLOYEE_ENTITLEMENTS_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_employee_entitlements'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; EmployeeEntitlementsCheckpointSha=$expectedEmployeeEntitlementsCheckpointSha; EmployeeEntitlementsIntegrationSha=$expectedEmployeeEntitlementsIntegrationSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isLeaveTypesApproval) {
    $expectedPreviousControlSha = '13b15cab7bc80f3d96aa8b10724d4521267174d6'
    $expectedLeaveTypesCheckpointSha = '4bbc70c7280879c41e73131d9b62212d735a68ca'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.leaveTypesCheckpointSha -ne $expectedLeaveTypesCheckpointSha) { throw 'ANDALUCIA_LOCAL_LEAVE_TYPES_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_LEAVE_TYPES_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedLeaveTypesCheckpointSha 'ANDALUCIA_LOCAL_LEAVE_TYPES_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedLeaveTypesCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_LEAVE_TYPES_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $leaveTypesPaths = @(Get-AndaluciaReviewedLeaveTypesPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedLeaveTypesCheckpointSha $leaveTypesPaths 'ANDALUCIA_LOCAL_LEAVE_TYPES_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedLeaveTypesCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($leaveTypesPaths | Sort-Object) @($manifest.leaveTypesPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_LEAVE_TYPES_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_LEAVE_TYPES_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_leave_types'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; LeaveTypesCheckpointSha=$expectedLeaveTypesCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isCustomReportFinalUiApproval) {
    $expectedPreviousControlSha = '7a9fe44b7d4e045b8c6cbee30e2305ccdb08f9de'
    $expectedCustomReportFinalUiCheckpointSha = 'f285c5d32aeead2cbca5659d08c985f6e0e15424'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.customReportFinalUiCheckpointSha -ne $expectedCustomReportFinalUiCheckpointSha) { throw 'ANDALUCIA_LOCAL_CUSTOM_REPORT_FINAL_UI_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_CUSTOM_REPORT_FINAL_UI_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedCustomReportFinalUiCheckpointSha 'ANDALUCIA_LOCAL_CUSTOM_REPORT_FINAL_UI_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedCustomReportFinalUiCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_CUSTOM_REPORT_FINAL_UI_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $customReportFinalUiPaths = @(Get-AndaluciaReviewedCustomReportFinalUiPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedCustomReportFinalUiCheckpointSha $customReportFinalUiPaths 'ANDALUCIA_LOCAL_CUSTOM_REPORT_FINAL_UI_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedCustomReportFinalUiCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($customReportFinalUiPaths | Sort-Object) @($manifest.customReportFinalUiPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_CUSTOM_REPORT_FINAL_UI_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_CUSTOM_REPORT_FINAL_UI_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_custom_report_final_ui'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; CustomReportFinalUiCheckpointSha=$expectedCustomReportFinalUiCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isCustomReportRedesignApproval) {
    $expectedPreviousControlSha = '32d1f255383ec74290dd5c3b1585c6dac34f9b76'
    $expectedCustomReportCheckpointSha = '2a4a00e60187b38cab85fda26766e1500b5fd4ad'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.customReportCheckpointSha -ne $expectedCustomReportCheckpointSha) { throw 'ANDALUCIA_LOCAL_CUSTOM_REPORT_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_CUSTOM_REPORT_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedCustomReportCheckpointSha 'ANDALUCIA_LOCAL_CUSTOM_REPORT_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedCustomReportCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_CUSTOM_REPORT_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $customReportPaths = @(Get-AndaluciaReviewedCustomReportRedesignPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedCustomReportCheckpointSha $customReportPaths 'ANDALUCIA_LOCAL_CUSTOM_REPORT_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedCustomReportCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($customReportPaths | Sort-Object) @($manifest.customReportPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_CUSTOM_REPORT_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_CUSTOM_REPORT_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_custom_report_redesign'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; CustomReportCheckpointSha=$expectedCustomReportCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isMonthlyReportAlignmentApproval) {
    $expectedPreviousControlSha = 'f4f4ce237d50bdc59621b90903ceb19a9d692824'
    $expectedAlignmentCheckpointSha = '8ff75ae31e598750ddca1672d660f35b84b0fa35'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.monthlyReportAlignmentCheckpointSha -ne $expectedAlignmentCheckpointSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_ALIGNMENT_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_ALIGNMENT_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedAlignmentCheckpointSha 'ANDALUCIA_LOCAL_MONTHLY_REPORT_ALIGNMENT_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedAlignmentCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_MONTHLY_REPORT_ALIGNMENT_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $alignmentPaths = @(Get-AndaluciaReviewedMonthlyReportAlignmentPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedAlignmentCheckpointSha $alignmentPaths 'ANDALUCIA_LOCAL_MONTHLY_REPORT_ALIGNMENT_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedAlignmentCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($alignmentPaths | Sort-Object) @($manifest.monthlyReportAlignmentPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_ALIGNMENT_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_MONTHLY_REPORT_ALIGNMENT_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_monthly_report_table_alignment'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; MonthlyReportAlignmentCheckpointSha=$expectedAlignmentCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isMonthlyReportTypographyApproval) {
    $expectedPreviousControlSha = '94f6958799e9e64a550a6f56cdae8b23aba31dc7'
    $expectedTypographyCheckpointSha = 'e645140222da9fc63f57b23f2417c335311b17e5'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.monthlyReportTypographyCheckpointSha -ne $expectedTypographyCheckpointSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_TYPOGRAPHY_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_TYPOGRAPHY_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedTypographyCheckpointSha 'ANDALUCIA_LOCAL_MONTHLY_REPORT_TYPOGRAPHY_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedTypographyCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_MONTHLY_REPORT_TYPOGRAPHY_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $typographyPaths = @(Get-AndaluciaReviewedMonthlyReportGuestExperiencePaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedTypographyCheckpointSha $typographyPaths 'ANDALUCIA_LOCAL_MONTHLY_REPORT_TYPOGRAPHY_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedTypographyCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($typographyPaths | Sort-Object) @($manifest.monthlyReportTypographyPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_TYPOGRAPHY_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_MONTHLY_REPORT_TYPOGRAPHY_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_monthly_report_typography_refinement'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; MonthlyReportTypographyCheckpointSha=$expectedTypographyCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isMonthlyReportGuestExperienceCompactApproval) {
    $expectedPreviousControlSha = '15b27421f7340e8082b38e7afb91aff8878e6e21'
    $expectedCompactCheckpointSha = '9032042bcb520264949a77b2fb3950b7637d584f'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.monthlyReportCompactCheckpointSha -ne $expectedCompactCheckpointSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedCompactCheckpointSha 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedCompactCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $compactPaths = @(Get-AndaluciaReviewedMonthlyReportGuestExperiencePaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedCompactCheckpointSha $compactPaths 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedCompactCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($compactPaths | Sort-Object) @($manifest.monthlyReportCompactPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_COMPACT_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_monthly_report_guest_experience_compact_ui'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; MonthlyReportCompactCheckpointSha=$expectedCompactCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isMonthlyReportGuestExperienceApproval) {
    $expectedPreviousControlSha = 'e834ad63938ebcbf381aff0e301d2929f7f1a7f8'
    $expectedUiCheckpointSha = 'acc72417bbc857187d01c0288b2269a9c31bd0f9'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.monthlyReportUiCheckpointSha -ne $expectedUiCheckpointSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedUiCheckpointSha 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedUiCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $uiPaths = @(Get-AndaluciaReviewedMonthlyReportGuestExperiencePaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedUiCheckpointSha $uiPaths 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedUiCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($uiPaths | Sort-Object) @($manifest.monthlyReportUiPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_MONTHLY_REPORT_GUEST_EXPERIENCE_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_monthly_report_guest_experience_ui'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; MonthlyReportUiCheckpointSha=$expectedUiCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isMonthlyReportApproval) {
    $expectedPreviousControlSha = 'd904ac43605a82281d6989a0deca1cd77ad20648'
    $expectedMonthlyCheckpointSha = '98ac6c0e142cebff6154b059bb5b7ee9c48b54c1'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.monthlyReportCheckpointSha -ne $expectedMonthlyCheckpointSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedMonthlyCheckpointSha 'ANDALUCIA_LOCAL_MONTHLY_REPORT_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedMonthlyCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_MONTHLY_REPORT_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $monthlyReportPaths = @(Get-AndaluciaReviewedMonthlyReportCheckpointPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedMonthlyCheckpointSha $monthlyReportPaths 'ANDALUCIA_LOCAL_MONTHLY_REPORT_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedMonthlyCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($monthlyReportPaths | Sort-Object) @($manifest.monthlyReportPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_MONTHLY_REPORT_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_MONTHLY_REPORT_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_monthly_report_checkpoint'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; MonthlyReportCheckpointSha=$expectedMonthlyCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isWeeklyReportFinalRefinementApproval) {
    $expectedPreviousControlSha = '7a703370eb852b51f5a0f3a25ed077c3bf138ce2'
    $expectedRefinementCheckpointSha = '477b148d87c2db2d4b78a892de5c223d98a54867'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.weeklyReportFinalRefinementCheckpointSha -ne $expectedRefinementCheckpointSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_REFINEMENT_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_REFINEMENT_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedRefinementCheckpointSha 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_REFINEMENT_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedRefinementCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_REFINEMENT_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $refinementPaths = @(Get-AndaluciaReviewedWeeklyReportRefinementPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedRefinementCheckpointSha $refinementPaths 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_REFINEMENT_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedRefinementCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($refinementPaths | Sort-Object) @($manifest.weeklyReportRefinementPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_REFINEMENT_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_REFINEMENT_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_weekly_report_final_refinement'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; WeeklyReportFinalRefinementCheckpointSha=$expectedRefinementCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isWeeklyReportCompactApproval) {
    $expectedPreviousControlSha = '672682499f0aa2cc5d36e70ba018c93179f07ccb'
    $expectedCompactCheckpointSha = '4b30543e01b9da1c379d3dc405206fe5316a6d44'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.weeklyReportCompactCheckpointSha -ne $expectedCompactCheckpointSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_COMPACT_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_COMPACT_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedCompactCheckpointSha 'ANDALUCIA_LOCAL_WEEKLY_REPORT_COMPACT_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedCompactCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_WEEKLY_REPORT_COMPACT_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $compactPaths = @(Get-AndaluciaReviewedWeeklyReportFinalUiPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedCompactCheckpointSha $compactPaths 'ANDALUCIA_LOCAL_WEEKLY_REPORT_COMPACT_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedCompactCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($compactPaths | Sort-Object) @($manifest.weeklyReportTypographyPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_COMPACT_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_WEEKLY_REPORT_COMPACT_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_weekly_report_compact_ui'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; WeeklyReportCompactCheckpointSha=$expectedCompactCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isWeeklyReportTypographyFinalApproval) {
    $expectedPreviousControlSha = '1acaa183fcce0d3aa35c8a0ef0b9af899c9c6a01'
    $expectedTypographyCheckpointSha = 'e02a33946b538c6da11750fc551311d854a3224b'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.weeklyReportTypographyFinalCheckpointSha -ne $expectedTypographyCheckpointSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_FINAL_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_FINAL_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedTypographyCheckpointSha 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_FINAL_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedTypographyCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_FINAL_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $typographyPaths = @(Get-AndaluciaReviewedWeeklyReportFinalUiPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedTypographyCheckpointSha $typographyPaths 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_FINAL_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedTypographyCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($typographyPaths | Sort-Object) @($manifest.weeklyReportTypographyPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_FINAL_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_FINAL_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_weekly_report_typography_final'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; WeeklyReportTypographyFinalCheckpointSha=$expectedTypographyCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isWeeklyReportTypographyApproval) {
    $expectedPreviousControlSha = 'ac833893e80897aab984e71ed7565d27c1c2025b'
    $expectedTypographyCheckpointSha = 'e1dd8ade75cc43ef1ea801be14c6fb325de119ce'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.weeklyReportTypographyCheckpointSha -ne $expectedTypographyCheckpointSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedTypographyCheckpointSha 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedTypographyCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $typographyPaths = @(Get-AndaluciaReviewedWeeklyReportFinalUiPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedTypographyCheckpointSha $typographyPaths 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedTypographyCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($typographyPaths | Sort-Object) @($manifest.weeklyReportTypographyPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_WEEKLY_REPORT_TYPOGRAPHY_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_weekly_report_typography_correction'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; WeeklyReportTypographyCheckpointSha=$expectedTypographyCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isWeeklyReportFinalUiApproval) {
    $expectedPreviousControlSha = 'efc64b9411a1144fb15692c11d182bf05f02df8e'
    $expectedFinalUiCheckpointSha = '5fd181e4b2dfc55c2dbe5f53e0a59be793d3790b'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.weeklyReportFinalUiCheckpointSha -ne $expectedFinalUiCheckpointSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_UI_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_UI_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedFinalUiCheckpointSha 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_UI_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedFinalUiCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_UI_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $finalUiPaths = @(Get-AndaluciaReviewedWeeklyReportFinalUiPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedFinalUiCheckpointSha $finalUiPaths 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_UI_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedFinalUiCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($finalUiPaths | Sort-Object) @($manifest.weeklyReportFinalUiPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_UI_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_WEEKLY_REPORT_FINAL_UI_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_weekly_report_final_ui'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; WeeklyReportFinalUiCheckpointSha=$expectedFinalUiCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isWeeklyReportApproval) {
    $expectedPreviousControlSha = '701af9bed5f301ae7a94b19f090a96af1324ca00'
    $expectedWeeklyCheckpointSha = '7c0dbe6be26acfb0e1fa8bef5bffaa7bc3f968ca'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.weeklyReportCheckpointSha -ne $expectedWeeklyCheckpointSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedWeeklyCheckpointSha 'ANDALUCIA_LOCAL_WEEKLY_REPORT_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedWeeklyCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_WEEKLY_REPORT_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $weeklyReportPaths = @(Get-AndaluciaReviewedWeeklyReportCheckpointPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedWeeklyCheckpointSha $weeklyReportPaths 'ANDALUCIA_LOCAL_WEEKLY_REPORT_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedWeeklyCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($weeklyReportPaths | Sort-Object) @($manifest.weeklyReportPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_WEEKLY_REPORT_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_WEEKLY_REPORT_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_weekly_report_checkpoint'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; WeeklyReportCheckpointSha=$expectedWeeklyCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isWindowsShutdownApproval) {
    $expectedPreviousControlSha = '60591881a56f614e7054c848b54d00e5fa82ccda'
    $expectedShutdownCheckpointSha = '7770b19fb1e34bb33f2107419289d13a825fa2e7'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.shutdownCheckpointSha -ne $expectedShutdownCheckpointSha) { throw 'ANDALUCIA_LOCAL_WINDOWS_SHUTDOWN_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_WINDOWS_SHUTDOWN_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedShutdownCheckpointSha 'ANDALUCIA_LOCAL_WINDOWS_SHUTDOWN_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedShutdownCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_WINDOWS_SHUTDOWN_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $shutdownPaths = @(Get-AndaluciaReviewedWindowsShutdownReliabilityPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedShutdownCheckpointSha $shutdownPaths 'ANDALUCIA_LOCAL_WINDOWS_SHUTDOWN_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedShutdownCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($shutdownPaths | Sort-Object) @($manifest.shutdownPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_WINDOWS_SHUTDOWN_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); installerSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Install-AndaluciaDatabaseScheduler.ps1'); shutdownSignalSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Signal-AndaluciaWindowsShutdown.cmd'); schedulerSourceSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'server/database-scheduler.ts') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_WINDOWS_SHUTDOWN_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_windows_shutdown_reliability'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; ShutdownCheckpointSha=$expectedShutdownCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isDailyReportDateResetApproval) {
    $expectedPreviousControlSha = '8d5872d4e6071eb3568a3b8ce9e1747ba4853d66'
    $expectedDateResetCheckpointSha = 'b1d15609a99ad14a0f13ae99c1c3858d4d2d099a'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.dateResetCheckpointSha -ne $expectedDateResetCheckpointSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_RESET_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_RESET_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedDateResetCheckpointSha 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_RESET_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedDateResetCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_RESET_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $dateResetPaths = @(Get-AndaluciaReviewedDailyReportDateResetPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedDateResetCheckpointSha $dateResetPaths 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_RESET_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedDateResetCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($dateResetPaths | Sort-Object) @($manifest.dateResetPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_RESET_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); approvalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalUiCheckpoint.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_DAILY_REPORT_DATE_RESET_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_daily_report_date_reset'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; DateResetCheckpointSha=$expectedDateResetCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isDailyReportTypographyApproval) {
    $expectedPreviousControlSha = '91fb31267b983c471d92622e1cac03a313391305'
    $expectedTypographyCheckpointSha = '51a35ece8b7cf90b698175b1a532e5bb6d141498'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.typographyCheckpointSha -ne $expectedTypographyCheckpointSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_TYPOGRAPHY_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_TYPOGRAPHY_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedTypographyCheckpointSha 'ANDALUCIA_LOCAL_DAILY_REPORT_TYPOGRAPHY_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedTypographyCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_DAILY_REPORT_TYPOGRAPHY_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $typographyPaths = @(Get-AndaluciaReviewedDailyReportTypographyPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedTypographyCheckpointSha $typographyPaths 'ANDALUCIA_LOCAL_DAILY_REPORT_TYPOGRAPHY_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedTypographyCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($typographyPaths | Sort-Object) @($manifest.typographyPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_TYPOGRAPHY_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); approvalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalUiCheckpoint.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_DAILY_REPORT_TYPOGRAPHY_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_daily_report_typography_refinement'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; TypographyCheckpointSha=$expectedTypographyCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isDailyReportDateApproval) {
    $expectedPreviousControlSha = '0bb49f54a61c733f0d8b7bcb3e237937df69f360'
    $expectedDateCheckpointSha = '572c5694df750b0edf009180e0b297c3d03c3b5d'
    if ([string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.dateCheckpointSha -ne $expectedDateCheckpointSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedDateCheckpointSha 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedDateCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $datePaths = @(Get-AndaluciaReviewedDailyReportDatePersistencePaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedDateCheckpointSha $datePaths 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedDateCheckpointSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($datePaths | Sort-Object) @($manifest.datePaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_DATE_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); approvalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalUiCheckpoint.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_DAILY_REPORT_DATE_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_daily_report_date_persistence'; ApprovedMainSha=$originMainSha; PreviousControlCommitSha=$expectedPreviousControlSha; DateCheckpointSha=$expectedDateCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isDailyReportCoverApproval) {
    $expectedBaselineSha = '40461397f9b5f1d3ffa391be9a0fc5110c6ff020'
    $expectedCheckpointSha = 'f9cd8b03db9d55205e37783aedd141335a9a11e0'
    $expectedBackendControlSha = 'dd07564c3e13a6f4e86668a34077e9527d3da2ee'
    $expectedReviewUiSha = 'bbc348a7cf9ca672d0371ecf35fd2f157f3f27fe'
    $expectedReviewUiControlSha = 'e33cbb100dbb5b01cc3399641a59980c68be3b5c'
    $expectedFinalReviewUiSha = '6110fd6e6da9f311d5be880eb3a277cb51caae3f'
    $expectedPreviousControlSha = '054fb4a77729c63249eb7c86ba4e3e8e1dfac03b'
    $expectedAlignmentSha = 'e509f25f4aaf1a501e1396be2079f904f4e17159'
    $expectedCoverSha = '1e3c1001ec6746e8fd627960ef2ee5ef1cd3f2b0'
    if ([string]$manifest.baselineApprovedSourceSha -ne $expectedBaselineSha -or [string]$manifest.reviewedCheckpointSha -ne $expectedCheckpointSha -or [string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.alignmentCheckpointSha -ne $expectedAlignmentSha -or [string]$manifest.coverCheckpointSha -ne $expectedCoverSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_COVER_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_COVER_NONCANONICAL_SHA' }
    foreach ($pair in @(@($originMainSha,$expectedBaselineSha),@($expectedBaselineSha,$expectedCheckpointSha),@($expectedCheckpointSha,$expectedBackendControlSha),@($expectedBackendControlSha,$expectedReviewUiSha),@($expectedReviewUiSha,$expectedReviewUiControlSha),@($expectedReviewUiControlSha,$expectedFinalReviewUiSha),@($expectedFinalReviewUiSha,$expectedPreviousControlSha),@($expectedPreviousControlSha,$expectedAlignmentSha),@($expectedAlignmentSha,$expectedCoverSha),@($expectedCoverSha,$controlCommitSha))) { Assert-AndaluciaGitAncestor $ProjectRoot $pair[0] $pair[1] 'ANDALUCIA_LOCAL_DAILY_REPORT_COVER_ANCESTRY_MISMATCH' }
    $alignmentPaths = @(Get-AndaluciaReviewedDailyReportAlignmentPaths)
    $coverPaths = @(Get-AndaluciaReviewedDailyReportCoverCorrectionPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedAlignmentSha $alignmentPaths 'ANDALUCIA_LOCAL_DAILY_REPORT_ALIGNMENT_PATH_MISMATCH')
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedAlignmentSha $expectedCoverSha $coverPaths 'ANDALUCIA_LOCAL_DAILY_REPORT_COVER_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedCoverSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($alignmentPaths | Sort-Object) @($manifest.alignmentPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0 -or @(Compare-Object ($coverPaths | Sort-Object) @($manifest.coverPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_DAILY_REPORT_COVER_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{ launcherSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1'); resolverSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1'); approvalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalUiCheckpoint.ps1'); backendApprovalScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1'); backendActivationScriptSha256=Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1') }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_DAILY_REPORT_COVER_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_daily_report_cover_reconciliation'; ApprovedMainSha=$originMainSha; BaselineApprovedSourceSha=$expectedBaselineSha; ReviewedCheckpointSha=$expectedCheckpointSha; PreviousControlCommitSha=$expectedPreviousControlSha; AlignmentCheckpointSha=$expectedAlignmentSha; CoverCheckpointSha=$expectedCoverSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isDailyReportBackendFinalUiApproval) {
    $expectedBaselineSha = '40461397f9b5f1d3ffa391be9a0fc5110c6ff020'
    $expectedCheckpointSha = 'f9cd8b03db9d55205e37783aedd141335a9a11e0'
    $expectedBackendControlSha = 'dd07564c3e13a6f4e86668a34077e9527d3da2ee'
    $expectedPreviousReviewUiSha = 'bbc348a7cf9ca672d0371ecf35fd2f157f3f27fe'
    $expectedPreviousControlSha = 'e33cbb100dbb5b01cc3399641a59980c68be3b5c'
    $expectedFinalReviewUiSha = '6110fd6e6da9f311d5be880eb3a277cb51caae3f'
    if ([string]$manifest.baselineApprovedSourceSha -ne $expectedBaselineSha -or [string]$manifest.reviewedCheckpointSha -ne $expectedCheckpointSha -or [string]$manifest.backendControlCommitSha -ne $expectedBackendControlSha -or [string]$manifest.previousReviewUiCheckpointSha -ne $expectedPreviousReviewUiSha -or [string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.reviewUiCheckpointSha -ne $expectedFinalReviewUiSha) { throw 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_CHECKPOINT_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_APPROVAL_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $originMainSha $expectedBaselineSha 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_BASELINE_NOT_BASED_ON_APPROVED_MAIN'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedBaselineSha $expectedCheckpointSha 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_CHECKPOINT_NOT_BASED_ON_BASELINE'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedCheckpointSha $expectedBackendControlSha 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_BACKEND_CONTROL_NOT_BASED_ON_CHECKPOINT'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedBackendControlSha $expectedPreviousReviewUiSha 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_PRIOR_REVIEW_NOT_BASED_ON_BACKEND_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousReviewUiSha $expectedPreviousControlSha 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_PRIOR_CONTROL_NOT_BASED_ON_REVIEW'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedFinalReviewUiSha 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_REVIEW_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedFinalReviewUiSha $controlCommitSha 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_CONTROL_NOT_BASED_ON_REVIEW'
    $reviewedPaths = @(Get-AndaluciaReviewedDailyReportCheckpointPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedBaselineSha $expectedCheckpointSha $reviewedPaths 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_REVIEWED_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedCheckpointSha $expectedBackendControlSha 'backend_control')
    $priorReviewUiPaths = @(Get-AndaluciaReviewedDailyReportReviewUiPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedBackendControlSha $expectedPreviousReviewUiSha $priorReviewUiPaths 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_PRIOR_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedPreviousReviewUiSha $expectedPreviousControlSha 'backend_control')
    $reviewUiPaths = @(Get-AndaluciaReviewedDailyReportReviewFinalUiPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedFinalReviewUiSha $reviewUiPaths 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedFinalReviewUiSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($reviewedPaths | Sort-Object) @($manifest.reviewedPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0 -or @(Compare-Object ($reviewUiPaths | Sort-Object) @($manifest.reviewUiPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_BACKEND_FINAL_UI_MANIFEST_PATH_MISMATCH' }
    $hashes = [ordered]@{
      launcherSha256 = Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1')
      resolverSha256 = Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1')
      approvalScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalUiCheckpoint.ps1')
      backendApprovalScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1')
      backendActivationScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1')
    }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_BACKEND_FINAL_UI_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_daily_report_backend_with_final_review_ui'; ApprovedMainSha=$originMainSha; BaselineApprovedSourceSha=$expectedBaselineSha; ReviewedCheckpointSha=$expectedCheckpointSha; PreviousControlCommitSha=$expectedPreviousControlSha; ReviewUiCheckpointSha=$expectedFinalReviewUiSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isDailyReportBackendUiApproval) {
    $expectedBaselineSha = '40461397f9b5f1d3ffa391be9a0fc5110c6ff020'
    $expectedCheckpointSha = 'f9cd8b03db9d55205e37783aedd141335a9a11e0'
    $expectedPreviousControlSha = 'dd07564c3e13a6f4e86668a34077e9527d3da2ee'
    $expectedReviewUiSha = 'bbc348a7cf9ca672d0371ecf35fd2f157f3f27fe'
    if ([string]$manifest.baselineApprovedSourceSha -ne $expectedBaselineSha -or [string]$manifest.reviewedCheckpointSha -ne $expectedCheckpointSha -or [string]$manifest.previousControlCommitSha -ne $expectedPreviousControlSha -or [string]$manifest.reviewUiCheckpointSha -ne $expectedReviewUiSha) { throw 'ANDALUCIA_LOCAL_BACKEND_UI_CHECKPOINT_IDENTITY_MISMATCH' }
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_BACKEND_UI_APPROVAL_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $originMainSha $expectedBaselineSha 'ANDALUCIA_LOCAL_BACKEND_UI_BASELINE_NOT_BASED_ON_APPROVED_MAIN'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedBaselineSha $expectedCheckpointSha 'ANDALUCIA_LOCAL_BACKEND_UI_CHECKPOINT_NOT_BASED_ON_BASELINE'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedCheckpointSha $expectedPreviousControlSha 'ANDALUCIA_LOCAL_BACKEND_UI_PRIOR_CONTROL_NOT_BASED_ON_CHECKPOINT'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedPreviousControlSha $expectedReviewUiSha 'ANDALUCIA_LOCAL_BACKEND_UI_REVIEW_NOT_BASED_ON_PRIOR_CONTROL'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedReviewUiSha $controlCommitSha 'ANDALUCIA_LOCAL_BACKEND_UI_CONTROL_NOT_BASED_ON_REVIEW'
    $reviewedPaths = @(Get-AndaluciaReviewedDailyReportCheckpointPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedBaselineSha $expectedCheckpointSha $reviewedPaths 'ANDALUCIA_LOCAL_BACKEND_UI_REVIEWED_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedCheckpointSha $expectedPreviousControlSha 'backend_control')
    $reviewUiPaths = @(Get-AndaluciaReviewedDailyReportReviewUiPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedPreviousControlSha $expectedReviewUiSha $reviewUiPaths 'ANDALUCIA_LOCAL_BACKEND_UI_PATH_MISMATCH')
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $expectedReviewUiSha $controlCommitSha 'backend_control')
    if (@(Compare-Object ($reviewedPaths | Sort-Object) @($manifest.reviewedPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0 -or @(Compare-Object ($reviewUiPaths | Sort-Object) @($manifest.reviewUiPaths | ForEach-Object { [string]$_ } | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_BACKEND_UI_MANIFEST_PATH_MISMATCH' }

    $hashes = [ordered]@{
      launcherSha256 = Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1')
      resolverSha256 = Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1')
      approvalScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalUiCheckpoint.ps1')
      backendApprovalScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1')
      backendActivationScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1')
    }
    foreach ($name in $hashes.Keys) { if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_BACKEND_UI_CONTROL_HASH_MISMATCH:$name" } }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_daily_report_backend_with_review_ui'; ApprovedMainSha=$originMainSha; BaselineApprovedSourceSha=$expectedBaselineSha; ReviewedCheckpointSha=$expectedCheckpointSha; PreviousControlCommitSha=$expectedPreviousControlSha; ReviewUiCheckpointSha=$expectedReviewUiSha; ControlCommitSha=$controlCommitSha }
  }

  if ($isDailyReportBackendApproval) {
    $expectedBaselineSha = '40461397f9b5f1d3ffa391be9a0fc5110c6ff020'
    $expectedCheckpointSha = 'f9cd8b03db9d55205e37783aedd141335a9a11e0'
    if ([string]$manifest.baselineApprovedSourceSha -ne $expectedBaselineSha -or [string]$manifest.reviewedCheckpointSha -ne $expectedCheckpointSha) { throw 'ANDALUCIA_LOCAL_BACKEND_CHECKPOINT_IDENTITY_MISMATCH' }
    $reviewedCheckpointSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.reviewedCheckpointSha)
    $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
    if ($reviewedCheckpointSha -ne $expectedCheckpointSha -or $controlCommitSha -ne [string]$manifest.controlCommitSha -or $controlCommitSha -ne $headSha) { throw 'ANDALUCIA_LOCAL_BACKEND_APPROVAL_NONCANONICAL_SHA' }
    Assert-AndaluciaGitAncestor $ProjectRoot $originMainSha $expectedBaselineSha 'ANDALUCIA_LOCAL_BACKEND_BASELINE_NOT_BASED_ON_APPROVED_MAIN'
    Assert-AndaluciaGitAncestor $ProjectRoot $expectedBaselineSha $reviewedCheckpointSha 'ANDALUCIA_LOCAL_BACKEND_CHECKPOINT_NOT_BASED_ON_BASELINE'
    Assert-AndaluciaGitAncestor $ProjectRoot $reviewedCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_BACKEND_CONTROL_NOT_BASED_ON_CHECKPOINT'
    $reviewedPaths = @(Get-AndaluciaReviewedDailyReportCheckpointPaths)
    [void](Assert-AndaluciaExactChangedPaths $ProjectRoot $expectedBaselineSha $reviewedCheckpointSha $reviewedPaths 'ANDALUCIA_LOCAL_BACKEND_REVIEWED_PATH_MISMATCH')
    $manifestPaths = @($manifest.reviewedPaths | ForEach-Object { [string]$_ })
    if (@(Compare-Object ($reviewedPaths | Sort-Object) ($manifestPaths | Sort-Object)).Count -gt 0) { throw 'ANDALUCIA_LOCAL_BACKEND_MANIFEST_PATH_MISMATCH' }
    [void](Assert-AndaluciaChangedPaths $ProjectRoot $reviewedCheckpointSha $controlCommitSha 'backend_control')

    $hashes = [ordered]@{
      launcherSha256 = Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1')
      resolverSha256 = Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Resolve-AndaluciaApprovedSource.ps1')
      approvalScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalUiCheckpoint.ps1')
      backendApprovalScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Approve-AndaluciaLocalBackendCheckpoint.ps1')
      backendActivationScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment/windows/Invoke-AndaluciaApprovedBackendCheckpointActivation.ps1')
    }
    foreach ($name in $hashes.Keys) {
      if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_BACKEND_CONTROL_HASH_MISMATCH:$name" }
    }
    return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_daily_report_backend_checkpoint'; ApprovedMainSha=$originMainSha; BaselineApprovedSourceSha=$expectedBaselineSha; ReviewedCheckpointSha=$reviewedCheckpointSha; ControlCommitSha=$controlCommitSha }
  }

  $uiCheckpointSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.sourceUiCheckpointSha)
  $controlCommitSha = Resolve-AndaluciaGitRef $ProjectRoot ([string]$manifest.controlCommitSha)
  if ($uiCheckpointSha -ne [string]$manifest.sourceUiCheckpointSha -or $controlCommitSha -ne [string]$manifest.controlCommitSha) { throw 'ANDALUCIA_LOCAL_UI_APPROVAL_NONCANONICAL_SHA' }
  Assert-AndaluciaGitAncestor $ProjectRoot $originMainSha $uiCheckpointSha 'ANDALUCIA_LOCAL_UI_CHECKPOINT_NOT_BASED_ON_APPROVED_MAIN'
  Assert-AndaluciaGitAncestor $ProjectRoot $uiCheckpointSha $controlCommitSha 'ANDALUCIA_LOCAL_UI_CONTROL_NOT_BASED_ON_CHECKPOINT'
  Assert-AndaluciaGitAncestor $ProjectRoot $controlCommitSha $headSha 'ANDALUCIA_LOCAL_UI_ACTIVE_SOURCE_NOT_BASED_ON_CONTROL'
  [void](Assert-AndaluciaChangedPaths $ProjectRoot $originMainSha $uiCheckpointSha 'ui')
  [void](Assert-AndaluciaChangedPaths $ProjectRoot $uiCheckpointSha $controlCommitSha 'control')
  [void](Assert-AndaluciaChangedPaths $ProjectRoot $controlCommitSha $headSha 'ui')

  $hashes = [ordered]@{
    launcherSha256 = Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment\windows\Start-AndaluciaGuardedApplication.ps1')
    resolverSha256 = Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment\windows\Resolve-AndaluciaApprovedSource.ps1')
    approvalScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $ProjectRoot 'deployment\windows\Approve-AndaluciaLocalUiCheckpoint.ps1')
  }
  foreach ($name in $hashes.Keys) {
    if ([string]$manifest.$name -ne [string]$hashes[$name]) { throw "ANDALUCIA_LOCAL_UI_CONTROL_HASH_MISMATCH:$name" }
  }

  return [ordered]@{ Sha=$headSha; Branch=$branch; Mode='approved_local_ui_checkpoint'; ApprovedMainSha=$originMainSha; SourceUiCheckpointSha=$uiCheckpointSha; ControlCommitSha=$controlCommitSha }
}
