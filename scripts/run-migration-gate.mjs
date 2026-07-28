#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    skipBuild: false,
    noServer: false,
    baseUrl: "http://127.0.0.1:4321",
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

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(baseUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(3_000),
      });

      if (response.status > 0) return;
    } catch {
      // Server sa ešte spúšťa.
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  throw new Error(
    `Server sa nespustil do ${Math.round(timeoutMs / 1000)} sekúnd: ${baseUrl}`,
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
    console.log("\n[1/3] Produkčný Astro build\n");
    const buildCode = await runNpm(["run", "build"]);

    if (buildCode !== 0) {
      throw new Error(`Astro build zlyhal (exit ${buildCode}).`);
    }
  }

  let server = null;

  try {
    if (!options.noServer) {
      console.log("\n[2/3] Spúšťam produkčný server\n");

      const url = new URL(options.baseUrl);
      const env = {
        ...process.env,
        HOST: url.hostname,
        PORT: url.port || (url.protocol === "https:" ? "443" : "80"),
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
    }

    console.log("\n[3/3] Kontrola URL mapovania\n");
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
