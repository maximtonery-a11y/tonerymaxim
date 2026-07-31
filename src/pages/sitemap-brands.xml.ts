import type { APIRoute } from "astro";
import { brandsSitemapResponse } from "../lib/sitemaps";

export const prerender = false;
export const GET: APIRoute = async ({ request }) => brandsSitemapResponse(request);
