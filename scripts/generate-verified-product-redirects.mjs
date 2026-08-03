#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const mappingPath = path.join(root, "migration", "TM_URL_MAPOVANIE_V1.csv");
const cachePath = path.join(root, ".tm-cache", "products.json");
const outputPath = path.join(root, "src", "lib", "legacy", "product-redirect-map.ts");

function parseDelimited(text, delimiter = ";") {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((value) => String(value || "").trim());
  return rows.slice(1)
    .filter((row) => row.some((value) => String(value || "").trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function lastPathSegment(value) {
  const pathname = new URL(value, "https://www.tonerymaxim.sk").pathname;
  return decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) || "").trim().toLowerCase();
}

const [mappingText, cacheText] = await Promise.all([
  readFile(mappingPath, "utf8"),
  readFile(cachePath, "utf8"),
]);

const rows = rowsToObjects(parseDelimited(mappingText));
const cache = JSON.parse(cacheText);
const currentSlugs = new Set((cache.products || []).map((product) => String(product.slug || "").trim()).filter(Boolean));
const redirects = new Map();

for (const row of rows) {
  if (String(row.Typ || "").trim() !== "product" || String(row.Akcia || "").trim() !== "301") continue;

  const source = lastPathSegment(row["Stará URL"]);
  const target = lastPathSegment(row["Navrhovaná nová URL"]);
  if (!source || !target) throw new Error(`Neplatné produktové mapovanie: ${row["Stará URL"]}`);
  if (!currentSlugs.has(target)) throw new Error(`Cieľ produktu neexistuje v aktuálnej cache: ${target}`);
  if (redirects.has(source) && redirects.get(source) !== target) {
    throw new Error(`Duplicitný zdroj s rôznymi cieľmi: ${source}`);
  }
  redirects.set(source, target);
}

const sorted = [...redirects.entries()].sort(([left], [right]) => left.localeCompare(right, "sk"));
const lines = sorted.map(([source, target]) => `  ${JSON.stringify(source)}: ${JSON.stringify(target)},`);
const output = `// Automaticky vytvorené a proti aktuálnej produktovej cache overené 301 mapovanie.\n// Zdroj: migration/TM_URL_MAPOVANIE_V1.csv. Generátor odmietne každý cieľ,\n// ktorý už v katalógu neexistuje, aby stará URL nikdy neviedla na chybný produkt.\n\nexport const LEGACY_PRODUCT_REDIRECTS: Readonly<Record<string, string>> = Object.freeze({\n${lines.join("\n")}\n});\n`;

await writeFile(outputPath, output, "utf8");
console.log(`Overené produktové presmerovania: ${sorted.length}`);
