#!/usr/bin/env bash
#
# Bootstrap a local NocoBase dev app under ./app and link this plugin into it.
# Idempotent: safe to re-run. Skips work that's already been done.
#
# Requirements: `nb` CLI must be on PATH.
#   npm i -g @nocobase/cli
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$REPO_ROOT/app"
PLUGIN_NAME="$(node -pe "require('$REPO_ROOT/package.json').name")"
# NocoBase expects <app>/plugins/@scope/plugin-name to match the package name exactly.
LINK_TARGET="$APP_DIR/plugins/$PLUGIN_NAME"

if ! command -v nb >/dev/null 2>&1; then
  echo "error: the \`nb\` CLI was not found on PATH."
  echo "       install it with:   npm i -g @nocobase/cli"
  exit 1
fi

if [ ! -f "$APP_DIR/source/package.json" ]; then
  echo "==> bootstrapping NocoBase dev app in $APP_DIR (this can take a while)"
  mkdir -p "$APP_DIR"
  (
    cd "$APP_DIR"
    nb init --skip-ui
  )
else
  echo "==> reusing existing dev app at $APP_DIR"
fi

echo "==> linking plugin \"$PLUGIN_NAME\" into dev app"
mkdir -p "$(dirname "$LINK_TARGET")"
if [ -e "$LINK_TARGET" ] || [ -L "$LINK_TARGET" ]; then
  # Only replace if it doesn't already point at us.
  current="$(readlink "$LINK_TARGET" 2>/dev/null || true)"
  if [ "$current" != "$REPO_ROOT" ]; then
    rm -rf "$LINK_TARGET"
    ln -s "$REPO_ROOT" "$LINK_TARGET"
  fi
else
  ln -s "$REPO_ROOT" "$LINK_TARGET"
fi

echo "==> enabling plugin"
nb plugin enable "$PLUGIN_NAME" || {
  echo "note: 'nb plugin enable' failed; run it manually after 'nb app start'."
}

echo
echo "Bootstrap complete."
echo "  Dev app dir : $APP_DIR"
echo "  Plugin link : $LINK_TARGET -> $REPO_ROOT"
echo
echo "Next:  yarn dev    # or:  nb app start"