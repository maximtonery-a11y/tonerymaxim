import type { APIRoute } from 'astro';
import { getAdminAccessKey, constantTimeEqual } from '../../lib/admin-access';
import { filterCatalogIssues, inspectCatalog } from '../../lib/catalog-inspector';

export const prerender = false;

function csv(value: unknown) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  return `"${text.replace(/"/g, '""')}"`;
}

export const GET: APIRoute = async ({ url, locals }) => {
  const adminKey = getAdminAccessKey(locals);
  const suppliedKey = url.searchParams.get('key') || '';
  if (adminKey && !constantTimeEqual(adminKey, suppliedKey)) {
    return new Response('Forbidden', { status: 403, headers: { 'X-Robots-Tag': 'noindex, nofollow' } });
  }

  const report = await inspectCatalog();
  const issues = filterCatalogIssues(report.issues, {
    severity: url.searchParams.get('severity') || 'all',
    rule: url.searchParams.get('rule') || 'all',
    query: url.searchParams.get('q') || '',
  });
  const rows = [
    ['Závažnosť', 'Kód kontroly', 'Kontrola', 'Produkt ID', 'SKU', 'Názov', 'URL', 'Detail'],
    ...issues.map((item) => [item.severity, item.code, item.label, item.productId, item.sku, item.name, item.detailUrl, item.message]),
  ];
  const body = '\uFEFF' + rows.map((row) => row.map(csv).join(';')).join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tm-catalog-quality-${stamp}.csv"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
};
