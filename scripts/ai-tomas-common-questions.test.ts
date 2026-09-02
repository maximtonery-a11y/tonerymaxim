import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssistantAnswer } from '../src/lib/aiSalesAssistant.ts';
import { routeCommerceMessage } from '../src/lib/ai-commerce/router.ts';
import { emptyCommerceState } from '../src/lib/ai-commerce/domain.ts';
import { advisorLinks } from '../src/lib/ai-advisor-links.ts';

process.env.OPENAI_ASSISTANT_ENABLED='0';

type Spec={name:string;intent:string;faq:string;bases:string[];required:RegExp[];forbidden?:RegExp[];link?:RegExp};
const specs:Spec[]=[
 {name:'cena dopravy',intent:'shipping',faq:'doprava-ceny',bases:['Koľko stojí doprava?','Aké máte poštovné?','Koľko zaplatím za kuriéra?','Je doprava od 29 € zdarma?','Koľko stojí doručenie do boxu?'],required:[/3,90 €/,/2,90 €/,/29 €/],link:/doprava-a-platba/},
 {name:'čas doručenia',intent:'order',faq:'expedicia-kedy-posleme',bases:['Kedy mi bude doručená objednávka?','Ako rýchlo doručujete?','Kedy odošlete môj balík?','Objednal som dnes, kedy zásielku pošlete?','Koľko dní trvá doručenie?'],required:[/15:00/,/1–2 pracovné dni/,/Stav objednávky/],forbidden:[/nemá prístup k stavu/]},
 {name:'zabudnuté heslo',intent:'account',faq:'ucet-heslo',bases:['Zabudol som heslo, čo mám robiť?','Neviem sa prihlásiť.','Obnova hesla mi nejde.','Mám nesprávne heslo.','E-mail na obnovu hesla mi neprišiel.'],required:[/Zabudnuté heslo/i,/e-mail/i,/spam/i],link:/zabudnute-heslo/},
 {name:'Packeta',intent:'shipping',faq:'doprava-packeta',bases:['Posielate cez Packetu?','Doručujete Packetou?','Máte Zásielkovňu?','Môžem si vybrať Z-BOX?','Viete zásielku poslať do Zásielkovne?'],required:[/Cez Packetu ani Zásielkovňu momentálne neposielame/,/GLS/,/DPD/],forbidden:[/nemám.*spoľahlivú odpoveď/i],link:/doprava-a-platba/},
 {name:'osobný odber',intent:'shipping',faq:'doprava-osobny-odber',bases:['Je možnosť osobného odberu?','Máte osobný odber?','Môžem si toner vyzdvihnúť osobne?','Máte predajňu na osobné vyzdvihnutie?','Dá sa objednávka prevziať na prevádzke?'],required:[/Osobný odber.*momentálne.*nie/is,/GLS/,/DPD/],link:/doprava-a-platba/},
 {name:'zľavy',intent:'loyalty',faq:'zlavy-prehlad',bases:['Viete mi poskytnúť zľavu?','Aké zľavy ponúkate?','Môžem dostať individuálnu zľavu?','Máte množstevné zľavy?','Akú zľavu dostanem pri väčšom nákupe?'],required:[/5 %/,/7 %/,/2–3 kusoch 10 %/,/4 a viac kusoch 25 %/,/Individuálnu zľavu AI Tomáš nemôže schváliť/],forbidden:[/Čo predáva ToneryMAXIM/]},
 {name:'možnosti platby',intent:'payment',faq:'platba-moznosti',bases:['Ako môžem zaplatiť?','Môžem zaplatiť kartou?','Ponúkate bankový prevod?','Dá sa platiť cez GoPay?','Aké sú možnosti platby?'],required:[/GoPay/,/dobierkou/,/bankovým prevodom/,/1,20 €/]},
 {name:'hotovosť a dobierka',intent:'payment',faq:'platba-hotovost',bases:['Môžem platiť v hotovosti?','Dá sa zaplatiť hotovosťou?','Chcem zaplatiť až pri prevzatí.','Prijímate hotovosť?','Ako zaplatím pri preberaní zásielky?'],required:[/hotovosti.*neponúkame/is,/dobierku/,/1,20 €/]},
 {name:'reklamácia',intent:'claim',faq:'reklamacia-postup',bases:['Ako reklamujem toner?','Toner nefunguje, čo mám robiť?','Prišiel mi poškodený tovar.','Poslali ste mi nesprávny toner.','Toner mi nepasuje do tlačiarne.'],required:[/info@tonerymaxim.sk/,/číslo objednávky/,/neposielajte na dobierku/i],link:/reklamacie|reklamacia-online/},
 {name:'vrátenie',intent:'claim',faq:'vratenie-tovaru',bases:['Chcem vrátiť tovar.','Objednal som nesprávny toner.','Do koľkých dní môžem odstúpiť?','Môžem toner vymeniť?','Kto zaplatí dopravu pri vrátení?'],required:[/14 dní/,/info@tonerymaxim.sk/,/neposielajte na dobierku/i],link:/odstupenie-od-zmluvy/},
 {name:'faktúra a firma',intent:'payment',faq:'faktura-firma',bases:['Dostanem faktúru?','Môžem objednať na firmu?','Kam zadám IČO?','Nakupujeme pre obec, môžeme dostať faktúru?','Ako vyplním firemné údaje?'],required:[/fakturačné údaje/i,/IČO/,/info@tonerymaxim.sk/]},
 {name:'doručenie do ČR',intent:'shipping',faq:'ceska-republika',bases:['Doručujete do Česka?','Pošlete toner do Brna?','Viete doručiť objednávku do Prahy?','Koľko stojí doprava do ČR?','Môžem si v Česku vybrať Pickup Box?'],required:[/iba klasickým kuriérom/,/3,90 €/,/od 29 €/,/neponúkame/]},
 {name:'kontakt',intent:'contact',faq:'kontakt',bases:['Aký máte telefón?','Aký je váš e-mail?','Kedy vám môžem zavolať?','Aká je pracovná doba?','Ako vás môžem kontaktovať?'],required:[/\+421 917 859 206/,/info@tonerymaxim.sk/,/9:00 do 15:00/],link:/kontakt/},
 {name:'registrácia',intent:'loyalty',faq:'registracia-zlava',bases:['Musím sa pred nákupom registrovať?','Môžem nakúpiť bez účtu?','Čo získam registráciou?','Aká je zľava za registráciu?','Ako dlho platí uvítacia zľava?'],required:[/bez registrácie/,/5 %/,/1 mesiac/],link:/registracia/},
 {name:'vernostné body',intent:'loyalty',faq:'vernost-body',bases:['Ako fungujú vernostné body?','Koľko bodov dostanem za nákup?','Akú hodnotu má 100 bodov?','Kde vidím svoje body?','Sú body rovnaké ako 7 % odmena?'],required:[/1 €.*1 vernostný bod/s,/100 bodov.*1 € zľavy/s,/samostatné od 7 % odmeny/]},
];

const wrappers=[(q:string)=>q,(q:string)=>`Dobrý deň, ${q}`,(q:string)=>`Prosím, ${q}`,(q:string)=>`${q} Ďakujem.`];
const cases=specs.flatMap((spec)=>spec.bases.flatMap((base)=>wrappers.map((wrap)=>({spec,question:wrap(base)}))));

test('bežná kontrola obsahuje presne 300 jedinečných otázok',()=>{
 assert.equal(cases.length,300);
 assert.equal(new Set(cases.map(({question})=>question.toLocaleLowerCase('sk-SK'))).size,300);
});

test('všetkých 300 bežných otázok má správny obsah, smerovanie a odkazy',async()=>{
 for(const {spec,question} of cases){
  const route=routeCommerceMessage(question,emptyCommerceState());
  assert.equal(route.needsProducts,false,`${spec.name}: ${question}`);
  assert.equal(route.productQuery,null,`${spec.name}: ${question}`);
  const answer:any=await buildAssistantAnswer(question,'/',[]);
  const text=answer.answer.join(' ');
  assert.equal(answer.intent,spec.intent,`${spec.name}: ${question}\n${text}`);
  assert.equal(answer.faq,spec.faq,`${spec.name}: ${question}\n${text}`);
  assert.deepEqual(answer.products||[],[],`${spec.name}: ${question}`);
  for(const required of spec.required)assert.match(text,required,`${spec.name}: ${question}\n${text}`);
  for(const forbidden of spec.forbidden||[])assert.doesNotMatch(text,forbidden,`${spec.name}: ${question}\n${text}`);
  const links=advisorLinks(answer);
  for(const link of links)assert.match(link.url,/^\/[a-z0-9/#?=&%.-]*$/i,`${spec.name}: ${link.url}`);
  if(spec.link)assert.ok(links.some((link)=>spec.link!.test(link.url)),`${spec.name}: chýba odkaz ${spec.link} pri ${question}`);
 }
});
