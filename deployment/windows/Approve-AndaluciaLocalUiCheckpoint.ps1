[CmdletBinding()]
param(
  [string]$SourceUiCheckpointSha,
  [string]$ControlCommitSha,
  [Parameter(Mandatory = $true)][string]$ManagerApproval,
  [string]$PreviousLiveSha,
  [string]$ReviewedCheckpointSha,
  [string[]]$ReviewedPaths,
  [string]$RepositoryRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = if ($RepositoryRoot) { [IO.Path]::GetFullPath($RepositoryRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')) }
$resolverPath = Join-Path $projectRoot 'deployment\windows\Resolve-AndaluciaApprovedSource.ps1'
$manifestPath = Join-Path $projectRoot '.runtime\andalucia-local-ui-approval.json'
if (-not (Test-Path -LiteralPath $resolverPath -PathType Leaf)) { throw 'ANDALUCIA_LOCAL_UI_RESOLVER_MISSING' }
. $resolverPath

$branch = (& git -C $projectRoot branch --show-current 2>$null).Trim()
if ($branch -notmatch '^codex/local-ui-[a-z0-9._-]+$') { throw "ANDALUCIA_LOCAL_UI_BRANCH_NOT_ALLOWED:$branch" }
$trackedChanges = @(& git -C $projectRoot status --porcelain --untracked-files=no)
if ($trackedChanges.Count -gt 0) { throw 'ANDALUCIA_LOCAL_UI_SOURCE_DIRTY' }
$activeSourceSha = Resolve-AndaluciaGitRef $projectRoot 'HEAD'
$approvedMainSha = Resolve-AndaluciaGitRef $projectRoot 'refs/remotes/origin/main'

if ($ManagerApproval -eq 'YES_I_APPROVE_EXACT_REVIEWED_UI_CHECKPOINT') {
  if (-not $PreviousLiveSha -or -not $ReviewedCheckpointSha -or -not $ControlCommitSha -or -not $ReviewedPaths -or $ReviewedPaths.Count -eq 0) { throw 'ANDALUCIA_LOCAL_REVIEWED_UI_APPROVAL_ARGUMENTS_REQUIRED' }
  $resolvedPreviousLive = Resolve-AndaluciaGitRef $projectRoot $PreviousLiveSha
  $resolvedReviewedCheckpoint = Resolve-AndaluciaGitRef $projectRoot $ReviewedCheckpointSha
  $resolvedControlCommit = Resolve-AndaluciaGitRef $projectRoot $ControlCommitSha
  if ($resolvedPreviousLive -ne $PreviousLiveSha -or $resolvedReviewedCheckpoint -ne $ReviewedCheckpointSha -or $resolvedControlCommit -ne $ControlCommitSha) { throw 'ANDALUCIA_LOCAL_REVIEWED_UI_FULL_SHA_REQUIRED' }
  if ($resolvedControlCommit -ne $activeSourceSha) { throw 'ANDALUCIA_LOCAL_REVIEWED_UI_CONTROL_NOT_HEAD' }
  $normalizedPaths = @($ReviewedPaths | ForEach-Object { ([string]$_).Replace('\','/').Trim() } | Where-Object { $_ })
  if (@($normalizedPaths | Sort-Object -Unique).Count -ne $normalizedPaths.Count) { throw 'ANDALUCIA_LOCAL_REVIEWED_UI_DUPLICATE_PATH' }
  Assert-AndaluciaReviewedUiPaths $normalizedPaths
  Assert-AndaluciaGitAncestor $projectRoot $approvedMainSha $resolvedPreviousLive 'ANDALUCIA_LOCAL_REVIEWED_UI_PREVIOUS_LIVE_NOT_BASED_ON_MAIN'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedPreviousLive $resolvedReviewedCheckpoint 'ANDALUCIA_LOCAL_REVIEWED_UI_CHECKPOINT_NOT_BASED_ON_PREVIOUS_LIVE'
  Assert-AndaluciaGitAncestor $projectRoot $resolvedReviewedCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_REVIEWED_UI_CONTROL_NOT_BASED_ON_CHECKPOINT'
  [void](Assert-AndaluciaExactChangedPaths $projectRoot $resolvedPreviousLive $resolvedReviewedCheckpoint $normalizedPaths 'ANDALUCIA_LOCAL_REVIEWED_UI_EXACT_SCOPE_MISMATCH')
  [void](Assert-AndaluciaChangedPaths $projectRoot $resolvedReviewedCheckpoint $resolvedControlCommit 'control')
  Assert-AndaluciaPathContentMatches $projectRoot $resolvedReviewedCheckpoint $resolvedControlCommit $normalizedPaths 'ANDALUCIA_LOCAL_REVIEWED_UI_CONTENT_MISMATCH'
  $fileHashes = [ordered]@{}
  $blobIds = [ordered]@{}
  foreach ($path in $normalizedPaths) {
    $fileHashes[$path] = Get-AndaluciaFileSha256 (Join-Path $projectRoot $path)
    $blobIds[$path] = (& git -C $projectRoot rev-parse "$resolvedReviewedCheckpoint`:$path" 2>$null).Trim()
    if (-not $blobIds[$path]) { throw "ANDALUCIA_LOCAL_REVIEWED_UI_BLOB_MISSING:$path" }
  }
  $manifest = [ordered]@{
    version = 'andalucia-local-reviewed-ui-approval-v1'
    mode = 'approved_local_reviewed_ui_checkpoint'
    managerApproval = $ManagerApproval
    approvedAt = [DateTime]::UtcNow.ToString('o')
    approvedMainSha = $approvedMainSha
    previousLiveSha = $resolvedPreviousLive
    reviewedCheckpointSha = $resolvedReviewedCheckpoint
    controlCommitSha = $resolvedControlCommit
    activeSourceSha = $activeSourceSha
    branch = $branch
    reviewedPaths = $normalizedPaths
    reviewedFileSha256 = $fileHashes
    reviewedBlobIds = $blobIds
    launcherSha256 = Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Start-AndaluciaGuardedApplication.ps1')
    resolverSha256 = Get-AndaluciaFileSha256 $resolverPath
    approvalScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Approve-AndaluciaLocalUiCheckpoint.ps1')
    preflightScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Test-AndaluciaGuardedUiActivation.ps1')
    activationScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment/windows/Invoke-AndaluciaApprovedUiActivation.ps1')
  }
  New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
  $temporaryPath = "$manifestPath.tmp"
  [IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 8) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
  $verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
  [ordered]@{ status='APPROVED_LOCAL_REVIEWED_UI_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 8
  exit 0
}

if ($ManagerApproval -ne 'YES_I_APPROVE_LOCAL_UI_CHECKPOINT') { throw 'ANDALUCIA_LOCAL_UI_MANAGER_APPROVAL_REQUIRED' }
if (-not $SourceUiCheckpointSha -or -not $ControlCommitSha) { throw 'ANDALUCIA_LOCAL_UI_APPROVAL_ARGUMENTS_REQUIRED' }
$resolvedUiCheckpoint = Resolve-AndaluciaGitRef $projectRoot $SourceUiCheckpointSha
$resolvedControlCommit = Resolve-AndaluciaGitRef $projectRoot $ControlCommitSha
if ($resolvedUiCheckpoint -ne $SourceUiCheckpointSha -or $resolvedControlCommit -ne $ControlCommitSha) { throw 'ANDALUCIA_LOCAL_UI_FULL_SHA_REQUIRED' }
Assert-AndaluciaGitAncestor $projectRoot $approvedMainSha $resolvedUiCheckpoint 'ANDALUCIA_LOCAL_UI_CHECKPOINT_NOT_BASED_ON_APPROVED_MAIN'
Assert-AndaluciaGitAncestor $projectRoot $resolvedUiCheckpoint $resolvedControlCommit 'ANDALUCIA_LOCAL_UI_CONTROL_NOT_BASED_ON_CHECKPOINT'
Assert-AndaluciaGitAncestor $projectRoot $resolvedControlCommit $activeSourceSha 'ANDALUCIA_LOCAL_UI_ACTIVE_SOURCE_NOT_BASED_ON_CONTROL'
[void](Assert-AndaluciaChangedPaths $projectRoot $approvedMainSha $resolvedUiCheckpoint 'ui')
[void](Assert-AndaluciaChangedPaths $projectRoot $resolvedUiCheckpoint $resolvedControlCommit 'control')
[void](Assert-AndaluciaChangedPaths $projectRoot $resolvedControlCommit $activeSourceSha 'ui')

$manifest = [ordered]@{
  version = 'andalucia-local-ui-approval-v1'
  mode = 'approved_local_ui_checkpoint'
  managerApproval = $ManagerApproval
  approvedAt = [DateTime]::UtcNow.ToString('o')
  approvedMainSha = $approvedMainSha
  sourceUiCheckpointSha = $resolvedUiCheckpoint
  controlCommitSha = $resolvedControlCommit
  activeSourceSha = $activeSourceSha
  branch = $branch
  launcherSha256 = Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment\windows\Start-AndaluciaGuardedApplication.ps1')
  resolverSha256 = Get-AndaluciaFileSha256 $resolverPath
  approvalScriptSha256 = Get-AndaluciaFileSha256 (Join-Path $projectRoot 'deployment\windows\Approve-AndaluciaLocalUiCheckpoint.ps1')
}
New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
$temporaryPath = "$manifestPath.tmp"
[IO.File]::WriteAllText($temporaryPath, (($manifest | ConvertTo-Json -Depth 4) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
$verified = Get-AndaluciaApprovedSourceState -ProjectRoot $projectRoot -ManifestPath $manifestPath
[ordered]@{ status='APPROVED_LOCAL_UI_CHECKPOINT'; manifestPath=$manifestPath; source=$verified; mutationPerformed='local_manifest_only' } | ConvertTo-Json -Depth 6
