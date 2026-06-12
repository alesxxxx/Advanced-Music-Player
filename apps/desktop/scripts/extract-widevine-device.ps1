#requires -Version 5.1
<#
.SYNOPSIS
  Extracts Widevine L3 device files (private_key + client_id_blob) from a .wvd
  or raw Chrome CDM and installs them into AMP's device directory.

.DESCRIPTION
  This script automates the device-file setup required by the @spdl/widevine
  node-widevine probe. It will:
    1. Resolve the AMP userData path.
    2. Search common locations for a .wvd file.
    3. If found, use Python/pywidevine to extract raw private_key and client_id_blob bytes.
    4. Write them to userData/widevine/ so the node-widevine probe can run.

  If no .wvd is found, it prints instructions for manual placement.

.EXAMPLE
  .\scripts\extract-widevine-device.ps1
  .\scripts\extract-widevine-device.ps1 -WvdPath "C:\Users\hunnid\Downloads\my_device.wvd"
#>
[CmdletBinding()]
param(
    [string]$WvdPath,
    [string]$OutputDir
)

$ErrorActionPreference = "Stop"

function Get-AmpUserDataPath {
    # Electron's app.getPath('userData') for AMP on Windows. The legacy MuSync/@spot-cloud paths
    # remain as fallbacks for profiles that predate the renames and weren't migrated.
    $candidates = @(
        "$env:APPDATA\AMP"
        "$env:APPDATA\MuSync"
        "$env:APPDATA\@spot-cloud\desktop"
        "$env:APPDATA\Spot-Cloud"
        "$env:APPDATA\spot-cloud"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    # Default to the most likely path even if it doesn't exist yet
    return "$env:APPDATA\AMP"
}

function Find-WvdFile {
    param([string]$ExplicitPath)
    if ($ExplicitPath -and (Test-Path $ExplicitPath)) {
        return (Resolve-Path $ExplicitPath).Path
    }

    $searchPaths = @(
        "$env:USERPROFILE\Downloads"
        "$env:USERPROFILE\Documents"
        "$env:USERPROFILE\Desktop"
        "$env:USERPROFILE\widevine"
        "$env:USERPROFILE\.widevine"
        "$env:LOCALAPPDATA\widevine"
    )

    foreach ($dir in $searchPaths) {
        if (-not (Test-Path $dir)) { continue }
        $found = Get-ChildItem -Path $dir -Filter "*.wvd" -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

function Test-Pywidevine {
    try {
        $null = py -c "import pywidevine; print(pywidevine.__version__)" 2>$null
        return $true
    } catch {
        try {
            $null = python -c "import pywidevine; print(pywidevine.__version__)" 2>$null
            return $true
        } catch {
            return $false
        }
    }
}

function Extract-DeviceFromWvd {
    param(
        [string]$Wvd,
        [string]$OutDir
    )

    $pyScript = @"
import sys, os

try:
    from pywidevine.device import Device
except ImportError as e:
    print(f"PYWIDEVINE_MISSING:{e}")
    sys.exit(1)

wvd_path = sys.argv[1]
out_dir = sys.argv[2]

try:
    device = Device.load(wvd_path)
    os.makedirs(out_dir, exist_ok=True)

    pk_path = os.path.join(out_dir, "device_private_key")
    blob_path = os.path.join(out_dir, "device_client_id_blob")

    with open(pk_path, "wb") as f:
        f.write(device.private_key)

    with open(blob_path, "wb") as f:
        f.write(device.client_id)

    print(f"EXTRACTED:{pk_path}:{blob_path}")
except Exception as e:
    print(f"ERROR:{e}")
    sys.exit(1)
"@

    $tmpPy = [System.IO.Path]::GetTempFileName() + ".py"
    [System.IO.File]::WriteAllText($tmpPy, $pyScript, (New-Object System.Text.UTF8Encoding $false))

    try {
        $result = & py $tmpPy $Wvd $OutDir 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Python extraction failed: $result"
        }
        $line = $result | Select-Object -Last 1
        if ($line -match "^EXTRACTED:(.+):(.+)$") {
            return @{ PrivateKey = $Matches[1]; ClientIdBlob = $Matches[2] }
        }
        if ($line -match "^PYWIDEVINE_MISSING") {
            throw "pywidevine is not installed. Run: pip install pywidevine"
        }
        throw "Unexpected Python output: $line"
    } finally {
        Remove-Item $tmpPy -ErrorAction SilentlyContinue
    }
}

# ── Main ────────────────────────────────────────────────────────────────────

$userData = Get-AmpUserDataPath
if (-not $OutputDir) {
    $OutputDir = "$userData\widevine"
}

Write-Host ""
Write-Host "AMP Widevine Device Extractor" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Target directory : $OutputDir"
Write-Host ""

# 1. Ensure output dir exists
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

# 2. Check if files already exist
$pkExists = Test-Path "$OutputDir\device_private_key"
$blobExists = Test-Path "$OutputDir\device_client_id_blob"
if ($pkExists -and $blobExists) {
    Write-Host "Device files already exist:" -ForegroundColor Green
    Write-Host "  $OutputDir\device_private_key"
    Write-Host "  $OutputDir\device_client_id_blob"
    Write-Host ""
    Write-Host "The node-widevine probe is ready to run. Play a DRM track in AMP to test." -ForegroundColor Green
    exit 0
}

# 3. Find .wvd
$wvd = Find-WvdFile -ExplicitPath $WvdPath
if (-not $wvd) {
    Write-Host "No .wvd file found automatically." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Searched these locations:" -ForegroundColor DarkGray
    Write-Host "  $env:USERPROFILE\Downloads"
    Write-Host "  $env:USERPROFILE\Documents"
    Write-Host "  $env:USERPROFILE\Desktop"
    Write-Host "  $env:USERPROFILE\widevine"
    Write-Host "  $env:USERPROFILE\.widevine"
    Write-Host "  $env:LOCALAPPDATA\widevine"
    Write-Host ""
    Write-Host "If you have a .wvd file elsewhere, re-run with the path:" -ForegroundColor Yellow
    Write-Host "  .\scripts\extract-widevine-device.ps1 -WvdPath `"C:\path\to\device.wvd`"" -ForegroundColor White
    Write-Host ""
    Write-Host "Manual fallback:" -ForegroundColor Yellow
    Write-Host "  1. Place your raw device files (or extract from .wvd) into:" -ForegroundColor White
    Write-Host "     $OutputDir"
    Write-Host "  2. Name them exactly: device_private_key  and  device_client_id_blob"
    exit 1
}

Write-Host "Found .wvd file: $wvd" -ForegroundColor Green
Write-Host ""

# 4. Check pywidevine
if (-not (Test-Pywidevine)) {
    Write-Host "Python + pywidevine are required but not detected." -ForegroundColor Red
    Write-Host "Install with:  pip install pywidevine  (or  py -m pip install pywidevine)" -ForegroundColor Yellow
    exit 1
}

Write-Host "Extracting device files with pywidevine…" -ForegroundColor Cyan
$extracted = Extract-DeviceFromWvd -Wvd $wvd -OutDir $OutputDir

Write-Host ""
Write-Host "Success! Files written:" -ForegroundColor Green
Write-Host "  $($extracted.PrivateKey)"
Write-Host "  $($extracted.ClientIdBlob)"
Write-Host ""
Write-Host "The node-widevine probe is now ready. Restart AMP (corepack pnpm dev) and play a DRM track." -ForegroundColor Green
