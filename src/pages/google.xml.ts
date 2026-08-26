import type { APIRoute } from "astro";
import { merchantFeedResponse } from "../lib/merchant-feed";

// Spätná kompatibilita pre starú URL. Google/Merchant používa rovnaký overený feed
// ako /merchant-feed.xml; AI poradca má používať /ai-product-feed.xml.
export const prerender = false;
export const GET: APIRoute = async ({ request }) => merchantFeedResponse(request);
