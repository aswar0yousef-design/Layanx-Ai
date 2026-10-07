#Requires -Version 5.1
<#
  Installs local speech recognition for LayanX (whisper.cpp server).

    powershell -ExecutionPolicy Bypass -File scripts\windows\install-whisper.ps1
    powershell -ExecutionPolicy Bypass -File scripts\windows\install-whisper.ps1 -Model small

  - NVIDIA GPU found  -> CUDA build + large-v3-turbo (best Arabic/English accuracy, ~1 GB VRAM)
  - no NVIDIA GPU     -> CPU build + small (fast enough for short commands)
  Files go to %LOCALAPPDATA%\LayanX\whisper. LayanX.cmd starts the server automatically
  on 127.0.0.1:8178 and the assistant switches to it by itself. Audio never leaves the PC.
#>
param(
  [ValidateSet('auto', 'large-v3-turbo', 'medium', 'small', 'base')][string]$Model = 'auto',
  [switch]$Cpu
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$DataDir = if ($env:LAYANX_DATA_DIR) { $env:LAYANX_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'LayanX' }
$Dir = Join-Path $DataDir 'whisper'
$Models = Join-Path $Dir 'models'
New-Item -ItemType Directory -Force -Path $Models | Out-Null
function Say($m) { Write-Host "[LayanX] $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "[LayanX] $m" -ForegroundColor Red; Read-Host 'Press Enter to close' | Out-Null; exit 1 }

$hasNvidia = $false
if (-not $Cpu) { try { $null = & nvidia-smi --query-gpu=name --format=csv,noheader 2>$null; $hasNvidia = ($LASTEXITCODE -eq 0) } catch {} }
if ($Model -eq 'auto') { $Model = if ($hasNvidia) { 'large-v3-turbo' } else { 'small' } }
$modelFile = switch ($Model) {
  'large-v3-turbo' { 'ggml-large-v3-turbo-q5_0.bin' }
  'medium' { 'ggml-medium-q5_0.bin' }
  'small' { 'ggml-small-q5_1.bin' }
  'base' { 'ggml-base-q5_1.bin' }
}

# 1) whisper.cpp release (latest)
if (-not (Get-ChildItem -Path $Dir -Recurse -Filter 'whisper-server.exe' -ErrorAction SilentlyContinue)) {
  Say 'Looking up the latest whisper.cpp release...'
  try { $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest' -Headers @{ 'User-Agent' = 'LayanX' } }
  catch { Fail "Could not reach GitHub: $($_.Exception.Message)" }
  $pattern = if ($hasNvidia) { '^whisper-cublas-12.*-bin-x64\.zip$' } else { '^whisper-bin-x64\.zip$' }
  $asset = $release.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1
  if (-not $asset -and $hasNvidia) { Say 'No CUDA build in this release; using the CPU build.'; $asset = $release.assets | Where-Object { $_.name -match '^whisper-bin-x64\.zip$' } | Select-Object -First 1 }
  if (-not $asset) { Fail "No Windows build found in whisper.cpp $($release.tag_name). Download it manually from https://github.com/ggml-org/whisper.cpp/releases into $Dir" }
  $zip = Join-Path $env:TEMP $asset.name
  Say "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB)) MB)..."
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $Dir -Force
  Remove-Item $zip -ErrorAction SilentlyContinue
}
if (-not (Get-ChildItem -Path $Dir -Recurse -Filter 'whisper-server.exe' -ErrorAction SilentlyContinue)) { Fail 'whisper-server.exe was not found after extraction.' }

# 2) model
$target = Join-Path $Models $modelFile
if (-not (Test-Path $target)) {
  Say "Downloading the $Model speech model ($modelFile)..."
  Invoke-WebRequest -Uri "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$modelFile" -OutFile "$target.part" -UseBasicParsing
  Move-Item "$target.part" $target -Force
}
Get-ChildItem -Path $Models -Filter 'ggml-*.bin' | Where-Object { $_.Name -ne $modelFile } | ForEach-Object { Say "Other model kept: $($_.Name) (the largest model is used; delete it to switch)" }

Say "Done. Whisper ($Model, $(if ($hasNvidia) { 'GPU' } else { 'CPU' })) is installed in $Dir"
Say 'Start LayanX again (LayanX.cmd). The assistant page will show: speech recognition on this computer.'
Start-Sleep -Seconds 3
