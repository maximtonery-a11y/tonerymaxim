// Runs before npm build in Coolify and CI. No production credentials or HTTP.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const temp = await mkdtemp(join(tmpdir(), 'tm-release-guard-'));
const preload = join(temp, 'offline.mjs');
await writeFile(preload, "globalThis.fetch=async()=>{throw new Error('Release guard prohibits external HTTP');};\n");
const tests = ['printer-api-cache', 'printer-alias-regression', 'search-prefix-regression', 'product-cache-streaming', 'product-cache-generation-race',
  'memory-v1-regression', 'memory-v1-sync', 'morning-audit-regression', 'checkout-empty-cart',
  'checkout-hard-regression', 'gopay-recovery-regression', 'ai-price-question-v21', 'ai-tomas-product-context', 'ai-tomas-browser-flow', 'hp-toner-help', 'order-workflow', 'security-config', 'security-hardening', 'mail-security'];
const args = ['--import', preload, '--experimental-strip-types', '--test', '--test-concurrency=2', ...tests.map(name => `scripts/${name}.test.ts`), 'scripts/live-stability-check.test.mjs', 'scripts/search-client-resilience.test.mjs'];
const env = { PATH: process.env.PATH, NODE_ENV: 'test', TM_CACHE_DIR: temp,
  TM_DISABLE_BACKGROUND_WORKERS: '1', TM_DISABLE_INDEXNOW: '1', OPENAI_ASSISTANT_ENABLED: '0' };
try {
  const child = spawn(process.execPath, args, { env, stdio: 'inherit' });
  const timer = setTimeout(() => child.kill('SIGTERM'), 120000); timer.unref();
  const { code, signal } = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timer));
  if (code !== 0 || signal) throw new Error(`Critical release checks failed (${signal || code}); build stopped.`);
  console.log('Critical release checks passed; production build may continue.');
} finally { await rm(temp, { recursive: true, force: true }); }
