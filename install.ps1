# dsh-card-updater: attach the plugin to a DSH profile.
#
# Adds the plugin to the profile's dependencies (as a local link, so the source
# stays live) and to its bundle list, then reinstalls the profile. The profile
# package.json is backed up first. Nothing outside the chosen profile changes.
#
# Run it from this folder:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Profile web
#
# `powershell` rather than `pwsh`: Windows ships Windows PowerShell 5.1 and many
# machines have no PowerShell 7. This script runs on either.
#
# After this, restart DSH. The plugin appears as a sidebar-foot entry and under
# Settings -> Card Updater.

[CmdletBinding()]
param(
  [string]$Profile = 'tavern'
)

$ErrorActionPreference = 'Stop'
$PluginId = 'dsh-card-updater'
$PluginDir = (Resolve-Path $PSScriptRoot).Path
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$ProfileDir = Join-Path $DshHome "profiles\$Profile"
$ProfilePkg = Join-Path $ProfileDir 'package.json'

Write-Host "dsh-card-updater install" -ForegroundColor Cyan
Write-Host "  plugin  : $PluginDir"
Write-Host "  profile : $Profile"

if (-not (Test-Path $ProfilePkg)) {
  throw "profile package.json not found: $ProfilePkg"
}
if (-not (Test-Path (Join-Path $PluginDir 'package.json'))) {
  throw "this folder does not look like a plugin package: $PluginDir"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$ProfilePkg.pre-card-updater-$stamp"
Copy-Item $ProfilePkg $backup
Write-Host "  backup  : $backup" -ForegroundColor DarkGray

# The link target is written with forward slashes: Node resolves either, and a
# literal backslash in a JSON dependency spec is ambiguous.
$linkTarget = 'link:' + ($PluginDir -replace '\\', '/')

$node = @'
const fs = require('fs')
const [file, id, target] = process.argv.slice(2)
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
'@

$tmp = Join-Path $env:TEMP "dcu-install-$stamp.cjs"
Set-Content -Path $tmp -Value $node -Encoding UTF8
try {
  node $tmp $ProfilePkg $PluginId $linkTarget
} finally {
  Remove-Item $tmp -ErrorAction SilentlyContinue
}

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

Write-Host ""
Write-Host "Done. Restart DSH to apply." -ForegroundColor Green
Write-Host "To undo, run uninstall.ps1 (or restore $backup and run pnpm install)."
