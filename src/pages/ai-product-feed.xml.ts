import type { APIRoute } from "astro";
import { aiProductFeedResponse } from "../lib/ai-product-feed";

export const prerender = false;
export const GET: APIRoute = async ({ request }) => aiProductFeedResponse(request);
