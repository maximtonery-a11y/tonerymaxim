import type { APIRoute } from 'astro';
import { saveAnalyticsEvent } from '../../lib/tm-analytics';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid content type' }), { status: 415 });
    }

    const payload = await request.json().catch(() => null);
    await saveAnalyticsEvent(request, payload);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: 'Analytics save failed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
};
