#Requires -Version 5.1
<#
  Makes LayanX always on for the current Windows user: a scheduled task named "LayanX" starts the watchdog
  (scripts\windows\watchdog.ps1) at every logon, and the watchdog starts LayanX and restarts it if it stops.
  No administrator rights are needed.

    powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1          # install and start now
    powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1 -Remove  # remove

  To pause LayanX without removing this: LayanX-Stop.cmd. Starting LayanX.cmd resumes it.
#>
param([switch]$Remove, [switch]$NoStart)
$ErrorActionPreference = 'Stop'
$TaskName = 'LayanX'
$Watchdog = Join-Path $PSScriptRoot 'watchdog.ps1'

function Stop-Watchdog {
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*watchdog.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
}

if ($Remove) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host '[LayanX] Always-on start removed.'
  } else {
    Write-Host '[LayanX] Always-on start was not installed.'
  }
  Stop-Watchdog
  Write-Host '[LayanX] LayanX itself keeps running until you use LayanX-Stop.cmd.'
  exit 0
}

$user = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Watchdog`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
# No time limit, keep running on battery, and if the watchdog itself dies, the task starts it again every minute.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Keeps LayanX running for this user (scripts\windows\watchdog.ps1).' -Force | Out-Null
Write-Host "[LayanX] Always-on start installed for $user (task '$TaskName')."

if (-not $NoStart) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host '[LayanX] Watchdog started. LayanX will be up within about two minutes; log: %LOCALAPPDATA%\LayanX\logs\watchdog.log'
}
