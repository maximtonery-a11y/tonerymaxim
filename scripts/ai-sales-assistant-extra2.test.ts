import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssistantAnswer } from '../src/lib/aiSalesAssistant.ts';
process.env.OPENAI_ASSISTANT_ENABLED='0';
const C:any[]=[
['kolko ma bude stat kurier','shipping'],['mam nakup za 28,99 doprava zdarma?','shipping'],['mam nakup presne 29 eur','shipping'],['mam kosik 30 eur ale po zlave 28 eur','shipping'],['dobierka sa rata do 29 eur?','shipping'],['chcem balik na adresu','shipping'],['chcem balik do boxu','shipping'],['parcel shop','shipping'],['pickup box','shipping'],
['posielate do ostravy','shipping'],['som v cesku','shipping'],['do brna cez box','shipping'],['do prahy kurierom','shipping'],['do ceska nad 29 eur','shipping'],['do ceska na parcelshop','shipping'],
['kolko stoji platba kartou','payment'],['je gopay spoplatneny','payment'],['kolko stoji prevod','payment'],['kolko stoji dobierka 1.20','payment'],['viete fakturu na firmu','payment'],['chcem fakturu na ico','payment'],
['musim sa registrovat aby som nakupil','loyalty'],['co mam z registracie','loyalty'],['dokedy plati 5 percent','loyalty'],['5 percent na prvy nakup','loyalty'],['co dostanem po objednavke','loyalty'],['ako pouzijem 7 percent','loyalty'],['mam 250 bodov kolko je to eur','loyalty'],['body sa pripisu aj bez registracie','loyalty'],
['kde je balik','order'],['mam tracking','order'],['objednal som dnes do 15','order'],['objednal som vecer kedy poslete','order'],['objednal som v sobotu','order'],['platim prevodom kedy expedujete','order'],
['prisla mi rozbita krabica','claim'],['toner bol poskodeny','claim'],['chcem odstupit od zmluvy','claim'],['vratim to do 14 dni','claim'],['mozem poslat reklamaciu na dobierku','claim'],['toner som otvoril a nepasuje','claim'],
['tlac ma biele pasy','diagnostic'],['robi to smuhy','diagnostic'],['farba je slaba','diagnostic'],['po vymene tonera netlaci','diagnostic'],['pise no toner','diagnostic'],['pise cartridge error','diagnostic'],['po aktualizacii firmware nepozna toner','diagnostic'],
['je kompatibilny toner original','compatibility'],['co je alternativa','compatibility'],['co je repasovany toner','compatibility'],['chcem lacnejsi ako original','compatibility'],['moze kompatibilny pokazit tlaciaren','compatibility'],
['ako zistim model tlaciarne','support'],['neviem ci mam toner alebo atrament','support'],['kde najdem oznacenie tonera','support'],
['daj telefon','contact'],['kedy ste na telefone','contact'],['mate otvorene v sobotu','contact'],['mail na vas','contact'],
['mozem napisat cislo objednavky','legal'],['mozem napisat iban','legal'],['mozem napisat rodne cislo','legal'],['mozem napisat adresu','legal'],['mozem napisat cislo karty','legal'],['mozem napisat pin','legal'],
['predavate kavu','fallback'],['potrebujem televizor','fallback'],['kolko je hodin','fallback'],['napis email manzelke','fallback'],['povedz vtip o tlaciarni','fallback'],['aky mate obrat','fallback'],['kolko mate zamestnancov','fallback'],['kto je majitel','fallback'],['daj mi zlavu 90 percent','fallback'],['mate kupon zdarma','fallback'],['urob mi fakturu','fallback'],['zrus mi objednavku','fallback'],['zmen mi adresu objednavky','fallback'],
];
for (const [q,intent] of C) test(q,async()=>{const r=await buildAssistantAnswer(q,'/');assert.equal(r.intent,intent,`answer=${r.answer.join(' ')}`);if(intent==='fallback')assert.equal((r.products||[]).length,0)});
