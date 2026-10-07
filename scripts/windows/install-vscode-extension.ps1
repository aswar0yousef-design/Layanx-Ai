#Requires -Version 5.1
# Installs the LayanX VS Code extension:  powershell -ExecutionPolicy Bypass -File scripts\windows\install-vscode-extension.ps1
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$Vsix = Join-Path $Root 'vscode-extension\layanx-agent.vsix'
if (-not (Test-Path $Vsix)) {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { Write-Host '[LayanX] Node.js is required to build the extension. Run LayanX.cmd once first.' -ForegroundColor Red; exit 1 }
  & $node.Source (Join-Path $Root 'scripts\build-vsix.mjs')
}
$candidates = @(
  (Get-Command code -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1),
  "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd",
  "$env:ProgramFiles\Microsoft VS Code\bin\code.cmd"
) | Where-Object { $_ -and (Test-Path $_) }
$code = $candidates | Select-Object -First 1
if (-not $code) {
  Write-Host '[LayanX] VS Code was not found. In VS Code: Extensions > ... > Install from VSIX... and choose:' -ForegroundColor Yellow
  Write-Host "  $Vsix"
  exit 1
}
& $code --install-extension $Vsix --force
Write-Host '[LayanX] Installed. In VS Code press Ctrl+Shift+P and run: "LayanX: Connect (Pairing Code)".' -ForegroundColor Cyan
Write-Host '         Get the code from the LayanX setup page: Phone & VS Code > Create pairing code.'
