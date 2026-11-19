import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bratislavaDay, daysUntil, dueTonerCareReminder, endTonerCare, expireTonerCare, mergeTonerCareUpdate,
  replacementDate, shouldSendTonerCareReminder, tonerCareReminderDates, tonerCareReminders, validPlanDate, type TonerCareHistoryEntry, type TonerCareReminder,
} from '../src/lib/toner-care-rules.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const plan = () => ({
  title: 'Brother DCP-L3517CDW', care_enabled: true, installed_at: '2026-09-20',
  expected_months: 3, expected_replacement_at: '2026-12-20', care_cycle_id: 'cycle-1',
  care_reminders: [] as TonerCareReminder[], care_history: [] as TonerCareHistoryEntry[],
});
const at = (date: string) => new Date(`${date}T09:00:00Z`);

// Real server code, isolated Woo/SMTP adapters; no network and no real e-mails.
async function fixture(path: string, options: { customers?: any[]; clock?: string; failCustomer?: boolean; failSaveId?: number } = {}) {
  const clock = { now: options.clock || '2026-11-20T09:00:00Z' };
  const customers = options.customers || [{ id: 1, email: 'customer@example.invalid', first_name: 'Test', printers: [plan()] }];
  const emails: any[] = [];
  const errors: any[] = [];
  let failCustomer = Boolean(options.failCustomer);
  class FixedDate extends Date {
    constructor(value?: any) { super(value === undefined ? clock.now : value); }
    static now() { return Date.parse(clock.now); }
  }
  const context = vm.createContext({
    Date: FixedDate, URL, URLSearchParams, Request, Response, Buffer, structuredClone,
    setTimeout, clearTimeout, setInterval, clearInterval,
    process: { env: { ADMIN_EMAIL: 'merchant@example.invalid' } },
    console: { log() {}, error(...args: any[]) { errors.push(args); } },
  });
  const woo = {
    getSavedPrintersFromCustomer: (customer: any) => structuredClone(customer?.printers || []),
    getWooCustomersPage: async (page: number) => page === 1 ? customers : [],
    getWooCustomerById: async (id: number) => customers.find((item) => item.id === id) || null,
    saveWooCustomerPrinters: async (id: number, printers: any[]) => {
      if (id === options.failSaveId) throw new Error('Fixture: Woo save failed');
      const customer = customers.find((item) => item.id === id);
      customer.printers = structuredClone(printers);
      return structuredClone(customer);
    },
  };
  const mocks: Record<string, any> = {
    'woo-client': woo,
    'mail': { sendMail: async (mail: any) => {
      if (failCustomer && mail.to === 'customer@example.invalid') throw new Error('Fixture: SMTP rejected customer');
      emails.push(mail);
    } },
    'storefront-url': { storefrontUrl: (path: string) => `https://shop.example.invalid${path}` },
    'auth-session': { readCustomerSession: (cookies: any) => cookies?.id ? { id: cookies.id } : null },
    'tm-products-cache': { compactKey: (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ''), normalize: (s: string) => s.toLowerCase(), getProductsCache: async () => ({ products: [] }) },
    'seo-catalog': { entitySlug: (s: string) => s.toLowerCase(), printerBrandForName: () => null },
  };
  const modules = new Map<string, any>();
  async function load(filename: string): Promise<any> {
    if (modules.has(filename)) return modules.get(filename);
    const source = stripTypeScriptTypes(await readFile(filename, 'utf8'), { mode: 'strip' });
    const mod = new vm.SourceTextModule(source, { context, identifier: filename, initializeImportMeta(meta) { Object.assign(meta, { env: {} }); } });
    modules.set(filename, mod);
    await mod.link(async (specifier: string, parent: any) => {
      const key = specifier.split('/').at(-1)!.replace(/\.ts$/, '');
      const exports = mocks[key] || (specifier.startsWith('node:') ? await import(specifier) : null);
      if (exports) return new vm.SyntheticModule(Object.keys(exports), function() { for (const [name, value] of Object.entries(exports)) this.setExport(name, value); }, { context });
      const target = resolve(dirname(parent.identifier), specifier);
      return load(target.endsWith('.ts') ? target : `${target}.ts`);
    });
    return mod;
  }
  const mod = await load(resolve(root, path));
  await mod.evaluate();
  return { server: mod.namespace, clock, customers, emails, errors, setCustomerFailure: (value: boolean) => { failCustomer = value; } };
}

test('one calendar month before deadline, then seven days, only through deadline', () => {
  assert.deepEqual(tonerCareReminderDates('2026-12-20'), ['2026-11-20', '2026-11-27', '2026-12-04', '2026-12-11', '2026-12-18']);
  assert.deepEqual(tonerCareReminderDates('2026-03-31'), ['2026-02-28', '2026-03-07', '2026-03-14', '2026-03-21', '2026-03-28']);
  assert.equal(shouldSendTonerCareReminder('2026-12-20', at('2026-11-19')), false);
  assert.equal(shouldSendTonerCareReminder('2026-12-20', at('2026-11-20')), true);
  assert.equal(shouldSendTonerCareReminder('2026-12-20', at('2026-12-20')), true);
  assert.equal(shouldSendTonerCareReminder('2026-12-20', at('2026-12-21')), false);
});

test('strict dates and month-end clamping prevent rolled-over dates', () => {
  assert.equal(validPlanDate('2026-02-30'), '');
  assert.equal(validPlanDate('2028-02-29'), '2028-02-29');
  assert.equal(replacementDate('2026-01-31', 1), '2026-02-28');
  assert.equal(replacementDate('2027-11-30', 3), '2028-02-29');
  assert.equal(replacementDate('2026-01-31', NaN), '');
});

test('deadline ends in Europe/Bratislava, including summer time', () => {
  assert.equal(bratislavaDay(new Date('2026-12-20T23:00:00Z')), '2026-12-21');
  assert.equal(daysUntil('2026-12-20', new Date('2026-12-20T23:00:00Z')), -1);
  assert.equal(bratislavaDay(new Date('2026-07-20T22:00:00Z')), '2026-07-21');
  assert.equal(expireTonerCare(plan(), new Date('2026-12-20T22:59:59Z')).care_enabled, true);
  assert.equal(expireTonerCare(plan(), new Date('2026-12-20T23:00:00Z')).care_enabled, false);
});

test('late scans coalesce missed reminders and leave at least seven days between sends', () => {
  const p: any = plan();
  assert.equal(dueTonerCareReminder(p, 'customer', at('2026-12-05')), '2026-12-04');
  p.care_reminders = [{ scheduled_for: '2026-12-04', customer_sent_at: at('2026-12-05').toISOString() }];
  assert.equal(dueTonerCareReminder(p, 'customer', at('2026-12-11')), null);
  assert.equal(dueTonerCareReminder(p, 'customer', at('2026-12-12')), '2026-12-11');
  assert.equal(dueTonerCareReminder(p, 'admin', at('2026-12-05')), '2026-12-04');
});

test('legacy sent markers migrate without immediately sending a duplicate', () => {
  const p: any = { ...plan(), last_reminder_at: at('2026-11-29').toISOString() };
  p.customer_reminder_sent_for = [p.title, p.installed_at, p.expected_replacement_at].join('|');
  assert.equal(tonerCareReminders(p)[0].scheduled_for, '2026-11-27');
  assert.equal(dueTonerCareReminder(p, 'customer', at('2026-11-30')), null);
  assert.equal(dueTonerCareReminder(p, 'customer', at('2026-12-04')), null);
  assert.equal(dueTonerCareReminder(p, 'customer', at('2026-12-06')), '2026-12-04');
});

test('expiration and manual disable preserve printer and history once', () => {
  const p = plan();
  const expired = expireTonerCare(p, at('2026-12-21'));
  assert.equal(p.care_enabled, true);
  assert.equal(expired.care_enabled, false);
  assert.equal(expired.title, p.title);
  assert.equal(expired.care_history.length, 1);
  assert.equal(expired.care_history[0].reason, 'expired');
  assert.equal(endTonerCare(expired, 'disabled', at('2026-12-22')).care_history.length, 1);
  const disabled = endTonerCare(p, 'disabled', at('2026-11-20'));
  assert.equal(dueTonerCareReminder(disabled, 'customer', at('2026-11-27')), null);
});

test('real worker sends five pairs, skips repeat scans, then persists expired history', async () => {
  const f = await fixture('src/lib/toner-care.ts');
  for (const day of tonerCareReminderDates('2026-12-20')) {
    f.clock.now = at(day).toISOString();
    assert.equal((await f.server.runTonerCareScan()).notifications, 2);
    assert.equal((await f.server.runTonerCareScan()).notifications, 0);
  }
  assert.equal(f.emails.length, 10);
  assert.equal(f.customers[0].printers[0].care_reminders.length, 5);
  assert.match(f.emails[0].text, /mesiac.*7 dní/);
  f.clock.now = at('2026-12-21').toISOString();
  assert.equal((await f.server.runTonerCareScan()).notifications, 0);
  assert.equal(f.customers[0].printers[0].care_enabled, false);
  assert.equal(f.customers[0].printers[0].care_history[0].reminders.length, 5);
});

test('worker retries failed recipient without resending the successful recipient', async () => {
  const f = await fixture('src/lib/toner-care.ts', { failCustomer: true });
  assert.equal((await f.server.runTonerCareScan()).notifications, 1);
  assert.match(f.emails[0].text, /zatiaľ nebolo potvrdené/);
  f.setCustomerFailure(false);
  assert.equal((await f.server.runTonerCareScan()).notifications, 1);
  assert.equal(f.emails.filter((item) => item.to === 'merchant@example.invalid').length, 1);
  assert.equal((await f.server.runTonerCareScan()).notifications, 0);
});

test('worker respects disabled plans and processes later customers after a save error', async () => {
  const customers = [
    { id: 1, email: 'one@example.invalid', printers: [plan()] },
    { id: 2, email: 'two@example.invalid', printers: [{ ...plan(), care_enabled: false }] },
    { id: 3, email: 'three@example.invalid', printers: [plan()] },
  ];
  const f = await fixture('src/lib/toner-care.ts', { customers, failSaveId: 1 });
  await f.server.runTonerCareScan();
  assert.equal(f.emails.some((item) => item.to === 'two@example.invalid'), false);
  assert.equal(f.customers[2].printers[0].care_reminders.length, 1);
  assert.equal(f.errors.some((args) => String(args).includes('Woo save failed')), true);
});

test('API disables only the selected guard, retaining both saved printers', async () => {
  const f = await fixture('src/pages/api/account/saved-printers.ts');
  f.customers[0].printers.push({ title: 'HP LaserJet M110w', care_enabled: true });
  const response = await f.server.PUT({ cookies: { id: 1 }, request: new Request('https://shop.example.invalid/api/account/saved-printers', { method: 'PUT', body: JSON.stringify({ title: plan().title, action: 'disable' }) }) });
  assert.equal(response.status, 200);
  assert.equal(f.customers[0].printers.length, 2);
  assert.equal(f.customers[0].printers[0].care_enabled, false);
  assert.equal(f.customers[0].printers[0].care_history[0].reason, 'disabled');
  assert.equal(f.customers[0].printers[1].care_enabled, true);
});

test('API rejects invalid dates, invalid duration and already expired activation', async () => {
  const f = await fixture('src/pages/api/account/saved-printers.ts');
  for (const change of [{ installed_at: '2026-02-30' }, { expected_months: 'bad' }, { expected_months: 2.5 }, { installed_at: '2025-01-01' }, { installed_at: '2027-01-01' }]) {
    const response = await f.server.PUT({ cookies: { id: 1 }, request: new Request('https://shop.example.invalid/api/account/saved-printers', { method: 'PUT', body: JSON.stringify({ ...plan(), ...change }) }) });
    assert.equal(response.status, 400, JSON.stringify(change));
  }
  assert.equal(f.customers[0].printers[0].care_cycle_id, 'cycle-1');
});

test('new plan archives the previous cycle and starts fresh reminder history', async () => {
  const f = await fixture('src/pages/api/account/saved-printers.ts');
  const response = await f.server.PUT({ cookies: { id: 1 }, request: new Request('https://shop.example.invalid/api/account/saved-printers', { method: 'PUT', body: JSON.stringify({ ...plan(), installed_at: '2026-11-20' }) }) });
  assert.equal(response.status, 200);
  const updated = f.customers[0].printers[0];
  assert.equal(updated.expected_replacement_at, '2027-02-20');
  assert.notEqual(updated.care_cycle_id, 'cycle-1');
  assert.equal(updated.care_history[0].cycle_id, 'cycle-1');
  assert.equal(updated.care_reminders.length, 0);
});

test('read API immediately shows expired plan without deleting the printer', async () => {
  const f = await fixture('src/pages/api/account/saved-printers.ts', { clock: '2026-12-20T23:00:00Z' });
  const response = await f.server.GET({ cookies: { id: 1 } });
  const data = await response.json();
  assert.equal(data.printers.length, 1);
  assert.equal(data.printers[0].care_enabled, false);
  assert.equal(data.printers[0].care_end_reason, 'expired');
});

test('API rejects unauthenticated guard mutations', async () => {
  const f = await fixture('src/pages/api/account/saved-printers.ts');
  const response = await f.server.PUT({ cookies: {}, request: new Request('https://shop.example.invalid/api/account/saved-printers', { method: 'PUT', body: JSON.stringify({ title: plan().title, action: 'disable' }) }) });
  assert.equal(response.status, 401);
  assert.equal(f.customers[0].printers[0].care_enabled, true);
});

test('background changes preserve a customer edit, manual disable and unrelated settings', () => {
  const original = plan();
  const expired = expireTonerCare(original, at('2026-12-21'));
  const disabled = endTonerCare(original, 'disabled', at('2026-12-19'));
  assert.deepEqual(mergeTonerCareUpdate(original, expired, disabled), disabled);
  const edited = { ...original, installed_at: '2026-11-20', expected_replacement_at: '2027-02-20', care_cycle_id: 'cycle-2' };
  assert.deepEqual(mergeTonerCareUpdate(original, expired, edited), edited);
  const latest = { ...original, preferred_type: 'original', custom_note: 'Uložené zákazníkom' };
  const merged = mergeTonerCareUpdate(original, expired, latest);
  assert.equal('preferred_type' in merged && merged.preferred_type, 'original');
  assert.equal('custom_note' in merged && merged.custom_note, 'Uložené zákazníkom');
  assert.equal(merged.care_enabled, false);
});
