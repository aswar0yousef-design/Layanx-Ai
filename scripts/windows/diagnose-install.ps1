#requires -Version 5.1
[CmdletBinding()]
param([switch]$RunChecks,[switch]$RunTests)
$ErrorActionPreference = 'Continue'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$DataDir = if ($env:LAYANX_DATA_DIR) { $env:LAYANX_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'LayanX' }
$LogDir = Join-Path $DataDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Report = Join-Path $LogDir ("diagnostic-{0}.txt" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$Results = New-Object System.Collections.Generic.List[object]
function Add-Result([string]$Name,[string]$State,[string]$Detail) {
  $item = [pscustomobject]@{ check=$Name; state=$State; detail=$Detail }; $Results.Add($item)
  $color = if ($State -eq 'PASS') {'Green'} elseif ($State -eq 'WARN') {'Yellow'} else {'Red'}
  Write-Host ("[{0}] {1}: {2}" -f $State,$Name,$Detail) -ForegroundColor $color
}
function Run-Command([string]$Name,[string]$Exe,[string[]]$Args) {
  Write-Host ""; Write-Host ("--- {0} ---" -f $Name)
  try {
    $output = & $Exe @Args 2>&1 | Out-String
    $code = $LASTEXITCODE
    if ($output) { $output | Write-Host }
    Add-Result $Name $(if ($code -eq 0) {'PASS'} else {'FAIL'}) ("exit={0}" -f $code)
    return ($code -eq 0)
  } catch { Add-Result $Name 'FAIL' $_.Exception.Message; return $false }
}
Write-Host "LayanX diagnostic (does not collect secret values)"
Write-Host "Repository: $Root"
Write-Host "Data directory: $DataDir"
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  $nodeVersion = (& $node.Source --version 2>&1 | Out-String).Trim(); $major=0
  if ($nodeVersion -match '^v(\d+)') { $major=[int]$Matches[1] }
  Add-Result 'Node.js' $(if ($major -ge 22) {'PASS'} else {'FAIL'}) "$nodeVersion (requires 22+)"
} else { Add-Result 'Node.js' 'FAIL' 'node.exe not found on PATH' }
$npm = Get-Command npm -ErrorAction SilentlyContinue
if ($npm) { Add-Result 'npm' 'PASS' $npm.Source } else { Add-Result 'npm' 'FAIL' 'npm not found on PATH' }
$package = Join-Path $Root 'package.json'
if (Test-Path $package) {
  try {
    $pkg=Get-Content $package -Raw | ConvertFrom-Json
    Add-Result 'Project package.json' 'PASS' ("{0}@{1}" -f $pkg.name,$pkg.version)
    if (Test-Path (Join-Path $Root 'package-lock.json')) { Add-Result 'Dependency lockfile' 'PASS' 'package-lock.json exists' }
    else { Add-Result 'Dependency lockfile' 'WARN' 'package-lock.json missing; dependency resolution may vary' }
    if (Test-Path (Join-Path $Root 'node_modules\tsx\dist\cli.mjs')) { Add-Result 'npm dependencies' 'PASS' 'tsx dependency found' }
    else { Add-Result 'npm dependencies' 'WARN' 'node_modules appears incomplete; run npm install' }
  } catch { Add-Result 'Project package.json' 'FAIL' $_.Exception.Message }
} else { Add-Result 'Project package.json' 'FAIL' 'package.json not found in repository root' }
$ollama=Get-Command ollama -ErrorAction SilentlyContinue
if ($ollama) { Add-Result 'Ollama CLI' 'PASS' ((& $ollama.Source --version 2>&1 | Out-String).Trim()) }
else { Add-Result 'Ollama CLI' 'WARN' 'ollama command not found on PATH' }
try {
  $tags=Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3
  $models=@($tags.models | ForEach-Object { $_.name })
  Add-Result 'Ollama API' 'PASS' ("reachable; models: "+$(if($models.Count){$models -join ', '}else{'none installed'}))
  if(-not $models.Count){Add-Result 'Local model' 'FAIL' 'Ollama is running but no models are installed'}
} catch { Add-Result 'Ollama API' 'WARN' 'not reachable at 127.0.0.1:11434' }
$mt5=Get-Process -Name terminal64,terminal -ErrorAction SilentlyContinue
if($mt5){Add-Result 'MT5 terminal process' 'PASS' (($mt5|ForEach-Object{$_.ProcessName}) -join ', ')}
else{Add-Result 'MT5 terminal process' 'WARN' 'MetaTrader 5 is not currently running'}
$python=Get-Command python -ErrorAction SilentlyContinue
if(-not $python){$python=Get-Command py -ErrorAction SilentlyContinue}
if($python){
  $pyCheck=& $python.Source -c "import MetaTrader5; print('MetaTrader5 package OK')" 2>&1
  if($LASTEXITCODE -eq 0){Add-Result 'MT5 Python package' 'PASS' (($pyCheck|Out-String).Trim())}
  else{Add-Result 'MT5 Python package' 'WARN' 'Package missing from this Python; run python -m pip install MetaTrader5'}
}else{Add-Result 'Python for MT5 bridge' 'WARN' 'Python not found on PATH'}
foreach($voiceService in @(@{Name='Local Whisper STT';Port=8178},@{Name='Local Piper TTS';Port=8179},@{Name='Voice Sense VAD';Port=8180})){
  $client=$null
  try{
    $client=New-Object Net.Sockets.TcpClient
    $connect=$client.BeginConnect('127.0.0.1',[int]$voiceService.Port,$null,$null)
    if(-not $connect.AsyncWaitHandle.WaitOne(700)){throw 'connection timeout'}
    $client.EndConnect($connect)
    Add-Result $voiceService.Name 'PASS' ("listening on 127.0.0.1:"+$voiceService.Port)
  }catch{
    Add-Result $voiceService.Name 'WARN' ("not reachable on port "+$voiceService.Port+"; optional local voice component may not be installed or started")
  }finally{if($client){$client.Close()}}
}
try {
  $client=New-Object Net.Sockets.TcpClient; $client.Connect('127.0.0.1',3000); $client.Close()
  Add-Result 'Port 3000' 'WARN' 'already in use; confirm the listener is LayanX'
} catch { Add-Result 'Port 3000' 'PASS' 'available' }
$logFile=Join-Path $DataDir 'logs\layanx.log'
if(Test-Path $logFile){
  $tail=Get-Content $logFile -Tail 25 | Where-Object {$_ -match '(?i)error|failed|exception|timeout|denied'} | Select-Object -Last 8
  Add-Result 'Runtime log' 'PASS' ("found; recent error-like lines: "+$tail.Count)
  if($tail){Write-Host ""; Write-Host "Recent error-like log lines:"; $tail|ForEach-Object{Write-Host $_}}
}else{Add-Result 'Runtime log' 'WARN' 'No layanx.log found under the user data directory'}
if($RunChecks -or $RunTests){
  Push-Location $Root
  try{
    if($npm){
      [void](Run-Command 'TypeScript typecheck' $npm.Source @('run','typecheck'))
      if($RunTests){[void](Run-Command 'Automated test suite' $npm.Source @('test'))}
      if($RunChecks){[void](Run-Command 'Production build' $npm.Source @('run','build'))}
      if($RunChecks){[void](Run-Command 'Operational acceptance' $npm.Source @('run','operational:acceptance'))}
    }
  }finally{Pop-Location}
}
$Results | Format-Table -AutoSize | Out-String -Width 220 | Set-Content -Path $Report -Encoding UTF8
Write-Host ""
Write-Host "Saved diagnostic summary to: $Report"
if(@($Results|Where-Object{$_.state -eq 'FAIL'}).Count -gt 0){exit 1}
