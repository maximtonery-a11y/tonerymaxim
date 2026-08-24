import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = () => {
  // Liveness endpoint musi byt konstantny a bez I/O. Coolify ho moze volat
  // pocas startu aj opakovane; katalog, disk, Google ani background workery
  // preto nesmu byt podmienkou dostupnosti verejneho webu.
  return new Response(JSON.stringify({
    ok: true,
    service: 'tonerymaxim',
    timestamp: new Date().toISOString(),
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
};
