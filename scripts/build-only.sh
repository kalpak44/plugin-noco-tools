#!/usr/bin/env bash
#
# Build without producing a tarball (compile-only, used for local sanity checks).
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="$REPO_ROOT/app/source"
PLUGIN_NAME="$(node -pe "require('$REPO_ROOT/package.json').name")"
TARGET_DIR="$SOURCE_DIR/packages/plugins/$PLUGIN_NAME"

if [ ! -f "$SOURCE_DIR/package.json" ]; then
  bash "$REPO_ROOT/scripts/bootstrap-dev-app.sh"
else
  rsync -a --delete \
    --exclude 'node_modules' \
    --exclude 'app' \
    --exclude 'dist' \
    --exclude '.git' \
    --exclude 'scripts' \
    --exclude '.github' \
    --exclude '.idea' \
    --exclude '.vscode' \
    "$REPO_ROOT/" "$TARGET_DIR/"
fi

(cd "$SOURCE_DIR" && yarn build "$PLUGIN_NAME")