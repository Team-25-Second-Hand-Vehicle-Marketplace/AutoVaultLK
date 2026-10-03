<#
.SYNOPSIS
  Installs dependencies and builds every service and the frontend.

.DESCRIPTION
  Runs `npm ci` then `npm run build` in each package, in order, and stops at
  the first failure. Use -SkipInstall when dependencies are already installed.

.EXAMPLE
  .\scripts\build-all.ps1
  .\scripts\build-all.ps1 -SkipInstall
#>
param(
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$packages = @(
  'auth-user-service',
  'marketplace-service',
  'admin-service',
  'notification-service',
  'ingestion-service',
  'web-frontend'
)

foreach ($pkg in $packages) {
  Write-Host "==> $pkg" -ForegroundColor Cyan
  Push-Location (Join-Path $root $pkg)
  try {
    if (-not $SkipInstall) {
      npm ci
      if ($LASTEXITCODE -ne 0) { throw "npm ci failed in $pkg" }
    }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "build failed in $pkg" }
  } finally {
    Pop-Location
  }
}

Write-Host 'All packages built.' -ForegroundColor Green
