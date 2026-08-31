export type AiQuickPrompt = { label: string; question: string };

const common: AiQuickPrompt[] = [
  { label: 'Cena dopravy', question: 'Koľko stojí doprava?' },
  { label: 'Čas dodania', question: 'Koľko trvá dodanie?' },
  { label: 'Stav objednávky', question: 'Kde je moja objednávka?' },
];

export function quickPromptsForPath(pathname: string): AiQuickPrompt[] {
  const path = String(pathname || '/').toLowerCase();
  if (/^\/produkt\//.test(path)) return [
    { label: 'Pasuje do tlačiarne?', question: 'Do ktorých tlačiarní pasuje tento produkt?' },
    { label: 'Je skladom?', question: 'Je tento produkt skladom?' },
    { label: 'Originál alebo kompatibilný?', question: 'Aký je rozdiel medzi originálnym a kompatibilným tonerom?' },
    ...common.slice(0, 1),
  ];
  if (/^\/tlaciarne\//.test(path)) return [
    { label: 'Nájsť správny toner', question: 'Nájdite mi správny toner pre túto tlačiareň.' },
    { label: 'Kompatibilný alebo originál?', question: 'Aký toner sa mi viac oplatí: kompatibilný alebo originálny?' },
    { label: 'Problém s tlačou', question: 'Tlačiareň tlačí pásy. Čo mám skontrolovať?' },
    ...common.slice(0, 1),
  ];
  if (/^\/(kosik|pokladna)/.test(path)) return [
    { label: 'Cena dopravy', question: 'Koľko stojí doprava?' },
    { label: 'Spôsoby platby', question: 'Ako môžem zaplatiť?' },
    { label: 'Čas dodania', question: 'Koľko trvá dodanie?' },
    { label: 'Pomoc s nákupom', question: 'Pomôžte mi skontrolovať nákup.' },
  ];
  if (/^\/kalendare/.test(path)) return [
    { label: 'Aké kalendáre máte?', question: 'Aké kalendáre máte v ponuke?' },
    { label: 'Aké diáre máte?', question: 'Aké diáre máte v ponuke?' },
    { label: 'Množstevné zľavy', question: 'Aké sú množstevné zľavy na kalendáre?' },
    ...common.slice(0, 1),
  ];
  if (/^\/ucet\/objednavky/.test(path)) return [
    { label: 'Stav objednávky', question: 'Kde je moja objednávka?' },
    { label: 'Čas dodania', question: 'Koľko trvá dodanie?' },
    { label: 'Reklamácia', question: 'Ako môžem reklamovať objednávku?' },
  ];
  return [
    { label: 'Nájsť toner', question: 'Pomôžte mi nájsť správny toner.' },
    ...common,
  ];
}
