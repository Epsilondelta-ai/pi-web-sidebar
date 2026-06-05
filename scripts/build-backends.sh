#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGETS=(
  "darwin/amd64"
  "darwin/arm64"
  "linux/amd64"
  "linux/arm64"
)

for target in "${TARGETS[@]}"; do
  GOOS="${target%/*}"
  GOARCH="${target#*/}"
  OUT_DIR="$ROOT/bin/$GOOS-$GOARCH"
  OUT="$OUT_DIR/pi-web-sidebar-backend"
  mkdir -p "$OUT_DIR"
  echo "building $GOOS/$GOARCH -> $OUT"
  GOOS="$GOOS" GOARCH="$GOARCH" go build -o "$OUT" "$ROOT/backend.go"
  chmod 755 "$OUT"
done

chmod 755 "$ROOT/backend.js"
