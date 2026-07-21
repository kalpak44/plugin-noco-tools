#!/usr/bin/env bash
#
# Build without producing a tarball (used for CI type/build checks).
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$REPO_ROOT/app"
PLUGIN_NAME="$(node -pe "require('$REPO_ROOT/package.json').name")"

if [ ! -f "$APP_DIR/source/package.json" ]; then
  bash "$REPO_ROOT/scripts/bootstrap-dev-app.sh"
fi

cd "$APP_DIR/source"
nb source build "$PLUGIN_NAME"