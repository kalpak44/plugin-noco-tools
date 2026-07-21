#!/usr/bin/env bash
#
# Build the plugin and produce a .tgz artifact in ./dist that you can drop into
# any NocoBase instance's ./storage/plugins directory.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$REPO_ROOT/app"
SOURCE_DIR="$APP_DIR/source"
PLUGIN_NAME="$(node -pe "require('$REPO_ROOT/package.json').name")"
TARGET_DIR="$SOURCE_DIR/packages/plugins/$PLUGIN_NAME"
DIST_DIR="$REPO_ROOT/dist"

if [ ! -f "$SOURCE_DIR/package.json" ]; then
  echo "==> dev app not bootstrapped yet; running bootstrap first"
  bash "$REPO_ROOT/scripts/bootstrap-dev-app.sh"
else
  echo "==> syncing latest plugin sources into $TARGET_DIR"
  mkdir -p "$(dirname "$TARGET_DIR")"
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

echo "==> building plugin: $PLUGIN_NAME"
(cd "$SOURCE_DIR" && yarn build "$PLUGIN_NAME")

echo "==> packing tarball with npm pack"
mkdir -p "$DIST_DIR"
rm -f "$DIST_DIR"/*.tgz 2>/dev/null || true
TARBALL="$(cd "$TARGET_DIR" && npm pack --pack-destination "$DIST_DIR" 2>&1 | tail -1)"

# npm pack prints the tarball filename on the last line — verify it exists.
if [ ! -f "$DIST_DIR/$TARBALL" ]; then
  echo "error: expected tarball not found at $DIST_DIR/$TARBALL"
  ls "$DIST_DIR"
  exit 2
fi

echo
echo "Built: $DIST_DIR/$TARBALL"
echo
echo "Install it by copying to your NocoBase app's ./storage/plugins/ dir,"
echo "then opening /v/admin/ and enabling"
echo "  \"Noco Tools — Google (Gmail + Calendar)\"."