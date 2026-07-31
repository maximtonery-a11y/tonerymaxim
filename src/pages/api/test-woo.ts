import type { APIRoute } from "astro";

export const GET: APIRoute = async () => {
  try {
    const wooUrl = process.env.WOO_URL || import.meta.env.WOO_URL;
    const wooKey = process.env.WOO_CONSUMER_KEY || import.meta.env.WOO_CONSUMER_KEY;
    const wooSecret = process.env.WOO_CONSUMER_SECRET || import.meta.env.WOO_CONSUMER_SECRET;
    const url =
      `${wooUrl}/wp-json/wc/v3/products?per_page=5`;

    const auth = Buffer.from(
      `${wooKey}:${wooSecret}`
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
