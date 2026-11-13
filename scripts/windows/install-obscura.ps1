#Requires -Version 5.1
<#
  Installs Obscura, a light headless browser engine, beside LayanX's Chromium/Playwright.

    powershell -ExecutionPolicy Bypass -File scripts\windows\install-obscura.ps1

  - Pinned release v0.2.6 (commit 8534b40), standard build obscura-x86_64-windows.zip, SHA-256 checked.
  - The "-stealth" builds are never installed: they fake the browser's fingerprint to get past sites' bot
    protection, which LayanX does not do.
  - Files go to %LOCALAPPDATA%\LayanX\obscura. LayanX finds obscura.exe there by itself (or set LAYANX_OBSCURA_PATH).
  Obscura is Apache-2.0 and runs as a separate program.
#>
param([switch]$Yes)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Version = 'v0.2.6'
$Asset = 'obscura-x86_64-windows.zip'
$Sha256 = '0a110d0693753a252ed7ffd61e682363e8622caf79697f564c529099a31a6242'
$DataDir = if ($env:LAYANX_DATA_DIR) { $env:LAYANX_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'LayanX' }
$Dir = Join-Path $DataDir 'obscura'
function Say($m) { Write-Host "[LayanX] $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "[LayanX] $m" -ForegroundColor Red; if (-not $Yes) { Read-Host 'Press Enter to close' | Out-Null }; exit 1 }

if (Get-ChildItem -Path $Dir -Recurse -Filter 'obscura.exe' -ErrorAction SilentlyContinue) { Say "Obscura is already installed in $Dir"; exit 0 }
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$zip = Join-Path $env:TEMP $Asset
Say "Downloading Obscura $Version ($Asset)..."
try { Invoke-WebRequest -Uri "https://github.com/h4ckf0r0day/obscura/releases/download/$Version/$Asset" -OutFile $zip -UseBasicParsing }
catch { Fail "Could not download Obscura: $($_.Exception.Message)" }
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($hash -ne $Sha256) { Remove-Item $zip -Force -ErrorAction SilentlyContinue; Fail "SHA-256 mismatch for $Asset (got $hash). The file was deleted and nothing was installed." }
Say 'SHA-256 verified.'
Expand-Archive -Path $zip -DestinationPath $Dir -Force
Remove-Item $zip -ErrorAction SilentlyContinue
$exe = Get-ChildItem -Path $Dir -Recurse -Filter 'obscura.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { Fail 'obscura.exe was not found after extraction.' }
Say "Done. Obscura $Version is installed: $($exe.FullName)"
Say 'Restart LayanX. Page reading uses Obscura first and falls back to Chromium when a page needs it.'
