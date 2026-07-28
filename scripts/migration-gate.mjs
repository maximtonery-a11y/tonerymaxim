#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_MAPPING = "migration/TM_URL_MAPOVANIE_V1.csv";
const DEFAULT_OUTPUT = "migration/reports";
const PRODUCTION_ORIGIN = "https://www.tonerymaxim.sk";
const USER_AGENT = "ToneryMaxim-Migration-Gate/1.0";

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.MIGRATION_BASE_URL || "http://127.0.0.1:4321",
    mapping: process.env.MIGRATION_MAPPING || DEFAULT_MAPPING,
    outputDir: process.env.MIGRATION_OUTPUT_DIR || DEFAULT_OUTPUT,
    concurrency: Number(process.env.MIGRATION_CONCURRENCY || 4),
    timeoutMs: Number(process.env.MIGRATION_TIMEOUT_MS || 30000),
    maxRedirects: Number(process.env.MIGRATION_MAX_REDIRECTS || 5),
    limit: 0,
    types: [],
    allowNoindex: false,
    noFail: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--base-url" && value) { options.baseUrl = value; index += 1; }
    else if (arg === "--mapping" && value) { options.mapping = value; index += 1; }
    else if (arg === "--output-dir" && value) { options.outputDir = value; index += 1; }
    else if (arg === "--concurrency" && value) { options.concurrency = Number(value); index += 1; }
    else if (arg === "--timeout-ms" && value) { options.timeoutMs = Number(value); index += 1; }
    else if (arg === "--max-redirects" && value) { options.maxRedirects = Number(value); index += 1; }
    else if (arg === "--limit" && value) { options.limit = Number(value); index += 1; }
    else if (arg === "--types" && value) { options.types = value.split(",").map((item) => item.trim()).filter(Boolean); index += 1; }
    else if (arg === "--allow-noindex") options.allowNoindex = true;
    else if (arg === "--no-fail") options.noFail = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Neznámy parameter: ${arg}`);
  }

  if (!Number.isFinite(options.concurrency) || options.concurrency < 1 || options.concurrency > 50) {
    throw new Error("--concurrency musí byť číslo od 1 do 50.");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error("--timeout-ms musí byť aspoň 1000.");
  }
  if (!Number.isFinite(options.maxRedirects) || options.maxRedirects < 0 || options.maxRedirects > 20) {
    throw new Error("--max-redirects musí byť číslo od 0 do 20.");
  }

  const baseHost = new URL(options.baseUrl).hostname.toLowerCase();
  if (["tonerymaxim.info", "www.tonerymaxim.info"].includes(baseHost)) options.allowNoindex = true;
  return options;
}

function printHelp() {
  console.log(`\nToneryMaxim Migration Gate\n\nPoužitie:\n  node scripts/migration-gate.mjs [parametre]\n\nParametre:\n  --base-url URL          Testovaný Astro server (predvolené http://127.0.0.1:4321)\n  --mapping SÚBOR         CSV mapovanie URL\n  --output-dir PRIEČINOK  Výstupné reporty\n  --concurrency N         Súbežné požiadavky, predvolené 8\n  --timeout-ms N          Timeout jednej požiadavky, predvolené 20000\n  --max-redirects N       Maximum presmerovaní, predvolené 5\n  --types A,B             Otestovať iba zadané typy\n  --limit N               Otestovať prvých N riadkov\n  --allow-noindex         Noindex nebude blokujúca chyba (vhodné pre .info)\n  --dry-run               Len skontroluje mapovanie, neposiela HTTP požiadavky\n  --no-fail               Vždy skončí s exit kódom 0\n`);
}

function parseDelimited(text, delimiter = ";") {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((value) => String(value || "").trim());
  return rows.slice(1)
    .filter((row) => row.some((value) => String(value || "").trim()))
    .map((row, rowIndex) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]).concat([["__row", rowIndex + 2]])));
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, headers) {
  const lines = [headers.map(csvCell).join(";")];
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header])).join(";"));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function normalizePathname(value) {
  let pathname = String(value || "/");
  try { pathname = new URL(pathname, PRODUCTION_ORIGIN).pathname; } catch {}
  pathname = pathname.replace(/\/{2,}/g, "/");
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
  return pathname || "/";
}

function comparableUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value, PRODUCTION_ORIGIN);
    const pathname = normalizePathname(url.pathname);
    const params = [...url.searchParams.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
    const query = new URLSearchParams(params).toString();
    const rawHost = url.hostname.toLowerCase();
    const host = ["tonerymaxim.sk", "www.tonerymaxim.sk"].includes(rawHost) ? "www.tonerymaxim.sk" : rawHost;
    return `${host}${pathname}${query ? `?${query}` : ""}`;
  } catch {
    return `www.tonerymaxim.sk${normalizePathname(value)}`;
  }
}

function toTestUrl(publicUrl, baseUrl) {
  const source = new URL(publicUrl, PRODUCTION_ORIGIN);
  const base = new URL(baseUrl);
  return new URL(`${source.pathname}${source.search}`, base).toString();
}

function toPublicUrl(testUrl, baseUrl) {
  const url = new URL(testUrl);
  const base = new URL(baseUrl);
  if (url.origin === base.origin) return new URL(`${url.pathname}${url.search}`, PRODUCTION_ORIGIN).toString();
  return url.toString();
}

function redirectStatus(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function parseAttributes(tag) {
  const attrs = {};
  const pattern = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(tag))) attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  return attrs;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function stripHtml(value) {
  return decodeEntities(String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function analyzeHtml(html, headers) {
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  const canonicalTag = linkTags.find((tag) => {
    const attrs = parseAttributes(tag);
    return String(attrs.rel || "").toLowerCase().split(/\s+/).includes("canonical");
  });
  const canonical = canonicalTag ? parseAttributes(canonicalTag).href || "" : "";

  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  const robots = metaTags
    .map(parseAttributes)
    .filter((attrs) => ["robots", "googlebot"].includes(String(attrs.name || "").toLowerCase()))
    .map((attrs) => attrs.content || "")
    .join(", ");
  const xRobots = headers.get("x-robots-tag") || "";
  const noindex = /\bnoindex\b/i.test(`${robots},${xRobots}`);

  const h1Matches = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  const h1 = h1Matches.map((match) => stripHtml(match[1])).filter(Boolean);
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripHtml(titleMatch[1]) : "";
  const text = stripHtml(html);
  const soft404 = /\b(chyba\s*404|str[aá]nka\s+sa\s+nena[šs]la|t[aá]to\s+str[aá]nka\s+u[žz]\s+nie\s+je\s+dostupn[aá]|page\s+not\s+found)\b/i.test(`${title} ${h1.join(" ")} ${text.slice(0, 1200)}`);
  const serverError = /\b(internal server error|astroerror|unhandled exception|referenceerror|typeerror:)\b/i.test(`${title} ${text.slice(0, 2500)}`);

  return {
    canonical,
    robots,
    xRobots,
    noindex,
    h1,
    title,
    textLength: text.length,
    soft404,
    serverError,
  };
}

async function fetchStep(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStepWithRetry(url, timeoutMs) {
  try {
    return await fetchStep(url, timeoutMs);
  } catch (error) {
    if (error?.name !== "AbortError") throw error;
    await new Promise((resolve) => setTimeout(resolve, 250));
    return fetchStep(url, timeoutMs);
  }
}

function rewriteRedirectLocation(location, currentUrl, baseUrl) {
  const resolved = new URL(location, currentUrl);
  const productionHosts = new Set(["tonerymaxim.sk", "www.tonerymaxim.sk", "tonerymaxim.info", "www.tonerymaxim.info"]);
  if (productionHosts.has(resolved.hostname.toLowerCase())) return toTestUrl(resolved.toString(), baseUrl);
  return resolved.toString();
}

async function inspectUrl(publicUrl, options) {
  const startUrl = toTestUrl(publicUrl, options.baseUrl);
  let currentUrl = startUrl;
  const visited = new Set();
  const chain = [];
  let initialStatus = 0;

  for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
    if (visited.has(currentUrl)) {
      return { error: "redirect-loop", chain, initialStatus, finalUrl: currentUrl, finalPublicUrl: toPublicUrl(currentUrl, options.baseUrl) };
    }
    visited.add(currentUrl);

    let response;
    try {
      response = await fetchStepWithRetry(currentUrl, options.timeoutMs);
    } catch (error) {
      return {
        error: error?.name === "AbortError" ? "timeout" : String(error?.message || error),
        chain,
        initialStatus,
        finalUrl: currentUrl,
        finalPublicUrl: toPublicUrl(currentUrl, options.baseUrl),
      };
    }

    if (!initialStatus) initialStatus = response.status;
    const location = response.headers.get("location");
    if (redirectStatus(response.status) && location) {
      const nextUrl = rewriteRedirectLocation(location, currentUrl, options.baseUrl);
      chain.push({ status: response.status, from: toPublicUrl(currentUrl, options.baseUrl), to: toPublicUrl(nextUrl, options.baseUrl) });
      if (hop === options.maxRedirects) {
        return { error: "too-many-redirects", chain, initialStatus, finalUrl: currentUrl, finalPublicUrl: toPublicUrl(currentUrl, options.baseUrl) };
      }
      currentUrl = nextUrl;
      continue;
    }

    const contentType = response.headers.get("content-type") || "";
    let html = "";
    if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      try { html = await response.text(); } catch {}
    }
    const analysis = analyzeHtml(html, response.headers);
    return {
      error: "",
      chain,
      initialStatus,
      finalStatus: response.status,
      finalUrl: currentUrl,
      finalPublicUrl: toPublicUrl(currentUrl, options.baseUrl),
      contentType,
      ...analysis,
    };
  }
  return { error: "unknown", chain, initialStatus, finalUrl: currentUrl, finalPublicUrl: toPublicUrl(currentUrl, options.baseUrl) };
}

function expectedForRow(row) {
  const action = String(row["Akcia"] || "").trim().toUpperCase();
  const type = String(row["Typ"] || "").trim().toLowerCase();
  const oldUrl = String(row["Stará URL"] || "").trim();
  const proposed = String(row["Navrhovaná nová URL"] || "").trim();

  if (action === "301") return { mode: "redirect", target: proposed, manual: false };

  // Riadky označené „OVERIŤ PRED 301“ nemajú dostatočne bezpečný konkrétny
  // cieľ. Pre produkty preto nevyžadujeme pochybný trvalý redirect z pôvodnej
  // tabuľky; nový recovery router môže použiť presný 301, relevantný 302
  // výsledok vyhľadávania alebo 410 pre zrušený netonerový sortiment.
  if (action === "OVERIŤ PRED 301" && ["product", "manufacturer", "article"].includes(type)) {
    return { mode: "recovery", target: proposed, manual: false };
  }
  if (action === "OVERIŤ PRED 301") return { mode: "redirect", target: proposed, manual: true };

  // Sortiment kalendárov, diárov a podobné staré kategórie sa v novom
  // tonerovom e-shope nenachádzajú. Správny výsledok je 410 Gone.
  if (type === "category" || type === "other") {
    return { mode: "gone", target: oldUrl, manual: false };
  }

  // Pri týchto skupinách povoľujeme bezpečný recovery režim:
  // presný 301, dočasný 302 na relevantné vyhľadávanie, zachované 200 alebo 410.
  if (["product", "manufacturer", "article"].includes(type)) {
    return { mode: "recovery", target: proposed, manual: false };
  }

  if (["printer-model", "printer-category"].includes(type)) {
    return { mode: "preserve-or-recovery", target: proposed || oldUrl, manual: false };
  }

  if (action === "200 ZACHOVAŤ" || action === "VYTVORIŤ ROUTU / ZACHOVAŤ 200") {
    return { mode: "preserve", target: proposed || oldUrl, manual: false };
  }
  if (action === "VYTVORIŤ LANDING") return { mode: "recovery", target: proposed || oldUrl, manual: false };

  return { mode: "recovery", target: proposed, manual: false };
}

const ISSUE_PRIORITY = [
  "SIEŤOVÁ CHYBA", "REDIRECT LOOP", "PRÍLIŠ VEĽA REDIRECTOV", "500", "404",
  "NESPRÁVNY HTTP STAV", "NESPRÁVNY REDIRECT", "REDIRECT CHAIN", "SOFT 404",
  "PRÁZDNA STRÁNKA", "CHÝBA CANONICAL", "NESPRÁVNY CANONICAL", "NOINDEX",
  "CHÝBA H1", "CHYBA V HTML", "MANUÁLNE OVERIŤ",
];

const ACCEPTABLE_VERDICTS = new Set(["PASS", "FALLBACK OK", "410 OK"]);

function primaryVerdict(issues) {
  for (const issue of ISSUE_PRIORITY) if (issues.includes(issue)) return issue;
  return "PASS";
}

function sourceHasDuplicatePathSlash(row) {
  try {
    return /\/{2,}/.test(new URL(String(row["Stará URL"] || "")).pathname);
  } catch {
    return false;
  }
}

function recoveryDestinationAllowed(value) {
  try {
    const url = new URL(value, PRODUCTION_ORIGIN);
    const path = normalizePathname(url.pathname);
    return path === "/produkty"
      || path === "/tlaciarne"
      || path.startsWith("/tlaciarne/")
      || path === "/faq"
      || path.startsWith("/produkt/");
  } catch {
    return false;
  }
}

function validateIndexableHtml(observed, expectedCanonical, issues, notes, options) {
  const htmlResponse = /text\/html|application\/xhtml\+xml/i.test(observed.contentType || "");
  if (observed.finalStatus !== 200 || !htmlResponse) return;

  if (observed.soft404) issues.push("SOFT 404");
  if (observed.serverError) issues.push("CHYBA V HTML");
  if (observed.textLength < 120) issues.push("PRÁZDNA STRÁNKA");
  if (!observed.h1?.length) issues.push("CHÝBA H1");
  if (!observed.canonical) issues.push("CHÝBA CANONICAL");
  else if (expectedCanonical && comparableUrl(observed.canonical) !== comparableUrl(expectedCanonical)) {
    issues.push("NESPRÁVNY CANONICAL");
    notes.push(`canonical ${observed.canonical}; očakávané ${expectedCanonical}`);
  }
  if (observed.noindex && !options.allowNoindex) issues.push("NOINDEX");
}

function evaluate(row, observed, options) {
  const expected = expectedForRow(row);
  const issues = [];
  const notes = [];
  let specialVerdict = "";

  if (expected.manual) issues.push("MANUÁLNE OVERIŤ");

  if (options.dryRun) {
    return { expected, issues, notes, verdict: primaryVerdict(issues) };
  }

  if (observed.error) {
    if (observed.error === "redirect-loop") issues.push("REDIRECT LOOP");
    else if (observed.error === "too-many-redirects") issues.push("PRÍLIŠ VEĽA REDIRECTOV");
    else issues.push("SIEŤOVÁ CHYBA");
    notes.push(observed.error);
    return { expected, issues: [...new Set(issues)], notes, verdict: primaryVerdict(issues) };
  }

  if (observed.finalStatus >= 500) issues.push("500");

  if (expected.mode === "gone") {
    if (observed.initialStatus === 410 && observed.finalStatus === 410 && observed.chain.length === 0) {
      specialVerdict = "410 OK";
    } else {
      issues.push(observed.finalStatus === 404 ? "404" : "NESPRÁVNY HTTP STAV");
    }
  } else if (expected.mode === "redirect") {
    if (![301, 308].includes(observed.initialStatus)) issues.push("NESPRÁVNY HTTP STAV");
    if (observed.chain.length > 1) issues.push("REDIRECT CHAIN");
    if (expected.target && comparableUrl(observed.finalPublicUrl) !== comparableUrl(expected.target)) {
      issues.push("NESPRÁVNY REDIRECT");
      notes.push(`očakávané ${expected.target}, získané ${observed.finalPublicUrl}`);
    }
    if (observed.finalStatus !== 200) issues.push("NESPRÁVNY HTTP STAV");
    validateIndexableHtml(observed, expected.target || observed.finalPublicUrl, issues, notes, options);
  } else if (expected.mode === "preserve") {
    if (observed.initialStatus !== 200 || observed.finalStatus !== 200 || observed.chain.length) {
      issues.push(observed.finalStatus === 404 ? "404" : "NESPRÁVNY HTTP STAV");
    }
    validateIndexableHtml(observed, expected.target || row["Stará URL"], issues, notes, options);
  } else if (expected.mode === "recovery" || expected.mode === "preserve-or-recovery") {
    const maxRecoveryRedirects = sourceHasDuplicatePathSlash(row) ? 2 : 1;

    if (observed.initialStatus === 410 && observed.finalStatus === 410 && observed.chain.length === 0) {
      specialVerdict = "410 OK";
    } else if (observed.initialStatus === 200 && observed.finalStatus === 200 && observed.chain.length === 0) {
      validateIndexableHtml(observed, row["Stará URL"], issues, notes, options);
    } else if ([301, 308].includes(observed.initialStatus) && observed.finalStatus === 200 && observed.chain.length <= maxRecoveryRedirects) {
      if (!recoveryDestinationAllowed(observed.finalPublicUrl)) issues.push("NESPRÁVNY REDIRECT");
      else validateIndexableHtml(observed, observed.finalPublicUrl, issues, notes, options);
    } else if ([302, 307].includes(observed.initialStatus) && observed.finalStatus === 200 && observed.chain.length <= maxRecoveryRedirects) {
      if (!recoveryDestinationAllowed(observed.finalPublicUrl)) issues.push("NESPRÁVNY REDIRECT");
      else specialVerdict = "FALLBACK OK";
    } else {
      if (observed.finalStatus === 404) issues.push("404");
      else issues.push("NESPRÁVNY HTTP STAV");
    }
  }

  const uniqueIssues = [...new Set(issues)];
  const verdict = uniqueIssues.length ? primaryVerdict(uniqueIssues) : (specialVerdict || "PASS");
  return { expected, issues: uniqueIssues, notes, verdict };
}

function reportRow(row, observed, evaluation) {
  const chainText = (observed?.chain || []).map((item) => `${item.status} ${item.from} -> ${item.to}`).join(" | ");
  return {
    "Riadok": row.__row,
    "Stará URL": row["Stará URL"],
    "Typ": row["Typ"],
    "Akcia": row["Akcia"],
    "Stav mapovania": row["Stav mapovania"],
    "Istota": row["Istota"],
    "Navrhovaná nová URL": row["Navrhovaná nová URL"],
    "Očakávaný režim": evaluation.expected.mode,
    "Verdikt": evaluation.verdict,
    "Problémy": evaluation.issues.join(" | "),
    "Poznámka testu": evaluation.notes.join(" | "),
    "Prvý HTTP stav": observed?.initialStatus || "",
    "Konečný HTTP stav": observed?.finalStatus || "",
    "Počet redirectov": observed?.chain?.length ?? "",
    "Redirect chain": chainText,
    "Konečná URL": observed?.finalPublicUrl || "",
    "Canonical": observed?.canonical || "",
    "Noindex": observed ? (observed.noindex ? "ÁNO" : "NIE") : "",
    "H1": observed?.h1?.join(" || ") || "",
    "Title": observed?.title || "",
    "Dĺžka textu": observed?.textLength ?? "",
    "Content-Type": observed?.contentType || "",
    "Sieťová chyba": observed?.error || "",
    "Dôvod / poznámka": row["Dôvod / poznámka"],
    "Kandidát slug": row["Kandidát slug"],
    "Kandidát názov": row["Kandidát názov"],
    "Skóre zhody": row["Skóre zhody"],
  };
}

async function runPool(items, concurrency, worker, onProgress) {
  const results = new Array(items.length);
  let cursor = 0;
  let completed = 0;
  async function runner() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
      completed += 1;
      onProgress?.(completed, items.length, results[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, runner));
  return results;
}

function countBy(rows, key) {
  const result = {};
  for (const row of rows) result[row[key] || "(prázdne)"] = (result[row[key] || "(prázdne)"] || 0) + 1;
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1]));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function htmlReport(summary, rows) {
  const verdictOptions = Object.keys(summary.byVerdict).map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)} (${summary.byVerdict[value]})</option>`).join("");
  const typeOptions = Object.keys(summary.byType).map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)} (${summary.byType[value]})</option>`).join("");
  const tableRows = rows.map((row) => `<tr data-verdict="${escapeHtml(row["Verdikt"])}" data-type="${escapeHtml(row["Typ"])}">
    <td>${escapeHtml(row["Riadok"])}</td><td class="verdict">${escapeHtml(row["Verdikt"])}</td><td>${escapeHtml(row["Typ"])}</td>
    <td><a href="${escapeHtml(row["Stará URL"])}" target="_blank" rel="noreferrer">${escapeHtml(row["Stará URL"])}</a></td>
    <td>${escapeHtml(row["Prvý HTTP stav"])}</td><td>${escapeHtml(row["Konečný HTTP stav"])}</td><td>${escapeHtml(row["Počet redirectov"])}</td>
    <td>${escapeHtml(row["Konečná URL"])}</td><td>${escapeHtml(row["Canonical"])}</td><td>${escapeHtml(row["Noindex"])}</td>
    <td>${escapeHtml(row["H1"])}</td><td>${escapeHtml(row["Problémy"])}</td><td>${escapeHtml(row["Poznámka testu"])}</td>
  </tr>`).join("\n");

  return `<!doctype html><html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ToneryMaxim Migration Gate</title><style>
:root{font-family:Inter,system-ui,sans-serif;color:#172033;background:#f4f7f8}body{margin:0}.wrap{max-width:1800px;margin:auto;padding:24px}.hero{background:#0f766e;color:white;padding:26px;border-radius:18px}.hero h1{margin:0 0 8px}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:18px 0}.kpi{background:white;border:1px solid #dbe5e8;border-radius:14px;padding:16px}.kpi b{display:block;font-size:28px}.bad{color:#b42318}.good{color:#067647}.filters{display:flex;gap:10px;flex-wrap:wrap;background:white;padding:14px;border-radius:14px;margin-bottom:14px;position:sticky;top:0;z-index:2;border:1px solid #dbe5e8}.filters input,.filters select{padding:10px;border:1px solid #cbd5e1;border-radius:8px;min-width:180px}table{border-collapse:collapse;width:100%;background:white;font-size:12px}th{position:sticky;top:70px;background:#172033;color:white;text-align:left}th,td{padding:8px;border:1px solid #e2e8f0;vertical-align:top;max-width:340px;overflow-wrap:anywhere}tr[data-verdict="PASS"] .verdict,tr[data-verdict="FALLBACK OK"] .verdict,tr[data-verdict="410 OK"] .verdict{color:#067647;font-weight:800}tr:not([data-verdict="PASS"]):not([data-verdict="FALLBACK OK"]):not([data-verdict="410 OK"]) .verdict{color:#b42318;font-weight:800}a{color:#0f766e}.hidden{display:none}</style></head><body><div class="wrap">
<section class="hero"><h1>ToneryMaxim Migration Gate</h1><div>Vytvorené ${escapeHtml(summary.generatedAt)} · Testovaný server ${escapeHtml(summary.baseUrl)}</div></section>
<section class="kpis"><div class="kpi"><span>URL celkom</span><b>${summary.total}</b></div><div class="kpi"><span>Bez blokera</span><b class="good">${summary.pass}</b></div><div class="kpi"><span>Blokujúce</span><b class="bad">${summary.blocking}</b></div><div class="kpi"><span>Nevyriešené mapovanie</span><b class="bad">${summary.unresolved}</b></div><div class="kpi"><span>Pripravené na DNS</span><b class="${summary.readyForDns ? "good" : "bad"}">${summary.readyForDns ? "ÁNO" : "NIE"}</b></div></section>
<div class="filters"><input id="q" placeholder="Hľadať URL, H1, problém..."><select id="verdict"><option value="">Všetky verdikty</option>${verdictOptions}</select><select id="type"><option value="">Všetky typy</option>${typeOptions}</select><span id="shown"></span></div>
<div style="overflow:auto;max-height:75vh"><table><thead><tr><th>Riadok</th><th>Verdikt</th><th>Typ</th><th>Stará URL</th><th>Prvý stav</th><th>Konečný stav</th><th>Redirecty</th><th>Konečná URL</th><th>Canonical</th><th>Noindex</th><th>H1</th><th>Problémy</th><th>Poznámka</th></tr></thead><tbody>${tableRows}</tbody></table></div>
</div><script>const rows=[...document.querySelectorAll('tbody tr')],q=document.querySelector('#q'),v=document.querySelector('#verdict'),t=document.querySelector('#type'),shown=document.querySelector('#shown');function f(){let n=0;for(const r of rows){const ok=(!q.value||r.textContent.toLowerCase().includes(q.value.toLowerCase()))&&(!v.value||r.dataset.verdict===v.value)&&(!t.value||r.dataset.type===t.value);r.classList.toggle('hidden',!ok);if(ok)n++}shown.textContent='Zobrazené: '+n}q.oninput=v.onchange=t.onchange=f;f()</script></body></html>`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { printHelp(); return; }
  if (!existsSync(options.mapping)) throw new Error(`Mapovanie neexistuje: ${options.mapping}`);

  const raw = await readFile(options.mapping, "utf8");
  let rows = rowsToObjects(parseDelimited(raw));
  const required = ["Stará URL", "Typ", "Navrhovaná nová URL", "Akcia", "Stav mapovania"];
  const headers = Object.keys(rows[0] || {});
  for (const name of required) if (!headers.includes(name)) throw new Error(`V CSV chýba stĺpec: ${name}`);

  if (options.types.length) rows = rows.filter((row) => options.types.includes(row["Typ"]));
  if (options.limit > 0) rows = rows.slice(0, options.limit);
  if (!rows.length) throw new Error("Po filtrovaní nezostal žiadny riadok na testovanie.");

  const duplicateCounts = new Map();
  for (const row of rows) {
    const key = comparableUrl(row["Stará URL"]);
    duplicateCounts.set(key, (duplicateCounts.get(key) || 0) + 1);
  }
  const duplicates = [...duplicateCounts.entries()].filter(([, count]) => count > 1);

  console.log(`Migration Gate: ${rows.length} URL, server ${options.baseUrl}`);
  const started = Date.now();
  let lastPrinted = 0;
  const resultRows = await runPool(rows, options.concurrency, async (row) => {
    let observed = null;
    if (!options.dryRun) observed = await inspectUrl(row["Stará URL"], options);
    const evaluation = evaluate(row, observed || {}, options);
    return reportRow(row, observed, evaluation);
  }, (completed, total) => {
    const now = Date.now();
    if (completed === total || completed % 100 === 0 || now - lastPrinted > 5000) {
      const elapsed = Math.max(1, (now - started) / 1000);
      const rate = completed / elapsed;
      const eta = rate > 0 ? Math.round((total - completed) / rate) : 0;
      process.stdout.write(`\r${completed}/${total} (${Math.round(completed / total * 100)} %) · ${rate.toFixed(1)} URL/s · ETA ${eta}s   `);
      lastPrinted = now;
    }
  });
  process.stdout.write("\n");

  const byVerdict = countBy(resultRows, "Verdikt");
  const byType = countBy(resultRows, "Typ");
  const pass = resultRows.filter((row) => ACCEPTABLE_VERDICTS.has(row["Verdikt"])).length;
  const unresolved = resultRows.filter((row) => /(?:^| \| )MANUÁLNE OVERIŤ(?: \| |$)/.test(row["Problémy"] || "")).length;
  const blocking = resultRows.length - pass;
  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    mapping: path.resolve(options.mapping),
    dryRun: options.dryRun,
    allowNoindex: options.allowNoindex,
    total: resultRows.length,
    pass,
    blocking,
    unresolved,
    duplicates: duplicates.length,
    readyForDns: blocking === 0 && unresolved === 0 && duplicates.length === 0,
    durationSeconds: Math.round((Date.now() - started) / 1000),
    byVerdict,
    byType,
  };

  await mkdir(options.outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportHeaders = Object.keys(resultRows[0]);
  const files = {
    csv: path.join(options.outputDir, `migration-gate-${stamp}.csv`),
    html: path.join(options.outputDir, `migration-gate-${stamp}.html`),
    json: path.join(options.outputDir, `migration-gate-${stamp}.json`),
    latestCsv: path.join(options.outputDir, "latest.csv"),
    latestHtml: path.join(options.outputDir, "latest.html"),
    latestJson: path.join(options.outputDir, "latest.json"),
  };
  const csv = toCsv(resultRows, reportHeaders);
  const html = htmlReport(summary, resultRows);
  const json = `${JSON.stringify({ summary, rows: resultRows }, null, 2)}\n`;
  await Promise.all([
    writeFile(files.csv, csv, "utf8"), writeFile(files.latestCsv, csv, "utf8"),
    writeFile(files.html, html, "utf8"), writeFile(files.latestHtml, html, "utf8"),
    writeFile(files.json, json, "utf8"), writeFile(files.latestJson, json, "utf8"),
  ]);

  console.log(`PASS: ${pass}/${resultRows.length}`);
  console.log(`Blokujúce: ${blocking}`);
  console.log(`Pripravené na DNS: ${summary.readyForDns ? "ÁNO" : "NIE"}`);
  console.log(`HTML report: ${path.resolve(files.latestHtml)}`);
  console.log(`CSV report:  ${path.resolve(files.latestCsv)}`);

  if (!summary.readyForDns && !options.noFail) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`MIGRATION GATE CHYBA: ${error?.stack || error}`);
  process.exitCode = 1;
});
