$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$projectRoot = Split-Path -Parent $PSScriptRoot
$helperDir = Join-Path $projectRoot "tools\printer-finder-windows"
$zipPath = Join-Path $projectRoot "public\downloads\tonerymaxim-printer-finder-windows.zip"
$expected = @(
  "ToneryMaximPrinterFinder.ps1",
  "Install.ps1",
  "Uninstall.ps1",
  "INSTALOVAT.cmd",
  "ODINSTALOVAT.cmd",
  "README.txt"
)

foreach ($scriptName in @("ToneryMaximPrinterFinder.ps1", "Install.ps1", "Uninstall.ps1")) {
  $path = Join-Path $helperDir $scriptName
  if (-not (Test-Path -LiteralPath $path)) { throw "Chýba $scriptName" }
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors) | Out-Null
  if (@($errors).Count -gt 0) {
    $messages = @($errors | ForEach-Object { $_.Message }) -join "; "
    throw "PowerShell syntax chyba v ${scriptName}: $messages"
  }
}

# Skutočný runtime self-test na tomto Windows PC. Neodosiela nič na server;
# iba preverí, že helper sa spustí a vie prečítať Windows Print Spooler.
$helperScript = Join-Path $helperDir "ToneryMaximPrinterFinder.ps1"
$selfTestFile = Join-Path $env:TEMP ("tm-printer-helper-release-test-" + [Guid]::NewGuid().ToString("N") + ".json")
try {
  $powerShellExe = (Get-Command powershell.exe -ErrorAction Stop).Source
  & $powerShellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helperScript -SelfTest -OutputPath $selfTestFile
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $selfTestFile)) {
    throw "Windows helper runtime self-test zlyhal."
  }
  $selfTest = Get-Content -LiteralPath $selfTestFile -Raw | ConvertFrom-Json
  if ($selfTest.ok -ne $true -or -not ([string]$selfTest.version).StartsWith("4.6.")) {
    throw "Windows helper vrátil neplatný výsledok self-testu."
  }
  Write-Host ("OK: Windows runtime self-test, fyzické tlačiarne: {0}." -f $selfTest.physicalPrinterCount) -ForegroundColor Green
}
finally {
  Remove-Item -LiteralPath $selfTestFile -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath $zipPath)) { throw "Chýba hostovaný Windows ZIP." }
$temp = Join-Path $env:TEMP ("tm-printer-helper-verify-" + [Guid]::NewGuid().ToString("N"))
try {
  Expand-Archive -LiteralPath $zipPath -DestinationPath $temp -Force
  $actual = @(Get-ChildItem -LiteralPath $temp -File | Select-Object -ExpandProperty Name | Sort-Object)
  $wanted = @($expected | Sort-Object)
  if (($actual -join "|") -ne ($wanted -join "|")) {
    throw "Windows ZIP má nesprávny obsah: $($actual -join ', ')"
  }
  foreach ($name in $expected) {
    $source = Join-Path $helperDir $name
    $packed = Join-Path $temp $name
    if (-not (Test-Path -LiteralPath $source) -or -not (Test-Path -LiteralPath $packed)) { throw "Chýba $name" }
    $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash
    $packedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $packed).Hash
    if ($sourceHash -ne $packedHash) { throw "ZIP obsahuje inú verziu súboru $name" }
  }
}
finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "OK: PowerShell syntax, Windows runtime self-test a Windows ZIP boli overené." -ForegroundColor Green
