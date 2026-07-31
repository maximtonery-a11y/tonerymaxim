import type { APIRoute } from "astro";

export const prerender = false;
export const GET: APIRoute = async () => new Response(null, {
  status: 301,
  headers: {
    Location: "/merchant-feed.xml",
    "Cache-Control": "public, max-age=86400",
  },
});
