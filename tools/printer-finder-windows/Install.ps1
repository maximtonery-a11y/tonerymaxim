$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$source = Join-Path $PSScriptRoot "ToneryMaximPrinterFinder.ps1"
if (-not (Test-Path -LiteralPath $source)) { throw "Chyba: chýba ToneryMaximPrinterFinder.ps1." }

$installDir = Join-Path $env:LOCALAPPDATA "ToneryMaxim\PrinterFinder"
$target = Join-Path $installDir "ToneryMaximPrinterFinder.ps1"
$stageFile = Join-Path $env:TEMP ("tm-printer-finder-stage-" + [Guid]::NewGuid().ToString("N") + ".ps1")
$testFile = Join-Path $env:TEMP ("tm-printer-finder-test-" + [Guid]::NewGuid().ToString("N") + ".json")

$powerShellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path -LiteralPath $powerShellExe)) {
  $powerShellExe = (Get-Command powershell.exe -ErrorAction Stop).Source
}

try {
  # Najprv testujeme dočasnú kópiu. Existujúci funkčný helper sa neprepíše,
  # kým nová verzia úspešne neprečíta Windows tlačiarne.
  Copy-Item -LiteralPath $source -Destination $stageFile -Force
  Unblock-File -LiteralPath $stageFile -ErrorAction SilentlyContinue
  & $powerShellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $stageFile -SelfTest -OutputPath $testFile
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $testFile)) {
    throw "Pomocník neprešiel kontrolou tlačiarní vo Windows."
  }
  $test = Get-Content -LiteralPath $testFile -Raw | ConvertFrom-Json
  if ($test.ok -ne $true -or [string]$test.version -ne "4.6.0") {
    throw "Pomocník neprešiel vlastným testom alebo má nesprávnu verziu."
  }

  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  Copy-Item -LiteralPath $stageFile -Destination $target -Force
  Unblock-File -LiteralPath $target -ErrorAction SilentlyContinue
}
finally {
  Remove-Item -LiteralPath $stageFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $testFile -Force -ErrorAction SilentlyContinue
}

$protocolRoot = "HKCU:\Software\Classes\tonerymaxim-printer"
New-Item -Path $protocolRoot -Force | Out-Null
Set-Item -Path $protocolRoot -Value "URL:ToneryMaxim Printer Finder Protocol"
New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $protocolRoot -Name "FriendlyTypeName" -Value "ToneryMaxim Printer Finder" -PropertyType String -Force | Out-Null

$appKey = Join-Path $protocolRoot "Application"
New-Item -Path $appKey -Force | Out-Null
New-ItemProperty -Path $appKey -Name "ApplicationName" -Value "ToneryMaxim Printer Finder" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $appKey -Name "ApplicationDescription" -Value "Nájde tlačiarne nainštalované vo Windows pre ToneryMaxim.sk" -PropertyType String -Force | Out-Null

$iconKey = Join-Path $protocolRoot "DefaultIcon"
New-Item -Path $iconKey -Force | Out-Null
Set-Item -Path $iconKey -Value ("{0},0" -f $powerShellExe)

$commandKey = Join-Path $protocolRoot "shell\open\command"
New-Item -Path $commandKey -Force | Out-Null
$command = '"' + $powerShellExe + '" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $target + '" "%1"'
Set-Item -Path $commandKey -Value $command

$registeredCommand = [string](Get-Item -Path $commandKey).GetValue("")
if ($registeredCommand -ne $command) { throw "Registrácia Windows protokolu sa nepodarila overiť." }

Write-Host ""
Write-Host "ToneryMaxim Printer Finder V4.6 bol uspesne nainstalovany." -ForegroundColor Green
Write-Host ("Windows nasiel {0} fyzickych tlaciarni." -f $test.physicalPrinterCount)
Write-Host "Administratorske prava neboli potrebne."
Write-Host ""

# Žiadne názvy tlačiarní nejdú do URL. Otvoríme iba testovaciu homepage a
# označíme v tomto prehliadači, že helper bol nainštalovaný.
Start-Process "https://www.tonerymaxim.sk/?tm_printer_finder_preview=1&tm_printer_finder_installed=1#tm-printer-finder" | Out-Null
