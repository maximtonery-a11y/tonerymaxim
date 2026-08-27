import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("SEO katalóg vyžaduje slug, názov a kladnú cenu", () => {
  const source = read("src/lib/seo-catalog.ts");
  assert.match(source, /String\(product\.slug/);
  assert.match(source, /String\(product\.name/);
  assert.match(source, /Number\(product\.price \|\| 0\) > 0/);
});

test("landing page kompatibilných produktov používa presný typ", () => {
  const source = read("src/lib/seo-catalog.ts");
  assert.match(source, /kind === "compatible"\) return product\.product_type_key === "compatible"/);
});

test("OEM entity vzniká iba z názvu alebo SKU produktu", () => {
  const source = read("src/lib/seo-catalog.ts");
  assert.match(source, /product\.name \|\| "".*product\.sku \|\| ""/s);
  assert.doesNotMatch(source, /productOemCodes[\s\S]{0,500}product\.search_text/);
  assert.match(source, /\[A-Z\]\{1,3\}/);
  const cache = read("src/lib/tm-products-cache.ts");
  assert.match(cache, /\[A-Z\]\{1,3\}/);
});

test("sitemap index odkazuje iba na existujúce endpointy", () => {
  const source = read("src/pages/sitemap.xml.ts");
  assert.match(source, /sitemapIndexResponse/);
  for (const name of [
    "sitemap-pages.xml.ts",
    "sitemap-products.xml.ts",
    "sitemap-brands.xml.ts",
    "sitemap-printers.xml.ts",
    "sitemap-oem.xml.ts",
  ]) {
    assert.equal(existsSync(join(root, "src/pages", name)), true, `${name} chýba`);
  }
});

test("GEO poskytuje spoľahlivý llms.txt endpoint a odkazuje naň z HTML", () => {
  assert.equal(existsSync(join(root, "src/pages/llms.txt.ts")), true);
  const route = read("src/pages/llms.txt.ts");
  const llms = read("src/lib/geo/llms.ts");
  const seoHead = read("src/components/SeoHead.astro");
  assert.match(route, /llmsResponse\(request\)/);
  assert.match(llms, /Content-Type.*text\/plain/s);
  assert.match(llms, /Cache-Control/);
  assert.match(llms, /OEM označenie/);
  assert.match(llms, /Nevymýšľajte cenu/);
  assert.match(llms, /sitemap-printers\.xml/);
  assert.match(seoHead, /rel="alternate" type="text\/plain"/);
});

test("globálna identita obchodu používa overiteľné štruktúrované údaje", () => {
  const seoHead = read("src/components/SeoHead.astro");
  assert.match(seoHead, /'@type': 'OnlineStore'/);
  assert.match(seoHead, /'@id': `\$\{PRODUCTION_ORIGIN\}\/\#organization`/);
  assert.match(seoHead, /legalName: 'Roman Babčan INkarus'/);
  assert.match(seoHead, /propertyID: 'IČO'/);
  assert.match(seoHead, /value: '37328344'/);
  assert.match(seoHead, /addressCountry: 'SK'/);
});

test("sitemap XML má bezpečné limity, cache validáciu a korektné hlavičky", () => {
  const source = read("src/lib/sitemaps.ts");
  assert.match(source, /SITEMAP_MAX_URLS = 50_000/);
  assert.match(source, /MIN_SAFE_SITEMAP_PRODUCTS = 100/);
  assert.match(source, /Bezpečnostná kontrola zastavila sitemapu/);
  assert.match(source, /ETag/);
  assert.match(source, /if-none-match/);
  assert.match(source, /if-modified-since/);
  assert.match(source, /status: 304/);
  assert.match(source, /status: 503/);
  assert.match(source, /Retry-After/);
});

test("produktová sitemap používa dátum produktu a podporuje obrázky", () => {
  const sitemap = read("src/lib/sitemaps.ts");
  const cache = read("src/lib/tm-products-cache.ts");
  assert.match(sitemap, /productSitemapDate\(product\)/);
  assert.match(sitemap, /product\.date_modified_gmt \|\| product\.date_modified/);
  assert.match(sitemap, /xmlns:image=/);
  assert.match(sitemap, /<image:image>/);
  assert.match(cache, /"date_modified"/);
  assert.match(cache, /"date_modified_gmt"/);
  assert.match(cache, /date_modified: product\.date_modified/);
});

test("sitemap obsahuje všetky verejné vstupné stránky bez parametrov", () => {
  const source = read("src/lib/sitemaps.ts");
  assert.match(source, /"\/cookies"/);
  assert.match(source, /`\/znacky\/\$\{brand\.slug\}`/);
  assert.match(source, /`\/tlaciarne\/\$\{brand\.slug\}`/);
  assert.match(source, /!url\.search && !url\.hash/);
});

test("všetky sitemap endpointy odovzdávajú Request pre ETag a 304", () => {
  for (const path of [
    "src/pages/sitemap.xml.ts",
    "src/pages/sitemap-pages.xml.ts",
    "src/pages/sitemap-products.xml.ts",
    "src/pages/sitemap-brands.xml.ts",
    "src/pages/sitemap-printers.xml.ts",
    "src/pages/sitemap-oem.xml.ts",
  ]) {
    const source = read(path);
    assert.match(source, /\(\{ request \}\)/, `${path} nepreberá Request`);
    assert.match(source, /\(request\)/, `${path} neposiela Request do generátora`);
  }
});

test("staré WordPress sitemap adresy smerujú na nový index", () => {
  const source = read("src/lib/legacy/redirects.ts");
  for (const path of ["/sitemap-index.xml", "/sitemap_index.xml", "/wp-sitemap.xml"]) {
    assert.match(source, new RegExp(`"${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*"\\/sitemap\\.xml"`));
  }
});

test("model tlačiarne používa nekolidujúcu dvojúrovňovú routu", () => {
  assert.equal(existsSync(join(root, "src/pages/tlaciarne/[model].astro")), false);
  assert.equal(existsSync(join(root, "src/pages/tlaciarne/[brand]/[model].astro")), true);
});

test("Merchant feed má verejnú XML routu, všetky produktové skupiny, prísne filtre a bezpečnostnú poistku", () => {
  assert.equal(existsSync(join(root, "src/pages/merchant-feed.xml.ts")), true);
  const route = read("src/pages/merchant-feed.xml.ts");
  const source = read("src/lib/merchant-feed.ts");
  assert.match(route, /\(\{ request \}\)/);
  assert.match(route, /merchantFeedResponse\(request\)/);
  assert.match(source, /buildMerchantProducts/);
  assert.match(source, /product\.product_type_key === "original"/);
  assert.match(source, /product\.product_type_key === "renovated"/);
  assert.match(source, /product\.product_type_key === "product"/);
  assert.doesNotMatch(source, /product\.product_type !== "compatible"/);
  assert.match(source, /product\.price <= 0/);
  assert.match(source, /product\.description\.length < 40/);
  assert.match(source, /validMerchantImage/);
  assert.match(source, /validMerchantUrl/);
  assert.match(source, /product\.availability !== "in_stock"/);
  assert.match(source, /Merchant feed safety gate/);
  assert.match(source, /status: 503/);
  assert.match(source, /Retry-After/);
});

test("Merchant XML obsahuje povinné Google atribúty, dopravu a cache validáciu", () => {
  const source = read("src/lib/merchant-feed.ts");
  for (const attribute of [
    "g:id",
    "g:title",
    "g:description",
    "g:link",
    "g:image_link",
    "g:availability",
    "g:condition",
    "g:price",
    "g:google_product_category",
    "g:product_type",
    "g:identifier_exists",
    "g:ships_from_country",
    "g:shipping",
  ]) {
    assert.match(source, new RegExp(attribute.replace(":", "\\:")), `${attribute} chýba`);
  }
  assert.match(source, /GOOGLE_PRODUCT_CATEGORY = "356"/);
  assert.match(source, /if \(!configured\) return fallback/);
  assert.match(source, /<g:country>SK<\/g:country>/);
  assert.match(source, /<g:price>\$\{shippingPrice\.toFixed\(2\)\} EUR<\/g:price>/);
  assert.match(source, /g:min_handling_time/);
  assert.match(source, /g:max_transit_time/);
  assert.match(source, /ETag/);
  assert.match(source, /if-none-match/);
  assert.match(source, /status: 304/);
});

test("Merchant feed povoľuje platené Shopping reklamy iba kompatibilným produktom", () => {
  const products = read("src/lib/merchant-products.ts");
  const feed = read("src/lib/merchant-feed.ts");
  assert.match(products, /productType === "compatible" \? \[\] : \["Shopping_ads"\]/);
  assert.match(products, /productType === "compatible" \? "ads-compatible" : "organic-only"/);
  assert.doesNotMatch(products, /productType === "compatible" \|\| productType === "renovated" \? "ads-primary"/);
  assert.match(feed, /g:excluded_destination/);
});

test("Merchant feed odovzdáva presnú OEM rodinu ako štruktúrovaný signál", () => {
  const products = read("src/lib/merchant-products.ts");
  const feed = read("src/lib/merchant-feed.ts");
  assert.match(products, /function oemCodes/);
  assert.match(products, /oemFamilyLabel/);
  assert.match(feed, /g:product_detail/);
  assert.match(feed, /OEM kód náplne/);
});

test("Merchant identifikátory nepoužívajú značku tlačiarne ako značku produktu", () => {
  const ads = read("src/lib/ads-products.ts");
  const identifiers = read("src/lib/product-identifiers.ts");
  const cache = read("src/lib/tm-products-cache.ts");
  const seo = read("src/lib/seo.ts");

  assert.match(ads, /brand: actualBrand/);
  assert.match(ads, /printer_brand: compatiblePrinterBrand/);
  assert.match(ads, /identifier_exists: Boolean\(gtin \|\| \(actualBrand && mpn\)\)/);
  assert.match(ads, /printer-brand-\$\{compactKey\(compatiblePrinterBrand\)\}/);
  assert.match(identifiers, /\[8, 12, 13, 14\]\.includes\(digits\.length\)/);
  assert.match(identifiers, /expected === checkDigit/);
  assert.match(cache, /"global_unique_id"/);
  assert.match(cache, /"brands"/);
  assert.match(cache, /product_brand: productBrand/);
  assert.match(cache, /gtin,/);
  assert.match(cache, /mpn,/);
  assert.match(seo, /gtinSchemaProperty/);
  assert.match(seo, /mpn: mpn \|\| undefined/);
});

test("reklamné exporty vždy používajú produkčnú .sk doménu", () => {
  for (const path of [
    "src/pages/api/ads-products.json.ts",
    "src/pages/api/dsa-page-feed.csv.ts",
  ]) {
    const source = read(path);
    assert.match(source, /PRODUCTION_ORIGIN = "https:\/\/www\.tonerymaxim\.sk"/);
    assert.match(source, /buildAdsProducts\(cache\.products, PRODUCTION_ORIGIN/);
  }
});

test("SEO Dominator vytvára priority iba z aktuálneho katalógu", () => {
  assert.equal(existsSync(join(root, "src/lib/seo-opportunities.ts")), true);
  assert.equal(existsSync(join(root, "src/pages/admin/seo-dominator.astro")), true);
  const source = read("src/lib/seo-opportunities.ts");
  assert.match(source, /getProductsCache/);
  assert.match(source, /landingOpportunities\(products\)/);
  assert.match(source, /brandOpportunities\(products\)/);
  assert.match(source, /printerOpportunities\(products\)/);
  assert.match(source, /oemOpportunities\(products\)/);
  assert.match(source, /productOpportunities\(products\)/);
  assert.match(source, /SEO_DOMINATOR_LIMIT/);
  assert.match(source, /Math\.min\(100, Math\.max\(20/);
  assert.match(source, /directAnswer/);
  assert.match(source, /suggestedTitle/);
  assert.match(source, /suggestedDescription/);
});

test("SEO Dominator API a CSV sú chránené a blokované pre indexáciu", () => {
  for (const path of [
    "src/pages/api/admin-seo-opportunities.ts",
    "src/pages/api/seo-opportunities.csv.ts",
  ]) {
    const source = read(path);
    assert.match(source, /getAdminAccessKey/);
    assert.match(source, /isAdminLocked/);
    assert.match(source, /no-store/);
    assert.match(source, /noindex, nofollow/);
  }
  const page = read("src/pages/admin/seo-dominator.astro");
  assert.match(page, /Skóre príležitosti je interný potenciál, nie odhad objemu vyhľadávania/);
  assert.match(page, /Nástroj nič automaticky nepublikuje a nemení produkty/);
  assert.match(page, /api\/seo-opportunities\.csv/);
});

test("Catalog Inspector odkazuje na SEO Dominator", () => {
  const source = read("src/pages/admin/catalog-quality.astro");
  assert.match(source, /\/admin\/seo-dominator/);
  assert.match(source, /SEO Dominator/);
});

test("nové SEO landing pages používajú jednotný produkčný layout", () => {
  for (const path of [
    "src/pages/tonery.astro",
    "src/pages/kompatibilne-tonery.astro",
    "src/pages/originalne-tonery.astro",
    "src/pages/renovovane-tonery.astro",
    "src/pages/atramentove-naplne.astro",
    "src/pages/znacky/[brand].astro",
    "src/pages/oem/[code].astro",
    "src/pages/tlaciarne/[brand]/[model].astro",
  ]) {
    assert.match(read(path), /SeoCatalogPage/, `${path} nepoužíva SeoCatalogPage`);
  }
});

test("landing pages majú dátovú odpoveď, obsah a interné entity", () => {
  const sharedPage = read("src/components/SeoCatalogPage.astro");
  assert.match(sharedPage, /Údaje z aktuálneho katalógu/);
  assert.match(sharedPage, /seo-stat-grid/);
  assert.match(sharedPage, /contentSections/);
  assert.match(sharedPage, /linkGroups/);
  assert.match(sharedPage, /generatedAt/);

  for (const path of [
    "src/pages/tonery.astro",
    "src/pages/kompatibilne-tonery.astro",
    "src/pages/originalne-tonery.astro",
    "src/pages/renovovane-tonery.astro",
    "src/pages/atramentove-naplne.astro",
    "src/pages/znacky/[brand].astro",
    "src/pages/oem/[code].astro",
    "src/pages/tlaciarne/[brand]/[model].astro",
  ]) {
    const source = read(path);
    assert.match(source, /answer=/, `${path} nemá priamu dátovú odpoveď`);
    assert.match(source, /contentSections=/, `${path} nemá vysvetľujúci obsah`);
    assert.match(source, /linkGroups=/, `${path} nemá interné entity`);
    assert.match(source, /schemaEntities=/, `${path} nemá entity pre JSON-LD`);
  }
});

test("dynamické landing pages používajú iba entity z aktuálneho katalógu", () => {
  const source = read("src/lib/seo-catalog.ts");
  assert.match(source, /export function catalogStats/);
  assert.match(source, /export function topBrandLinks/);
  assert.match(source, /export function topPrinterLinks/);
  assert.match(source, /export function topOemLinks/);
  assert.match(source, /export function printerLinksFromNames/);
  assert.match(source, /dateModified: options\.generatedAt/);
});

test("detail produktu odkazuje na OEM, tlačiareň a značku", () => {
  const source = read("src/pages/produkt/[slug].astro");
  assert.match(source, /productOemCodes\(product\)/);
  assert.match(source, /printerLinksFromNames/);
  assert.match(source, /printerBrandForName/);
  assert.match(source, /product-seo-relations/);
  assert.match(source, /Podľa OEM označenia/);
  assert.match(source, /Podľa modelu tlačiarne/);
});

test("katalógové a produktové stránky definujú WebSite entitu", () => {
  const seo = read("src/lib/seo.ts");
  const catalogPage = read("src/components/SeoCatalogPage.astro");
  const productPage = read("src/pages/produkt/[slug].astro");
  assert.match(seo, /export function websiteJsonLd/);
  assert.match(seo, /SearchAction/);
  assert.match(catalogPage, /websiteJsonLd\(SEO_ORIGIN\)/);
  assert.match(productPage, /websiteJsonLd\(SEO_ORIGIN\)/);
});

test("produkčný kód už neobsahuje sitemap placeholder ani TODO ProductGrid", () => {
  const sources = [
    "src/pages/api/sitemap.ts",
    "src/pages/sitemap.xml.ts",
    "src/pages/oem/[code].astro",
    "src/pages/tlaciarne/[brand]/[model].astro",
  ].map(read).join("\n");
  assert.doesNotMatch(sources, /placeholder|TODO: ProductGrid/i);
});

test("kategória komponentov je doplnkom troch hlavných skupín a odkazy nepridávajú textové hľadanie", () => {
  const cache = read("src/lib/tm-products-cache.ts");
  assert.match(cache, /category === "ostatne-komponenty"\) return !isToner && !isInk && !isDrum/);

  const links = [
    "src/components/Header.astro",
    "src/components/Footer.astro",
    "src/components/ProductFinder.astro",
    "src/pages/index.astro",
    "src/pages/tlaciarne.astro",
    "src/pages/tlaciarne/[brand].astro",
  ].map(read).join("\n");
  assert.match(links, /\/produkty\?category=ostatne-komponenty/);
  assert.doesNotMatch(links, /ostatne-komponenty&(search|s)=|s=ostatné komponenty|search=komponent/);
});


test("printer pages keep full mobile description below products", () => {
  const component = read("src/components/SeoCatalogPage.astro");
  const route = read("src/pages/tlaciarne/[brand]/[model].astro");
  assert.match(route, /productFirst=\{!notFound\}/);
  assert.match(component, /seo-printer-content/);
  assert.match(component, /!productFirst && contentSections\.length > 0/);
  assert.match(component, /id="odborne-informacie"/);
});

test("printer type filters only expose types that exist", () => {
  const route = read("src/pages/tlaciarne/[brand]/[model].astro");
  assert.match(route, /stats\.compatible \? \[`Kompatibilné:/);
  assert.match(route, /stats\.original \? \[`Originálne:/);
  assert.match(route, /stats\.renovated \? \[`Renovované:/);
});

test("printer descriptions contain compact benefits and complete buying guidance", () => {
  const component = read("src/components/SeoCatalogPage.astro");
  const route = read("src/pages/tlaciarne/[brand]/[model].astro");
  const styles = read("src/styles/seo-catalog.css");
  assert.match(component, /seo-commerce-benefits/);
  assert.match(component, /seo-type-comparison/);
  assert.match(component, /seo-recommendation-card/);
  assert.match(route, /commerceBenefits=\{commerceBenefits\}/);
  assert.match(route, /typeComparison=\{typeComparison\}/);
  assert.match(route, /recommendationCard=\{recommendationCard\}/);
  assert.match(route, /faq=\{printerFaq\}/);
  assert.match(route, /2–3 ks −10 % · 4\+ ks −25 %/);
  assert.match(route, /!inkBased && compatibleBest/);
  assert.match(styles, /\.seo-commerce-benefits/);
  assert.match(styles, /\.seo-type-comparison/);
  assert.match(styles, /\.seo-recommendation-card/);
});

test("ink printer descriptions never calculate or recommend cost per page", () => {
  const route = read("src/pages/tlaciarne/[brand]/[model].astro");
  assert.match(route, /const recommendationCard = !inkBased && compatibleBest/);
  assert.match(route, /const compatibleBest = inkBased \? null/);
  assert.match(route, /if \(isInkProduct\(product\)\) return null/);
  assert.match(route, /mainKind === "ink" \? "Výhodnejšia obstarávacia cena/);
});

test("AI fallback cannot wait ten seconds", () => {
  const ai = read("src/lib/openai-sales-assistant.ts");
  assert.match(ai, /OPENAI_TIMEOUT_MS", 1_200, 600, 1_500/);
});
