import type { APIRoute } from "astro";
import { heurekaFeedResponse } from "../lib/heureka-feed";

export const prerender = false;
export const GET: APIRoute = async ({ request }) => heurekaFeedResponse(request);
