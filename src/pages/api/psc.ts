import type { APIRoute } from "astro";
import postalData from "../../data/psc-sk.json";

export const prerender = false;

type PostalItem = {
  zip: string;
  city: string;
  municipality?: string;
  district?: string;
  postOffice?: string;
  region?: string;
  street?: string;
  type?: string;
};

const DATA = postalData as PostalItem[];

function onlyDigits(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function normalize(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,]/g, " ")
    .replace(/\b(ulica|ul\.|trieda|námestie|namestie)\b/g, "")
    .replace(/\s+\d+[a-zA-Z\/\-\d]*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(items: PostalItem[]) {
  const map = new Map<string, PostalItem>();

  for (const item of items) {
    map.set(`${item.zip}|${normalize(item.city)}|${normalize(item.street || "")}`, item);
  }

  return [...map.values()];
}

function sortBest(items: PostalItem[], cityQuery: string, streetQuery: string) {
  const cityNorm = normalize(cityQuery);
  const streetNorm = normalize(streetQuery);

  return [...items].sort((a, b) => {
    const aCityExact = normalize(a.city) === cityNorm ? 1 : 0;
    const bCityExact = normalize(b.city) === cityNorm ? 1 : 0;

    const aStreetExact = streetNorm && normalize(a.street || "") === streetNorm ? 1 : 0;
    const bStreetExact = streetNorm && normalize(b.street || "") === streetNorm ? 1 : 0;

    const aHasStreet = a.street ? 1 : 0;
    const bHasStreet = b.street ? 1 : 0;

    return (bCityExact - aCityExact) || (bStreetExact - aStreetExact) || (bHasStreet - aHasStreet);
  });
}

function findByZip(zip: string) {
  return DATA.filter((item) => item.zip === zip);
}

function findByCity(city: string) {
  const q = normalize(city);

  let matches = DATA.filter((item) => normalize(item.city) === q);

  if (matches.length === 0) {
    matches = DATA.filter((item) => normalize(item.city).startsWith(q));
  }

  return matches;
}

function findByCityAndStreet(city: string, street: string) {
  const cityNorm = normalize(city);
  const streetNorm = normalize(street);

  if (!cityNorm || !streetNorm) return [];

  let matches = DATA.filter((item) => {
    const itemCity = normalize(item.city);
    const itemStreet = normalize(item.street || "");

    return itemCity === cityNorm && itemStreet && (
      itemStreet === streetNorm ||
      streetNorm.startsWith(itemStreet) ||
      itemStreet.startsWith(streetNorm)
    );
  });

  if (matches.length === 0) {
    matches = DATA.filter((item) => {
      const itemCity = normalize(item.city);
      const itemStreet = normalize(item.street || "");

      return itemCity === cityNorm && itemStreet && (
        itemStreet.includes(streetNorm) ||
        streetNorm.includes(itemStreet)
      );
    });
  }

  return matches;
}

export const GET: APIRoute = async ({ url }) => {
  const zip = onlyDigits(url.searchParams.get("zip") || url.searchParams.get("psc") || "");
  const city = url.searchParams.get("city") || url.searchParams.get("obec") || "";
  const street = url.searchParams.get("street") || url.searchParams.get("ulica") || "";

  if (!zip && !city) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Zadajte PSČ alebo mesto.",
      results: [],
    }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  let matches: PostalItem[] = [];

  if (zip) {
    matches = findByZip(zip);
  } else if (city && street) {
    matches = findByCityAndStreet(city, street);
  } else if (city) {
    matches = findByCity(city);
  }

  matches = unique(sortBest(matches, city, street));

  if (matches.length === 0) {
    return new Response(JSON.stringify({
      ok: false,
      error: "PSČ alebo mesto sa nepodarilo nájsť.",
      results: [],
    }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const cityOnlyMatches = unique(matches.map((item) => ({
    ...item,
    street: "",
  })));

  const exact =
    matches.length === 1 ||
    (!!zip && cityOnlyMatches.length === 1) ||
    (!!city && !!street && matches.length === 1);

  const first = matches[0];

  return new Response(JSON.stringify({
    ok: true,
    city: first.city,
    zip: first.zip,
    street: first.street || "",
    exact,
    results: matches.slice(0, 30),
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "s-maxage=86400, stale-while-revalidate=604800",
    },
  });
};
