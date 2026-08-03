import type { APIRoute } from "astro";

export const prerender = false;

type HeurekaReview = {
  author: string;
  summary: string;
  pros: string;
  cons: string;
  rating: number;
  recommends: boolean | null;
  createdAt: string;
};

type HeurekaStats = {
  ok: boolean;
  source: "heureka" | "unavailable";
  recommendationPercent: number;
  averageRating: number;
  reviewCount: number;
  reviews: HeurekaReview[];
  updatedAt: string;
};

let memoryCache: { expires: number; data: HeurekaStats } | null = null;

function env(name: string) {
  return String(process.env[name] || import.meta.env[name] || "").trim();
}

function getHeurekaKey() {
  return env("HEUREKA_SECRET_KEY");
}

function decodeXml(value: string) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function htmlText(value: string) {
  return decodeXml(String(value || "").replace(/<[^>]+>/g, " "));
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
        author: tag(block, "name") || tag(block, "author") || "Overený zákazník",
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

function parsePublicReviews(html: string): HeurekaReview[] {
  const blocks = [...String(html || "").matchAll(/<li[^>]*class="[^"]*\bc-post\b[^"]*"[^>]*>([\s\S]*?)(?=<li[^>]*class="[^"]*\bc-post\b[^"]*"|$)/gi)]
    .map((match) => match[1]);

  return blocks
    .map((block) => {
      const authorMatch = block.match(/class="c-post__author"[^>]*>([\s\S]*?)<\/p>/i);
      const summaryMatch = block.match(/class="c-post__summary"[^>]*>([\s\S]*?)<\/p>/i);
      const prosMatch = block.match(/class="c-attributes-list__item"[^>]*>([\s\S]*?)<\/li>/i);
      const timeMatch = block.match(/class="c-post__publish-time"[^>]*datetime="([^"]+)"[^>]*>([\s\S]*?)<\/time>/i);
      const ratingMatch = block.match(/class="c-rating-widget"[^>]*data-rating="([0-9.]+)"/i);

      const rawAuthor = htmlText(authorMatch?.[1] || "");
      const author = rawAuthor
        .replace(/\s*-?\s*Overený nákup.*$/i, "")
        .trim() || "Overený zákazník";
      const summary = htmlText(summaryMatch?.[1] || prosMatch?.[1] || "");
      const ratingValue = toNumber(ratingMatch?.[1] || "");

      return {
        author,
        summary,
        pros: "",
        cons: "",
        rating: ratingValue > 0 ? Math.min(5, ratingValue / 2) : 5,
        recommends: /c-post__recommendation/i.test(block) ? true : null,
        createdAt: String(timeMatch?.[1] || htmlText(timeMatch?.[2] || "")),
      } satisfies HeurekaReview;
    })
    .filter((review) => review.summary)
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
    text.match(/([0-9]{1,3})\s*%?\s+zákazníkov\s+odpor/i) ||
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "ToneryMaxim Heureka widget/1.0",
      },
    });

    if (!response.ok) throw new Error(`Heureka request failed: ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadHeureka(): Promise<HeurekaStats> {
  const key = getHeurekaKey();
  const [xmlResult, htmlResult] = await Promise.allSettled([
    key
      ? fetchText(`https://www.heureka.sk/direct/dotaznik/export-review.php?key=${encodeURIComponent(key)}`)
      : Promise.resolve(""),
    fetchText("https://obchody.heureka.sk/tonerymaxim-sk/recenze/"),
  ]);

  const xml = xmlResult.status === "fulfilled" ? xmlResult.value : "";
  const html = htmlResult.status === "fulfilled" ? htmlResult.value : "";

  const xmlReviews = parseReviewsXml(xml);
  const publicReviews = parsePublicReviews(html);
  const reviews = xmlReviews.length ? xmlReviews : publicReviews;
  const publicStats = parsePublicStats(html);

  const recommendationPercent = Math.round(
    Math.max(0, Math.min(100, publicStats.recommendation)),
  );
  const averageRating = Math.round(
    Math.max(0, Math.min(5, publicStats.rating)) * 10,
  ) / 10;
  const reviewCount = Math.max(0, Math.round(publicStats.count));
  if (!recommendationPercent && !averageRating && !reviewCount && !reviews.length) {
    throw new Error("Heureka neposkytla overiteľné údaje.");
  }

  return {
    ok: true,
    source: "heureka",
    recommendationPercent,
    averageRating,
    reviewCount,
    reviews,
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
    if (memoryCache?.data?.ok) {
      return new Response(JSON.stringify(memoryCache.data), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=86400",
          "X-Heureka-Data": "stale-cache",
        },
      });
    }

    const unavailable: HeurekaStats & { error: string } = {
      ok: false,
      source: "unavailable",
      recommendationPercent: 0,
      averageRating: 0,
      reviewCount: 0,
      reviews: [],
      error: error?.message || "Heureka údaje sa nepodarilo načítať.",
      updatedAt: new Date().toISOString(),
    };

    return new Response(JSON.stringify(unavailable), {
      status: 503,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    });
  }
};
