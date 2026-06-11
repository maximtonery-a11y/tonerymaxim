import type { APIRoute } from "astro";

export const prerender = false;

type CompanyAddress = {
  street: string;
  city: string;
  zip: string;
  country: string;
};

type CompanyResponse = {
  source: "ORSF";
  ico: string;
  name: string;
  dic: string;
  icDph: string;
  legalForm: string;
  nace: string;
  naceCode: string;
  revenue?: number | null;
  profit?: number | null;
  salesCategory?: string;
  address: CompanyAddress;
  raw?: unknown;
};

function digits(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function byPath(obj: any, path: string) {
  return path.split(".").reduce((acc, key) => {
    if (acc === undefined || acc === null) return undefined;

    if (/^\d+$/.test(key) && Array.isArray(acc)) {
      return acc[Number(key)];
    }

    return acc[key];
  }, obj);
}

function pick(obj: any, paths: string[]) {
  for (const path of paths) {
    const value = byPath(obj, path);
    const text = normalizeText(value);
    if (text) return text;
  }

  return "";
}

function pickNumber(obj: any, paths: string[]) {
  for (const path of paths) {
    const value = byPath(obj, path);

    if (typeof value === "number" && Number.isFinite(value)) return value;

    if (typeof value === "string") {
      const number = Number(value.replace(/\s/g, "").replace(",", "."));
      if (Number.isFinite(number)) return number;
    }
  }

  return null;
}

function findDeepValue(obj: any, keys: string[]): string {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const seen = new WeakSet<object>();

  function walk(value: any): string {
    if (!value || typeof value !== "object") return "";
    if (seen.has(value)) return "";
    seen.add(value);

    for (const [key, child] of Object.entries(value)) {
      if (wanted.has(key.toLowerCase())) {
        const text = normalizeText(child);
        if (text) return text;

        if (child && typeof child === "object") {
          const nested = pick(child, ["label", "value", "name", "text", "description"]);
          if (nested) return nested;
        }
      }
    }

    for (const child of Object.values(value)) {
      if (Array.isArray(child)) {
        for (const item of child) {
          const found = walk(item);
          if (found) return found;
        }
      } else if (child && typeof child === "object") {
        const found = walk(child);
        if (found) return found;
      }
    }

    return "";
  }

  return walk(obj);
}

function getAddress(source: any): CompanyAddress {
  const address =
    source.address ??
    source.seat ??
    source.registeredSeat ??
    source.primaryAddress ??
    source.addresses?.[0] ??
    source.registeredAddresses?.[0] ??
    source.location ??
    {};

  const streetFromObject = [
    pick(address, [
      "street",
      "streetName",
      "street.value",
      "ulica",
      "line1",
      "addressLine1",
    ]),
    pick(address, [
      "streetNumber",
      "buildingNumber",
      "regNumber",
      "propertyRegistrationNumber",
      "supisneCislo",
    ]),
    pick(address, [
      "orientationNumber",
      "orientacneCislo",
    ]),
  ].filter(Boolean).join(" ");

  const street =
    streetFromObject ||
    pick(source, [
      "addressText",
      "formattedAddress",
      "addressLine",
      "street",
    ]) ||
    findDeepValue(source, ["street", "streetName", "ulica"]);

  const city =
    pick(address, [
      "city",
      "municipality",
      "municipalityName",
      "municipality.value",
      "obec",
    ]) ||
    findDeepValue(source, ["city", "municipality", "municipalityName", "obec"]);

  const zip =
    pick(address, [
      "postalCode",
      "postcode",
      "zip",
      "psc",
    ]) ||
    findDeepValue(source, ["postalCode", "postcode", "zip", "psc"]);

  const country =
    pick(address, [
      "country",
      "countryName",
      "country.value",
    ]) ||
    findDeepValue(source, ["country", "countryName"]) ||
    "Slovensko";

  return {
    street,
    city,
    zip: digits(zip),
    country,
  };
}

function getLatestFinancial(source: any) {
  const statements =
    source.financialStatements ??
    source.statements ??
    source.financials ??
    source.accountingStatements ??
    [];

  if (!Array.isArray(statements) || statements.length === 0) return {};

  return [...statements].sort((a, b) => {
    const yearA = Number(a.year ?? a.periodYear ?? a.accountingPeriodYear ?? 0);
    const yearB = Number(b.year ?? b.periodYear ?? b.accountingPeriodYear ?? 0);
    return yearB - yearA;
  })[0] ?? {};
}

function normalizeOrsf(data: any, ico: string): CompanyResponse | null {
  const source = data?.company ?? data?.data ?? data?.result ?? data;
  const latestFinancial = getLatestFinancial(source);

  const name =
    pick(source, [
      "name",
      "businessName",
      "fullName",
      "legalName",
      "title",
      "obchodneMeno",
      "nazov",
    ]) ||
    findDeepValue(source, ["name", "businessName", "fullName", "legalName", "obchodneMeno", "nazov"]);

  if (!name) return null;

  const dic =
    pick(source, [
      "taxId",
      "dic",
      "tin",
      "taxIdentificationNumber",
    ]) ||
    findDeepValue(source, ["taxId", "dic", "tin", "taxIdentificationNumber"]);

  const icDph =
    pick(source, [
      "vatId",
      "icDph",
      "icdph",
      "vatNumber",
      "vatRegistrationId",
    ]) ||
    findDeepValue(source, ["vatId", "icDph", "icdph", "vatNumber", "vatRegistrationId"]);

  const legalForm =
    pick(source, [
      "legalForm",
      "legalForm.label",
      "legalForm.name",
      "legalFormName",
      "legalFormText",
      "pravnaForma",
    ]) ||
    findDeepValue(source, ["legalForm", "legalFormName", "legalFormText", "pravnaForma"]);

  const naceCode =
    pick(source, [
      "naceCode",
      "skNaceCode",
      "mainActivity.naceCode",
      "mainActivity.code",
      "economicActivities.0.naceCode",
      "economicActivities.0.code",
    ]) ||
    findDeepValue(source, ["naceCode", "skNaceCode"]);

  const naceText =
    pick(source, [
      "nace",
      "skNace",
      "mainActivity.name",
      "mainActivity.description",
      "economicActivities.0.name",
      "economicActivities.0.description",
    ]) ||
    findDeepValue(source, ["nace", "skNace", "activityName", "activityDescription"]);

  const revenue =
    pickNumber(source, ["revenue", "revenueActual", "sales", "salesActual", "trzby"]) ??
    pickNumber(latestFinancial, ["revenue", "sales", "totalRevenue", "trzby"]);

  const profit =
    pickNumber(source, ["profit", "profitActual", "netProfit", "zisk"]) ??
    pickNumber(latestFinancial, ["profit", "netProfit", "economicResult", "zisk"]);

  const salesCategory =
    pick(source, ["salesCategory", "revenueCategory", "sizeCode", "velkost"]) ||
    findDeepValue(source, ["salesCategory", "revenueCategory", "sizeCode", "velkost"]);

  return {
    source: "ORSF",
    ico: pick(source, ["nationalId", "ico", "identifier"]) || ico,
    name,
    dic,
    icDph,
    legalForm,
    nace: [naceCode, naceText].filter(Boolean).join(" - "),
    naceCode,
    revenue,
    profit,
    salesCategory,
    address: getAddress(source),
    raw: source,
  };
}

export const GET: APIRoute = async ({ url }) => {
  const ico = digits(url.searchParams.get("ico") || "");

  if (ico.length < 6 || ico.length > 8) {
    return new Response(JSON.stringify({
      ok: false,
      error: "IČO musí mať 6 až 8 číslic.",
    }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  try {
    const response = await fetch(`https://api.orsf.sk/v1/companies/${encodeURIComponent(ico)}`, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "ToneryMaxim checkout company autofill",
      },
    });

    if (!response.ok) {
      return new Response(JSON.stringify({
        ok: false,
        error: response.status === 404
          ? "Firmu sa nepodarilo nájsť v ORSF."
          : "ORSF API momentálne nevrátilo údaje.",
        detail: `ORSF status ${response.status}`,
      }), {
        status: response.status === 404 ? 404 : 502,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const data = await response.json();
    const company = normalizeOrsf(data, ico);

    if (!company) {
      return new Response(JSON.stringify({
        ok: false,
        error: "ORSF vrátilo údaje, ale nepodarilo sa ich spracovať.",
      }), {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      company,
      warning: "Údaje sú z ORSF. ORSF je neoficiálny agregátor verejných registrov, nie právne záväzný výpis.",
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Nepodarilo sa spojiť s ORSF API.",
      detail: error?.message || "Unknown error",
    }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
};
