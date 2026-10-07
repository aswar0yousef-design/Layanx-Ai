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

# 1) whisper.cpp, pinned build b5130, SHA-256 checked. "Latest" is never installed: since v1.9.x the
#    version tags carry only source code (Windows builds are published under bNNNN tags), and an
#    unverified "latest" download is exactly how hijacked releases spread (Trivy/LiteLLM, March 2026).
$Build = 'b5130'
$Assets = @{
  'whisper-bin-x64.zip'               = 'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c'
  'whisper-cublas-12.4.0-bin-x64.zip' = 'af520ddd034d985b55dfeea3e465ed93653ba2aee1a55e865033edc548c272a7'
}
if (-not (Get-ChildItem -Path $Dir -Recurse -Filter 'whisper-server.exe' -ErrorAction SilentlyContinue)) {
  $name = if ($hasNvidia) { 'whisper-cublas-12.4.0-bin-x64.zip' } else { 'whisper-bin-x64.zip' }
  $zip = Join-Path $env:TEMP $name
  Say "Downloading whisper.cpp $Build ($name)..."
  try { Invoke-WebRequest -Uri "https://github.com/ggml-org/whisper.cpp/releases/download/$Build/$name" -OutFile $zip -UseBasicParsing }
  catch { Fail "Could not download whisper.cpp: $($_.Exception.Message)" }
  $hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if ($hash -ne $Assets[$name]) { Remove-Item $zip -Force -ErrorAction SilentlyContinue; Fail "SHA-256 mismatch for $name (got $hash). The file was deleted and nothing was installed." }
  Say 'SHA-256 verified.'
  Expand-Archive -Path $zip -DestinationPath $Dir -Force
  Remove-Item $zip -ErrorAction SilentlyContinue
}
if (-not (Get-ChildItem -Path $Dir -Recurse -Filter 'whisper-server.exe' -ErrorAction SilentlyContinue)) { Fail 'whisper-server.exe was not found after extraction.' }

# 2) model
# SHA-1 values published in whisper.cpp's model table (models/README.md and the Hugging Face page).
$ModelSha1 = @{
  'ggml-large-v3-turbo-q5_0.bin' = 'e050f7970618a659205450ad97eb95a18d69c9ee'
  'ggml-medium-q5_0.bin'         = '7718d4c1ec62ca96998f058114db98236937490e'
  'ggml-small-q5_1.bin'          = '6fe57ddcfdd1c6b07cdcc73aaf620810ce5fc771'
  'ggml-base-q5_1.bin'           = 'a3733eda680ef76256db5fc5dd9de8629e62c5e7'
}
$target = Join-Path $Models $modelFile
if (-not (Test-Path $target)) {
  Say "Downloading the $Model speech model ($modelFile)..."
  Invoke-WebRequest -Uri "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$modelFile" -OutFile "$target.part" -UseBasicParsing
  $sha1 = (Get-FileHash "$target.part" -Algorithm SHA1).Hash.ToLower()
  if ($sha1 -ne $ModelSha1[$modelFile]) { Remove-Item "$target.part" -Force -ErrorAction SilentlyContinue; Fail "Checksum mismatch for $modelFile (got $sha1). The file was deleted." }
  Move-Item "$target.part" $target -Force
}
Get-ChildItem -Path $Models -Filter 'ggml-*.bin' | Where-Object { $_.Name -ne $modelFile } | ForEach-Object { Say "Other model kept: $($_.Name) (the largest model is used; delete it to switch)" }

Say "Done. Whisper ($Model, $(if ($hasNvidia) { 'GPU' } else { 'CPU' })) is installed in $Dir"
Say 'Start LayanX again (LayanX.cmd). The assistant page will show: speech recognition on this computer.'
Start-Sleep -Seconds 3
