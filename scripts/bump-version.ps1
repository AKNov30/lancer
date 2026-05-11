<#
.SYNOPSIS
  Bump version across the three version files in sync.

.DESCRIPTION
  Updates:
    - package.json "version"
    - src-tauri/Cargo.toml [package] version
    - src-tauri/tauri.conf.json "version"

  After running, you still need to:
    1. Run `pnpm run release` (or `git cliff -o CHANGELOG.md --tag v<NEW>`)
    2. Commit + tag

.PARAMETER NewVersion
  Semver string (e.g., "1.0.1", "1.1.0-rc.1").

.EXAMPLE
  ./scripts/bump-version.ps1 -NewVersion 1.0.1
#>

param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$')]
  [string]$NewVersion
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent

# 1. package.json
$pkgPath = Join-Path $repoRoot "package.json"
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$oldPkg = $pkg.version
$pkg.version = $NewVersion
$pkg | ConvertTo-Json -Depth 20 | Set-Content $pkgPath -Encoding UTF8
Write-Host "package.json: $oldPkg -> $NewVersion" -ForegroundColor Green

# 2. Cargo.toml
$cargoPath = Join-Path $repoRoot "src-tauri/Cargo.toml"
$cargoContent = Get-Content $cargoPath -Raw
$cargoNew = $cargoContent -replace '(?m)^version\s*=\s*"[^"]+"', "version = `"$NewVersion`""
if ($cargoContent -eq $cargoNew) {
  Write-Warning "Cargo.toml: no version line matched — please verify manually"
} else {
  Set-Content $cargoPath -Value $cargoNew -Encoding UTF8
  Write-Host "Cargo.toml: bumped to $NewVersion" -ForegroundColor Green
}

# 3. tauri.conf.json
$tauriPath = Join-Path $repoRoot "src-tauri/tauri.conf.json"
$tauri = Get-Content $tauriPath -Raw | ConvertFrom-Json
$oldTauri = $tauri.version
$tauri.version = $NewVersion
$tauri | ConvertTo-Json -Depth 20 | Set-Content $tauriPath -Encoding UTF8
Write-Host "tauri.conf.json: $oldTauri -> $NewVersion" -ForegroundColor Green

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. pnpm install        # syncs pnpm-lock.yaml"
Write-Host "  2. cargo build --manifest-path src-tauri/Cargo.toml   # syncs Cargo.lock"
Write-Host "  3. pnpm run release    # generates CHANGELOG section"
Write-Host "  4. git add -A && git commit -m ``"chore(release): v$NewVersion``""
Write-Host "  5. git tag v$NewVersion && git push origin main --tags"
