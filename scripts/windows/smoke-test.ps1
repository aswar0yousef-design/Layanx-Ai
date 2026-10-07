<#
  LayanX - Windows smoke test.
  Proves the Windows-only parts on this PC: desktop helper (mouse/keyboard + UI Automation),
  DPAPI secrets, and npm scripts without .cmd spawning. Opens and closes Notepad.

  Run from the LayanX folder:
    powershell -ExecutionPolicy Bypass -File scripts\windows\smoke-test.ps1
  Add -NoUi to skip the Notepad check (for example over Remote Desktop with a locked screen).
  Add -WithTools to also test the security scanners installed by install-security-tools.ps1.
  Add -WithVoice to test Piper (speak Arabic), Whisper (hear it back) and voice sense (Silero VAD + Smart Turn)
  after install-piper.ps1 / install-whisper.ps1 / install-voice-sense.ps1.
  Always included: restricted isolation (low-integrity sandbox without Docker) and the ACP editor bridge.
  -Only core,sandbox,tools,voice runs a subset.
#>
param([switch]$NoUi,[switch]$WithTools,[switch]$WithVoice,[string]$Only)
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $Root
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Host 'Node.js 22+ is required.' -ForegroundColor Red; exit 1 }
$tsx = Join-Path $Root 'node_modules\tsx\dist\cli.mjs'
if (-not (Test-Path $tsx)) { Write-Host 'Run LayanX.cmd once (or npm install) first.' -ForegroundColor Red; exit 1 }
$smokeArgs = @($tsx, 'scripts/windows-smoke.ts')
if ($NoUi) { $smokeArgs += '--no-ui' }
if ($WithTools) { $smokeArgs += '--with-tools' }
if ($WithVoice) { $smokeArgs += '--with-voice' }
if ($Only) { $smokeArgs += @('--only', $Only) }
& $node @smokeArgs
$code = $LASTEXITCODE
if ($code -eq 0) { Write-Host 'Windows smoke test passed.' -ForegroundColor Green }
else { Write-Host 'Windows smoke test failed. Send the output above.' -ForegroundColor Red }
exit $code
