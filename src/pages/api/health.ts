import type { APIRoute } from 'astro';
import { warmSmartSearchIndex } from './smart-search';

export const prerender = false;

export const GET: APIRoute = async () => {
  // Coolify vola healthcheck po start period. Prvy healthcheck zaroven zahreje
  // produktovy/search index, ale pripadna chyba warm-upu nesmie zhodit liveness.
  let searchWarm = false;
  try {
    await warmSmartSearchIndex();
    searchWarm = true;
  } catch (error) {
    console.warn('[TM health] Search warm-up failed:', error);
  }

  return new Response(JSON.stringify({
    ok: true,
    service: 'tonerymaxim',
    search_warm: searchWarm,
    timestamp: new Date().toISOString(),
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
};
