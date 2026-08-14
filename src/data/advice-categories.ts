export type AdviceCategorySlug =
  | "vyber-naplne"
  | "riesenie-problemov"
  | "cipy-firmware"
  | "naklady-vytaznost"
  | "udrzba-bezpecnost";

export type AdviceCategory = {
  slug: AdviceCategorySlug;
  name: string;
  shortName: string;
  description: string;
  question: string;
};

export const adviceCategories: AdviceCategory[] = [
  { slug: "vyber-naplne", name: "Výber správnej náplne", shortName: "Výber náplne", description: "Presný model tlačiarne, OEM kód, kapacita a rozdiel medzi originálnym, kompatibilným a renovovaným produktom.", question: "Ako vybrať správny toner alebo atrament bez rizika zámeny?" },
  { slug: "riesenie-problemov", name: "Riešenie problémov s tlačou", shortName: "Problémy s tlačou", description: "Diagnostické postupy pri hláseniach kazety, bledej tlači, pruhoch, bodkách a ďalších chybách výtlačku.", question: "Čo skontrolovať skôr, než vymeníte toner alebo zavoláte servis?" },
  { slug: "cipy-firmware", name: "Čipy, firmvér a rozpoznanie kazety", shortName: "Čipy a firmvér", description: "No chip kazety, ukazovateľ stavu, politika kaziet a vplyv aktualizácií firmvéru na alternatívne náplne.", question: "Prečo tlačiareň kazetu nerozpozná a akú úlohu má čip?" },
  { slug: "naklady-vytaznost", name: "Náklady, kapacita a výťažnosť", shortName: "Náklady a výťažnosť", description: "Cena za stranu, ISO výťažnosť, štandardné a XL kazety aj rozdiel medzi deklarovanou a reálnou kapacitou.", question: "Ako porovnať kazety podľa skutočných nákladov na tlač?" },
  { slug: "udrzba-bezpecnost", name: "Údržba, skladovanie a bezpečnosť", shortName: "Údržba a bezpečnosť", description: "Bezpečná výmena, čistenie, skladovanie, preprava a ekologické odovzdanie spotrebného materiálu.", question: "Ako predĺžiť životnosť tlačiarne a manipulovať s tonerom bezpečne?" },
];

export function findAdviceCategory(slug: unknown): AdviceCategory | undefined {
  const key = String(slug || "").trim().toLowerCase();
  return adviceCategories.find((category) => category.slug === key);
}
