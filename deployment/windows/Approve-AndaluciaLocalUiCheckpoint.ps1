[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SourceUiCheckpointSha,
  [Parameter(Mandatory = $true)][string]$ControlCommitSha,
  [Parameter(Mandatory = $true)][string]$ManagerApproval,
  [string]$RepositoryRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = if ($RepositoryRoot) { [IO.Path]::GetFullPath($RepositoryRoot) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')) }
$resolverPath = Join-Path $projectRoot 'deployment\windows\Resolve-AndaluciaApprovedSource.ps1'
$manifestPath = Join-Path $projectRoot '.runtime\andalucia-local-ui-approval.json'
if ($ManagerApproval -ne 'YES_I_APPROVE_LOCAL_UI_CHECKPOINT') { throw 'ANDALUCIA_LOCAL_UI_MANAGER_APPROVAL_REQUIRED' }
if (-not (Test-Path -LiteralPath $resolverPath -PathType Leaf)) { throw 'ANDALUCIA_LOCAL_UI_RESOLVER_MISSING' }
. $resolverPath

$branch = (& git -C $projectRoot branch --show-current 2>$null).Trim()
if ($branch -notmatch '^codex/local-ui-[a-z0-9._-]+$') { throw "ANDALUCIA_LOCAL_UI_BRANCH_NOT_ALLOWED:$branch" }
$trackedChanges = @(& git -C $projectRoot status --porcelain --untracked-files=no)
if ($trackedChanges.Count -gt 0) { throw 'ANDALUCIA_LOCAL_UI_SOURCE_DIRTY' }
$activeSourceSha = Resolve-AndaluciaGitRef $projectRoot 'HEAD'
$approvedMainSha = Resolve-AndaluciaGitRef $projectRoot 'refs/remotes/origin/main'
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
