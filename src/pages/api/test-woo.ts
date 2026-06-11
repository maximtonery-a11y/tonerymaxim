import type { APIRoute } from "astro";

export const GET: APIRoute = async () => {
  try {
    const url =
      `${import.meta.env.WOO_URL}/wp-json/wc/v3/products?per_page=5`;

    const auth = Buffer.from(
      `${import.meta.env.WOO_CONSUMER_KEY}:${import.meta.env.WOO_CONSUMER_SECRET}`
    ).toString("base64");

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    const data = await response.json();

    return new Response(
      JSON.stringify(
        {
          status: response.status,
          data,
        },
        null,
        2
      ),
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify(
        {
          error: error.message,
        },
        null,
        2
      ),
      {
        status: 500,
      }
    );
  }
};