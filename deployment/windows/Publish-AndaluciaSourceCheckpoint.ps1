param(
    [string]$Message = "Validated source checkpoint $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
    [ValidateSet('Full', 'BuildOnly')]
    [string]$Validation = 'Full'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Label,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command
    )

    Write-Host "==> $Label"
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
}

$repositoryRoot = (& git rev-parse --show-toplevel 2>$null).Trim()
if (-not $repositoryRoot) {
    throw 'This checkpoint command must run inside the Andalucía Git repository.'
}

Set-Location -LiteralPath $repositoryRoot
$branch = (& git branch --show-current).Trim()
if (-not $branch) {
    throw 'Detached HEAD is not allowed for source checkpoints.'
}
if ($branch -in @('main', 'master')) {
    throw 'Source checkpoints must use a development or recovery branch, never main directly.'
}

$origin = (& git remote get-url origin 2>$null).Trim()
if (-not $origin) {
    throw 'The origin remote is not configured.'
}

$allowedPaths = @(
    '.github', 'database', 'deployment', 'docs', 'public', 'server', 'src',
    '.gitattributes', '.gitignore', 'AGENTS.md', 'ANDALUCIA', 'index.html', 'package-lock.json',
    'package.json', 'README.md', 'tsconfig.json', 'tsconfig.node.json', 'vite.config.ts'
)
& git add -- $allowedPaths
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to stage the approved source allowlist.'
}

$stagedFiles = @(& git diff --cached --name-only --diff-filter=ACMR)
if ($stagedFiles.Count -eq 0) {
    Write-Host 'No source changes require a checkpoint.'
    exit 0
}

$forbiddenPathPattern = '(^|/)(\.data($|-|/)|\.backups?/|\.recovery/|\.runtime/|\.tmp($|-|/)|\.test-data/|node_modules/|dist/|output/|artifacts/|sources/)|(^|/)(\.env($|\.)|postmaster\.pid$)|\.(db|sqlite|sqlite3|dump|backup|bak|pem|key|pfx|p12)$'
$forbiddenFiles = @($stagedFiles | Where-Object { $_ -match $forbiddenPathPattern })
if ($forbiddenFiles.Count -gt 0) {
    throw "Checkpoint blocked because prohibited files are staged: $($forbiddenFiles -join ', ')"
}

$secretMatches = @(& git grep --cached -I -l -E '(-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,})' -- $stagedFiles 2>$null)
if ($LASTEXITCODE -gt 1) {
    throw 'Sensitive-content scan could not be completed.'
}
if ($secretMatches.Count -gt 0) {
    throw "Checkpoint blocked by a potential embedded credential in: $($secretMatches -join ', ')"
}

Invoke-Checked -Label 'Production build' -Command { npm run build }
if ($Validation -eq 'Full') {
    Invoke-Checked -Label 'Migration 026 accumulated OFF regression' -Command { npm run test:accumulated-off-026 }
    Invoke-Checked -Label 'Migration 027 manual OT regression' -Command { npm run test:manual-overtime-027 }
    Invoke-Checked -Label 'Official timesheet exporter regression' -Command { npm run test:official-timesheet-export }
    Invoke-Checked -Label 'Official timesheet HTTP route regression' -Command { npm run test:official-timesheet-export-route }
}

Invoke-Checked -Label 'Create local checkpoint commit' -Command { git commit -m $Message }
$localSha = (& git rev-parse HEAD).Trim()

try {
    Invoke-Checked -Label "Push checkpoint to origin/$branch" -Command { git push --set-upstream origin "HEAD:refs/heads/$branch" }
} catch {
    Write-Error "The local checkpoint $localSha is safe, but the push failed. Retry with: git push --set-upstream origin HEAD:refs/heads/$branch"
    throw
}

$remoteLine = (& git ls-remote --heads origin "refs/heads/$branch").Trim()
$remoteSha = if ($remoteLine) { ($remoteLine -split '\s+')[0] } else { '' }
if ($remoteSha -ne $localSha) {
    throw "Remote verification failed. Local SHA: $localSha; remote SHA: $remoteSha"
}

Write-Host "Checkpoint verified: $branch @ $localSha"
