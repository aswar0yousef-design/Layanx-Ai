#Requires -Version 5.1
<#
  Keeps LayanX running for the signed-in Windows user. Started at logon by the "LayanX" scheduled task
  (scripts\windows\install-autostart.ps1); it runs hidden and checks every 30 seconds.

  - LayanX not answering: it is started with start.ps1 -NoBrowser -Unattended.
  - Stopped on purpose with LayanX-Stop.cmd (stopped.flag): left stopped until it is started by hand.
  - Repeated failures: waits longer between tries (up to 10 minutes) instead of restarting in a tight loop.

  A per-user task, not a Windows service: LayanX controls the desktop, the screen and the microphone,
  and a service runs in a separate session that cannot reach them.
#>
param([int]$IntervalSeconds = 30)
$ErrorActionPreference = 'Continue'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$DataDir = if ($env:LAYANX_DATA_DIR) { $env:LAYANX_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'LayanX' }
New-Item -ItemType Directory -Force -Path (Join-Path $DataDir 'logs') | Out-Null
$Log = Join-Path $DataDir 'logs\watchdog.log'
$Flag = Join-Path $DataDir 'stopped.flag'

function Note($m) {
  $line = "$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) $m"
  try {
    if ((Test-Path $Log) -and (Get-Item $Log).Length -gt 1MB) { Move-Item $Log "$Log.1" -Force }
    Add-Content -Path $Log -Value $line -Encoding UTF8
  } catch {}
}
function Get-Port {
  if ($env:LAYANX_PUBLIC_PORT) { return [int]$env:LAYANX_PUBLIC_PORT }
  $settingsFile = Join-Path $DataDir 'settings.json'
  if (Test-Path $settingsFile) { try { $s = Get-Content $settingsFile -Raw | ConvertFrom-Json; if ($s.publicPort) { return [int]$s.publicPort } } catch {} }
  return 3000
}
function Test-Gateway {
  try { $r = Invoke-RestMethod -Uri "http://127.0.0.1:$(Get-Port)/v1/gateway/health" -TimeoutSec 5; return ($r.app -eq 'layanx-gateway') } catch { return $false }
}

# One watchdog per user: a second copy (task started twice, or by hand) exits at once.
$mutex = New-Object Threading.Mutex($false, "Local\LayanX-Watchdog")
if (-not $mutex.WaitOne(0)) { exit 0 }

Note "watchdog started (pid $PID, folder $Root)"
$failures = 0
$wasUp = $false
try {
  while ($true) {
    if (Test-Path $Flag) {
      if ($wasUp) { Note 'stopped on purpose (LayanX-Stop); not restarting until started by hand'; $wasUp = $false }
    } elseif (Test-Gateway) {
      if (-not $wasUp) { Note 'LayanX is up'; $wasUp = $true }
      $failures = 0
    } else {
      if ($wasUp) { Note 'LayanX stopped answering' }
      $wasUp = $false
      # Back off after failures: 30 s, 1, 2, 4, 8 minutes, then every 10 minutes.
      $wait = [Math]::Min(600, $IntervalSeconds * [Math]::Pow(2, [Math]::Max(0, $failures - 1)))
      if ($failures -gt 0) { Note "waiting $([int]$wait) s before try $($failures + 1)"; Start-Sleep -Seconds ([int]$wait) }
      if (-not (Test-Path $Flag) -and -not (Test-Gateway)) {
        Note 'starting LayanX'
        $p = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$(Join-Path $PSScriptRoot 'start.ps1')`"", '-NoBrowser', '-Unattended') -WindowStyle Hidden -PassThru
        # Not -Wait: in Windows PowerShell it also waits for everything the launcher started, LayanX included, so it never returns.
        if (-not $p.WaitForExit(300000)) { Note 'launcher still running after 5 minutes; stopping it'; try { $p.Kill() } catch {} }
        if ($p.ExitCode -eq 0 -and (Test-Gateway)) { Note 'LayanX started'; $wasUp = $true; $failures = 0 }
        else { $failures++; Note "start failed (exit $($p.ExitCode)); see logs\layanx.log" }
      }
    }
    Start-Sleep -Seconds $IntervalSeconds
  }
} finally {
  $mutex.ReleaseMutex()
}
