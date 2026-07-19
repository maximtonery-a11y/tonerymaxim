import type { APIRoute } from "astro";
import { compactKey, getProductsCache, normalize } from "../../../lib/tm-products-cache";
import { readCustomerSession } from "../../../lib/auth-session";
import {
  getSavedProductsFromCustomer,
  getWooCustomerById,
  saveWooCustomerSavedProducts,
  type SavedProduct,
} from "../../../lib/woo-client";

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function productUrl(product: any) {
  if (product?.detail_url) return product.detail_url;
  if (product?.slug) return `/novy/produkt/${product.slug}`;
  return `/novy/produkty?s=${encodeURIComponent(product?.sku || product?.name || "")}`;
}

function productImage(product: any) {
  if (product?.image) return product.image;
  if (Array.isArray(product?.images) && product.images[0]) {
    if (typeof product.images[0] === "string") return product.images[0];
    return product.images[0]?.src || "";
  }
  return "";
}

function toSavedProduct(product: any): SavedProduct {
  return {
    id: Number(product.id || 0) || undefined,
    sku: String(product.sku || "").trim(),
    title: String(product.name || product.title || "Produkt").trim(),
    url: productUrl(product),
    image: productImage(product),
    price: Number(product.price || product.regular_price || 0),
    type: String(product.product_type_key || product.type || "").trim(),
    type_label: String(product.product_type_label || product.typeLabel || "").trim(),
    stock_status: String(product.stock_status || "").trim(),
    added_at: new Date().toISOString(),
  };
}

function savedProductKey(product: SavedProduct) {
  return String(product.id || product.sku || product.title || "").trim();
}

async function resolveProduct(input: Record<string, any>): Promise<SavedProduct | null> {
  const id = Number(input.id || input.product_id || 0);
  const sku = String(input.sku || "").trim();
  const title = String(input.title || input.name || input.q || input.search || "").trim();
  const targetCompact = compactKey(sku || title);

  const cache = await getProductsCache();
  const products = Array.isArray(cache.products) ? cache.products : [];

  let product = id ? products.find((item: any) => Number(item.id) === id) : null;
  if (!product && sku) product = products.find((item: any) => normalize(item.sku) === normalize(sku) || compactKey(item.sku) === compactKey(sku));
  if (!product && targetCompact) {
    product = products
      .map((item: any) => {
        const text = `${item.name || ""} ${item.sku || ""}`;
        let score = 0;
        if (compactKey(item.sku) === targetCompact) score += 120;
        if (compactKey(item.name) === targetCompact) score += 90;
        if (compactKey(text).includes(targetCompact)) score += 60;
        if (normalize(text).includes(normalize(title))) score += 50;
        if (item.stock_status === "instock") score += 8;
        if (Number(item.price || 0) > 0) score += 4;
        return { item, score };
      })
      .filter((row) => row.score >= 50)
      .sort((a, b) => b.score - a.score)[0]?.item;
  }

  return product ? toSavedProduct(product) : null;
}

async function requireCustomer(cookies: any) {
  const session = readCustomerSession(cookies);
  if (!session?.id) return null;
  return await getWooCustomerById(session.id);
}

export const GET: APIRoute = async ({ cookies }) => {
  const customer = await requireCustomer(cookies);
  if (!customer) return json({ ok: false, error: "Nie ste prihlásený." }, 401);
  return json({ ok: true, products: getSavedProductsFromCustomer(customer) });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const customer = await requireCustomer(cookies);
  if (!customer) return json({ ok: false, error: "Nie ste prihlásený." }, 401);

  const body = await request.json().catch(() => ({}));
  const product = await resolveProduct(body);
  if (!product) return json({ ok: false, error: "Tento produkt sme v databáze nenašli." }, 404);

  const existing = getSavedProductsFromCustomer(customer);
  const key = compactKey(savedProductKey(product));
  const exists = existing.some((item) => compactKey(savedProductKey(item)) === key);
  const products = exists ? existing : [product, ...existing].slice(0, 40);
  await saveWooCustomerSavedProducts(customer.id, products);

  return json({ ok: true, product, products });
};

export const DELETE: APIRoute = async ({ request, cookies }) => {
  const customer = await requireCustomer(cookies);
  if (!customer) return json({ ok: false, error: "Nie ste prihlásený." }, 401);

  const body = await request.json().catch(() => ({}));
  const key = compactKey(String(body.id || body.sku || body.title || ""));
  if (!key) return json({ ok: false, error: "Chýba produkt." }, 400);

  const products = getSavedProductsFromCustomer(customer).filter((product) => compactKey(savedProductKey(product)) !== key);
  await saveWooCustomerSavedProducts(customer.id, products);

  return json({ ok: true, products });
};
