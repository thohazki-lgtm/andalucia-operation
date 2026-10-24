[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ReviewedCheckpointSha,
  [Parameter(Mandatory = $true)][string]$ControlCommitSha,
  [Parameter(Mandatory = $true)][string]$ManagerApproval,
  [string]$RepositoryRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$expectedBaselineSha = '40461397f9b5f1d3ffa391be9a0fc5110c6ff020'
$expectedCheckpointSha = 'f9cd8b03db9d55205e37783aedd141335a9a11e0'
$expectedPreviousUiCheckpointSha = '310b3f36b89555fb90c9d2464a34d7f038e5a2de'
$expectedPreviousControlSha = '072cd10ccd0905601f554020cb489fedd740dd73'
$projectRoot = if ($RepositoryRoot) { [IO.Path]::GetFullPath($RepositoryRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')) }
$resolverPath = Join-Path $projectRoot 'deployment\windows\Resolve-AndaluciaApprovedSource.ps1'
$manifestPath = Join-Path $projectRoot '.runtime\andalucia-local-ui-approval.json'
if ($ManagerApproval -ne 'YES_I_APPROVE_EXACT_DAILY_REPORT_BACKEND_CHECKPOINT') { throw 'ANDALUCIA_LOCAL_BACKEND_MANAGER_APPROVAL_REQUIRED' }
if ($ReviewedCheckpointSha -ne $expectedCheckpointSha) { throw 'ANDALUCIA_LOCAL_BACKEND_CHECKPOINT_SHA_NOT_APPROVED' }
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
if ($resolvedCheckpoint -ne $expectedCheckpointSha -or $resolvedControlCommit -ne $ControlCommitSha -or $resolvedControlCommit -ne $activeSourceSha) { throw 'ANDALUCIA_LOCAL_BACKEND_FULL_SHA_REQUIRED' }

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
