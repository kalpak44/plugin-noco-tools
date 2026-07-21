#!/usr/bin/env bash
#
# Start the dev app with this plugin linked in and source-watching enabled.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$REPO_ROOT/app"

if [ ! -f "$APP_DIR/source/package.json" ]; then
  echo "==> dev app not bootstrapped yet; running bootstrap first"
  bash "$REPO_ROOT/scripts/bootstrap-dev-app.sh"
fi

cd "$APP_DIR/source"
echo "==> starting NocoBase in dev mode (source watch)"
exec nb source dev