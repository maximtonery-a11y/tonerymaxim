import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildProductSeo } from "../src/lib/catalog-seo-text.ts";
import { buildMerchantProducts } from "../src/lib/merchant-products.ts";
import { resolvedPublicationBrand } from "../src/lib/product-publication-policy.ts";
import { validIndexableProduct } from "../src/lib/seo-catalog.ts";

const catalog = JSON.parse(readFileSync(".tm-cache/products.json", "utf8"));
const products = catalog.products.filter(validIndexableProduct);

function productNamed(pattern: RegExp) {
  const product = products.find((item: any) => pattern.test(String(item.name || "")));
  assert.ok(product, `V testovacom katalógu chýba produkt ${pattern}`);
  return product;
}

test("HP W1420XL má presný názov a vecný popis pre Google", () => {
  const product = productNamed(/HP 142XL \(W1420XL\).*kompatibilný toner/i);
  const seo = buildProductSeo(product, products);
  assert.equal(seo.title, "HP W1420XL čierny kompatibilný toner | ToneryMaxim.sk");
  assert.match(seo.description, /HP 142XL \(W1420XL\)/i);
  assert.match(seo.description, /2[ .]000 strán/i);
  assert.match(seo.description, /M110w/i);
  assert.doesNotMatch(seo.title, /toner alebo náplň/i);
});

test("sada PG-545 XL + CL-546 XL nestratí druhú náplň", () => {
  const product = productNamed(/PG-545 XL \+ CL-546 XL/i);
  const title = buildProductSeo(product, products).title;
  assert.match(title, /PG-545 XL \+ CL-546 XL/i);
  assert.match(title, /sada (?:atramentových )?náplní/i);
});

test("C-EXV 21 varianty majú toner, kód aj správnu farbu", () => {
  const rows = products.filter((item: any) => /^C-EXV21 (?:Bk|C|M|Y) /i.test(String(item.name || "")));
  assert.equal(rows.length, 4);
  const titles = rows.map((item: any) => buildProductSeo(item, products).title);
  assert.equal(new Set(titles).size, 4);
  for (const title of titles) assert.match(title, /C-EXV 21(?:BK|C|M|Y).*toner/i);
  assert.ok(titles.some((title: string) => /čierny toner/i.test(title)));
  assert.ok(titles.some((title: string) => /azúrový toner/i.test(title)));
  assert.ok(titles.some((title: string) => /purpurový toner/i.test(title)));
  assert.ok(titles.some((title: string) => /žltý toner/i.test(title)));
});

test("Merchant názvy používajú rovnakú presnú identitu a správny slovenský rod", () => {
  const merchant = buildMerchantProducts(catalog.products, "https://www.tonerymaxim.sk");
  assert.equal(merchant.length, products.length);
  assert.equal(merchant.filter((item) => /Kompatibilný atramentová|Originálny atramentová|Renovovaný atramentová/i.test(item.name)).length, 0);
  const w1420 = merchant.find((item) => /w1420xl/i.test(item.slug));
  assert.equal(w1420?.name, "HP W1420XL čierny kompatibilný toner");
  assert.match(String(w1420?.description), /M110w/i);

  const lexmark = merchant.filter((item) => /^lexmark-cs317-originalny-toner/.test(item.slug));
  assert.equal(lexmark.length, 4);
  assert.equal(new Set(lexmark.map((item) => item.name)).size, 4);
  const epson408 = merchant.filter((item) => /^epson-408-originalna-atramentova-napln/.test(item.slug));
  assert.equal(epson408.length, 4);
  assert.equal(new Set(epson408.map((item) => item.name)).size, 4);
});

test("všetky indexovateľné produkty majú čistý názov a konkrétny popis", () => {
  for (const product of products) {
    const seo = buildProductSeo(product, products);
    assert.ok(seo.title.length > 12 && seo.title.length <= 65, String(product.name));
    assert.ok(seo.description.length >= 35 && seo.description.length <= 158, String(product.name));
    assert.doesNotMatch(`${seo.title} ${seo.description}`, /<[^>]+>/, String(product.name));
  }
});

test("automatický názov zachová značku a dostupný typ pri celom katalógu", () => {
  const typePatterns: Record<string, RegExp> = {
    compatible: /kompatibiln/i,
    original: /origin[aá]l/i,
    renovated: /renovovan/i,
  };

  for (const product of products) {
    const title = buildProductSeo(product, products).title;
    const brand = resolvedPublicationBrand(product);
    assert.ok(brand, `Produkt bez publikovateľnej značky: ${product.name}`);
    assert.ok(
      title.toLocaleLowerCase("sk").includes(brand.toLocaleLowerCase("sk")),
      `V automatickom názve chýba značka ${brand}: ${title}`,
    );

    const typePattern = typePatterns[String(product.product_type_key || "")];
    if (typePattern) {
      assert.match(title, typePattern, `V automatickom názve chýba typ produktu: ${title}`);
    }
  }
});

test("HTML v názve budúceho produktu sa nedostane do titulku ani popisu", () => {
  const source = productNamed(/W1420XL/i);
  const product = {
    ...source,
    name: `<strong>${source.name}</strong><script>alert(1)</script>`,
  };
  const seo = buildProductSeo(product, products);
  assert.doesNotMatch(`${seo.title} ${seo.description}`, /<[^>]+>/);
  assert.doesNotMatch(`${seo.title} ${seo.description}`, /alert\(1\)/i);
});
