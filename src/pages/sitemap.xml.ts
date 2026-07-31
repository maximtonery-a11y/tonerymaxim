import type { APIRoute } from "astro";
import { sitemapIndexResponse } from "../lib/sitemaps";

export const prerender = false;
export const GET: APIRoute = async ({ request }) => sitemapIndexResponse(request);
