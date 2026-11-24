import type { APIRoute } from 'astro';

// A dedicated worker uses the policy on its own response. It can download
// the shop's fixed models but the browser blocks external connections.
export const prerender = false;
export const GET: APIRoute = () => new Response("importScripts('./engine.js');", {
  headers: {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'public, max-age=300, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
  },
});
