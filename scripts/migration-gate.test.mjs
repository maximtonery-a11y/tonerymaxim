#!/usr/bin/env node

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const temp = await mkdtemp(path.join(os.tmpdir(), "tm-migration-gate-"));

function htmlPage(pathname, heading = "Nová stránka") {
  return `<html><head><title>${heading}</title><link rel="canonical" href="https://www.tonerymaxim.sk${pathname}"></head><body><h1>${heading}</h1><p>${"Obsah ".repeat(30)}</p></body></html>`;
}

const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const pathname = url.pathname;

  if (pathname === "/old-redirect") { response.writeHead(301, { location: "/new-page" }); response.end(); return; }
  if (pathname === "/old-register") { response.writeHead(301, { location: "/registracia" }); response.end(); return; }
  if (pathname === "/old-chain") { response.writeHead(301, { location: "/middle" }); response.end(); return; }
  if (pathname === "/middle") { response.writeHead(301, { location: "/new-page" }); response.end(); return; }
  if (pathname === "/legacy-toner") { response.writeHead(302, { location: "/produkty?s=HP+652" }); response.end(); return; }
  if (pathname === "/gone") { response.writeHead(410, { "content-type": "text/html", "x-robots-tag": "noindex" }); response.end("<h1>Produkt už nie je v ponuke</h1>"); return; }
  if (pathname === "/new-page") { response.writeHead(200, { "content-type": "text/html" }); response.end(htmlPage("/new-page")); return; }
  if (pathname === "/registracia") { response.writeHead(200, { "content-type": "text/html", "x-robots-tag": "noindex, follow" }); response.end(htmlPage("/registracia", "Registrácia")); return; }
  if (pathname === "/produkty") { response.writeHead(200, { "content-type": "text/html" }); response.end(htmlPage("/produkty", "Produkty")); return; }
  if (pathname === "/preserve") { response.writeHead(200, { "content-type": "text/html" }); response.end(htmlPage("/preserve/", "Zachovaná stránka")); return; }
  if (pathname === "/soft-404") { response.writeHead(200, { "content-type": "text/html" }); response.end(htmlPage("/soft-404", "Stránka sa nenašla")); return; }

  response.writeHead(404, { "content-type": "text/html", "x-robots-tag": "noindex" });
  response.end("<h1>404</h1>");
});

function runGate(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/migration-gate.mjs", ...args], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code));
  });
}

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const csv = `Stará URL;Typ;Navrhovaná nová URL;Akcia;Stav mapovania;Istota;Dôvod / poznámka;Kandidát slug;Kandidát názov;Skóre zhody
https://www.tonerymaxim.sk/old-redirect;static;https://www.tonerymaxim.sk/new-page;301;JEDNOZNAČNÉ;vysoká;;;;
https://www.tonerymaxim.sk/old-register;static;https://www.tonerymaxim.sk/registracia;301;JEDNOZNAČNÉ;vysoká;;;;
https://www.tonerymaxim.sk/preserve;static;https://www.tonerymaxim.sk/preserve;200 ZACHOVAŤ;ZHODA;vysoká;;;;
https://www.tonerymaxim.sk/legacy-toner;product;;MANUÁLNE;BEZ KANDIDÁTA;nízka;;;;
https://www.tonerymaxim.sk/gone;category;;MANUÁLNE;BEZ KANDIDÁTA;nízka;;;;
https://www.tonerymaxim.sk/soft-404;static;https://www.tonerymaxim.sk/soft-404;200 ZACHOVAŤ;ZHODA;vysoká;;;;
https://www.tonerymaxim.sk/unresolved;product;;MANUÁLNE;BEZ KANDIDÁTA;nízka;;;;
https://www.tonerymaxim.sk/old-chain;static;https://www.tonerymaxim.sk/new-page;301;JEDNOZNAČNÉ;vysoká;;;;
`;
  const mapping = path.join(temp, "mapping.csv");
  const output = path.join(temp, "reports");
  const dryOutput = path.join(temp, "dry-reports");
  const partialOutput = path.join(temp, "partial-reports");
  await writeFile(mapping, csv, "utf8");

  const exitCode = await runGate([
    "--base-url", `http://127.0.0.1:${port}`,
    "--mapping", mapping,
    "--output-dir", output,
    "--concurrency", "2",
    "--no-fail",
  ]);
  assert.equal(exitCode, 0);

  const report = JSON.parse(await readFile(path.join(output, "latest.json"), "utf8"));
  assert.equal(report.summary.total, 8);
  assert.deepEqual(report.rows.map((row) => row.Verdikt), [
    "PASS",
    "PASS",
    "PASS",
    "DOČASNÝ REDIRECT",
    "410 OK",
    "SOFT 404",
    "404",
    "REDIRECT CHAIN",
  ]);
  assert.equal(report.summary.httpTested, 8);
  assert.equal(report.summary.reclassifiedByV69, 3);
  assert.equal(report.summary.unresolved, 0);
  assert.equal(report.summary.readyForDns, false);

  const dryCode = await runGate([
    "--mapping", mapping,
    "--output-dir", dryOutput,
    "--dry-run",
    "--no-fail",
  ]);
  assert.equal(dryCode, 0);

  const dryReport = JSON.parse(await readFile(path.join(dryOutput, "latest.json"), "utf8"));
  assert.equal(dryReport.summary.httpTested, 0);
  assert.equal(dryReport.summary.pass, 0);
  assert.equal(dryReport.summary.blocking, 8);
  assert.equal(dryReport.summary.readyForDns, false);
  assert.ok(dryReport.rows.every((row) => row.Verdikt === "NEOVERENÉ HTTP"));

  const partialCode = await runGate([
    "--base-url", `http://127.0.0.1:${port}`,
    "--mapping", mapping,
    "--output-dir", partialOutput,
    "--limit", "2",
    "--no-fail",
  ]);
  assert.equal(partialCode, 0);

  const partialReport = JSON.parse(await readFile(path.join(partialOutput, "latest.json"), "utf8"));
  assert.equal(partialReport.summary.mappingTotal, 8);
  assert.equal(partialReport.summary.total, 2);
  assert.equal(partialReport.summary.blocking, 0);
  assert.equal(partialReport.summary.partialSelection, true);
  assert.equal(partialReport.summary.readyForDns, false);

  console.log("Migration Gate test: OK");
} finally {
  server.close();
  await rm(temp, { recursive: true, force: true });
}
