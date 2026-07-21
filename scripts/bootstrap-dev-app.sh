#!/usr/bin/env bash
#
# Bootstrap the local dev app under ./app that we use to build this plugin.
# Steps:
#   1. Download a NocoBase source tree via `nb source download` (npm mode).
#   2. Add the extra dev-only deps that the build toolchain expects.
#   3. Copy the plugin sources into app/source/packages/plugins/@…/…
#      (copy, NOT symlink — lerna 4 in @nocobase/build ignores symlinks).
#   4. yarn install so the workspace picks up our plugin.
#
# Idempotent: safe to re-run.
#
# Requirements: `nb` CLI on PATH.
#   npm i -g @nocobase/cli
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$REPO_ROOT/app"
SOURCE_DIR="$APP_DIR/source"
PLUGIN_NAME="$(node -pe "require('$REPO_ROOT/package.json').name")"
TARGET_DIR="$SOURCE_DIR/packages/plugins/$PLUGIN_NAME"

if ! command -v nb >/dev/null 2>&1; then
  echo "error: the \`nb\` CLI was not found on PATH."
  echo "       install it with:   npm i -g @nocobase/cli"
  exit 1
fi

if [ ! -f "$SOURCE_DIR/package.json" ]; then
  echo "==> downloading NocoBase source into $SOURCE_DIR (npm mode, first run only)"
  mkdir -p "$APP_DIR"
  (cd "$APP_DIR" && nb source download -y --source npm --output-dir source)
else
  echo "==> reusing existing source tree at $SOURCE_DIR"
fi

echo "==> ensuring build-time dev deps are installed in the source tree"
# @nocobase/build     — the build orchestrator (`nocobase-build` binary)
# ts-node             — required by @nocobase/cli-v1's dep check
# @nocobase/flow-engine, @nocobase/client-v2, @nocobase/client
#                     — resolvable during "write external version" step
# react + react-dom + antd — resolvable during client-v2 rsbuild
(
  cd "$SOURCE_DIR"
  # If any of these are already installed, `yarn add` is a no-op update.
  yarn add -W --dev \
    @nocobase/build \
    @nocobase/flow-engine \
    @nocobase/client-v2 \
    @nocobase/client \
    react react-dom antd \
    ts-node
)

echo "==> syncing plugin sources into $TARGET_DIR"
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

echo "==> yarn install to pick up the plugin in the workspace"
(cd "$SOURCE_DIR" && yarn install --ignore-engines)

cat <<EOF

Bootstrap complete.
  Source dir : $SOURCE_DIR
  Plugin dir : $TARGET_DIR

Next:
  yarn build          # produces dist/*.tgz at the repo root
  yarn dev            # runs NocoBase in dev mode (needs a working DB config)
EOF