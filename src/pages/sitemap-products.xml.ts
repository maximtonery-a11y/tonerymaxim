import type { APIRoute } from "astro";
import { productsSitemapResponse } from "../lib/sitemaps";

export const prerender = false;
export const GET: APIRoute = async ({ request }) => productsSitemapResponse(request);
