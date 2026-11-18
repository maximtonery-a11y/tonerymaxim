// A fresh Astro process must finish a persisted order after only a healthcheck.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readSignedJson, writeSignedJson } from '../src/lib/secure-persistence.ts';

const root = await mkdtemp(join(tmpdir(), 'tm-restart-'));
const secret = randomBytes(32).toString('hex');
process.env.TM_PERSISTENCE_SECRET = secret;
const id = '349812';
const stamp = new Date().toISOString();
const job = {
  id, source: { orderNumber: id, contact: {}, currency: 'EUR' }, status: 'pending', attempts: 0,
  createdAt: stamp, updatedAt: stamp, wooOrderId: 721, emailSentAt: stamp, adminEmailSentAt: stamp,
};
const queue = join(root, 'async-orders');
const destination = join(queue, 'done', id + '.json');
const usedPort = createServer();
await new Promise(resolve => usedPort.listen(0, '127.0.0.1', resolve));
const port = usedPort.address().port;
await new Promise(resolve => usedPort.close(resolve));
let child, exited, log = '';
try {
  await writeSignedJson(join(queue, 'pending', id + '.json'), job);
  const calls = join(root, 'writes.jsonl');
  await writeFile(calls, '');
  const shim = join(root, 'offline.mjs');
  await writeFile(shim, `
    import { appendFile } from 'node:fs/promises';
    import os from 'node:os';
    try { os.networkInterfaces(); } catch { os.networkInterfaces = () => ({}); }
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      await appendFile(${JSON.stringify(calls)}, JSON.stringify([init.method, url.pathname, init.body]) + '\\n');
      if (url.origin !== 'https://woo.example.invalid' || url.pathname !== '/wp-json/wc/v3/orders/721' || init.method !== 'PUT') throw Error('Unexpected transport in offline order test');
      return Response.json({id:721});
    };
  `);
  child = spawn(process.execPath, ['--import', shim, 'dist/server/entry.mjs'], { env: {
    PATH: process.env.PATH, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
    WOO_URL: 'https://woo.example.invalid', WOO_CONSUMER_KEY: 'fixture', WOO_CONSUMER_SECRET: 'fixture',
    AUTH_SECRET: secret, TM_PERSISTENCE_SECRET: secret, TM_PERSISTENT_DATA_DIR: root, TM_CACHE_DIR: join(root, 'product-cache'),
    TM_ASYNC_ORDER_WORKER_START_DELAY_MS: '5000', TM_DISABLE_INDEXNOW: '1', OPENAI_ASSISTANT_ENABLED: '0',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  exited = new Promise(resolve => child.once('exit', resolve));
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log += data; });
  const deadline = Date.now() + 25_000;
  while (!log.includes('Server listening') && child.exitCode == null && Date.now() < deadline) await delay(50);
  assert.match(log, /Server listening/);
  const health = await fetch('http://127.0.0.1:' + port + '/api/health', { signal: AbortSignal.timeout(5000) });
  await health.arrayBuffer();
  let done;
  while (!done && child.exitCode == null && Date.now() < deadline) {
    done = await readSignedJson(destination);
    if (!done) await delay(100);
  }
  assert.equal(done?.status, 'done', 'Pending order was not resumed after a healthcheck. ' + log);
  assert.equal(done.wooOrderId, job.wooOrderId);
  assert.equal(done.source.orderNumber, id);
  const writes = (await readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].slice(0, 2), ['PUT', '/wp-json/wc/v3/orders/721']);
  assert.ok(JSON.parse(writes[0][2]).meta_data.some(item => item.key === 'tm_order_number' && item.value === id));
  console.log('A healthcheck resumed a persisted order without creating another Woo order.');
} finally {
  if (child) { child.kill('SIGTERM'); await exited; }
  await rm(root, { recursive: true, force: true });
}
