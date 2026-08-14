import type { APIRoute } from "astro";
import { llmsResponse } from "../lib/geo/llms";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => llmsResponse(request);
