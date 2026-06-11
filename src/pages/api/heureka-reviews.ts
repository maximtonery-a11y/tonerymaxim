import type { APIRoute } from "astro";

export const prerender = false;

type HeurekaReview = {
  summary: string;
  pros: string;
  cons: string;
  rating: number;
  recommends: boolean | null;
  createdAt: string;
};

type HeurekaStats = {
  ok: boolean;
  source: "heureka" | "fallback";
  recommendationPercent: number;
  averageRating: number;
  reviewCount: number;
  reviews: HeurekaReview[];
  updatedAt: string;
};

const FALLBACK: HeurekaStats = {
  ok: true,
  source: "fallback",
  recommendationPercent: 100,
  averageRating: 4.9,
  reviewCount: 1323,
  reviews: [
    {
      summary: "Spokojnosť, rýchlo vybavená objednávka, výborná kvalita obchodu",
      pros: "Rýchle doručenie",
      cons: "",
      rating: 5,
      recommends: true,
      createdAt: "",
    },
    {
      summary: "Rýchlosť a spoľahlivosť",
      pros: "Balenie objednávky",
      cons: "",
      rating: 5,
      recommends: true,
      createdAt: "",
    },
    {
      summary: "Rýchle doručenie",
      pros: "Široký výber sortimentu",
      cons: "",
      rating: 5,
      recommends: true,
      createdAt: "",
    },
  ],
  updatedAt: new Date().toISOString(),
};

let memoryCache: { expires: number; data: HeurekaStats } | null = null;

function env(name: string) {
  return String(import.meta.env[name] || "").trim();
}

function getHeurekaKey() {
  return env("HEUREKA_SECRET_KEY") || "669a543dae41dd685d3c9f4b9124311b";
}

function decodeXml(value: string) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string) {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function toNumber(value: string) {
  const normalized = String(value || "").replace(/\s/g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function parseReviewsXml(xml: string): HeurekaReview[] {
  const blocks = [...String(xml || "").matchAll(/<review[^>]*>([\s\S]*?)<\/review>/gi)].map((match) => match[1]);

  return blocks
    .map((block) => {
      const rating = toNumber(tag(block, "total_rating") || tag(block, "rating") || tag(block, "score"));
      const recommendsText = (tag(block, "recommends") || tag(block, "recommend") || "").toLowerCase();
      const recommends = recommendsText ? ["1", "true", "yes", "ano", "áno"].includes(recommendsText) : null;

      return {
        summary: tag(block, "summary") || tag(block, "text") || tag(block, "description"),
        pros: tag(block, "pros"),
        cons: tag(block, "cons"),
        rating: rating > 0 ? Math.min(5, rating) : 5,
        recommends,
        createdAt: tag(block, "created") || tag(block, "unix_timestamp") || tag(block, "date"),
      } satisfies HeurekaReview;
    })
    .filter((review) => review.summary || review.pros || review.cons)
    .slice(0, 3);
}

function parsePublicStats(html: string) {
  const text = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const countMatch =
    text.match(/Recenzie\s*\(?\s*([0-9][0-9\s]*)\s*\)?/i) ||
    text.match(/Všetky recenzie\s*\(?\s*([0-9][0-9\s]*)\s*\)?/i) ||
    text.match(/z\s+([0-9][0-9\s]*)\s+recenzi/i);

  const recommendationMatch =
    text.match(/([0-9]{1,3})\s*%\s+zákazníkov\s+odpor/i) ||
    text.match(/odporúč[a-záčďéíĺľňóôŕšťúýž\s]+([0-9]{1,3})\s*%/i);

  const ratingMatch =
    text.match(/([0-5](?:[,.][0-9])?)\s+celková\s+spokojnosť/i) ||
    text.match(/celková\s+spokojnosť[^0-9]*([0-5](?:[,.][0-9])?)/i) ||
    text.match(/([0-5](?:[,.][0-9])?)\s*\/\s*5/i);

  return {
    count: countMatch ? Math.max(0, Number(countMatch[1].replace(/\s/g, ""))) : 0,
    recommendation: recommendationMatch ? Math.max(0, Math.min(100, Number(recommendationMatch[1]))) : 0,
    rating: ratingMatch ? toNumber(ratingMatch[1]) : 0,
  };
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "ToneryMaxim Heureka widget/1.0",
    },
  });

  if (!response.ok) throw new Error(`Heureka request failed: ${response.status}`);
  return response.text();
}

async function loadHeureka(): Promise<HeurekaStats> {
  const key = getHeurekaKey();
  const [xmlResult, htmlResult] = await Promise.allSettled([
    fetchText(`https://www.heureka.sk/direct/dotaznik/export-review.php?key=${encodeURIComponent(key)}`),
    fetchText("https://obchody.heureka.sk/tonerymaxim-sk/recenze/?e=reviews&p=left"),
  ]);

  const xml = xmlResult.status === "fulfilled" ? xmlResult.value : "";
  const html = htmlResult.status === "fulfilled" ? htmlResult.value : "";

  const reviews = parseReviewsXml(xml);
  const publicStats = parsePublicStats(html);

  const recommendable = reviews.filter((review) => review.recommends !== null);
  const recommended = recommendable.filter((review) => review.recommends === true).length;
  const recommendationFromXml = recommendable.length ? Math.round((recommended / recommendable.length) * 100) : 0;

  const ratingFromXml = reviews.length
    ? Math.round((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length) * 10) / 10
    : 0;

  return {
    ok: true,
    source: "heureka",
    recommendationPercent: publicStats.recommendation || recommendationFromXml || FALLBACK.recommendationPercent,
    averageRating: publicStats.rating || ratingFromXml || FALLBACK.averageRating,
    reviewCount: publicStats.count || FALLBACK.reviewCount,
    reviews: reviews.length ? reviews : FALLBACK.reviews,
    updatedAt: new Date().toISOString(),
  };
}

export const GET: APIRoute = async () => {
  if (memoryCache && memoryCache.expires > Date.now()) {
    return new Response(JSON.stringify(memoryCache.data), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=900, s-maxage=1800, stale-while-revalidate=86400",
      },
    });
  }

  try {
    const data = await loadHeureka();
    memoryCache = { expires: Date.now() + 30 * 60 * 1000, data };

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=900, s-maxage=1800, stale-while-revalidate=86400",
      },
    });
  } catch (error: any) {
    const fallback = {
      ...FALLBACK,
      source: "fallback" as const,
      error: error?.message || "Heureka údaje sa nepodarilo načítať.",
      updatedAt: new Date().toISOString(),
    };

    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
      },
    });
  }
};
