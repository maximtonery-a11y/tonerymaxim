$ErrorActionPreference = "SilentlyContinue"
$protocolRoot = "HKCU:\Software\Classes\tonerymaxim-printer"
Remove-Item -Path $protocolRoot -Recurse -Force
$installDir = Join-Path $env:LOCALAPPDATA "ToneryMaxim\PrinterFinder"
Remove-Item -LiteralPath $installDir -Recurse -Force
Write-Host "ToneryMaxim Printer Finder V4.6 bol odinstalovany." -ForegroundColor Green
