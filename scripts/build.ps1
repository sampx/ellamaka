<#
.SYNOPSIS
  ellamaka build script for Windows
  build.ps1 desktop [-Channel main|beta|prod] [-Install] [-Help]
#>

param(
    [Parameter(Position = 0)]
    [string]$Target,

    [Parameter()]
    [ValidateSet("main", "beta", "prod")]
    [string]$Channel = "main",

    [Parameter()]
    [switch]$Install,

    [Parameter()]
    [switch]$Help
)

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$PROJECT_ROOT = Split-Path -Parent $SCRIPT_DIR

function Show-Help {
    @"
Usage: build.ps1 <target> [options]

Targets:
  desktop    Build Desktop app

Desktop options:
  -Channel <main|beta|prod>
             Channel (default: main). Controls bundle ID, app name, icons.
  -Install   Run the installer after build
"@
    exit 0
}

if ($Help -or !$Target -or $Target -eq "help") {
    Show-Help
}

if ($Target -ne "desktop") {
    Write-Host "ERROR: Unknown target: $Target"
    Write-Host "Usage: build.ps1 desktop [options]"
    exit 1
}

# ── Desktop build ──────────────────────────────────────────

$env:OPENCODE_CHANNEL = $Channel

# Build hash — same as CI's github.sha but for local HEAD
if (!$env:OPENCODE_BUILD_ID) {
    $hash = git -C $PROJECT_ROOT rev-parse HEAD 2>$null
    if ($hash) {
        $env:OPENCODE_BUILD_ID = $hash.Trim()
    }
}

# Use the already-installed electron from node_modules instead of re-downloading
$electronDist = Join-Path $PROJECT_ROOT "node_modules" "electron" "dist"
if (Test-Path $electronDist -PathType Container) {
    $env:ELECTRON_DIST = $electronDist
}

$APP_NAME = switch ($Channel) {
    "main" { "Ellamaka Main" }
    "beta" { "Ellamaka Beta" }
    "prod" { "Ellamaka" }
}

$buildLabel = if ($env:OPENCODE_BUILD_ID) {
    $env:OPENCODE_BUILD_ID.Substring(0, [Math]::Min(12, $env:OPENCODE_BUILD_ID.Length))
} else {
    "none"
}

Write-Host ""
Write-Host "Building Desktop (channel: $Channel, app: $APP_NAME, build: $buildLabel)..."

$DESKTOP_DIR = Join-Path $PROJECT_ROOT "packages" "ellamaka-desktop"

Push-Location $DESKTOP_DIR
try {
    bun run build
    if ($LASTEXITCODE -ne 0) { throw "bun run build failed" }

    bun run package:win
    if ($LASTEXITCODE -ne 0) { throw "bun run package:win failed" }
}
finally {
    Pop-Location
}

$distDir = Join-Path $DESKTOP_DIR "dist"
$exe = Get-ChildItem -Path $distDir -Filter "ellamaka-desktop-win-*.exe" -Recurse -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (!$exe) {
    Write-Host "ERROR: .exe installer not found in dist/"
    exit 1
}

Write-Host "Desktop packaged: $($exe.FullName)"

if ($Install) {
    Write-Host ""
    Write-Host "Running installer..."
    Start-Process -FilePath $exe.FullName -Wait
    Write-Host "Installation complete"
}