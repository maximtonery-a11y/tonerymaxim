import benchmark from "../../data/geo-ai-benchmark.json";

type BenchmarkPrompt = {
  id: string;
  prompt: string;
  target: string;
  expected: string[];
};

const prompts = benchmark.prompts as BenchmarkPrompt[];

export function benchmarkForPath(path: string): BenchmarkPrompt | undefined {
  return prompts.find((item) => item.target === path);
}

export function benchmarkAnswer(subject: string, expected: string[], kind: "printer" | "oem"): string {
  const codes = expected.join(", ");
  if (kind === "printer") {
    return `Podľa aktuálneho katalógu ToneryMaxim.sk sú k modelu ${subject} priradené náplne alebo spotrebné diely s označením ${codes}. Pred objednaním porovnajte celý model tlačiarne, presný OEM kód, farbu a kapacitu v detaile produktu.`;
  }
  return `Na tejto stránke nájdete produkty rodiny ${codes} a tlačiarne, ku ktorým sú priradené v aktuálnom katalógu ToneryMaxim.sk. Konkrétnu kazetu vyberte podľa celého OEM kódu, farby, kapacity a presného modelu tlačiarne.`;
}

export const DEFAULT_GEO_GUIDES = [
  { href: "/poradna/ako-vybrat-toner-podla-modelu-tlaciarne", label: "Ako vybrať toner podľa modelu tlačiarne" },
  { href: "/poradna/ako-najst-toner-podla-oem-kodu", label: "Ako nájsť toner podľa OEM kódu" },
  { href: "/poradna/najcastejsie-chyby-pri-vybere-naplne", label: "Najčastejšie chyby pri výbere náplne" },
];
