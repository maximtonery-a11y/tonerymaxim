// Runs every npm test group with bounded concurrency and no external fetches.
// node scripts/verify-predeploy-regressions.mjs --catalog /abs/products.json --output /abs/report-directory
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2), option = name => args[args.indexOf('--' + name) + 1];
if (!args.includes('--catalog') || !args.includes('--output')) throw new Error('--catalog and --output are required');
const root = process.cwd(), output = resolve(option('output')), input = resolve(option('catalog'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const groups = ['ads', 'search', 'performance', 'woo', 'dpd', 'seo', 'migration', 'security', 'price-history', 'production', 'ai:regression'];
const temp = await mkdtemp(join(tmpdir(), 'tm-predeploy-regressions-'));
const guard = join(temp, 'offline.mjs');
const fixture = join(root, '.tm-cache', 'products.json');
const previousFixture = await readFile(fixture).catch(() => null);
await mkdir(output, { recursive: true }); await mkdir(join(root, '.tm-cache'), { recursive: true });
// A few historical catalogue assertions explicitly read this development path.
// Preserve any existing file and restore it after the run.
if (input !== fixture) await copyFile(input, fixture);
await mkdir(join(temp, 'cache')); await copyFile(input, join(temp, 'cache', 'products.json'));
await writeFile(guard, `const original=globalThis.fetch;globalThis.fetch=async(input,...args)=>{const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Predeploy test prohibits external requests: '+url.origin);return original(input,...args);};`);
const env = { PATH: process.env.PATH, NODE_ENV: 'test', TM_CACHE_DIR: join(temp, 'cache'),
  TM_DISABLE_BACKGROUND_WORKERS: '1', TM_DISABLE_INDEXNOW: '1', OPENAI_ASSISTANT_ENABLED: '0' };
const results = [], sourceFingerprints = {};
for (const path of ['src/lib/ai-commerce/catalog.ts','src/lib/catalog-seo-text.ts','src/lib/tm-products-cache.ts','src/pages/api/smart-search.ts']) {
  sourceFingerprints[path] = createHash('sha256').update(await readFile(join(root,path))).digest('hex');
}
async function run(name, args) {
  const startedAt = new Date().toISOString(), start = performance.now();
  const child = spawn(process.execPath, ['--import', guard, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  await writeFile(join(output, `suite-${name.replaceAll(':','-')}.log`), log);
  const metric = k => Number(log.match(new RegExp(`^# ${k} (\\d+)`, 'm'))?.[1] || 0);
  const result = { name, startedAt, exitCode: code, durationMs: Math.round(performance.now() - start), tests: metric('tests'), pass: metric('pass'), fail: metric('fail'), skipped: metric('skipped'), failures: [...log.matchAll(/^not ok[^\n]*/gm)].map(m => m[0]) };
  results.push(result); console.log(JSON.stringify(result));
  await writeFile(join(output, 'full-suite.json'), JSON.stringify({ sourceFingerprints, results }, null, 2));
}
try {
  for (const name of groups) {
    const files = [...new Set(pkg.scripts['test:' + name].match(/scripts\/[a-zA-Z0-9_.-]+\.test\.(?:ts|mjs)/g) || [])];
    const migration = files.filter(f => f.endsWith('migration-gate.test.mjs'));
    await run(name, ['--experimental-strip-types', '--test', '--test-reporter=tap', '--test-concurrency=2', ...files.filter(f => !migration.includes(f))]);
    for (const f of migration) await run('migration-gate', [f]);
  }
  await run('extra-purchase', ['--experimental-strip-types', '--test', '--test-reporter=tap', '--test-concurrency=2', 'scripts/checkout-hard-regression.test.ts', 'scripts/gopay-recovery-regression.test.ts', 'scripts/ai-price-question-v21.test.ts', 'scripts/order-workflow.test.ts']);
  const total = results.reduce((a, r) => ({ tests: a.tests + r.tests, pass: a.pass + r.pass, fail: a.fail + r.fail, skipped: a.skipped + r.skipped }), { tests: 0, pass: 0, fail: 0, skipped: 0 });
  console.log('TOTAL ' + JSON.stringify(total)); if (results.some(r => r.exitCode !== 0)) process.exitCode = 1;
} finally {
  if (input !== fixture) { if (previousFixture) await writeFile(fixture, previousFixture); else await rm(fixture, { force:true }); }
  await rm(temp, { recursive:true, force:true });
}
