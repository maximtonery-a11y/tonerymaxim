import type { APIRoute } from "astro";
import { oemSitemapResponse } from "../lib/sitemaps";

export const prerender = false;
export const GET: APIRoute = async ({ request }) => oemSitemapResponse(request);
