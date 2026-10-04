// Read-only sampler. Run manually; it never triggers a catalogue sync.
import { appendFile } from 'node:fs/promises';
const args = process.argv.slice(2);
const option = (name, fallback) => { const i=args.indexOf(name); return i<0 ? fallback : args[i+1]; };
const base = option('--url','https://www.tonerymaxim.sk');
const samples = Number(option('--samples','864'));
const seconds = Number(option('--interval','300'));
const output = option('--output','memory-v1.jsonl');
if (!Number.isInteger(samples) || samples<1 || !Number.isFinite(seconds) || seconds<5) throw new Error('Invalid samples/interval');
const url = new URL('/api/storefront-check', base);
console.log(`Read-only monitoring: ${url}; ${samples} samples, ${seconds}s apart; ${output}. Keep this process running.`);
for(let i=0;i<samples;i++) {
  const started=performance.now();
  let sample;
  try {
    const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(20000)});
    sample={sample:i+1,observedAt:new Date().toISOString(),status:response.status,elapsedMs:Math.round(performance.now()-started),data:await response.json()};
  } catch(error) { sample={sample:i+1,observedAt:new Date().toISOString(),error:String(error.message)}; }
  await appendFile(output,JSON.stringify(sample)+'\n','utf8');
  console.log(`${sample.observedAt}: ${sample.status ?? sample.error}, RSS ${sample.data?.checks?.rssMb ?? '?'} MB`);
  if(i+1<samples) await new Promise(resolve=>setTimeout(resolve,Math.max(0,seconds*1000-(performance.now()-started))));
}
