#!/usr/bin/env bash
#
# Build @kalpak44/plugin-noco-tools into ./dist/*.tgz — a single-file pipeline.
#
# On first run this bootstraps a local NocoBase source tree under ./app/source
# (via `nb source download`) so the NocoBase build toolchain (@nocobase/build)
# can compile our plugin against the runtime versions we target.
#
# The NocoBase version is pinned so builds are reproducible and produce an
# externalVersion.js that matches the deployed instance runtime. Override the
# pin by exporting NOCOBASE_VERSION.
#
# Requirements:
#   - node >= 22
#   - `nb` CLI on PATH:  npm i -g @nocobase/cli
#
# Idempotent: safe to re-run.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$REPO_ROOT/app"
SOURCE_DIR="$APP_DIR/source"
PLUGIN_NAME="$(node -pe "require('$REPO_ROOT/package.json').name")"
TARGET_DIR="$SOURCE_DIR/packages/plugins/$PLUGIN_NAME"
DIST_DIR="$REPO_ROOT/dist"

# Pin to the deployed instance's NocoBase runtime so externalVersion.js matches
# what the plugin manager expects (see "Dependencies compatibility check").
NOCOBASE_VERSION="${NOCOBASE_VERSION:-2.1.28}"

if ! command -v nb >/dev/null 2>&1; then
  echo "error: the \`nb\` CLI was not found on PATH." >&2
  echo "       install it with:   npm i -g @nocobase/cli" >&2
  exit 1
fi

# --- 1. Ensure NocoBase source scaffold exists (download only on first run)-
if [ ! -f "$SOURCE_DIR/package.json" ]; then
  echo "==> downloading NocoBase source v$NOCOBASE_VERSION into $SOURCE_DIR"
  mkdir -p "$APP_DIR"
  (cd "$APP_DIR" && nb source download -y --source npm --version "$NOCOBASE_VERSION" --output-dir source)
else
  echo "==> reusing existing source tree at $SOURCE_DIR"
fi

# --- 2. Ensure build-time dev deps are present (idempotent, safe to re-run) -
# @nocobase/build     — the build orchestrator (`nocobase-build` binary)
# ts-node             — required by @nocobase/cli-v1's dep check
# @nocobase/flow-engine, @nocobase/client-v2, @nocobase/client
#                     — resolvable during the "write external version" and
#                       declaration-generation steps
# react + react-dom + antd — pinned to what the NocoBase runtime bundles, so
#                     the versions written into dist/externalVersion.js match
#                     the plugin manager's compatibility check (built-in
#                     plugins in nocobase 2.1.x pin react@18.2.0, antd@5.24.2).
REACT_VERSION="${REACT_VERSION:-18.2.0}"
ANTD_VERSION="${ANTD_VERSION:-5.24.2}"
echo "==> ensuring build-time dev deps are installed"
(
  cd "$SOURCE_DIR"
  yarn add -W --dev \
    "@nocobase/build@$NOCOBASE_VERSION" \
    "@nocobase/flow-engine@$NOCOBASE_VERSION" \
    "@nocobase/client-v2@$NOCOBASE_VERSION" \
    "@nocobase/client@$NOCOBASE_VERSION" \
    "react@$REACT_VERSION" "react-dom@$REACT_VERSION" "antd@$ANTD_VERSION" \
    ts-node
)

# --- 3. Sync plugin sources into the workspace ------------------------------
# lerna 4 (used by @nocobase/build) ignores symlinks, so we rsync a copy.
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

# --- 4. yarn install to register the plugin in the workspace ----------------
(cd "$SOURCE_DIR" && yarn install --ignore-engines)

# --- 5. Build the plugin ----------------------------------------------------
echo "==> building $PLUGIN_NAME"
(cd "$SOURCE_DIR" && yarn build "$PLUGIN_NAME")

# --- 6. Pack the tarball into ./dist ---------------------------------------
echo "==> packing tarball with npm pack"
mkdir -p "$DIST_DIR"
rm -f "$DIST_DIR"/*.tgz 2>/dev/null || true
TARBALL="$(cd "$TARGET_DIR" && npm pack --pack-destination "$DIST_DIR" 2>&1 | tail -1)"

if [ ! -f "$DIST_DIR/$TARBALL" ]; then
  echo "error: expected tarball not found at $DIST_DIR/$TARBALL" >&2
  ls "$DIST_DIR"
  exit 2
fi

echo
echo "Built: $DIST_DIR/$TARBALL"
echo
echo "Install into a NocoBase instance by copying to storage/plugins/ or via"
echo "the plugin manager UI (Add new plugin → upload)."