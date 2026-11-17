import type { APIRoute } from 'astro';
import { readCustomerSession } from '../../../lib/auth-session';
import { getCustomerInvoices, InvoiceError, invoiceJson, invoiceOrderFilter, invoicePageNumber } from '../../../lib/account-invoices';

export const prerender = false;
export const GET: APIRoute = async ({ cookies, url }) => {
  const session = readCustomerSession(cookies);
  if (!session) return invoiceJson({ ok: false, error: 'Neprihlásený zákazník.' }, 401);
  try {
    const result = await getCustomerInvoices(session.id, invoicePageNumber(url.searchParams.get('page')), invoiceOrderFilter(url.searchParams.get('order')));
    return invoiceJson({ ok: true, ...result });
  } catch (error) {
    return invoiceJson({ ok: false, error: error instanceof InvoiceError ? error.message : 'Faktúry momentálne nie sú dostupné.' }, error instanceof InvoiceError ? error.status : 503);
  }
};
