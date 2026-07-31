import type { APIRoute } from "astro";
import { pagesSitemapResponse } from "../lib/sitemaps";

export const prerender = false;
export const GET: APIRoute = async ({ request }) => pagesSitemapResponse(request);
