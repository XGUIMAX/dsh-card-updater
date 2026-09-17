# dsh-card-updater: detach the plugin from a DSH profile.
#
# Removes the plugin's entry from the profile's dependencies and bundle list,
# reinstalls the profile so the change takes effect, and leaves everything else
# in the profile untouched. The profile package.json is backed up first, and the
# plugin's own data directory is kept unless -PurgeData is given.
#
#   pwsh -File uninstall.ps1                 # detach, keep card-updater data
#   pwsh -File uninstall.ps1 -PurgeData      # detach and delete its data dir
#   pwsh -File uninstall.ps1 -Profile web    # target another profile
#
# Nothing outside the chosen profile is modified.

[CmdletBinding()]
param(
  [string]$Profile = 'tavern',
  [switch]$PurgeData
)

$ErrorActionPreference = 'Stop'
$PluginId = 'dsh-card-updater'
$PluginDir = $PSScriptRoot
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$ProfileDir = Join-Path $DshHome "profiles\$Profile"
$ProfilePkg = Join-Path $ProfileDir 'package.json'

Write-Host "dsh-card-updater uninstall" -ForegroundColor Cyan
Write-Host "  profile : $Profile"
Write-Host "  dir     : $ProfileDir"

if (-not (Test-Path $ProfilePkg)) {
  throw "profile package.json not found: $ProfilePkg"
}

# Back up before touching anything, so this is reversible by hand if needed.
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$ProfilePkg.pre-card-updater-$stamp"
Copy-Item $ProfilePkg $backup
Write-Host "  backup  : $backup" -ForegroundColor DarkGray

# Edit the manifest through Node: it round-trips the JSON safely and keeps the
# file UTF-8, which hand-editing in PowerShell does not.
$node = @'
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
'@

$tmp = Join-Path $env:TEMP "dcu-uninstall-$stamp.cjs"
Set-Content -Path $tmp -Value $node -Encoding UTF8
try {
  node $tmp $ProfilePkg $PluginId
} finally {
  Remove-Item $tmp -ErrorAction SilentlyContinue
}

# Reinstall so the profile's lockfile and node_modules match the manifest.
Push-Location $ProfileDir
try {
  Write-Host "  running pnpm install..." -ForegroundColor DarkGray
  pnpm install --silent
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "pnpm install returned $LASTEXITCODE. Restore from $backup if the profile fails to boot."
  }
} finally {
  Pop-Location
}

if ($PurgeData) {
  $dataDir = Join-Path $DshHome "profile-data\$Profile\data\tools\card-updater"
  if (Test-Path $dataDir) {
    Remove-Item $dataDir -Recurse -Force
    Write-Host "  data    : removed $dataDir" -ForegroundColor Yellow
  }
} else {
  Write-Host "  data    : kept (pass -PurgeData to delete)" -ForegroundColor DarkGray
}

# The plugin folder is deliberately left alone. This script runs from inside it,
# and deleting the directory a running script lives in is a needless risk for no
# benefit: an orphaned folder is inert once the profile no longer references it.
Write-Host "  files   : plugin folder kept; delete it by hand if you want it gone:" -ForegroundColor DarkGray
Write-Host "            $PluginDir" -ForegroundColor DarkGray

Write-Host ""
Write-Host "Done. Restart DSH to apply." -ForegroundColor Green
Write-Host "To undo, restore $backup over package.json and run pnpm install again."
