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
  if (-not $isUiApproval -and -not $isDailyReportBackendApproval -and -not $isDailyReportBackendUiApproval -and -not $isDailyReportBackendFinalUiApproval -and -not $isDailyReportCoverApproval -and -not $isDailyReportDateApproval -and -not $isDailyReportTypographyApproval -and -not $isDailyReportDateResetApproval -and -not $isWindowsShutdownApproval -and -not $isWeeklyReportApproval -and -not $isWeeklyReportFinalUiApproval -and -not $isWeeklyReportTypographyApproval -and -not $isWeeklyReportTypographyFinalApproval) { throw 'ANDALUCIA_LOCAL_APPROVAL_MANIFEST_INVALID' }
  if ([string]$manifest.branch -ne $branch -or [string]$manifest.activeSourceSha -ne $headSha -or [string]$manifest.approvedMainSha -ne $originMainSha) { throw 'ANDALUCIA_LOCAL_UI_APPROVAL_SOURCE_MISMATCH' }

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
