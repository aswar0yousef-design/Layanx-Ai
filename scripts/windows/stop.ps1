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
Start-Sleep -Seconds 2
