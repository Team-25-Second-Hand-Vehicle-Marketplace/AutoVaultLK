#!/usr/bin/env bash
# Installs dependencies and builds every service and the frontend.
# Stops at the first failure. Pass --skip-install if dependencies are already installed.
set -euo pipefail

skip_install=false
[[ "${1:-}" == "--skip-install" ]] && skip_install=true

root="$(cd "$(dirname "$0")/.." && pwd)"
packages=(
  auth-user-service
  marketplace-service
  admin-service
  notification-service
  ingestion-service
  web-frontend
)

for pkg in "${packages[@]}"; do
  echo "==> $pkg"
  cd "$root/$pkg"
  if [[ "$skip_install" == false ]]; then
    npm ci
  fi
  npm run build
done

echo "All packages built."
