import type { APIRoute } from "astro";
import { getGoPayAccessToken } from "../../lib/gopay-client";

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    await getGoPayAccessToken("payment-create");
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    console.error("GoPay warmup error:", error?.message || error);
    return new Response(JSON.stringify({ ok: false }), {
      status: 503,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
};
