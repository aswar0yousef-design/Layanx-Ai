#Requires -Version 5.1
<#
  Speech detection and end-of-turn detection for the LayanX assistant, on this computer.

    powershell -ExecutionPolicy Bypass -File scripts\windows\install-voice-sense.ps1

  - Silero VAD v6.2 (MIT): Whisper only receives clips that contain speech (no words "heard" in noise).
  - Smart Turn v3.2 CPU (BSD-2, 23 languages incl. Arabic): LayanX answers as soon as you finish a
    sentence and keeps listening while you pause mid-sentence.
  - Models (~11 MB) are downloaded from pinned commits and checked against SHA-256 before use.
  - Uses the Piper voice environment when present (it already has onnxruntime), otherwise its own
    Python environment with pinned onnxruntime and numpy.
  LayanX.cmd starts it on 127.0.0.1:8180; the assistant uses it automatically. Audio never leaves the PC.
#>
param([switch]$Yes)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$DataDir = if ($env:LAYANX_DATA_DIR) { $env:LAYANX_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'LayanX' }
$Dir = Join-Path $DataDir 'voice-sense'
$Models = Join-Path $Dir 'models'
New-Item -ItemType Directory -Force -Path $Models | Out-Null
function Say($m) { Write-Host "[LayanX] $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "[LayanX] $m" -ForegroundColor Red; if (-not $Yes) { Read-Host 'Press Enter to close' | Out-Null }; exit 1 }

$Pinned = @(
  @{ Name = 'silero_vad.onnx'; Sha256 = '1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3';
     Url = 'https://raw.githubusercontent.com/snakers4/silero-vad/v6.2.3/src/silero_vad/data/silero_vad.onnx' },
  @{ Name = 'smart-turn-v3.2-cpu.onnx'; Sha256 = '2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f';
     Url = 'https://raw.githubusercontent.com/pipecat-ai/pipecat/cc51c069bafa1f34ce65b1c6c7fb34289a6b0199/src/pipecat/audio/turn/smart_turn/data/smart-turn-v3.2-cpu.onnx' }
)

# Python: the Piper environment if it can load onnxruntime, otherwise a dedicated one.
$py = $null
$piperPy = Join-Path $DataDir 'piper\venv\Scripts\python.exe'
if (Test-Path $piperPy) {
  & $piperPy -c "import onnxruntime, numpy" 2>$null
  if ($LASTEXITCODE -eq 0) { $py = $piperPy; Say 'Using the Piper voice environment (onnxruntime already installed).' }
}
if (-not $py) {
  . (Join-Path $PSScriptRoot 'python.ps1')
  $python = Ensure-Python -Yes:$Yes
  $venv = Join-Path $Dir 'venv'
  $py = Join-Path $venv 'Scripts\python.exe'
  if (-not (Test-Path $py)) {
    Say "Creating the voice sense environment (Python $($python.Version))..."
    & $python.Cmd @($python.Args) -m venv $venv
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $py)) { Fail 'Could not create the Python virtual environment.' }
  }
  Say 'Installing onnxruntime 1.22.1 and numpy 2.2.6 (pinned)...'
  & $py -m pip install --disable-pip-version-check --no-input 'onnxruntime==1.22.1' 'numpy==2.2.6'
  if ($LASTEXITCODE -ne 0) { Fail 'Installing onnxruntime failed. Check the internet connection and the messages above.' }
}

foreach ($m in $Pinned) {
  $target = Join-Path $Models $m.Name
  if ((Test-Path $target) -and ((Get-FileHash -Algorithm SHA256 $target).Hash.ToLower() -eq $m.Sha256)) { Say "$($m.Name) already installed"; continue }
  Say "Downloading $($m.Name)..."
  $tmp = "$target.download"
  Invoke-WebRequest -UseBasicParsing -Uri $m.Url -OutFile $tmp
  $actual = (Get-FileHash -Algorithm SHA256 $tmp).Hash.ToLower()
  if ($actual -ne $m.Sha256) { Remove-Item $tmp -Force; Fail "SHA-256 mismatch for $($m.Name): expected $($m.Sha256), got $actual. The file was deleted." }
  Move-Item -Force $tmp $target
  Say "$($m.Name): SHA-256 verified"
}
Set-Content -Path (Join-Path $Dir 'python.txt') -Value $py -Encoding ASCII
Say "Done. Voice sense is installed in $Dir"
Say 'Start LayanX again (LayanX.cmd). The assistant uses it automatically.'
