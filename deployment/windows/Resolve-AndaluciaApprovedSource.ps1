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
    'deployment/windows/Resolve-AndaluciaApprovedSource.ps1',
    'deployment/windows/Approve-AndaluciaLocalUiCheckpoint.ps1',
    'server/local-ui-activation.test.ts',
    'server/database-scheduler.test.ts'
  )
  $invalid = @(if ($Mode -eq 'ui') {
    @($paths | Where-Object { $_ -notmatch $uiPattern })
  } else {
    @($paths | Where-Object { $_ -notin $controlPaths })
  })
  if ($invalid.Count -gt 0) { throw "ANDALUCIA_LOCAL_UI_PATH_NOT_APPROVED:${Mode}:$($invalid -join ',')" }
  return $paths
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
  if ($manifest.version -ne 'andalucia-local-ui-approval-v1' -or $manifest.mode -ne 'approved_local_ui_checkpoint' -or $manifest.managerApproval -ne 'YES_I_APPROVE_LOCAL_UI_CHECKPOINT') { throw 'ANDALUCIA_LOCAL_UI_APPROVAL_MANIFEST_INVALID' }
  if ([string]$manifest.branch -ne $branch -or [string]$manifest.activeSourceSha -ne $headSha -or [string]$manifest.approvedMainSha -ne $originMainSha) { throw 'ANDALUCIA_LOCAL_UI_APPROVAL_SOURCE_MISMATCH' }

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
