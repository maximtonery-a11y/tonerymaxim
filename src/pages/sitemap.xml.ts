import type { APIRoute } from 'astro';
import { getProductsCache } from '../lib/tm-products-cache';

export const prerender = false;
const staticPaths = ['/', '/produkty', '/tlaciarne', '/kontakt', '/doprava-a-platba', '/faq', '/reklamacie', '/reklamacia-online', '/odstupenie-od-zmluvy', '/obchodne-podmienky', '/ochrana-osobnych-udajov'];
const brands = ['hp','canon','brother','epson','xerox','samsung','lexmark','kyocera','oki','ricoh','konica-minolta','utax','panasonic','toshiba','dell'];
function xml(value: string) { return value.replace(/[<>&"']/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c] || c)); }
export const GET: APIRoute = async ({ url }) => {
  const origin = url.origin;
  const cache = await getProductsCache().catch(() => null);
  const productPaths = (cache?.products || []).filter((p: any) => p.slug && p.name).map((p: any) => `/produkt/${encodeURIComponent(p.slug)}`);
  const urls = [...staticPaths, ...brands.map((b) => `/tlaciarne/${b}`), ...productPaths];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((path) => `  <url><loc>${xml(new URL(path, origin).toString())}</loc><changefreq>${path.startsWith('/produkt/') ? 'weekly' : 'monthly'}</changefreq><priority>${path === '/' ? '1.0' : path.startsWith('/produkt/') ? '0.8' : '0.7'}</priority></url>`).join('\n')}
</urlset>`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } });
};
