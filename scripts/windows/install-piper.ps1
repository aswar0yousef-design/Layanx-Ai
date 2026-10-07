#Requires -Version 5.1
<#
  Installs a natural local voice for LayanX replies (Piper text-to-speech, Arabic + English).

    powershell -ExecutionPolicy Bypass -File scripts\windows\install-piper.ps1
    powershell -ExecutionPolicy Bypass -File scripts\windows\install-piper.ps1 -NoEnglish

  - Needs Python 3.10-3.13 (offers to install Python 3.12 with winget).
  - Installs piper-tts 1.8.0 (pinned) into its own virtual environment under %LOCALAPPDATA%\LayanX\piper.
  - Voices: ar_JO-kareem-medium (Arabic) and en_US-lessac-medium (English), ~60 MB each.
  - LayanX.cmd starts the voice server on 127.0.0.1:8179; the assistant uses it automatically.
  Piper is GPL-3.0: it runs as a separate program and is not part of LayanX's code. Text never leaves the PC.
#>
param([switch]$NoEnglish, [switch]$Yes)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$PiperVersion = '1.8.0'
$DataDir = if ($env:LAYANX_DATA_DIR) { $env:LAYANX_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'LayanX' }
$Dir = Join-Path $DataDir 'piper'
$Venv = Join-Path $Dir 'venv'
$Voices = Join-Path $Dir 'voices'
New-Item -ItemType Directory -Force -Path $Voices | Out-Null
function Say($m) { Write-Host "[LayanX] $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "[LayanX] $m" -ForegroundColor Red; if (-not $Yes) { Read-Host 'Press Enter to close' | Out-Null }; exit 1 }

. (Join-Path $PSScriptRoot 'python.ps1')
$python = Ensure-Python -Yes:$Yes
Say "Using Python $($python.Version)"

$vpy = Join-Path $Venv 'Scripts\python.exe'
if (-not (Test-Path $vpy)) {
  Say 'Creating the voice environment...'
  & $python.Cmd @($python.Args) -m venv $Venv
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $vpy)) { Fail 'Could not create the Python virtual environment.' }
}
Say "Installing piper-tts $PiperVersion (pinned)..."
& $vpy -m pip install --disable-pip-version-check --no-input "piper-tts[http]==$PiperVersion"
if ($LASTEXITCODE -ne 0) { Fail 'Installing piper-tts failed. Check the internet connection and the messages above.' }

$wanted = @('ar_JO-kareem-medium')
if (-not $NoEnglish) { $wanted += 'en_US-lessac-medium' }
Push-Location $Voices
try {
  foreach ($voice in $wanted) {
    if (Test-Path (Join-Path $Voices "$voice.onnx")) { Say "Voice $voice already installed"; continue }
    Say "Downloading voice $voice..."
    & $vpy -m piper.download_voices $voice
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $Voices "$voice.onnx"))) { Fail "Downloading the voice $voice failed." }
  }
} finally { Pop-Location }

Say "Done. Piper $PiperVersion with $($wanted -join ', ') is installed in $Dir"
Say 'Start LayanX again (LayanX.cmd). Replies in the assistant will use this voice.'
