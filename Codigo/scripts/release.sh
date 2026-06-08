#!/usr/bin/env bash
#
# release.sh — build, verify, package (and optionally publish) the Swagger to SDK extension.
#
# Correct sequence (matches the .vscodeignore single-bundle packaging):
#   clean -> install -> compile (typecheck) -> bundle (esbuild, self-contained)
#   -> VERIFY bundle is self-contained -> vsce package -> [vsce publish]
#
# Usage:
#   ./scripts/release.sh                      # build + verify + package (.vsix only)
#   ./scripts/release.sh --bump patch         # bump version (patch|minor|major|X.Y.Z) then package
#   ./scripts/release.sh --publish            # also publish to the VS Code Marketplace
#   ./scripts/release.sh --bump patch --publish
#
# Publishing requires Marketplace auth: either export VSCE_PAT=<token>
# or have run `vsce login <publisher>` previously.

set -euo pipefail

# --- locate repo (this script lives in <repo>/scripts) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
REPO="$(pwd)"

# --- args ---
DO_PUBLISH=0
BUMP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --publish) DO_PUBLISH=1; shift ;;
    --bump)    BUMP="${2:-}"; shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# --- pick package manager (prefer pnpm if its lockfile is present) ---
if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null 2>&1; then
  PM=pnpm; PM_INSTALL="pnpm install"; PM_RUN="pnpm run"; VSCE="pnpm dlx @vscode/vsce"
elif command -v npm >/dev/null 2>&1; then
  PM=npm; PM_INSTALL="npm install"; PM_RUN="npm run"; VSCE="npx --yes @vscode/vsce"
else
  echo "ERROR: neither pnpm nor npm found on PATH." >&2; exit 1
fi
echo "==> package manager: $PM"

# --- step 0: clean stale build + old vsix ---
echo "==> [1/7] clean"
rm -rf out
rm -f ./*.vsix

# --- step 1: install deps ---
echo "==> [2/7] install deps ($PM)"
$PM_INSTALL

# --- step 2: optional version bump (no git tag) ---
if [ -n "$BUMP" ]; then
  echo "==> bump version: $BUMP"
  npm version "$BUMP" --no-git-tag-version
fi
VERSION="$(node -p "require('./package.json').version")"
NAME="$(node -p "require('./package.json').name")"
echo "==> building $NAME@$VERSION"

# --- step 3: typecheck (tsc) — fails the build on any type error ---
echo "==> [3/7] compile (typecheck)"
$PM_RUN compile

# --- step 4: bundle (esbuild) — MUST run after compile; produces the self-contained out/extension.js ---
echo "==> [4/7] bundle (esbuild)"
$PM_RUN bundle

# --- step 5: VERIFY the shipped artifact is self-contained ---
# .vscodeignore ships only out/extension.js (+ .map) and excludes node_modules,
# so the bundle must have NO local relative requires and must inline 'yaml'.
echo "==> [5/7] verify bundle self-containment"
BUNDLE="out/extension.js"
[ -f "$BUNDLE" ] || { echo "FAIL: $BUNDLE missing." >&2; exit 1; }

local_reqs="$(grep -F -c 'require("./' "$BUNDLE" || true)"
yaml_reqs="$(grep -F -c 'require("yaml")' "$BUNDLE" || true)"
has_activate="$(grep -F -c 'activate:' "$BUNDLE" || true)"

if [ "$local_reqs" != "0" ]; then
  echo "FAIL: bundle has $local_reqs local relative require(s) — it is NOT self-contained." >&2
  echo "      (did 'compile' run after 'bundle' by mistake?)" >&2
  exit 1
fi
if [ "$yaml_reqs" != "0" ]; then
  echo "FAIL: 'yaml' is required at runtime but node_modules is not shipped." >&2
  exit 1
fi
if [ "$has_activate" = "0" ]; then
  echo "FAIL: bundle does not export activate()." >&2
  exit 1
fi
echo "    OK: 0 local requires, yaml inlined, activate exported ($(du -h "$BUNDLE" | cut -f1))"

# --- step 6: package the .vsix ---
echo "==> [6/7] package (.vsix)"
$VSCE package
VSIX="$(ls -t ./*.vsix | head -1)"
echo "    built: $VSIX"

# --- step 7: publish (opt-in only) ---
if [ "$DO_PUBLISH" = "1" ]; then
  echo "==> [7/7] publish to VS Code Marketplace"
  if [ -z "${VSCE_PAT:-}" ]; then
    echo "    WARNING: VSCE_PAT is not set. vsce will use a cached 'vsce login' session if present;"
    echo "    otherwise this will fail. To set up auth:"
    echo "      1) create a PAT (Marketplace > Manage) at https://dev.azure.com"
    echo "      2) export VSCE_PAT=<token>   (or run: $VSCE login $(node -p "require('./package.json').publisher"))"
  fi
  # publish the exact artifact we just verified (no rebuild)
  $VSCE publish --packagePath "$VSIX"
  echo "    published $NAME@$VERSION"
else
  echo "==> [7/7] skip publish (run with --publish to push to Marketplace)"
fi

echo "==> DONE: $NAME@$VERSION  ($VSIX)"
