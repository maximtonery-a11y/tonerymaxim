import { answerAiSalesQuestion } from '../src/lib/aiSalesAssistant';

const cases = [
  ['aka je tankova tlaciaren?', 'tanková'],
  ['pri akom type laser, tank, atrament je najlacnejsia tlac?', 'tanková'],
  ['ako sa pocita cena za jednu stranu?', 'delená'],
  ['ktore tonery maju najlepsi pomer cena za jednu stranku?', 'kompatibilnými'],
  ['odporuc mi najlacnejsi toner do ciernobielej tlaciarne', 'presný model'],
  ['odporuc najlacnejsi toner do farebnej tlaciarne', 'presný model'],
  ['aku tlaciaren kupit na vela ciernobielej tlace?', 'laserová'],
  ['co je lacnejsie na prevadzku laser alebo tank?', 'tanková'],
  ['preco moze byt drahsi toner vyhodnejsi?', 'kapacitou'],
];

let failed = 0;
for (const [q, expected] of cases) {
  const r = await answerAiSalesQuestion(q);
  const text = r.answer.join(' ');
  const ok = text.toLocaleLowerCase('sk').includes(expected.toLocaleLowerCase('sk'));
  console.log(ok ? 'PASS' : 'FAIL', q, '=>', text);
  if (!ok) failed++;
}
if (failed) process.exit(1);
