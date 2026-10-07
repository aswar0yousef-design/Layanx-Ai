#Requires -Version 5.1
<#
  LayanX one-click launcher for Windows 10/11.

  Double-click LayanX.cmd (or the LayanX desktop shortcut). On first run it:
    1. checks Node.js 22+ (offers winget install if missing)
    2. installs npm dependencies (again only when package-lock.json changes)
    3. checks Ollama, starts it if needed, offers a starter model sized to your RAM
    4. starts LayanX hidden in the background and opens the control page
    5. creates a desktop shortcut

  Console messages are in English on purpose: the classic Windows console does
  not shape Arabic text correctly. The control page in the browser is Arabic.
#>
param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$DataDir = if ($env:LAYANX_DATA_DIR) { $env:LAYANX_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'LayanX' }
New-Item -ItemType Directory -Force -Path (Join-Path $DataDir 'logs') | Out-Null
$LogFile = Join-Path $DataDir 'logs\layanx.log'

$Port = 3000
if ($env:LAYANX_PUBLIC_PORT) { $Port = [int]$env:LAYANX_PUBLIC_PORT }
else {
  $settingsFile = Join-Path $DataDir 'settings.json'
  if (Test-Path $settingsFile) {
    try { $s = Get-Content $settingsFile -Raw | ConvertFrom-Json; if ($s.publicPort) { $Port = [int]$s.publicPort } } catch {}
  }
}
$Base = "http://127.0.0.1:$Port"
$OllamaUrl = 'http://127.0.0.1:11434'
if ($env:OLLAMA_BASE_URL) { $OllamaUrl = $env:OLLAMA_BASE_URL.TrimEnd('/') }

function Say($m)  { Write-Host "[LayanX] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[LayanX] $m" -ForegroundColor Yellow }
function Fail($m) {
  Write-Host "[LayanX] $m" -ForegroundColor Red
  Write-Host ''
  Read-Host 'Press Enter to close' | Out-Null
  exit 1
}
function Ask($q) { $a = Read-Host "$q [Y/n]"; return ($a -eq '' -or $a -match '^(y|yes)$') }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Test-Url($url) {
  try { Invoke-RestMethod -Uri $url -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}
function Test-Gateway {
  try { $r = Invoke-RestMethod -Uri "$Base/v1/gateway/health" -TimeoutSec 2; return ($r.app -eq 'layanx-gateway') } catch { return $false }
}
function Test-PortInUse($p) {
  $client = New-Object Net.Sockets.TcpClient
  try { $client.Connect('127.0.0.1', $p); return $true } catch { return $false } finally { $client.Close() }
}

# ---------------------------------------------------------------- Node.js
function Find-Node {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $p = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (Test-Path $p) { return $p }
  return $null
}
$Node = Find-Node
if (-not $Node) {
  if ((Get-Command winget -ErrorAction SilentlyContinue) -and (Ask 'Node.js is required but not installed. Install Node.js LTS now with winget?')) {
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    Refresh-Path
    $Node = Find-Node
  }
  if (-not $Node) { Fail 'Install Node.js 22 LTS or newer from https://nodejs.org, then run LayanX again.' }
}
$major = [int](& $Node -p "process.versions.node.split('.')[0]")
if ($major -lt 22) { Fail "Node.js $major is too old. LayanX needs Node.js 22 or newer (https://nodejs.org)." }
$NodeDir = Split-Path $Node -Parent
$env:Path = "$NodeDir;$env:Path"
$Npm = Join-Path $NodeDir 'npm.cmd'

# ---------------------------------------------------------------- Ollama
function Find-Ollama {
  $c = Get-Command ollama -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $p = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
  if (Test-Path $p) { return $p }
  return $null
}
function Ensure-Ollama {
  $exe = Find-Ollama
  if (-not (Test-Url "$OllamaUrl/api/version")) {
    if (-not $exe -and (Get-Command winget -ErrorAction SilentlyContinue)) {
      if (Ask 'Ollama (runs AI models on this PC) is not installed. Install it now with winget?') {
        winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements
        Refresh-Path
        $exe = Find-Ollama
      }
    }
    if ($exe -and -not (Test-Url "$OllamaUrl/api/version")) {
      Say 'Starting Ollama...'
      # Faster and smaller on small GPUs (e.g. 6 GB): flash attention + 8-bit KV cache.
      if (-not $env:OLLAMA_FLASH_ATTENTION) { $env:OLLAMA_FLASH_ATTENTION = '1' }
      if (-not $env:OLLAMA_KV_CACHE_TYPE) { $env:OLLAMA_KV_CACHE_TYPE = 'q8_0' }
      Start-Process -FilePath $exe -ArgumentList 'serve' -WindowStyle Hidden
      for ($i = 0; $i -lt 40 -and -not (Test-Url "$OllamaUrl/api/version"); $i++) { Start-Sleep -Milliseconds 500 }
    }
  }
  if (-not (Test-Url "$OllamaUrl/api/version")) {
    Warn 'Ollama is not running. LayanX will start anyway; cloud models you configure will still work.'
    return
  }
  $tags = Invoke-RestMethod -Uri "$OllamaUrl/api/tags" -TimeoutSec 5
  if (-not $tags.models -or @($tags.models).Count -eq 0) {
    $ramGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
    if ($ramGB -lt 12) { $model = 'qwen3.5:4b'; $size = '3.3 GB' }
    else { $model = 'qwen3.5:9b'; $size = '6.6 GB' }
    if ($exe -and (Ask "No local model is installed. Download $model ($size, suits $ramGB GB RAM)?")) {
      & $exe pull $model
      if ($LASTEXITCODE -ne 0) { Warn "Download failed. Later, run: ollama pull $model" }
    } else {
      Warn "No model installed. Later, run: ollama pull $model"
    }
  }
}

# ---------------------------------------------------------------- Whisper (local speech-to-text, optional)
function Ensure-Whisper {
  $dir = Join-Path $DataDir 'whisper'
  if (-not (Test-Path $dir)) { return }
  if (Test-CohereAsr) { return }  # Cohere Transcribe Arabic replaces Whisper (LAYANX_STT_ENGINE=whisper keeps Whisper)
  $port = 8178
  if ($env:LAYANX_STT_PORT) { $port = [int]$env:LAYANX_STT_PORT }
  if (Test-PortInUse $port) { return }
  $server = Get-ChildItem -Path $dir -Recurse -Filter 'whisper-server.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  $model = Get-ChildItem -Path (Join-Path $dir 'models') -Filter 'ggml-*.bin' -ErrorAction SilentlyContinue | Sort-Object Length -Descending | Select-Object -First 1
  if (-not $server -or -not $model) { Warn 'Whisper folder found but whisper-server.exe or a ggml model is missing. Run scripts\windows\install-whisper.ps1'; return }
  Say "Starting local speech recognition (Whisper: $($model.Name))..."
  $threads = [Math]::Max(2, [Environment]::ProcessorCount / 2)
  Start-Process -FilePath $server.FullName -WorkingDirectory $server.DirectoryName -WindowStyle Hidden -ArgumentList @('-m', "`"$($model.FullName)`"", '--host', '127.0.0.1', '--port', "$port", '--inference-path', '/v1/audio/transcriptions', '-t', "$threads")
  for ($i = 0; $i -lt 30 -and -not (Test-PortInUse $port); $i++) { Start-Sleep -Milliseconds 500 }
}

# ---------------------------------------------------------------- Cohere Transcribe Arabic (optional, replaces Whisper)
function Test-CohereAsr { return (Test-Path (Join-Path $DataDir 'cohere-asr\install.json')) -and ($env:LAYANX_STT_ENGINE -ne 'whisper') }
function Ensure-CohereAsr {
  if (-not (Test-CohereAsr)) { return }
  $dir = Join-Path $DataDir 'cohere-asr'
  $info = Get-Content (Join-Path $dir 'install.json') -Raw | ConvertFrom-Json
  if (-not (Test-Path $info.python)) { Warn 'Cohere speech recognition needs reinstalling: run scripts\windows\install-cohere-asr.ps1'; return }
  $port = 8181
  if ($env:LAYANX_COHERE_PORT) { $port = [int]$env:LAYANX_COHERE_PORT }
  if (Test-PortInUse $port) { return }
  Say "Starting Arabic speech recognition (Cohere Transcribe Arabic, $($info.device))..."
  $server = Join-Path $Root 'scripts\voice-sense\cohere_asr_server.py'
  Start-Process -FilePath $info.python -WorkingDirectory $dir -WindowStyle Hidden -ArgumentList @("`"$server`"", '--model', "`"$(Join-Path $dir 'model')`"", '--port', "$port", '--device', $info.device)
  # The port opens at once; the 2B model keeps loading in the background (about a minute on the CPU).
  for ($i = 0; $i -lt 40 -and -not (Test-PortInUse $port); $i++) { Start-Sleep -Milliseconds 500 }
}

# ---------------------------------------------------------------- Piper (local Arabic voice, optional)
function Ensure-Piper {
  $dir = Join-Path $DataDir 'piper'
  $vpy = Join-Path $dir 'venv\Scripts\python.exe'
  if (-not (Test-Path $vpy)) { return }
  $port = 8179
  if ($env:LAYANX_TTS_PORT) { $port = [int]$env:LAYANX_TTS_PORT }
  if (Test-PortInUse $port) { return }
  $voices = Join-Path $dir 'voices'
  $model = if (Test-Path (Join-Path $voices 'ar_JO-kareem-medium.onnx')) { 'ar_JO-kareem-medium' } else { (Get-ChildItem -Path $voices -Filter '*.onnx' -ErrorAction SilentlyContinue | Select-Object -First 1).BaseName }
  if (-not $model) { Warn 'Piper is installed but no voice was found. Run scripts\windows\install-piper.ps1'; return }
  Say "Starting the local voice (Piper: $model)..."
  Start-Process -FilePath $vpy -WorkingDirectory $voices -WindowStyle Hidden -ArgumentList @('-m', 'piper.http_server', '-m', $model, '--data-dir', "`"$voices`"", '--host', '127.0.0.1', '--port', "$port")
  for ($i = 0; $i -lt 40 -and -not (Test-PortInUse $port); $i++) { Start-Sleep -Milliseconds 500 }
}

function Ensure-VoiceSense {
  $dir = Join-Path $DataDir 'voice-sense'
  $pyFile = Join-Path $dir 'python.txt'
  if (-not (Test-Path $pyFile)) { return }
  $py = (Get-Content $pyFile -Raw).Trim()
  if (-not (Test-Path $py)) { Warn 'Voice sense needs reinstalling: run scripts\windows\install-voice-sense.ps1'; return }
  $port = 8180
  if ($env:LAYANX_VOICE_SENSE_PORT) { $port = [int]$env:LAYANX_VOICE_SENSE_PORT }
  if (Test-PortInUse $port) { return }
  Say 'Starting speech and end-of-turn detection (Silero VAD + Smart Turn)...'
  $server = Join-Path $Root 'scripts\voice-sense\server.py'
  Start-Process -FilePath $py -WorkingDirectory $dir -WindowStyle Hidden -ArgumentList @("`"$server`"", '--models', "`"$(Join-Path $dir 'models')`"", '--port', "$port")
  for ($i = 0; $i -lt 40 -and -not (Test-PortInUse $port); $i++) { Start-Sleep -Milliseconds 500 }
}

# ---------------------------------------------------------------- start
if (Test-Gateway) {
  Say 'LayanX is already running.'
} else {
  if (Test-PortInUse $Port) {
    Fail "Port $Port is used by another program. Close it, or set LAYANX_PUBLIC_PORT to a free port (e.g. 3300) and run LayanX again."
  }
  Set-Location $Root

  # Dependencies: install on first run and whenever the lockfile changes.
  $lock = Join-Path $Root 'package-lock.json'
  $manifest = if (Test-Path $lock) { $lock } else { Join-Path $Root 'package.json' }
  $hashFile = Join-Path $DataDir 'deps.sha256'
  $current = (Get-FileHash $manifest -Algorithm SHA256).Hash
  $saved = if (Test-Path $hashFile) { (Get-Content $hashFile -Raw).Trim() } else { '' }
  $tsx = Join-Path $Root 'node_modules\tsx\dist\cli.mjs'
  if (-not (Test-Path $tsx) -or $current -ne $saved) {
    Say 'Installing dependencies (first run or after an update; this can take a few minutes)...'
    if (Test-Path $lock) { & $Npm ci --no-audit --no-fund } else { & $Npm install --no-audit --no-fund }
    if ($LASTEXITCODE -ne 0) { Fail 'Installing dependencies failed. Check your internet connection and the messages above.' }
    Set-Content -Path $hashFile -Value $current -NoNewline
  }

  Ensure-Ollama
  Ensure-CohereAsr
  Ensure-Whisper
  Ensure-Piper
  Ensure-VoiceSense

  Say 'Starting LayanX in the background...'
  Start-Process -FilePath $Node -ArgumentList @("`"$tsx`"", 'src/start-local.ts') -WorkingDirectory $Root -WindowStyle Hidden
  $ready = $false
  for ($i = 0; $i -lt 240; $i++) {
    if (Test-Gateway) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { Fail "LayanX did not start within 2 minutes. Open the log: $LogFile" }
}

# ---------------------------------------------------------------- browser
try {
  Invoke-RestMethod -Method Post -Uri "$Base/v1/setup/launch-ticket" -ContentType 'application/json' -Body '{}' | Out-Null
  $ticket = Get-Content (Join-Path $DataDir 'launch-ticket.json') -Raw | ConvertFrom-Json
  if (-not $NoBrowser) {
    $openAssistant = $false
    $settingsFile = Join-Path $DataDir 'settings.json'
    if (Test-Path $settingsFile) { try { $openAssistant = [bool]((Get-Content $settingsFile -Raw | ConvertFrom-Json).openAssistantOnStart) } catch {} }
    if ($openAssistant) {
      # The assistant runs best as its own Edge app window (Arabic natural voices, microphone permission kept).
      $url = "$Base/setup#launch=$($ticket.code)&next=%2Fvoice%3Flisten%3D1"
      $edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
      if ($edge) { Start-Process -FilePath $edge -ArgumentList @("--app=$url") } else { Start-Process $url }
    } else {
      Start-Process "$Base/setup#launch=$($ticket.code)"
    }
  }
} catch {
  Fail "LayanX is running but the control page could not be opened: $($_.Exception.Message)"
}

# ---------------------------------------------------------------- shortcut
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'LayanX.lnk'
if (-not (Test-Path $lnk)) {
  try {
    $ws = New-Object -ComObject WScript.Shell
    $sc = $ws.CreateShortcut($lnk)
    $sc.TargetPath = Join-Path $Root 'LayanX.cmd'
    $sc.WorkingDirectory = $Root
    $icon = Join-Path $Root 'scripts\windows\layanx.ico'
    if (Test-Path $icon) { $sc.IconLocation = $icon } else { $sc.IconLocation = "$Node,0" }
    $sc.Description = 'Start LayanX'
    $sc.Save()
    Say 'Created a LayanX shortcut on your desktop.'
  } catch {
    Warn "Could not create the desktop shortcut: $($_.Exception.Message)"
  }
}
Say "Ready. Control page: $Base/setup"
Start-Sleep -Seconds 2
exit 0
