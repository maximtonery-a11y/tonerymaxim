import type { APIRoute } from "astro";
import { printersSitemapResponse } from "../lib/sitemaps";

export const prerender = false;
export const GET: APIRoute = async ({ request }) => printersSitemapResponse(request);
