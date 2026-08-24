import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensurePrivateDir, readSignedJson, writeSignedJson, TM_DATA_ROOT } from './secure-persistence.ts';

export type MarketingCreative={id:string;name:string;mime:string;bytes:number;width:number;height:number;aspectRatio:number;usage:string[];qualityScore:number;qualityState:'VÝBORNÉ'|'POUŽITEĽNÉ'|'UPRAVIŤ';qualityNotes:string[];createdAt:string};
const DIR=join(TM_DATA_ROOT,'marketing-v2','creatives'), META=join(DIR,'metadata.json');
const TYPES=new Map([['image/png','png'],['image/jpeg','jpg'],['image/webp','webp']]);
const clean=(v:unknown,max=120)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);

export function imageDimensions(data:Buffer,mime:string):{width:number;height:number}|null{
  if(mime==='image/png'&&data.length>=24&&data.subarray(1,4).toString()==='PNG')return{width:data.readUInt32BE(16),height:data.readUInt32BE(20)};
  if(mime==='image/webp'&&data.length>=30&&data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP'){
    const kind=data.subarray(12,16).toString();
    if(kind==='VP8X')return{width:1+data.readUIntLE(24,3),height:1+data.readUIntLE(27,3)};
    if(kind==='VP8 '&&data.length>=30)return{width:data.readUInt16LE(26)&0x3fff,height:data.readUInt16LE(28)&0x3fff};
    if(kind==='VP8L'&&data.length>=25){const bits=data.readUInt32LE(21);return{width:(bits&0x3fff)+1,height:((bits>>14)&0x3fff)+1};}
  }
  if(mime==='image/jpeg'&&data.length>=4&&data[0]===0xff&&data[1]===0xd8){let i=2;while(i+9<data.length){if(data[i]!==0xff){i++;continue}const marker=data[i+1];if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return{height:data.readUInt16BE(i+5),width:data.readUInt16BE(i+7)};const size=data.readUInt16BE(i+2);if(size<2)break;i+=2+size;}}
  return null;
}
function usage(width:number,height:number){const ratio=width/height,out:string[]=[];if(width>=1200&&height>=628&&ratio>=1.8&&ratio<=2.0)out.push('landscape');if(width>=1200&&height>=1200&&ratio>=.95&&ratio<=1.05)out.push('square');if(width>=960&&height>=1200&&ratio>=.75&&ratio<=.85)out.push('portrait');return out;}
function quality(width:number,height:number,bytes:number,uses:string[]){let score=100;const notes:string[]=[];if(width<600||height<600){score-=35;notes.push('Nízke rozlíšenie pre kvalitnú reklamu.')}if(!uses.length){score-=35;notes.push('Pomer strán nezodpovedá hlavným Google formátom.')}if(bytes<20_000){score-=15;notes.push('Veľmi malý súbor môže mať nízku obrazovú kvalitu.')}if(bytes>5*1024*1024){score-=10;notes.push('Veľký súbor odporúčame optimalizovať.')}score=Math.max(0,score);return{qualityScore:score,qualityState:(score>=85?'VÝBORNÉ':score>=60?'POUŽITEĽNÉ':'UPRAVIŤ') as MarketingCreative['qualityState'],qualityNotes:notes}}
export async function readMarketingCreatives(){const data=await readSignedJson<{items:MarketingCreative[]}>(META);return Array.isArray(data?.items)?data!.items:[];}
export async function saveMarketingCreative(file:File,name?:string){
  if(!TYPES.has(file.type))throw new Error('Povolené sú iba JPG, PNG a WebP obrázky.');
  if(file.size<100||file.size>10*1024*1024)throw new Error('Obrázok musí mať 100 B až 10 MB.');
  const data=Buffer.from(await file.arrayBuffer()),dimensions=imageDimensions(data,file.type);
  if(!dimensions||dimensions.width<300||dimensions.height<300||dimensions.width>10000||dimensions.height>10000)throw new Error('Obrázok je poškodený alebo má nepovolené rozmery. Minimum je 300 × 300 px.');
  const id=randomUUID(),ext=TYPES.get(file.type)!;await ensurePrivateDir(DIR);const target=join(DIR,`${id}.${ext}`),temp=`${target}.${process.pid}.tmp`;await writeFile(temp,data,{mode:0o600});await rename(temp,target);
  const uses=usage(dimensions.width,dimensions.height),item:MarketingCreative={id,name:clean(name||file.name)||'Reklamný obrázok',mime:file.type,bytes:file.size,width:dimensions.width,height:dimensions.height,aspectRatio:Number((dimensions.width/dimensions.height).toFixed(4)),usage:uses,...quality(dimensions.width,dimensions.height,file.size,uses),createdAt:new Date().toISOString()};
  const items=await readMarketingCreatives();await writeSignedJson(META,{items:[item,...items].slice(0,1000)});return item;
}
export async function readMarketingCreativeFile(id:string){const item=(await readMarketingCreatives()).find(x=>x.id===id);if(!item)return null;const ext=TYPES.get(item.mime);if(!ext)return null;return{item,data:await readFile(join(DIR,`${item.id}.${ext}`))};}
