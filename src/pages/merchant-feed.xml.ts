import type { APIRoute } from "astro";
import { merchantFeedResponse } from "../lib/merchant-feed";

export const prerender = false;
export const GET: APIRoute = async ({ request }) => merchantFeedResponse(request);
