<#
.SYNOPSIS
  Fail CI if the Vite production bundle exceeds a budget.

.DESCRIPTION
  Runs `pnpm vite build`, then sums the sizes of all .js + .css files in `dist/`.
  Fails if total exceeds the budget (default 500 KB JS + 150 KB CSS).
#>

param(
  [int]$JsBudgetKB = 500,
  [int]$CssBudgetKB = 150
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

Write-Host "Running pnpm vite build..." -ForegroundColor Cyan
pnpm vite build
if ($LASTEXITCODE -ne 0) { throw "Vite build failed" }

$distAssets = Join-Path $repoRoot "dist/assets"
if (-not (Test-Path $distAssets)) { throw "No dist/assets directory found after build" }

# Sum sizes (raw, not gzipped — closer approximation is fine for a gate)
$jsBytes = (Get-ChildItem $distAssets -Filter *.js | Measure-Object -Property Length -Sum).Sum
$cssBytes = (Get-ChildItem $distAssets -Filter *.css | Measure-Object -Property Length -Sum).Sum

$jsKB = [math]::Round($jsBytes / 1024, 1)
$cssKB = [math]::Round($cssBytes / 1024, 1)

Write-Host ""
Write-Host "Bundle sizes (raw):" -ForegroundColor Cyan
Write-Host "  JS  : $jsKB KB (budget: $JsBudgetKB KB)"
Write-Host "  CSS : $cssKB KB (budget: $CssBudgetKB KB)"
Write-Host ""

$failed = $false
if ($jsBytes -gt ($JsBudgetKB * 1024)) {
  Write-Host "FAIL: JS bundle exceeds budget" -ForegroundColor Red
  $failed = $true
}
if ($cssBytes -gt ($CssBudgetKB * 1024)) {
  Write-Host "FAIL: CSS bundle exceeds budget" -ForegroundColor Red
  $failed = $true
}

if ($failed) {
  Write-Host ""
  Write-Host "If this growth is intentional, raise the budget in scripts/check-bundle-size.ps1" -ForegroundColor Yellow
  exit 1
}

Write-Host "OK: bundles within budget" -ForegroundColor Green
