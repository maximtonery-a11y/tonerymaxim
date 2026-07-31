#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    skipBuild: false,
    noServer: false,
    baseUrl: "http://127.0.0.1:4399",
  };
  const forwarded = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--skip-build") {
      options.skipBuild = true;
    } else if (arg === "--no-server") {
      options.noServer = true;
    } else if (arg === "--base-url" && args[index + 1]) {
      options.baseUrl = args[index + 1];
      forwarded.push(arg, args[index + 1]);
      index += 1;
    } else {
      forwarded.push(arg);
    }
  }

  if (!forwarded.includes("--base-url")) {
    forwarded.push("--base-url", options.baseUrl);
  }

  return { options, forwarded };
}

function run(bin, args, env = process.env, extraOptions = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: "inherit",
      env,
      windowsHide: false,
      ...extraOptions,
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${bin} bol ukončený signálom ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

function strongOr(value, fallback, minimumLength) {
  const text = String(value || '').trim();
  const normalized = text.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const placeholder = [
    'SEM_VLOZTE',
    'CHANGE_ME',
    'CHANGEME',
    'REPLACE_ME',
    'YOUR_SECRET',
    'EXAMPLE_SECRET',
    'LOCAL_DEVELOPMENT_SECRET',
  ].some((marker) => normalized.includes(marker));
  return text.length >= minimumLength && !placeholder ? text : fallback;
}

async function runNpm(args, env = process.env) {
  // Keď je runner spustený cez `npm run`, npm poskytne cestu k npm-cli.js.
  // Spustenie cez Node je na Windows spoľahlivejšie než priame spawn("npm.cmd"),
  // ktoré na niektorých verziách Node/Windows končí chybou spawn EINVAL.
  const npmExecPath = process.env.npm_execpath;

  if (npmExecPath && existsSync(npmExecPath)) {
    return run(process.execPath, [npmExecPath, ...args], env);
  }

  if (process.platform === "win32") {
    return run("cmd.exe", ["/d", "/s", "/c", "npm", ...args], env, {
      windowsVerbatimArguments: false,
    });
  }

  return run("npm", args, env);
}

async function waitForServer(baseUrl, timeoutMs = 45_000) {
  const started = Date.now();
  const healthUrl = new URL("/api/health", baseUrl);

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(healthUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(3_000),
      });

      const body = await response.json().catch(() => null);
      if (response.ok && body?.ok === true) return;
    } catch {
      // Server sa ešte spúšťa.
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  throw new Error(
    `Server sa nespustil do ${Math.round(timeoutMs / 1000)} sekúnd: ${baseUrl}`,
  );
}

async function warmProductsCache(baseUrl, timeoutMs = 10 * 60_000) {
  const cacheUrl = new URL("/api/cache-status", baseUrl);
  let lastDetail = "bez odpovede";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(cacheUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await response.json().catch(() => null);
      const total = Number(body?.total || 0);
      if (response.ok && body?.ok === true && total >= 100) {
        console.log(
          `Produktová cache pripravená: ${total} produktov, aktualizácia ${body.generated_at || "neznáma"}.`,
        );
        return;
      }
      lastDetail = body?.error || `HTTP ${response.status}, produkty ${total}`;
    } catch (error) {
      lastDetail = error?.message || String(error);
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 3_000));
  }

  throw new Error(
    `Produktová cache nie je pripravená (${lastDetail}). Skontrolujte WOO_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET a pripojenie na WooCommerce.`,
  );
}

async function stopServer(server) {
  if (!server || server.exitCode !== null || server.killed) return;

  if (process.platform === "win32") {
    // Ukončí aj prípadné podradené procesy servera.
    await run("taskkill.exe", ["/pid", String(server.pid), "/t", "/f"]).catch(
      () => undefined,
    );
    return;
  }

  server.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (server.exitCode === null && !server.killed) server.kill("SIGKILL");
}

async function main() {
  const { options, forwarded } = parseArgs(process.argv.slice(2));

  if (!options.skipBuild && !options.noServer) {
    console.log("\n[1/4] Produkčný Astro build\n");
    const buildCode = await runNpm(["run", "build"]);

    if (buildCode !== 0) {
      throw new Error(`Astro build zlyhal (exit ${buildCode}).`);
    }
  }

  let server = null;

  try {
    if (!options.noServer) {
      console.log("\n[2/4] Spúšťam produkčný server\n");

      const url = new URL(options.baseUrl);
      const localAuthSecret = '8f63c4de01b642a899b9a95e8a2d76bc4c4d45337bb74afe';
      const localPersistenceSecret = 'f0986ef3d1ab45f79f5430fe3386d6729223455376a24520';
      const localSyncSecret = '9208cfae89a14c9a925fc19d053beabf';
      const localAdminSecret = '3651369ca30a45a5b4d9471a8f646888';
      const env = {
        ...process.env,
        HOST: url.hostname,
        PORT: url.port || (url.protocol === "https:" ? "443" : "80"),
        AUTH_SECRET: strongOr(process.env.AUTH_SECRET, localAuthSecret, 32),
        TM_PERSISTENCE_SECRET: strongOr(
          process.env.TM_PERSISTENCE_SECRET,
          localPersistenceSecret,
          32,
        ),
        SYNC_SECRET: strongOr(process.env.SYNC_SECRET, localSyncSecret, 24),
        ADMIN_API_SECRET: strongOr(
          process.env.ADMIN_API_SECRET,
          localAdminSecret,
          24,
        ),
        TM_DISABLE_BACKGROUND_WORKERS: "1",
      };

      server = spawn(process.execPath, ["./dist/server/entry.mjs"], {
        stdio: "inherit",
        env,
        windowsHide: false,
      });

      server.once("error", (error) => {
        console.error("Server chyba:", error);
      });

      await waitForServer(options.baseUrl);

      console.log("\n[3/4] Pripravujem produktovú cache\n");
      await warmProductsCache(options.baseUrl);
    }

    console.log(
      `\n[${options.noServer ? "3/3" : "4/4"}] Kontrola URL mapovania\n`,
    );
    const code = await run(process.execPath, [
      "scripts/migration-gate.mjs",
      ...forwarded,
    ]);
    process.exitCode = code;
  } finally {
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(`\nMIGRATION GATE RUNNER CHYBA: ${error?.stack || error}`);
  process.exitCode = 1;
});
