import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCodeSeo, buildProductSeo } from "../src/lib/catalog-seo-text.ts";
import {
  normalizeCanonical,
  normalizeSeoDescription,
  normalizeSeoTitle,
  SEO_DESCRIPTION_LIMIT,
  SEO_SITE_SUFFIX,
  SEO_TITLE_LIMIT,
} from "../src/lib/seo-snippet.ts";
import { oemEntities, validIndexableProduct } from "../src/lib/seo-catalog.ts";

const ORIGIN = "https://www.tonerymaxim.sk";

test("dlhý title zachová značku webu a limit", () => {
  const title = normalizeSeoTitle(`Veľmi dlhý názov produktu s množstvom označení a kompatibilných modelov tlačiarní${SEO_SITE_SUFFIX}`);
  assert.ok(title.length <= SEO_TITLE_LIMIT);
  assert.ok(title.endsWith(SEO_SITE_SUFFIX));
});

test("title odstráni HTML a nadbytočné medzery", () => {
  assert.equal(normalizeSeoTitle("  <b>HP W1420XL</b>   toner | ToneryMaxim.sk "), "HP W1420XL toner | ToneryMaxim.sk");
});

test("description je čistý text v bezpečnom limite", () => {
  const description = normalizeSeoDescription(`<p>${"Kompatibilný toner do tlačiarne skladom. ".repeat(10)}</p>`);
  assert.ok(description.length <= SEO_DESCRIPTION_LIMIT);
  assert.doesNotMatch(description, /[<>]/);
  assert.match(description, /[.!?]$/);
});

test("canonical vždy smeruje na produkčnú doménu a nemá fragment", () => {
  assert.equal(
    normalizeCanonical("https://tonerymaxim.info/produkt/test#popis", "/", ORIGIN),
    "https://www.tonerymaxim.sk/produkt/test",
  );
});

test("canonical odstráni marketingové a vyhľadávacie parametre", () => {
  assert.equal(
    normalizeCanonical("/produkty?utm_source=test&s=hp", "/produkty", ORIGIN),
    "https://www.tonerymaxim.sk/produkty",
  );
});

test("canonical zachová iba platné stránkovanie", () => {
  assert.equal(
    normalizeCanonical("/znacky/hp?page=03&utm_source=test", "/znacky/hp", ORIGIN),
    "https://www.tonerymaxim.sk/znacky/hp?page=3",
  );
});

test("produktový title sa generuje už v správnom limite", () => {
  const seo = buildProductSeo({
    id: "1",
    slug: "test",
    name: "HP W1420XL mimoriadne dlhý názov kompatibilného toneru s čipom a rozšírenou kapacitou",
    price: 20,
  } as any);
  assert.ok(seo.title.length <= SEO_TITLE_LIMIT);
  assert.ok(seo.title.endsWith(SEO_SITE_SUFFIX));
});

test("OEM title sa generuje už v správnom limite", () => {
  const seo = buildCodeSeo("W1420XL", [{
    id: "1",
    slug: "test",
    name: "HP W1420XL mimoriadne dlhý názov kompatibilného toneru s čipom a rozšírenou kapacitou",
    price: 20,
  } as any], []);
  assert.ok(seo.title.length <= SEO_TITLE_LIMIT);
  assert.ok(seo.title.endsWith(SEO_SITE_SUFFIX));
});

test("slovenské tvary rešpektujú rod produktu", () => {
  const base = { id: "1", slug: "test", price: 20, stock_status: "instock" };
  assert.match(buildProductSeo({ ...base, name: "HP W1420XL kompatibilný toner", color: "Čierna", product_type_key: "compatible" } as any).title, /^HP W1420XL čierny kompatibilný toner/);
  assert.match(buildProductSeo({ ...base, name: "Brother BT5000C kompatibilná atramentová náplň", product_brand: "Brother", color: "Azúrová", product_type_key: "compatible" } as any).title, /azúrová kompatibilná atramentová náplň/);
  assert.match(buildProductSeo({ ...base, name: "Canon DR-051 originálny optický valec", color: "Čierna", product_type_key: "original" } as any).title, /čierny originálny optický valec/);
  assert.match(buildProductSeo({ ...base, name: "Renovovaný toner HATONA pre Canon Cartridge 055 Black s OEM čipom", color: "Čierna", product_type_key: "renovated" } as any).title, /^Canon CRG 055 čierny renovovaný toner s OEM čipom/);
  assert.match(buildProductSeo({ ...base, name: "BROTHER Originál BT-D100BK Black DCP-T230", color: "Čierna", product_type_key: "original" } as any).title, /^Brother BT-D100BK čierna originálna atramentová náplň/);
  assert.match(buildProductSeo({ ...base, name: "CANON originál CRG-072H black", color: "Čierna", product_type_key: "original" } as any).title, /^Canon CRG-072H čierny originálny toner/);
});

test("reálny katalóg nemá technický, poškodený ani príliš dlhý produktový title", () => {
  const catalog = JSON.parse(readFileSync(".tm-cache/products.json", "utf8"));
  const products = catalog.products.filter(validIndexableProduct);
  const titles = products.map((product: any) => buildProductSeo(product, products).title);
  assert.equal(titles.filter((title: string) => title.length > SEO_TITLE_LIMIT).length, 0);
  assert.equal(titles.filter((title: string) => /tlačí farbou|farbou čierna/i.test(title)).length, 0);
  assert.equal(titles.filter((title: string) => /^SKU\s|\s·\s(?:[a-f0-9]{12,}|\d{5,})$/i.test(title)).length, 0, "Title nesmie zobrazovať interné SKU ani technický hash");
  assert.equal(titles.filter((title: string) => /HP 92[47]E.*spotrebný materiál/i.test(title)).length, 0, "HP 924e/937e sú atramentové náplne");
  assert.equal(titles.filter((title: string) => /\bvariant\s+\d+\b/i.test(title)).length, 0, "Title nesmie obsahovať vymyslený variant");
  assert.equal(titles.filter((title: string) => /^ý\s|ý HATONA/i.test(title)).length, 0, "Title nesmie obsahovať poškodenú identitu");
  assert.equal(titles.filter((title: string) => /^CRG-?072H? – .*spotrebný materiál/i.test(title)).length, 0, "CRG-072 je toner");
});

test("každá OEM stránka začína vlastným kódom a má jedinečný title", () => {
  const catalog = JSON.parse(readFileSync(".tm-cache/products.json", "utf8"));
  const products = catalog.products.filter(validIndexableProduct);
  const entities = oemEntities(products);
  const titles = entities.map((entity) => buildCodeSeo(entity.code, entity.products, entity.printers).title);
  assert.equal(new Set(titles).size, titles.length);
  entities.forEach((entity, index) => assert.ok(titles[index].startsWith(`${entity.code} –`), `${entity.code} chýba na začiatku title`));
});
