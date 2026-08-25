<#
.SYNOPSIS
  Starts the whole AutoVaultLK stack for local development.

.DESCRIPTION
  Brings up Postgres (Docker), then each NestJS service in its own PowerShell
  window, then the Vite frontend. Each service runs `npm run start:dev`, so
  they watch and reload independently.

  The frontend talks to the services through Vite's dev proxy
  (web-frontend/vite.config.ts), which mirrors the nginx route prefixes. The
  nginx gateway container is therefore NOT required for frontend work — start
  it with -Gateway only when you specifically want to exercise that path.

.PARAMETER Gateway
  Also start the nginx API gateway shim on :8080.

.PARAMETER SkipFrontend
  Start backend services only.

.EXAMPLE
  .\scripts\start-all.ps1
  .\scripts\start-all.ps1 -Gateway
#>
param(
  [switch]$Gateway,
  [switch]$SkipFrontend
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path (Join-Path $root '.env'))) {
  Write-Error "No .env at the repo root. Copy .env.example to .env first."
}

# ── Postgres ────────────────────────────────────────────────────────────
Write-Host "Starting Postgres..." -ForegroundColor Cyan
docker compose -f (Join-Path $root 'docker-compose.yml') up -d

# The services fail their first DB query if they boot before Postgres is
# accepting connections, so wait on the container's own healthcheck rather
# than a fixed sleep.
Write-Host "Waiting for Postgres to report healthy..." -NoNewline
for ($i = 0; $i -lt 60; $i++) {
  $state = (docker inspect -f '{{.State.Health.Status}}' vehicle_marketplace_postgres 2>$null)
  if ($state -eq 'healthy') { break }
  Start-Sleep -Seconds 1
  Write-Host "." -NoNewline
}
if ($state -ne 'healthy') { Write-Error "Postgres did not become healthy." }
Write-Host " ok" -ForegroundColor Green

if ($Gateway) {
  Write-Host "Starting nginx gateway shim on :8080..." -ForegroundColor Cyan
  docker compose -f (Join-Path $root 'docker-compose.dev.yml') up gateway -d
}

# ── NestJS services ─────────────────────────────────────────────────────
# PORT is set explicitly per service because the root .env defines a single
# PORT=3001. marketplace/admin/notification read their own *_PORT var first,
# but auth and ingestion read only PORT — without this, ingestion would try
# to bind 3001 and collide with auth.
$services = @(
  @{ Name = 'auth-user-service';     Port = 3001 },
  @{ Name = 'marketplace-service';   Port = 3002 },
  @{ Name = 'ingestion-service';     Port = 3003 },
  @{ Name = 'admin-service';         Port = 3004 },
  @{ Name = 'notification-service';  Port = 3005 }
)

foreach ($svc in $services) {
  $dir = Join-Path $root $svc.Name
  if (-not (Test-Path (Join-Path $dir 'node_modules'))) {
    Write-Host "Installing deps for $($svc.Name)..." -ForegroundColor Yellow
    Push-Location $dir; npm install; Pop-Location
  }
  Write-Host "Starting $($svc.Name) on :$($svc.Port)" -ForegroundColor Cyan
  $cmd = "`$host.UI.RawUI.WindowTitle='$($svc.Name) :$($svc.Port)'; " +
         "Set-Location '$dir'; `$env:PORT='$($svc.Port)'; npm run start:dev"
  Start-Process powershell -ArgumentList '-NoExit', '-Command', $cmd
}

# ── Frontend ────────────────────────────────────────────────────────────
if (-not $SkipFrontend) {
  $fe = Join-Path $root 'web-frontend'
  if (-not (Test-Path (Join-Path $fe 'node_modules'))) {
    Write-Host "Installing deps for web-frontend..." -ForegroundColor Yellow
    Push-Location $fe; npm install; Pop-Location
  }
  Write-Host "Starting web-frontend on :5173" -ForegroundColor Cyan
  $cmd = "`$host.UI.RawUI.WindowTitle='web-frontend :5173'; " +
         "Set-Location '$fe'; npm run dev"
  Start-Process powershell -ArgumentList '-NoExit', '-Command', $cmd
}

Write-Host ""
Write-Host "All started." -ForegroundColor Green
Write-Host "  Frontend    http://localhost:5173"
Write-Host "  Auth        http://localhost:3001"
Write-Host "  Marketplace http://localhost:3002"
Write-Host "  Ingestion   http://localhost:3003"
Write-Host "  Admin       http://localhost:3004"
Write-Host "  Notify      http://localhost:3005"
if ($Gateway) { Write-Host "  Gateway     http://localhost:8080" }
Write-Host ""
Write-Host "Stop with: .\scripts\stop-all.ps1"
