#!/usr/bin/env node

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const temp = await mkdtemp(path.join(os.tmpdir(), "tm-migration-gate-"));
const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/old-redirect") { response.writeHead(301, { location: "/new-page" }); response.end(); return; }
  if (pathname === "/new-page") { response.writeHead(200, { "content-type": "text/html" }); response.end('<html><head><title>Nová</title><link rel="canonical" href="https://www.tonerymaxim.sk/new-page"></head><body><h1>Nová stránka</h1><p>' + "Obsah ".repeat(30) + '</p></body></html>'); return; }
  if (pathname === "/preserve") { response.writeHead(200, { "content-type": "text/html" }); response.end('<html><head><title>Zachovaná</title><link href="https://www.tonerymaxim.sk/preserve/" rel="canonical"></head><body><h1>Zachovaná stránka</h1><p>' + "Obsah ".repeat(30) + '</p></body></html>'); return; }
  if (pathname === "/soft-404") { response.writeHead(200, { "content-type": "text/html" }); response.end('<html><head><link rel="canonical" href="https://www.tonerymaxim.sk/soft-404"></head><body><h1>Stránka sa nenašla</h1><p>' + "Obsah ".repeat(30) + '</p></body></html>'); return; }
  response.writeHead(404, { "content-type": "text/html", "x-robots-tag": "noindex" }); response.end("<h1>404</h1>");
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const csv = `Stará URL;Typ;Navrhovaná nová URL;Akcia;Stav mapovania;Istota;Dôvod / poznámka;Kandidát slug;Kandidát názov;Skóre zhody\nhttps://www.tonerymaxim.sk/old-redirect;static;https://www.tonerymaxim.sk/new-page;301;JEDNOZNAČNÉ;vysoká;;;;\nhttps://www.tonerymaxim.sk/preserve;static;https://www.tonerymaxim.sk/preserve;200 ZACHOVAŤ;ZHODA;vysoká;;;;\nhttps://www.tonerymaxim.sk/soft-404;static;https://www.tonerymaxim.sk/soft-404;200 ZACHOVAŤ;ZHODA;vysoká;;;;\nhttps://www.tonerymaxim.sk/unresolved;product;;MANUÁLNE;BEZ KANDIDÁTA;nízka;;;;\n`;
const mapping = path.join(temp, "mapping.csv");
const output = path.join(temp, "reports");
await writeFile(mapping, csv, "utf8");

const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["scripts/migration-gate.mjs", "--base-url", `http://127.0.0.1:${port}`, "--mapping", mapping, "--output-dir", output, "--concurrency", "2", "--no-fail"], { stdio: "inherit" });
  child.on("error", reject); child.on("exit", (code) => resolve(code));
});
assert.equal(exitCode, 0);
const report = JSON.parse(await readFile(path.join(output, "latest.json"), "utf8"));
assert.equal(report.summary.total, 4);
assert.equal(report.rows[0].Verdikt, "PASS");
assert.equal(report.rows[1].Verdikt, "PASS");
assert.equal(report.rows[2].Verdikt, "SOFT 404");
assert.equal(report.rows[3].Verdikt, "404");
assert.equal(report.summary.unresolved, 1);
assert.equal(report.summary.readyForDns, false);
console.log("Migration Gate test: OK");
server.close();
await rm(temp, { recursive: true, force: true });
