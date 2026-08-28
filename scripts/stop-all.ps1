<#
.SYNOPSIS
  Stops everything start-all.ps1 started.

.PARAMETER KeepData
  Stop the Postgres container but keep the named volume (the default).
  Data is only destroyed by `docker compose down -v`, which this never does.
#>
param([switch]$KeepDatabase)

$root = Split-Path -Parent $PSScriptRoot

# The service windows are plain `npm run start:dev` processes; killing the
# node processes bound to the dev ports is more reliable than trying to
# match window titles.
$ports = 3001, 3002, 3003, 3004, 3005, 5173
foreach ($port in $ports) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    try {
      Stop-Process -Id $c.OwningProcess -Force -ErrorAction Stop
      Write-Host "Stopped process on :$port" -ForegroundColor Yellow
    } catch {}
  }
}

docker compose -f (Join-Path $root 'docker-compose.dev.yml') stop gateway 2>$null | Out-Null

if (-not $KeepDatabase) {
  docker compose -f (Join-Path $root 'docker-compose.yml') stop
  Write-Host "Postgres stopped (data volume kept)." -ForegroundColor Yellow
}

Write-Host "Done." -ForegroundColor Green
