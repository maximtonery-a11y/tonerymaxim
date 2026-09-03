import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('newsletter lifecycle, suppression and legacy import', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tm-newsletter-'));
  process.env.NODE_ENV = 'development';
  process.env.TM_PERSISTENCE_SECRET = 'newsletter-test-secret-12345678901234567890';
  process.env.TM_PERSISTENT_DATA_DIR = dir;
  try {
    const n = await import('../src/lib/newsletter.ts');
    assert.equal(n.validNewsletterEmail('User+news@example.com'), true);
    assert.equal(n.validNewsletterEmail('bad @example.com'), false);

    const first = await n.createNewsletterConfirmation('User+news@example.com', 'newsletter-page');
    assert.equal(first.token.length, 64);
    assert.equal(await n.confirmNewsletter(first.email, 'wrong-token'), false);
    assert.equal(await n.confirmNewsletter(first.email, first.token), true);
    assert.equal((await n.getNewsletterRecord(first.email))?.status, 'subscribed');

    const unsub = await n.createNewsletterUnsubscribeConfirmation(first.email);
    assert.equal(unsub.send, true);
    assert.equal(unsub.token.length, 64);
    assert.equal(await n.confirmNewsletterUnsubscribe(first.email, 'wrong-token'), false);
    assert.equal(await n.confirmNewsletterUnsubscribe(first.email, unsub.token), true);
    assert.equal((await n.getNewsletterRecord(first.email))?.status, 'unsubscribed');

    const imported = await n.importConfirmedNewsletterEmails([first.email, 'legacy@example.com', 'legacy@example.com', 'bad']);
    assert.equal(imported.keptUnsubscribed, 1);
    assert.equal(imported.added, 1);
    const legacy = await n.getNewsletterRecord('legacy@example.com');
    assert.equal(legacy?.status, 'subscribed');
    assert.equal(legacy?.consentVersion, 'legacy-import-unknown');
    assert.equal(legacy?.consentAt, undefined);
    assert.equal(legacy?.confirmedAt, undefined);

    const modern = await n.createNewsletterConfirmation('modern@example.com', 'footer');
    assert.equal(await n.confirmNewsletter(modern.email, modern.token), true);
    const before = await n.getNewsletterRecord(modern.email);
    await n.importConfirmedNewsletterEmails([modern.email]);
    const after = await n.getNewsletterRecord(modern.email);
    assert.equal(after?.source, before?.source);
    assert.equal(after?.consentVersion, before?.consentVersion);
    assert.equal(after?.confirmedAt, before?.confirmedAt);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
