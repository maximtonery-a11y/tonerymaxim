param(
  [Parameter(Position = 0)]
  [string]$ProtocolUrl = "",
  [string]$OutputPath = "",
  [switch]$SelfTest
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0
$Version = "4.6.0"
$MaxPrinters = 12
$MaxFieldLength = 140

function ConvertTo-TMSafeText {
  param([object]$Value)
  $text = [string]$Value
  $text = [regex]::Replace($text, "[\x00-\x1F\x7F]", " ")
  $text = [regex]::Replace($text, "\s+", " ").Trim()
  if ($text.Length -gt $MaxFieldLength) { $text = $text.Substring(0, $MaxFieldLength) }
  return $text
}


function Get-TMPropertyValue {
  param([object]$Object, [string]$Name, [object]$DefaultValue = $null)
  if ($null -eq $Object) { return $DefaultValue }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $DefaultValue }
  return $property.Value
}

function Test-TMVirtualPrinter {
  param([string]$Value)
  $text = ([string]$Value).ToLowerInvariant()
  $markers = @(
    "microsoft print to pdf",
    "microsoft xps document writer",
    "fax",
    "onenote",
    "adobe pdf",
    "pdfcreator",
    "pdf creator",
    "cutepdf",
    "bullzip",
    "dopdf",
    "document image writer",
    "send to onenote",
    "snagit",
    "foxit pdf",
    "nitro pdf",
    "pdf24",
    "pdf-xchange",
    "novapdf",
    "fineprint"
  )
  foreach ($marker in $markers) {
    if ($text.Contains($marker)) { return $true }
  }
  return $false
}

function Get-TMInstalledPrinters {
  $rows = $null
  try {
    $rows = @(Get-CimInstance -ClassName Win32_Printer -ErrorAction Stop)
  }
  catch {
    try {
      $rows = @(Get-WmiObject -Class Win32_Printer -ErrorAction Stop)
    }
    catch {
      $rows = @(Get-Printer -ErrorAction Stop)
    }
  }

  $seen = @{}
  $items = @()
  foreach ($row in $rows) {
    $name = ConvertTo-TMSafeText (Get-TMPropertyValue $row "Name" "")
    $driver = ConvertTo-TMSafeText (Get-TMPropertyValue $row "DriverName" "")
    if ([string]::IsNullOrWhiteSpace($name) -and [string]::IsNullOrWhiteSpace($driver)) { continue }

    $key = ($name + "|" + $driver).ToLowerInvariant()
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true

    $isVirtual = Test-TMVirtualPrinter ($name + " " + $driver)
    if ($isVirtual) { continue }

    $items += [pscustomobject]@{
      name       = $name
      driver     = $driver
      isDefault  = [bool](Get-TMPropertyValue $row "Default" $false)
      isNetwork  = [bool](Get-TMPropertyValue $row "Network" $false)
      isLocal    = [bool](Get-TMPropertyValue $row "Local" $false)
      isOffline  = [bool](Get-TMPropertyValue $row "WorkOffline" $false)
      isVirtual  = $false
    }
  }

  return @($items |
    Sort-Object @{ Expression = { if ($_.isDefault) { 0 } else { 1 } } }, name |
    Select-Object -First $MaxPrinters)
}

function New-TMPayload {
  $printers = @(Get-TMInstalledPrinters)
  return [ordered]@{
    version     = $Version
    generatedAt = [DateTime]::UtcNow.ToString("o")
    printers    = @($printers)
  }
}

function Get-TMProtocolValue {
  param([string]$Url, [string]$Name)
  $pattern = "(?:[?&])" + [regex]::Escape($Name) + "=([^&#]+)"
  $match = [regex]::Match($Url, $pattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if (-not $match.Success) { return "" }
  return [Uri]::UnescapeDataString($match.Groups[1].Value)
}

function Submit-TMBody {
  param([string]$Endpoint, [object]$Body)
  # Windows PowerShell 5.1 na starších systémoch nemusí mať TLS 1.2 ako default.
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
  $json = $Body | ConvertTo-Json -Compress -Depth 6
  # Windows PowerShell 5.1 má pri string Body historicky nejednotné kódovanie.
  # Posielame explicitné UTF-8 bajty, aby názvy ovládačov s diakritikou neboli poškodené.
  $jsonBytes = [Text.Encoding]::UTF8.GetBytes($json)

  # Browser registruje jednorazový token a v tom istom kliknutí spúšťa helper.
  # Krátky retry odstraňuje pretek, ak sa helper rozbehne o pár ms skôr, než
  # registračný POST dorazí na server.
  $lastError = $null
  for ($attempt = 0; $attempt -lt 6; $attempt++) {
    try {
      Invoke-RestMethod -Uri $Endpoint -Method Post -ContentType "application/json; charset=utf-8" -Body $jsonBytes -TimeoutSec 20 -Headers @{ Accept = "application/json" } | Out-Null
      return
    }
    catch {
      $lastError = $_
      if ($attempt -lt 5) { Start-Sleep -Milliseconds 350 }
    }
  }
  if ($null -ne $lastError) { throw $lastError }
  throw "Odoslanie výsledku zlyhalo."
}

try {
  if ($SelfTest.IsPresent) {
    $payload = New-TMPayload
    $result = [ordered]@{
      ok = $true
      version = $Version
      printerCount = @($payload.printers).Count
      physicalPrinterCount = @($payload.printers).Count
    }
    $json = $result | ConvertTo-Json -Compress -Depth 4
    if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
      [IO.File]::WriteAllText($OutputPath, $json, [Text.Encoding]::UTF8)
    }
    exit 0
  }

  if ([string]::IsNullOrWhiteSpace($ProtocolUrl) -or -not $ProtocolUrl.StartsWith("tonerymaxim-printer://detect?", [StringComparison]::OrdinalIgnoreCase)) {
    exit 2
  }

  $site = Get-TMProtocolValue $ProtocolUrl "site"
  $token = Get-TMProtocolValue $ProtocolUrl "token"
  if ($site -ne "sk" -and $site -ne "info") { exit 2 }
  if ($token -notmatch "^[A-Za-z0-9_-]{32,96}$") { exit 2 }

  $baseUrl = if ($site -eq "info") { "https://www.tonerymaxim.info" } else { "https://www.tonerymaxim.sk" }
  $endpoint = $baseUrl + "/api/printer-detect-submit"

  try {
    # Ochrana súkromia: najprv bez údajov o tlačiarňach overíme, že token
    # skutočne vytvorila aktívna stránka ToneryMaxim. Náhodné spustenie custom
    # protokolu z iného webu tak lokálne tlačiarne ani nečíta.
    Submit-TMBody $endpoint ([ordered]@{ token = $token; version = $Version; checkOnly = $true })

    $payload = New-TMPayload
    $body = [ordered]@{
      token = $token
      version = $Version
      generatedAt = $payload.generatedAt
      printers = @($payload.printers)
    }
    Submit-TMBody $endpoint $body
    exit 0
  }
  catch {
    # Ak zlyhalo samotné čítanie tlačiarní, pokúsime sa browseru odovzdať
    # iba generický stav chyby. Ak zlyhala aj sieť, web po krátkom čase zobrazí timeout.
    try {
      Submit-TMBody $endpoint ([ordered]@{ token = $token; version = $Version; error = "helper_failed" })
    } catch {}
    exit 1
  }
}
catch {
  if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
    $safe = [ordered]@{ ok = $false; version = $Version; error = $_.Exception.Message } | ConvertTo-Json -Compress
    try { [IO.File]::WriteAllText($OutputPath, $safe, [Text.Encoding]::UTF8) } catch {}
  }
  exit 1
}
