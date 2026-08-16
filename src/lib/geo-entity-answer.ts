import { isInkProduct, isTonerProduct, productOemCodes, productSearchText, type TmProduct } from "./seo-catalog.ts";

type GeoPilotLike = {
  productKind: string;
  selection: string;
  caution: string;
};

export type GeoEntityAnswer = {
  question: string;
  answer: string;
  bullets: string[];
};

function unique(values: string[], limit = 8): string[] {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].slice(0, limit);
}

function naturalList(values: string[]): string {
  if (values.length <= 1) return values[0] || "";
  if (values.length === 2) return `${values[0]} a ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} a ${values.at(-1)}`;
}

function inferKinds(products: TmProduct[]): string[] {
  const kinds: string[] = [];
  if (products.some(isTonerProduct)) kinds.push("tonerové kazety");
  if (products.some(isInkProduct)) kinds.push("atramentové náplne");
  if (products.some((product) => /\b(valec|drum|image drum|imaging unit|optick)/.test(productSearchText(product)))) kinds.push("optické valce alebo zobrazovacie jednotky");
  if (!kinds.length) kinds.push("spotrebný materiál");
  return unique(kinds, 3);
}

export function printerGeoAnswer(name: string, products: TmProduct[], pilot?: GeoPilotLike): GeoEntityAnswer {
  const codes = unique(products.flatMap(productOemCodes), 8);
  const kinds = inferKinds(products);
  const codeText = naturalList(codes);
  const question = kinds.length === 1 && kinds[0] === "atramentové náplne"
    ? `Aké náplne používa ${name}?`
    : `Aký toner alebo náplň používa ${name}?`;

  if (pilot) {
    return {
      question,
      answer: `${pilot.selection}${codes.length ? ` Aktuálne priradené produkty na tejto stránke obsahujú OEM označenia ${codeText}.` : ""} ${pilot.caution}`,
      bullets: [
        `Typ spotrebného materiálu: ${pilot.productKind}.`,
        ...(codes.length ? [`OEM označenia nájdené pri aktuálne priradených produktoch: ${codeText}.`] : []),
        "Pred objednaním potvrďte celý model tlačiarne a OEM kód v detaile konkrétneho produktu.",
      ],
    };
  }

  const answer = codes.length
    ? `Pre ${name} sú v aktuálnom katalógu ToneryMaxim.sk priradené ${naturalList(kinds)} s OEM označením ${codeText}. Vyberajte podľa celého OEM kódu, typu produktu, farby a kapacity uvedenej v detaile.`
    : `Pre ${name} sú v aktuálnom katalógu ToneryMaxim.sk priradené ${naturalList(kinds)} zobrazené na tejto stránke. Pred objednaním porovnajte celý model tlačiarne a údaje v detaile konkrétneho produktu.`;

  return {
    question,
    answer,
    bullets: [
      ...(codes.length ? [`OEM označenia v aktuálnej ponuke: ${codeText}.`] : []),
      `Typy spotrebného materiálu v ponuke: ${naturalList(kinds)}.`,
      "Podobné číslo modelu neznamená automaticky rovnakú náplň; rozhoduje celý model a OEM označenie.",
    ],
  };
}

export function oemGeoAnswer(code: string, products: TmProduct[], printers: string[], pilot?: GeoPilotLike): GeoEntityAnswer {
  const kinds = inferKinds(products);
  const printerList = unique(printers, 6);
  const question = `Čo je ${code} a pre ktoré tlačiarne je určený?`;

  if (pilot) {
    return {
      question,
      answer: `${code} je v katalógu ToneryMaxim.sk vedený ako ${pilot.productKind}. ${pilot.selection} ${pilot.caution}`,
      bullets: [
        `Typ produktu: ${pilot.productKind}.`,
        ...(printerList.length ? [`Medzi priradené modely patria ${naturalList(printerList)}.`] : []),
        "Konkrétnu kompatibilitu potvrďte v detaile produktu podľa celého OEM kódu a modelu tlačiarne.",
      ],
    };
  }

  const answer = printerList.length
    ? `${code} je OEM označenie pre ${naturalList(kinds)}. V aktuálnom katalógu ToneryMaxim.sk je priradené napríklad k modelom ${naturalList(printerList)}. Konkrétny variant vyberte podľa celého kódu, farby, kapacity a presného modelu tlačiarne.`
    : `${code} je OEM označenie pre ${naturalList(kinds)} evidované v aktuálnom katalógu ToneryMaxim.sk. Konkrétny variant vyberte podľa celého kódu, farby, kapacity a presného modelu tlačiarne.`;

  return {
    question,
    answer,
    bullets: [
      `Typ produktu podľa aktuálne priradených položiek: ${naturalList(kinds)}.`,
      ...(printerList.length ? [`Príklady priradených tlačiarní: ${naturalList(printerList)}.`] : []),
      "Rovnaký základ OEM kódu nemusí znamenať rovnakú farbu, kapacitu alebo balenie.",
    ],
  };
}
