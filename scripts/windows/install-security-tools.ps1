<#
  LayanX - optional security scanners (gitleaks, osv-scanner, opengrep).
  Exact pinned versions, each download verified against its published SHA-256 before use.
    powershell -ExecutionPolicy Bypass -File scripts\windows\install-security-tools.ps1
#>
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $Root
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
$tsx = Join-Path $Root 'node_modules\tsx\dist\cli.mjs'
if (-not $node -or -not (Test-Path $tsx)) { Write-Host 'Run LayanX.cmd once first (it installs Node.js packages).' -ForegroundColor Red; exit 1 }
& $node $tsx 'scripts/install-security-tools.ts' @args
exit $LASTEXITCODE
