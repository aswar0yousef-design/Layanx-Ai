#Requires -Version 5.1
# Stops the LayanX background process for the current Windows user.
$DataDir = if ($env:LAYANX_DATA_DIR) { $env:LAYANX_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'LayanX' }
$pidFile = Join-Path $DataDir 'layanx.pid'
if (-not (Test-Path $pidFile)) { Write-Host '[LayanX] LayanX is not running.'; Start-Sleep -Seconds 2; exit 0 }
$procId = [int]((Get-Content $pidFile -Raw).Trim())
try {
  $p = Get-Process -Id $procId -ErrorAction Stop
  if ($p.ProcessName -ne 'node') { throw "PID $procId is not a LayanX process." }
  Stop-Process -Id $procId -ErrorAction Stop
  Write-Host '[LayanX] LayanX stopped.'
} catch {
  Write-Host "[LayanX] Nothing to stop ($($_.Exception.Message))."
}
Remove-Item $pidFile -ErrorAction SilentlyContinue
# Helper servers LayanX started from its own folder (Whisper, Piper, voice sense, Cohere ASR) hold GPU/RAM: stop them too.
try {
  Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($DataDir, [StringComparison]::OrdinalIgnoreCase)) -or ($_.CommandLine -and ($_.CommandLine -like '*piper.http_server*' -or $_.CommandLine -like '*voice-sense*server.py*' -or $_.CommandLine -like '*cohere_asr_server.py*') -and $_.CommandLine.IndexOf($DataDir, [StringComparison]::OrdinalIgnoreCase) -ge 0) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; Write-Host "[LayanX] stopped $($_.Name)" }
} catch {}
Start-Sleep -Seconds 2
