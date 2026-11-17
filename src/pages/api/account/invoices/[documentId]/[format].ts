import type { APIRoute } from 'astro';
import { readCustomerSession } from '../../../../../lib/auth-session';
import { downloadCustomerInvoice, InvoiceError, invoiceJson } from '../../../../../lib/account-invoices';

export const prerender = false;
export const GET: APIRoute = async ({ cookies, params }) => {
  const session = readCustomerSession(cookies);
  if (!session) return invoiceJson({ ok: false, error: 'Neprihlásený zákazník.' }, 401);
  try { return await downloadCustomerInvoice(session.id, params.documentId || '', params.format || ''); }
  catch (error) {
    return invoiceJson({ ok: false, error: error instanceof InvoiceError ? error.message : 'Dokument momentálne nie je dostupný.' }, error instanceof InvoiceError ? error.status : 503);
  }
};
