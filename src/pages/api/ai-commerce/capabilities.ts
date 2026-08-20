import type { APIRoute } from 'astro';
import { commerceCapabilities } from '../../../lib/ai-commerce/engine.ts';
export const prerender = false;
export const GET: APIRoute = async () => Response.json({ ok: true, ...commerceCapabilities }, { headers: { 'Cache-Control': 'no-store' } });
