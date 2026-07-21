#!/usr/bin/env bash
#
# Build the plugin and produce a .tgz artifact you can install into any NocoBase
# instance by dropping it into ./storage/plugins.
#
# Output:
#   dist/<name-flattened>-<version>.tgz  (at repo root)
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$REPO_ROOT/app"
PLUGIN_NAME="$(node -pe "require('$REPO_ROOT/package.json').name")"
PLUGIN_VERSION="$(node -pe "require('$REPO_ROOT/package.json').version")"
DIST_DIR="$REPO_ROOT/dist"

if [ ! -f "$APP_DIR/source/package.json" ]; then
  echo "==> dev app not bootstrapped yet; running bootstrap first"
  bash "$REPO_ROOT/scripts/bootstrap-dev-app.sh"
fi

mkdir -p "$DIST_DIR"
rm -f "$DIST_DIR"/*.tgz 2>/dev/null || true

echo "==> building plugin: $PLUGIN_NAME@$PLUGIN_VERSION"
(
  cd "$APP_DIR/source"
  nb source build "$PLUGIN_NAME" --tar
)

TAR_DIR="$APP_DIR/source/storage/tar"
if [ ! -d "$TAR_DIR" ]; then
  echo "error: expected tar output dir not found: $TAR_DIR"
  exit 2
fi

# Prefer the most recent tarball matching the plugin name (nb source build may
# use a name-flattened filename, e.g. @scope/name -> scope-name.tgz).
LATEST_TAR="$(ls -t "$TAR_DIR"/*.tgz 2>/dev/null | head -n1 || true)"
if [ -z "$LATEST_TAR" ]; then
  echo "error: no .tgz produced under $TAR_DIR"
  exit 3
fi

BASENAME="$(basename "$LATEST_TAR")"
cp "$LATEST_TAR" "$DIST_DIR/$BASENAME"

echo
echo "Built: $DIST_DIR/$BASENAME"
echo
echo "Install it by copying to your NocoBase app's ./storage/plugins/ dir, then"
echo "opening /v/admin/ and enabling \"Noco Tools — Google (Gmail + Calendar)\"."