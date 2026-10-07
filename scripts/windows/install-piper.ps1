#Requires -Version 5.1
<#
  Installs a natural local voice for LayanX replies (Piper text-to-speech, Arabic + English).

    powershell -ExecutionPolicy Bypass -File scripts\windows\install-piper.ps1
    powershell -ExecutionPolicy Bypass -File scripts\windows\install-piper.ps1 -NoEnglish

  - Needs Python 3.9-3.13 (offers to install Python 3.12 with winget).
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

function Test-Python($cmd, $extra) {
  try {
    $v = & $cmd @extra -c "import sys;print('%d.%d' % sys.version_info[:2])" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $v) { return $null }
    $parts = "$v".Trim().Split('.')
    $major = [int]$parts[0]; $minor = [int]$parts[1]
    if ($major -eq 3 -and $minor -ge 9 -and $minor -le 13) { return @{ Cmd = $cmd; Args = $extra; Version = "$v".Trim() } }
  } catch {}
  return $null
}
function Find-Python {
  foreach ($candidate in @(@('py', @('-3.12')), @('py', @('-3.11')), @('py', @('-3.13')), @('py', @('-3.10')), @('python', @()), @('python3', @()))) {
    if (Get-Command $candidate[0] -ErrorAction SilentlyContinue) {
      $found = Test-Python $candidate[0] $candidate[1]
      if ($found) { return $found }
    }
  }
  return $null
}

$python = Find-Python
if (-not $python) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $answer = if ($Yes) { 'y' } else { Read-Host 'Python 3.12 is needed for the local voice. Install it now with winget? (y/n)' }
    if ($answer -match '^(y|yes|نعم|ن)$') {
      winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
      $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
      $python = Find-Python
    }
  }
  if (-not $python) { Fail 'Install Python 3.12 from https://www.python.org/downloads/ (tick "Add to PATH"), then run this script again.' }
}
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
