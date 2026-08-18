/** V14 regression scenarios – cena za stranu. Run inside the full ToneryMAXIM project. */
const scenarios = [
  'Mám Brother HL-L2352DW, ktorý toner má najlepší pomer cena za jednu stranu?',
  'Do HP LaserJet M110w čo vychádza najlacnejšie na jednu stranu?',
  'Porovnaj mi originálny a kompatibilný toner do Brother DCP-L2532DW podľa ceny za stranu.',
  'Ktorý toner do OKI C301 má najlepší pomer ceny a výťažnosti?',
  'Mám Canon MF3010, koľko približne stojí jedna strana?',
  'Potrebujem TN2421, ktorý variant vychádza najlacnejšie na stranu?',
  'Potrebujem CF283A, porovnaj cenu za stranu.',
  'Ktorý W1420A je najvýhodnejší na jednu stranu?',
  'Ak produkt nemá uvedenú kapacitu, nevymýšľaj cenu za stranu.',
];
console.log(`V14 cost-per-page regression: ${scenarios.length} scenarios prepared.`);
for (const q of scenarios) console.log('-', q);
