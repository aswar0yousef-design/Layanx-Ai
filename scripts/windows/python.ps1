#Requires -Version 5.1
# Shared by the LayanX installers that need Python (Piper voice, voice sense, Cohere speech recognition).
# Dot-source it after defining Say and Fail:   . (Join-Path $PSScriptRoot 'python.ps1')
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

function Ensure-Python([switch]$Yes) {
  $python = Find-Python
  if ($python) { return $python }
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $answer = if ($Yes) { 'y' } else { Read-Host 'Python 3.12 is needed. Install it now with winget? (y/n)' }
    if ($answer -match '^(y|yes|نعم|ن)$') {
      winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
      $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
      $python = Find-Python
    }
  }
  if (-not $python) { Fail 'Install Python 3.12 from https://www.python.org/downloads/ (tick "Add to PATH"), then run this script again.' }
  return $python
}
