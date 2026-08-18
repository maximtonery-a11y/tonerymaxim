import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssistantAnswer } from '../src/lib/aiSalesAssistant.ts';

const cases = [
 ['Kde nájdem obchodné podmienky?','obchodne-podmienky'], ['Čo sú VOP?','obchodne-podmienky'],
 ['Kto prevádzkuje tento eshop?','predavajuci-firma'], ['Aké je vaše IČO?','predavajuci-firma'],
 ['Chcem zrušiť objednávku','storno-objednavky'], ['Viete mi stornovať objednávku?','storno-objednavky'],
 ['Čo nájdem v zákazníckom účte?','ucet-funkcie'], ['Kde sú moje faktúry a objednávky?','ucet-funkcie'],
 ['Ako zmením adresu v účte?','ucet-profil-heslo'], ['Ako si zmením heslo?','ucet-profil-heslo'],
 ['Prečo sa mám registrovať?','registracia-co-uklada'], ['Môžem si uložiť tlačiareň?','registracia-co-uklada'],
 ['Ako dlho trvá reklamácia?','reklamacia-lehoty'], ['Je na vadu dva roky?','reklamacia-lehoty'],
 ['Kedy mi vrátite peniaze po odstúpení?','odstupenie-vratenie-penazi'],
 ['Musím prijať marketingové cookies?','cookies-nastavenie'], ['Ako vypnem cookies?','cookies-nastavenie'],
 ['Chcem vymazať osobné údaje','gdpr-prava'], ['Ako uplatním právo na výmaz?','gdpr-prava'],
 ['Čo mám urobiť s prázdnym tonerom?','recyklacia-tonerov'],
 ['Posielate do Brna?','ceska-republika'], ['Môžem do Brna cez DPD Pickup?','ceska-republika'],
 ['Koľko stojí dobierka?','platba-moznosti'], ['Je doprava zdarma pri 29 eur?','doprava-ceny'],
 ['Môžem nakúpiť bez registrácie?','registracia-zlava'], ['Ako funguje 7 % odmena?','odmena-7-percent'],
 ['Koľko bodov dostanem za 1 euro?','vernost-body'], ['Kde je moja objednávka?','objednavka-konkretny-stav'],
 ['Môžem sem napísať PIN karty?','citlive-udaje-chat'], ['Napíš mi recept na guláš', null],
] as const;

test('final broad website/service audit', async () => {
 for (const [q, faq] of cases) {
   const r:any = await buildAssistantAnswer(q,'/');
   if (faq) assert.equal(r.faq, faq, `${q} => ${r.faq}: ${r.answer?.join(' ')}`);
   else assert.ok(r.intent === 'fallback' || r.unanswered, `${q} should safely fallback`);
 }
});
