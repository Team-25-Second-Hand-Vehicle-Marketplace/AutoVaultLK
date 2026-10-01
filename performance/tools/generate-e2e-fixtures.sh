#!/usr/bin/env bash
# Generates one CSV+ZIP pair per dealer for end-to-end-load.js (levels 0, 2-4).
#
#   bash performance/tools/generate-e2e-fixtures.sh <level>
#
# Run it immediately before every k6 run: registration_number is globally
# unique, so a pair can only be ingested once per database. Each call uses a
# fresh timestamped prefix. Images are 4 per vehicle (level 0: exactly 3
# images for 2 vehicles), 800x600.
set -euo pipefail

LEVEL="${1:?usage: generate-e2e-fixtures.sh <level 0|2|3|4>}"
TOTAL_IMAGES=""   # optional exact cap on ZIP entries (level 0 only)
PER_VEHICLE=4
case "$LEVEL" in
  0) DEALERS=1;  ROWS=2; PER_VEHICLE=2; TOTAL_IMAGES=3 ;;
  2) DEALERS=3;  ROWS=15 ;;
  3) DEALERS=10; ROWS=50 ;;
  4) DEALERS=20; ROWS=150 ;;
  *) echo "level must be 0, 2, 3 or 4 (level 1 is CSV-only and needs no fixtures)" >&2; exit 1 ;;
esac

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/ingestion-service"
OUT=test-data/e2e-load
STAMP="$(date +%s)"
rm -rf "$OUT"
mkdir -p "$OUT/raw"

for ((i = 0; i < DEALERS; i++)); do
  echo "dealer $((i + 1))/$DEALERS: $ROWS rows"
  node node_modules/tsx/dist/cli.mjs src/tools/vehicle-generator/vehicle-generator.ts \
    --count "$ROWS" --format csv --mode clean --output "$OUT/raw/dealer-$i.csv"
  node node_modules/tsx/dist/cli.mjs src/tools/vehicle-generator/generate-unique-csv.ts \
    --input "$OUT/raw/dealer-$i.csv" --output "$OUT/dealer-$i.csv" --prefix "E2EL${LEVEL}D${i}-${STAMP}"
  node node_modules/tsx/dist/cli.mjs src/tools/image-generator/image-generator.ts \
    --from-csv "$OUT/dealer-$i.csv" --per-vehicle "$PER_VEHICLE" ${TOTAL_IMAGES:+--total-images "$TOTAL_IMAGES"} --width 800 --height 600 \
    --output "$OUT/dealer-$i.zip"
done

rm -rf "$OUT/raw"
echo "done: $DEALERS pairs in ingestion-service/$OUT"
