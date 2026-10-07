#Requires -Version 5.1
<#
  Better Arabic speech recognition for LayanX: Cohere Transcribe Arabic (07-2026), on this computer.

    powershell -ExecutionPolicy Bypass -File scripts\windows\install-cohere-asr.ps1
    powershell -ExecutionPolicy Bypass -File scripts\windows\install-cohere-asr.ps1 -Device cuda

  - 2B parameters, Apache-2.0 open weights; strongest open model on Gulf and other Arabic dialects.
  - Hugging Face asks you to accept the model's terms once: open
    https://huggingface.co/CohereLabs/cohere-transcribe-arabic-07-2026 , sign in, accept, then create a
    read token at https://huggingface.co/settings/tokens . The script asks for the token; it is used for
    the download only and is not stored.
  - Downloads ~4.1 GB (model, pinned to commit c3e911b4) plus PyTorch (~0.3 GB CPU / ~2.5 GB CUDA).
  - -Device cpu (default): about 8 GB RAM, leaves the graphics card to Ollama.
    -Device cuda: about 4.5 GB of graphics memory in half precision (GTX 1660 Super and newer).
  LayanX.cmd starts it on 127.0.0.1:8181 and uses it instead of Whisper. Audio never leaves the PC.
#>
param([ValidateSet('cpu','cuda')][string]$Device = 'cpu', [switch]$Yes)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Repo = 'CohereLabs/cohere-transcribe-arabic-07-2026'
$Revision = 'c3e911b42149bf7a1e53d5cef9878aee87515a23'
$TorchVersion = '2.8.0'
$TransformersVersion = '5.4.0'
$DataDir = if ($env:LAYANX_DATA_DIR) { $env:LAYANX_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'LayanX' }
$Dir = Join-Path $DataDir 'cohere-asr'
$Venv = Join-Path $Dir 'venv'
$Model = Join-Path $Dir 'model'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
function Say($m) { Write-Host "[LayanX] $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "[LayanX] $m" -ForegroundColor Red; if (-not $Yes) { Read-Host 'Press Enter to close' | Out-Null }; exit 1 }

. (Join-Path $PSScriptRoot 'python.ps1')
$python = Ensure-Python -Yes:$Yes
$py = Join-Path $Venv 'Scripts\python.exe'
if (-not (Test-Path $py)) {
  Say "Creating the speech recognition environment (Python $($python.Version))..."
  & $python.Cmd @($python.Args) -m venv $Venv
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $py)) { Fail 'Could not create the Python virtual environment.' }
}
Say "Installing PyTorch $TorchVersion ($Device)..."
if ($Device -eq 'cuda') { & $py -m pip install --disable-pip-version-check --no-input "torch==$TorchVersion" --index-url https://download.pytorch.org/whl/cu126 }
else { & $py -m pip install --disable-pip-version-check --no-input "torch==$TorchVersion" }
if ($LASTEXITCODE -ne 0) { Fail 'Installing PyTorch failed. Check the internet connection and the messages above.' }
Say "Installing transformers $TransformersVersion..."
& $py -m pip install --disable-pip-version-check --no-input "transformers==$TransformersVersion" sentencepiece protobuf numpy
if ($LASTEXITCODE -ne 0) { Fail 'Installing transformers failed.' }

if (-not (Test-Path (Join-Path $Model 'model.safetensors'))) {
  $token = $env:HF_TOKEN
  if (-not $token) {
    Say "Accept the model terms at https://huggingface.co/$Repo , then paste a read token from https://huggingface.co/settings/tokens"
    $secure = Read-Host 'Hugging Face token' -AsSecureString
    $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  }
  if (-not $token) { Fail 'A Hugging Face token is needed to download the model.' }
  Say "Downloading $Repo at commit $($Revision.Substring(0,8)) (~4.1 GB)..."
  $env:LX_HF_TOKEN = $token
  & $py -c "import os,sys;from huggingface_hub import snapshot_download;snapshot_download(sys.argv[1],revision=sys.argv[2],local_dir=sys.argv[3],token=os.environ['LX_HF_TOKEN'],allow_patterns=['*.json','*.safetensors','*.model','*.py','*.txt'])" $Repo $Revision $Model
  $code = $LASTEXITCODE
  Remove-Item Env:\LX_HF_TOKEN -ErrorAction SilentlyContinue
  if ($code -ne 0) { Fail 'Download failed. Check that you accepted the model terms with the same Hugging Face account as the token.' }
}
# Record what was installed; the hash lets LayanX notice a replaced model file.
$hash = (Get-FileHash -Algorithm SHA256 (Join-Path $Model 'model.safetensors')).Hash.ToLower()
@{ repo = $Repo; revision = $Revision; device = $Device; modelSha256 = $hash; python = $py } | ConvertTo-Json | Set-Content -Path (Join-Path $Dir 'install.json') -Encoding ASCII
Say "Done. Cohere Transcribe Arabic is installed in $Dir (device: $Device)."
Say 'Start LayanX again (LayanX.cmd). Speech recognition will use it instead of Whisper.'
