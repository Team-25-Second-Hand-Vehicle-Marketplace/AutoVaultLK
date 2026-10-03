#!/usr/bin/env bash
# Runs the unit tests of every package, and optionally the integration,
# contract and end-to-end suites of the backend services.
#
# Usage: scripts/test-all.sh [--integration] [--contract] [--e2e]
#
# The integration, contract and end-to-end suites need the local PostgreSQL
# container, so start it first with `docker compose up -d`.
set -euo pipefail

run_integration=false
run_contract=false
run_e2e=false
for arg in "$@"; do
  case "$arg" in
    --integration) run_integration=true ;;
    --contract) run_contract=true ;;
    --e2e) run_e2e=true ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

root="$(cd "$(dirname "$0")/.." && pwd)"
services=(
  auth-user-service
  marketplace-service
  admin-service
  notification-service
  ingestion-service
)

run_suite() {
  local pkg="$1" script="$2"
  echo "==> $pkg : $script"
  (cd "$root/$pkg" && npm run "$script")
}

for svc in "${services[@]}"; do
  run_suite "$svc" test:ci
  if [[ "$run_integration" == true ]]; then run_suite "$svc" test:integration; fi
  if [[ "$run_contract" == true ]]; then run_suite "$svc" test:contract; fi
  if [[ "$run_e2e" == true ]]; then run_suite "$svc" test:e2e; fi
done

run_suite web-frontend test

echo "All selected test suites passed."
