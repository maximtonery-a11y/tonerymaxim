import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { matchDetectedPrinter } from "../src/lib/detected-printer-match.ts";
import {
  completePrinterDetectionSession,
  registerPrinterDetectionSession,
  failPrinterDetectionSession,
  PRINTER_DETECT_SESSION_MAX,
  PRINTER_DETECT_SESSION_TTL_MS,
  printerDetectionSessionCountForTest,
  printerDetectionSessionPending,
  readPrinterDetectionSession,
  validPrinterDetectionToken,
} from "../src/lib/printer-detect-sessions.ts";
import { GET as getPrinterDetectSession, POST as postPrinterDetectSession } from "../src/pages/api/printer-detect-session.ts";

const catalog = [
  "Brother HL-L2350DW",
  "Brother HL-L2352DW",
  "Brother DCP-L2532DW",
  "Brother MFC-L2712DW",
  "HP LaserJet Pro M404dn",
  "HP LaserJet Pro M405dn",
  "HP LaserJet Pro M110w",
  "HP LaserJet 1020",
  "Canon i-SENSYS MF655Cdw",
  "Canon i-SENSYS LBP6030B",
  "Epson EcoTank L3250",
  "Epson WorkForce Pro WF-C5890DWF",
  "HP DeskJet 2710",
  "Xerox Phaser 3020",
  "Ricoh SP 230DNW",
  "Dell 3110cn",
];

let tokenCounter = 0;
function testToken(prefix = "t") {
  tokenCounter += 1;
  return `${prefix}${String(tokenCounter).padStart(6, "0")}${"x".repeat(40)}`.slice(0, 48);
}

test("presný Windows názov sa nikdy nezamení za podobný susedný model", () => {
  const result = matchDetectedPrinter({ name: "Brother HL-L2350DW series", driver: "Brother HL-L2350DW Printer" }, catalog);
  assert.equal(result.status, "exact");
  assert.equal(result.model, "Brother HL-L2350DW");
  assert.notEqual(result.model, "Brother HL-L2352DW");
});

test("rodinový driver M404-M405 sa sám nepovažuje za presnú tlačiareň", () => {
  const result = matchDetectedPrinter({ name: "Office printer", driver: "HP LaserJet Pro M404-M405 PCL-6 (V4)" }, catalog);
  assert.notEqual(result.status, "exact");
});

test("presný názov fronty môže bezpečne spresniť rodinový driver", () => {
  const result = matchDetectedPrinter({ name: "HP LaserJet Pro M404dn", driver: "HP LaserJet Pro M404-M405 PCL-6 (V4)" }, catalog);
  assert.equal(result.status, "exact");
  assert.equal(result.model, "HP LaserJet Pro M404dn");
});

test("premenovaná fronta sa rozpozná podľa presného značkového drivera", () => {
  const result = matchDetectedPrinter({ name: "Uctaren", driver: "Canon i-SENSYS MF655Cdw" }, catalog);
  assert.equal(result.status, "exact");
  assert.equal(result.model, "Canon i-SENSYS MF655Cdw");
});

test("spoločný katalógový zápis s dvoma modelmi sa nikdy neprijme automaticky", () => {
  const result = matchDetectedPrinter({ name: "HP LaserJet Pro M404dn" }, ["HP LaserJet Pro M404dn M405dn"]);
  assert.notEqual(result.status, "exact");
});

test("Brother prefix HL/DCP/MFC je súčasť modelovej identity", () => {
  const models = ["Brother HL-L2350DW", "Brother DCP-L2350DW", "Brother MFC-L2350DW"];
  const result = matchDetectedPrinter({ name: "Brother HL-L2350DW series", driver: "Brother HL-L2350DW Printer" }, models);
  assert.equal(result.status, "exact");
  assert.equal(result.model, "Brother HL-L2350DW");
});

test("samotné číslo modelu sa pri viacerých rodinách automaticky neprijme", () => {
  const result = matchDetectedPrinter(
    { name: "HP 2710 series", driver: "HP 2710" },
    ["HP DeskJet 2710", "HP LaserJet 2710", "HP OfficeJet 2710"],
  );
  assert.notEqual(result.status, "exact");
});

test("plný číselný model s rodinným kontextom môže byť presná zhoda", () => {
  const result = matchDetectedPrinter({ name: "HP DeskJet 2710 series", driver: "HP DeskJet 2710" }, catalog);
  assert.equal(result.status, "exact");
  assert.equal(result.model, "HP DeskJet 2710");
});

test("regresia V3: HP LaserJet Pro 200 sa nesmie odvodiť zo samotného HP 200", () => {
  const result = matchDetectedPrinter(
    { name: "HP 200 series", driver: "HP 200" },
    ["HP LaserJet Pro 200", "HP DeskJet 200", "HP OfficeJet Pro 200", "HP Color LaserJet Pro 200"],
  );
  assert.notEqual(result.status, "exact");
});

test("regresia V3: rodinný kontext pri čisto číselnom modeli zostáva zachovaný", () => {
  const laser = matchDetectedPrinter(
    { name: "HP LaserJet Pro 200", driver: "HP LaserJet Pro 200" },
    ["HP LaserJet Pro 200", "HP DeskJet 200", "HP OfficeJet Pro 200"],
  );
  assert.equal(laser.status, "exact");
  assert.equal(laser.model, "HP LaserJet Pro 200");
});

test("alfanumerická koncovka oddelená medzerou zostáva rovnaký model", () => {
  const result = matchDetectedPrinter({ name: "Dell 3110 cn", driver: "Dell 3110cn" }, catalog);
  assert.equal(result.status, "exact");
  assert.equal(result.model, "Dell 3110cn");
});

test("Brother model rozdelený na viac tokenov sa správne spojí", () => {
  const result = matchDetectedPrinter({ name: "Brother DCP L2532 DW", driver: "Brother DCP-L2532DW" }, catalog);
  assert.equal(result.status, "exact");
  assert.equal(result.model, "Brother DCP-L2532DW");
});

test("Epson WF prefix chráni pred zhodou s inou rodinou", () => {
  const result = matchDetectedPrinter(
    { name: "Epson WF-C5890DWF", driver: "EPSON C5890DWF Series" },
    ["Epson WorkForce Pro WF-C5890DWF", "Epson SureColor C5890DWF"],
  );
  assert.notEqual(result.status, "exact");
});

test("dva katalógové modely s rovnakým Canon kódom ostanú nejednoznačné", () => {
  const result = matchDetectedPrinter(
    { name: "Canon MF655Cdw", driver: "Canon MF655Cdw" },
    ["Canon i-SENSYS MF655Cdw", "Canon PIXMA MF655Cdw"],
  );
  assert.equal(result.status, "ambiguous");
});

test("HP marketingové číslo série neblokuje presný alfanumerický model", () => {
  const result = matchDetectedPrinter(
    { name: "HP LaserJet Pro 400 M401dn", driver: "HP LaserJet Pro 400 M401dn" },
    ["HP LaserJet Pro 400 M401dn", "HP LaserJet Pro M402dn"],
  );
  assert.equal(result.status, "exact");
  assert.equal(result.model, "HP LaserJet Pro 400 M401dn");
});

test("bez značky sa k značkovému katalógu automatická zhoda neprijme", () => {
  const result = matchDetectedPrinter({ name: "M404dn", driver: "M404dn" }, ["HP LaserJet Pro M404dn"]);
  assert.notEqual(result.status, "exact");
});

test("konflikt značiek medzi frontou a driverom sa nikdy neprijme automaticky", () => {
  const result = matchDetectedPrinter(
    { name: "HP LaserJet Pro M404dn", driver: "Canon i-SENSYS M404dn" },
    ["HP LaserJet Pro M404dn", "Canon i-SENSYS M404dn"],
  );
  assert.notEqual(result.status, "exact");
});

test("virtuálne tlačiarne sa ignorujú", () => {
  for (const name of ["Microsoft Print to PDF", "Microsoft XPS Document Writer", "Fax", "Send to OneNote 16", "Adobe PDF"]) {
    assert.equal(matchDetectedPrinter({ name }, catalog).status, "ignored", name);
  }
});

test("adversariálny korpus číselných rodín nemá falošnú automatickú zhodu", () => {
  const brands = ["HP", "Brother", "Canon", "Epson", "Xerox", "Ricoh", "Samsung", "Kyocera", "OKI", "Lexmark"];
  const families: Record<string, string[]> = {
    HP: ["LaserJet Pro", "DeskJet", "OfficeJet Pro", "Color LaserJet Pro"],
    Brother: ["HL", "DCP", "MFC"],
    Canon: ["i-SENSYS", "PIXMA", "MAXIFY"],
    Epson: ["WorkForce Pro WF", "EcoTank ET", "SureColor SC"],
    Xerox: ["Phaser", "WorkCentre", "VersaLink"],
    Ricoh: ["SP", "M C", "IM"],
    Samsung: ["ML", "CLP", "SCX"],
    Kyocera: ["ECOSYS P", "ECOSYS M", "TASKalfa"],
    OKI: ["C", "MC", "B"],
    Lexmark: ["MS", "MX", "CS"],
  };
  const suffixes = ["", "dn", "dw", "cdw", "DWF", "w", "n", "NW"];

  let checked = 0;
  for (const brand of brands) {
    const brandFamilies = families[brand];
    for (let number = 200; number < 240; number += 1) {
      for (let left = 0; left < brandFamilies.length; left += 1) {
        for (let right = left + 1; right < brandFamilies.length; right += 1) {
          const suffix = suffixes[(number + left) % suffixes.length];
          const first = `${brand} ${brandFamilies[left]} ${number}${suffix}`;
          const second = `${brand} ${brandFamilies[right]} ${number}${suffix}`;
          const generic = matchDetectedPrinter({ name: `${brand} ${number} series`, driver: `${brand} ${number}` }, [first, second]);
          assert.notEqual(generic.status, "exact", `${brand} ${number}: ${first} / ${second}`);
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked >= 1000);
});

test("reálny mix formátov zachováva presné modely", () => {
  const models = [
    "Brother HL-L2350DW", "Brother DCP-L2532DW", "Brother MFC-L2712DW", "Brother HL-1110", "Brother DCP-1610W",
    "HP LaserJet Pro M404dn", "HP LaserJet Pro M110w", "HP LaserJet 1020", "HP DeskJet 2710e", "HP Laser 107w", "HP Color LaserJet Pro MFP 4302fdw",
    "Canon i-SENSYS MF655Cdw", "Canon i-SENSYS LBP6030B", "Canon PIXMA TS3350", "Canon imageRUNNER 2425i",
    "Epson WorkForce Pro WF-C5890DWF", "Epson EcoTank L3250", "Epson Expression Home XP-2100", "Epson SureColor SC-P700",
    "Xerox Phaser 3020", "Xerox WorkCentre 3025BI", "Xerox VersaLink C405DN",
    "Ricoh SP 230DNW", "Ricoh M C240FW", "Ricoh IM C3000",
    "Kyocera ECOSYS P2040dn", "Kyocera ECOSYS M5526cdw", "Kyocera TASKalfa 2554ci",
    "OKI C332dn", "OKI MC363dn", "Samsung Xpress M2026W", "Samsung ML-2165W", "Lexmark MS310dn", "Lexmark MX310dn",
    "Konica Minolta bizhub C250i", "Pantum P2500W", "Sharp MX-3071", "Dell 3110cn",
  ];

  for (const model of models) {
    const variants = new Set([
      model,
      `${model} series`,
      `${model} Printer`,
      model.replaceAll("-", " "),
      model.replace(/(\d)([A-Za-z]{1,4})$/, "$1 $2"),
    ]);
    for (const variant of variants) {
      const result = matchDetectedPrinter({ name: variant, driver: variant }, models);
      assert.equal(result.status, "exact", `${model} <= ${variant}`);
      assert.equal(result.model, model, `${model} <= ${variant}`);
    }
  }
});

test("detekčný token má prísny base64url formát a klient ho generuje kryptograficky", async () => {
  assert.equal(validPrinterDetectionToken("a".repeat(32)), true);
  assert.equal(validPrinterDetectionToken("A0_-".repeat(8)), true);
  assert.equal(validPrinterDetectionToken("abc"), false);
  assert.equal(validPrinterDetectionToken("a".repeat(31)), false);
  assert.equal(validPrinterDetectionToken("a".repeat(97)), false);
  assert.equal(validPrinterDetectionToken("a".repeat(31) + "."), false);
  const component = await readFile(new URL("../src/components/DesktopPrinterFinder.astro", import.meta.url), "utf8");
  assert.match(component, /crypto\.randomUUID\(\)/);
  assert.match(component, /crypto\.getRandomValues/);
});

test("relácia má krátku životnosť a po expirácii sa nedá použiť", () => {
  const now = 1_000_000;
  const token = testToken("e");
  assert.equal(registerPrinterDetectionSession(token, now), true);
  assert.equal(printerDetectionSessionPending(token, now + PRINTER_DETECT_SESSION_TTL_MS - 1), true);
  assert.equal(readPrinterDetectionSession(token, now + PRINTER_DETECT_SESSION_TTL_MS), null);
  assert.equal(completePrinterDetectionSession(token, { ok: true }, now + PRINTER_DETECT_SESSION_TTL_MS), false);
});

test("rovnaký jednorazový token sa nedá zaregistrovať dvakrát", () => {
  const token = testToken("r");
  assert.equal(registerPrinterDetectionSession(token), true);
  assert.equal(registerPrinterDetectionSession(token), false);
});

test("reláciu môže helper dokončiť iba raz", () => {
  const token = testToken("c");
  assert.equal(registerPrinterDetectionSession(token), true);
  assert.equal(completePrinterDetectionSession(token, { answer: 1 }), true);
  assert.equal(completePrinterDetectionSession(token, { answer: 2 }), false);
  const stored = readPrinterDetectionSession(token);
  assert.equal(stored?.status, "complete");
  if (stored?.status === "complete") assert.deepEqual(stored.result, { answer: 1 });
});

test("chyba helpera sa uloží iba ako krátka generická správa", () => {
  const token = testToken("f");
  assert.equal(registerPrinterDetectionSession(token), true);
  assert.equal(failPrinterDetectionSession(token, "x".repeat(500)), true);
  const stored = readPrinterDetectionSession(token);
  assert.equal(stored?.status, "error");
  if (stored?.status === "error") assert.ok(stored.error.length <= 160);
});

test("pamäť relácií je tvrdo ohraničená", () => {
  for (let index = 0; index < PRINTER_DETECT_SESSION_MAX + 40; index += 1) {
    const token = `m${String(index).padStart(6, "0")}${"z".repeat(50)}`.slice(0, 48);
    registerPrinterDetectionSession(token);
  }
  assert.ok(printerDetectionSessionCountForTest() <= PRINTER_DETECT_SESSION_MAX);
});

test("čítanie plnej mapy relácií samo nevyhadzuje aktívnu reláciu", () => {
  const now = 9_000_000_000_000;
  const tokens: string[] = [];
  for (let index = 0; index < PRINTER_DETECT_SESSION_MAX; index += 1) {
    const token = `q${String(index).padStart(6, "0")}${"y".repeat(50)}`.slice(0, 48);
    tokens.push(token);
    assert.equal(registerPrinterDetectionSession(token, now), true);
  }
  assert.equal(printerDetectionSessionCountForTest(now), PRINTER_DETECT_SESSION_MAX);
  assert.equal(readPrinterDetectionSession(tokens[0], now)?.status, "pending");
  assert.equal(printerDetectionSessionCountForTest(now), PRINTER_DETECT_SESSION_MAX);

  const extra = `q999999${"e".repeat(50)}`.slice(0, 48);
  assert.equal(registerPrinterDetectionSession(extra, now), true);
  assert.equal(printerDetectionSessionCountForTest(now), PRINTER_DETECT_SESSION_MAX);
  assert.equal(readPrinterDetectionSession(tokens[0], now), null);
  assert.equal(readPrinterDetectionSession(extra, now)?.status, "pending");
});

test("session API reálne registruje, polluje a odmieta duplicitný token", async () => {
  const token = testToken("a");
  const request = new Request("https://www.tonerymaxim.sk/api/printer-detect-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const created = await postPrinterDetectSession({ request } as any);
  assert.equal(created.status, 200);
  assert.deepEqual(await created.json(), { ok: true });

  const duplicate = await postPrinterDetectSession({ request: new Request(request.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  }) } as any);
  assert.equal(duplicate.status, 409);

  const polled = await getPrinterDetectSession({ url: new URL(`${request.url}?token=${encodeURIComponent(token)}`) } as any);
  assert.equal(polled.status, 200);
  const data = await polled.json();
  assert.equal(data.status, "pending");
  assert.match(polled.headers.get("cache-control") || "", /no-store/);
});

test("session API odmieta poškodené JSON a krátky token", async () => {
  const badJson = await postPrinterDetectSession({ request: new Request("https://www.tonerymaxim.sk/api/printer-detect-session", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{" }) } as any);
  assert.equal(badJson.status, 400);
  const short = await postPrinterDetectSession({ request: new Request("https://www.tonerymaxim.sk/api/printer-detect-session", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "short" }) }) } as any);
  assert.equal(short.status, 400);
});

test("desktop komponent neposiela názvy tlačiarní cez URL ani fragment", async () => {
  const source = await readFile(new URL("../src/components/DesktopPrinterFinder.astro", import.meta.url), "utf8");
  assert.match(source, /tonerymaxim-printer:\/\/detect/);
  assert.match(source, /query\.set\(['"]token['"], token\)/);
  assert.match(source, /printer-detect-session/);
  assert.doesNotMatch(source, /tm-printer-result|printer-finder-return|navigator\.usb|requestDevice|WebUSB/i);
  assert.doesNotMatch(source, /JSON\.stringify\(\{\s*printers/);
});

test("externý Windows protokol sa spúšťa v pôvodnom kliknutí bez await pred launchom", async () => {
  const source = await readFile(new URL("../src/components/DesktopPrinterFinder.astro", import.meta.url), "utf8");
  const start = source.indexOf("function launchHelper()");
  const end = source.indexOf("const pageParams", start);
  const launch = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(launch.slice(0, launch.indexOf("window.location.href")), /\bawait\b/);
  assert.ok(launch.indexOf("const registration = registerDetectionSession(token)") < launch.indexOf("window.location.href = protocolUrl(token)"));
  assert.match(launch, /window\.location\.href\s*=\s*protocolUrl\(token\)/);
  assert.match(source, /keepalive:\s*true/);
});

test("desktop komponent je iba pre Windows desktop a pred ostrým zapnutím je preview-gated", async () => {
  const source = await readFile(new URL("../src/components/DesktopPrinterFinder.astro", import.meta.url), "utf8");
  assert.match(source, /navigator\.userAgentData\?\.platform|navigator\.platform/);
  assert.match(source, /windows\|win32\|win64/i);
  assert.match(source, /max-width:\s*760px/);
  assert.match(source, /tonerymaxim\.info/);
  assert.match(source, /tm_printer_finder_preview/);
  assert.match(source, /TM_PRINTER_FINDER_ENABLED/);
});

test("UI escapuje všetky serverové a Windows texty pred innerHTML", async () => {
  const source = await readFile(new URL("../src/components/DesktopPrinterFinder.astro", import.meta.url), "utf8");
  assert.match(source, /replace\(\/&\/g, '&amp;'\)/);
  assert.match(source, /esc\(source\)/);
  assert.match(source, /esc\(item\.model\)/);
  assert.match(source, /esc\(suggestion\.model\)/);
  assert.match(source, /encodeURIComponent\(manualQuery\)/);
  assert.match(source, /function safeCatalogUrl/);
  assert.match(source, /url\.origin !== location\.origin/);
  assert.match(source, /url\.pathname\.startsWith\('\/tlaciarne\/'\)/);
});

test("session API je no-store a nevykonáva diskové uloženie", async () => {
  const api = await readFile(new URL("../src/pages/api/printer-detect-session.ts", import.meta.url), "utf8");
  const store = await readFile(new URL("../src/lib/printer-detect-sessions.ts", import.meta.url), "utf8");
  assert.match(api, /no-store/);
  assert.match(store, /Map<string, PrinterDetectionSessionState>/);
  assert.doesNotMatch(store, /writeFile|appendFile|createWriteStream|localStorage|sessionStorage/);
  assert.match(store, /registerPrinterDetectionSession/);
});

test("helper submit endpoint overí token pred načítaním katalógu", async () => {
  const source = await readFile(new URL("../src/pages/api/printer-detect-submit.ts", import.meta.url), "utf8");
  const tokenCheck = source.indexOf("printerDetectionSessionPending(token)");
  const cacheLoad = source.indexOf("const models = await printerModels()");
  assert.ok(tokenCheck >= 0 && cacheLoad > tokenCheck);
  assert.match(source, /HELPER_MAJOR_VERSION\s*=\s*["']4["']/);
  assert.match(source, /MAX_PRINTERS\s*=\s*12/);
  assert.match(source, /MAX_FIELD_LENGTH\s*=\s*160/);
  assert.match(source, /cache-control.*no-store/i);
  assert.match(source, /body(?:\?\.|\.)checkOnly === true/);
  assert.match(source, /session\.status === "complete"[\s\S]{0,120}alreadyComplete/);
  const checkOnlyIndex = Math.max(source.indexOf('body.checkOnly === true'), source.indexOf('body?.checkOnly === true'));
  assert.ok(checkOnlyIndex >= 0 && checkOnlyIndex < source.indexOf('const models = await printerModels()'));
  assert.doesNotMatch(source, /relevance|levenshtein|fuzzy/i);
});

test("submit API má explicitné typy pre nedôveryhodný JSON aj výsledky", async () => {
  const source = await readFile(new URL("../src/pages/api/printer-detect-submit.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /let\s+body\s*:\s*any/);
  assert.match(source, /let\s+body\s*:\s*PrinterDetectSubmitBody/);
  assert.match(source, /normalizePrinter\(value:\s*unknown\)/);
  assert.match(source, /const\s+results\s*:\s*DetectionResultItem\[\]/);
  assert.match(source, /filter\(\(item:\s*DetectionResultItem\)/);
});

test("helper endpoint klientovi nevracia surový payload tlačiarní", async () => {
  const source = await readFile(new URL("../src/pages/api/printer-detect-submit.ts", import.meta.url), "utf8");
  assert.match(source, /return json\(\{ ok: true \}\)/);
  assert.doesNotMatch(source, /return json\(\{\s*ok:\s*true,\s*printers/);
});

test("middleware má rate limit relácií a origin výnimku iba pre tokenizovaný helper submit", async () => {
  const source = await readFile(new URL("../src/middleware.ts", import.meta.url), "utf8");
  assert.match(source, /printer-detect-session/);
  assert.match(source, /printer-detect-submit/);
  assert.match(source, /ORIGIN_EXEMPT[\s\S]*printer-detect-submit/);
  assert.match(source, /printer-detect-session[^\n]*GET[^\n]*120/);
  assert.match(source, /printer-detect-submit[^\n]*POST[^\n]*60/);
  assert.match(source, /printerFinderPreviewRequest/);
  assert.match(source, /tm_printer_finder_preview/);
  assert.match(source, /liveCatalogPath\(url\.pathname\) \|\| printerFinderPreviewRequest/);
});

test("Windows helper posiela výsledok HTTPS POSTom iba na pevný ToneryMaxim host", async () => {
  const helper = await readFile(new URL("../tools/printer-finder-windows/ToneryMaximPrinterFinder.ps1", import.meta.url), "utf8");
  assert.match(helper, /Win32_Printer/);
  assert.match(helper, /https:\/\/www\.tonerymaxim\.sk/);
  assert.match(helper, /https:\/\/www\.tonerymaxim\.info/);
  assert.match(helper, /\/api\/printer-detect-submit/);
  assert.match(helper, /Invoke-RestMethod/);
  assert.match(helper, /for \(\$attempt = 0; \$attempt -lt 6; \$attempt\+\+\)/);
  assert.match(helper, /\[Text\.Encoding\]::UTF8\.GetBytes\(\$json\)/);
  assert.match(helper, /-Body \$jsonBytes/);
  assert.match(helper, /checkOnly = \$true/);
  assert.match(helper, /\[switch\]\$SelfTest/);
  assert.match(helper, /if \(\$SelfTest\.IsPresent\)/);
  assert.ok(helper.indexOf('checkOnly = $true') < helper.indexOf('$payload = New-TMPayload', helper.indexOf('checkOnly = $true')));
  assert.match(helper, /function Get-TMPropertyValue/);
  assert.match(helper, /Get-TMPropertyValue \$row "Default" \$false/);
  assert.match(helper, /token -notmatch "\^\[A-Za-z0-9_-/);
  assert.doesNotMatch(helper, /tm-printer-result|printer-finder-return|Start-Process\s+\$target|HttpListener|TcpListener|127\.0\.0\.1/);
});

test("helper limituje počet a dĺžku údajov a virtuálne tlačiarne odstráni ešte vo Windows", async () => {
  const helper = await readFile(new URL("../tools/printer-finder-windows/ToneryMaximPrinterFinder.ps1", import.meta.url), "utf8");
  assert.match(helper, /\$MaxPrinters\s*=\s*12/);
  assert.match(helper, /\$MaxFieldLength\s*=\s*140/);
  assert.match(helper, /Select-Object -First \$MaxPrinters/);
  assert.match(helper, /if \(\$isVirtual\) \{ continue \}/);
  assert.match(helper, /\[regex\]::Replace\(\$text, "\[\\x00-\\x1F\\x7F\]"/);
});

test("inštalátor používa HKCU, self-test a po inštalácii neposiela názvy tlačiarní v URL", async () => {
  const source = await readFile(new URL("../tools/printer-finder-windows/Install.ps1", import.meta.url), "utf8");
  assert.match(source, /-File \$stageFile -SelfTest -OutputPath \$testFile/);
  assert.doesNotMatch(source, /["\']--self-test["\']/);
  assert.match(source, /HKCU:\\Software\\Classes\\tonerymaxim-printer/);
  assert.match(source, /tm_printer_finder_installed=1/);
  assert.match(source, /tm_printer_finder_preview=1/);
  assert.doesNotMatch(source, /tm-printer-result|printer-finder-return/);
  assert.doesNotMatch(source, /HKLM:|RunAs|Verb\s+runAs/i);
});

test("release verifier spúšťa reálny Windows helper self-test ešte pred pushom", async () => {
  const source = await readFile(new URL("../scripts/verify-printer-helper.ps1", import.meta.url), "utf8");
  assert.match(source, /-File \$helperScript -SelfTest -OutputPath \$selfTestFile/);
  assert.doesNotMatch(source, /["\']--self-test["\']/);
  assert.match(source, /physicalPrinterCount/);
  assert.match(source, /Windows helper runtime self-test/);
  assert.match(source, /Language\.Parser/);
});

test("hostovaný Windows ZIP obsahuje inštaláciu aj odinštaláciu", async () => {
  const zip = await readFile(new URL("../public/downloads/tonerymaxim-printer-finder-windows.zip", import.meta.url));
  const directoryText = zip.toString("latin1");
  assert.match(directoryText, /INSTALOVAT\.cmd/);
  assert.match(directoryText, /ODINSTALOVAT\.cmd/);
  assert.match(directoryText, /ToneryMaximPrinterFinder\.ps1/);
  assert.match(directoryText, /Install\.ps1/);
});

test("V4 už nepotrebuje citlivú návratovú stránku V3", async () => {
  await assert.rejects(access(new URL("../src/pages/printer-finder-return.astro", import.meta.url)));
  await assert.rejects(access(new URL("../src/pages/api/printer-detect-match.ts", import.meta.url)));
});
