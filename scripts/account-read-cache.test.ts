import test from 'node:test';
import assert from 'node:assert/strict';
import { readAccountDisplay, invalidateAccountReads } from '../src/lib/account-read-cache.ts';

test('parallel account reads coalesce and completed reads stay private to customer and resource', async () => {
  invalidateAccountReads();
  let calls = 0;
  const load = async () => { calls++; await new Promise(r=>setTimeout(r,5)); return { count: 12 }; };
  const values = await Promise.all(Array.from({length:30},()=>readAccountDisplay(1,'orders:1',1000,load)));
  assert.equal(calls,1); assert.ok(values.every(value=>value.count===12));
  await readAccountDisplay(1,'orders:1',1000,load); assert.equal(calls,1);
  await readAccountDisplay(2,'orders:1',1000,load);
  await readAccountDisplay(1,'orders:2',1000,load);
  assert.equal(calls,3);
});

test('successful writes invalidate the owner without evicting another account', async () => {
  invalidateAccountReads();
  await readAccountDisplay(1,'orders:1',1000,async()=>1);
  await readAccountDisplay(2,'orders:1',1000,async()=>2);
  invalidateAccountReads(1);
  assert.equal(await readAccountDisplay(1,'orders:1',1000,async()=>3),3);
  assert.equal(await readAccountDisplay(2,'orders:1',1000,async()=>4),2);
});

test('an old in-flight response cannot overwrite data after invalidation', async () => {
  invalidateAccountReads();
  let finish!: (value:string)=>void;
  const old = readAccountDisplay(7,'orders:1',1000,()=>new Promise<string>(resolve=>{finish=resolve;}));
  await Promise.resolve(); invalidateAccountReads(7);
  const current = await readAccountDisplay(7,'orders:1',1000,async()=>'new');
  finish('old'); assert.equal(await old,'old'); assert.equal(current,'new');
  assert.equal(await readAccountDisplay(7,'orders:1',1000,async()=>'wrong'),'new');
});

test('errors and oversized histories are not retained and expired entries reload', async () => {
  invalidateAccountReads();
  await assert.rejects(readAccountDisplay(9,'orders:1',1000,async()=>{throw new Error('upstream');}));
  assert.equal(await readAccountDisplay(9,'orders:1',1,async()=>1),1);
  await new Promise(r=>setTimeout(r,5));
  assert.equal(await readAccountDisplay(9,'orders:1',1000,async()=>2),2);
  let calls=0; const big=async()=>{calls++;return 'x'.repeat(300_000);};
  await readAccountDisplay(10,'orders:1',1000,big); await readAccountDisplay(10,'orders:1',1000,big);
  assert.equal(calls,2);
});

test('cache size remains bounded and invalid identities never start a request', async () => {
  invalidateAccountReads();
  let calls=0;const load=async()=>++calls;
  for(let id=1;id<=150;id++)await readAccountDisplay(id,'orders:1',1000,load);
  await readAccountDisplay(1,'orders:1',1000,load);
  assert.equal(calls,151,'The oldest entry must have been evicted');
  for(const id of [0,-1,1.5,NaN])await assert.rejects(readAccountDisplay(id,'orders:1',1000,load));
  assert.equal(calls,151);
});
