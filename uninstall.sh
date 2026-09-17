#!/usr/bin/env bash
# dsh-card-updater: detach the plugin from a DSH profile.
#
# Removes the plugin's entry from the profile's dependencies and bundle list,
# reinstalls the profile so the change takes effect, and leaves everything else
# in the profile untouched. The profile package.json is backed up first, and the
# plugin's own data directory is kept unless --purge-data is given.
#
# Run it from this folder:
#   ./uninstall.sh
#   ./uninstall.sh --purge-data
#   ./uninstall.sh --profile web
#
# On Windows use uninstall.ps1 instead. On macOS and Linux this script needs
# bash, node and pnpm on PATH.
#
# Nothing outside the chosen profile is modified.

set -euo pipefail

PROFILE='tavern'
PURGE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --profile=*) PROFILE="${1#*=}"; shift ;;
    --purge-data) PURGE=1; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

PLUGIN_ID='dsh-card-updater'
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE"
PROFILE_PKG="$PROFILE_DIR/package.json"

echo "dsh-card-updater uninstall"
echo "  profile : $PROFILE"
echo "  dir     : $PROFILE_DIR"

if [ ! -f "$PROFILE_PKG" ]; then
  echo "profile package.json not found: $PROFILE_PKG" >&2
  exit 1
fi

# Back up before touching anything, so this stays reversible by hand.
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$PROFILE_PKG.pre-card-updater-$STAMP"
cp "$PROFILE_PKG" "$BACKUP"
echo "  backup  : $BACKUP"

# Edit the manifest through node: it round-trips the JSON safely and keeps the
# file UTF-8.
node - "$PROFILE_PKG" "$PLUGIN_ID" <<'NODE'
const fs = require('fs')
const [file, id] = process.argv.slice(2)
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
const changes = []

if (pkg.dependencies && pkg.dependencies[id]) {
  delete pkg.dependencies[id]
  changes.push('dependencies')
}
const bundles = pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles
if (Array.isArray(bundles)) {
  const before = bundles.length
  pkg.dsh.profile.bundles = bundles.filter((b) => b !== id)
  if (pkg.dsh.profile.bundles.length !== before) changes.push('dsh.profile.bundles')
}
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
console.log(changes.length ? 'removed from: ' + changes.join(', ') : 'nothing to remove (already detached)')
NODE

# Reinstall so the profile's lockfile and node_modules match the manifest.
echo "  running pnpm install..."
if ! (cd "$PROFILE_DIR" && pnpm install --silent); then
  echo "warning: pnpm install failed. Restore from $BACKUP if the profile fails to boot." >&2
fi

DATA_DIR="$DSH_HOME_DIR/profile-data/$PROFILE/data/tools/card-updater"
if [ "$PURGE" = "1" ]; then
  if [ -d "$DATA_DIR" ]; then
    rm -rf "$DATA_DIR"
    echo "  data    : removed $DATA_DIR"
  fi
else
  echo "  data    : kept (pass --purge-data to delete)"
fi

# The plugin folder is deliberately left alone: this script runs from inside it,
# and an orphaned folder is inert once the profile no longer references it.
echo "  files   : plugin folder kept; delete it by hand if you want it gone:"
echo "            $PLUGIN_DIR"

echo ""
echo "Done. Restart DSH to apply."
echo "To undo, restore $BACKUP over package.json and run pnpm install again."
