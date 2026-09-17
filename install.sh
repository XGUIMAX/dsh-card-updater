#!/usr/bin/env bash
# dsh-card-updater: attach the plugin to a DSH profile.
#
# Adds the plugin to the profile's dependencies (as a local link, so the source
# stays live) and to its bundle list, then reinstalls the profile. The profile
# package.json is backed up first. Nothing outside the chosen profile changes.
#
# Run it from this folder:
#   ./install.sh
#   ./install.sh --profile web
#
# On Windows use install.ps1 instead. On macOS and Linux this script needs bash,
# node and pnpm on PATH; it writes the profile manifest through node so the file
# stays valid UTF-8 JSON.
#
# After this, restart DSH. The plugin appears as a sidebar-foot entry and under
# Settings -> Card Updater.

set -euo pipefail

PROFILE='tavern'
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --profile=*) PROFILE="${1#*=}"; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

PLUGIN_ID='dsh-card-updater'
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE"
PROFILE_PKG="$PROFILE_DIR/package.json"

echo "dsh-card-updater install"
echo "  plugin  : $PLUGIN_DIR"
echo "  profile : $PROFILE"

if [ ! -f "$PROFILE_PKG" ]; then
  echo "profile package.json not found: $PROFILE_PKG" >&2
  exit 1
fi
if [ ! -f "$PLUGIN_DIR/package.json" ]; then
  echo "this folder does not look like a plugin package: $PLUGIN_DIR" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$PROFILE_PKG.pre-card-updater-$STAMP"
cp "$PROFILE_PKG" "$BACKUP"
echo "  backup  : $BACKUP"

# The link target carries no trailing slash and no quoting: it is written into
# JSON verbatim, and node resolves the same spec on every platform.
node - "$PROFILE_PKG" "$PLUGIN_ID" "$PLUGIN_DIR" <<'NODE'
const fs = require('fs')
const [file, id, dir] = process.argv.slice(2)
const target = 'link:' + dir
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
const changes = []

pkg.dependencies = pkg.dependencies || {}
if (pkg.dependencies[id] !== target) {
  pkg.dependencies[id] = target
  changes.push('dependencies')
}

pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []
if (!bundles.includes(id)) {
  // Appended last, so a bundle that patches the stack still runs after the ones
  // it expects to find already mounted.
  pkg.dsh.profile.bundles = [...bundles, id]
  changes.push('dsh.profile.bundles')
}

fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
console.log(changes.length ? 'updated: ' + changes.join(', ') : 'already installed')
NODE

echo "  running pnpm install..."
if ! (cd "$PROFILE_DIR" && pnpm install --silent); then
  echo "warning: pnpm install failed. Restore from $BACKUP if the profile fails to boot." >&2
fi

echo ""
echo "Done. Restart DSH to apply."
echo "To undo, run ./uninstall.sh (or restore $BACKUP and run pnpm install)."
