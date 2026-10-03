<#
.SYNOPSIS
  Runs the unit tests of every package, and optionally the integration,
  contract and end-to-end suites of the backend services.

.DESCRIPTION
  Unit tests run for each backend service (test:ci) and the frontend (vitest).
  The integration, contract and end-to-end suites need the local PostgreSQL
  container, so start it first with `docker compose up -d`. The script stops at
  the first failing package.

.PARAMETER Integration
  Also run each backend service's integration suite.

.PARAMETER Contract
  Also run each backend service's contract suite.

.PARAMETER E2E
  Also run each backend service's end-to-end suite.

.EXAMPLE
  .\scripts\test-all.ps1
  .\scripts\test-all.ps1 -Integration -Contract -E2E
#>
param(
  [switch]$Integration,
  [switch]$Contract,
  [switch]$E2E
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$services = @(
  'auth-user-service',
  'marketplace-service',
  'admin-service',
  'notification-service',
  'ingestion-service'
)

function Invoke-Suite($pkg, $script) {
  Write-Host "==> $pkg : $script" -ForegroundColor Cyan
  Push-Location (Join-Path $root $pkg)
  try {
    npm run $script
    if ($LASTEXITCODE -ne 0) { throw "$script failed in $pkg" }
  } finally {
    Pop-Location
  }
}

foreach ($svc in $services) {
  Invoke-Suite $svc 'test:ci'
  if ($Integration) { Invoke-Suite $svc 'test:integration' }
  if ($Contract)    { Invoke-Suite $svc 'test:contract' }
  if ($E2E)         { Invoke-Suite $svc 'test:e2e' }
}

Invoke-Suite 'web-frontend' 'test'

Write-Host 'All selected test suites passed.' -ForegroundColor Green
