import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';

// Stream transport serializes mail entirely in memory; it opens no SMTP socket.
test('patched Nodemailer preserves Slovak transactional mail in 10 offline rounds', async t => {
  for (let round = 1; round <= 10; round++) {
    await t.test('mail serialization round ' + round, async () => {
      const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
      const result = await transport.sendMail({
        from: { name: 'ToneryMaxim.sk', address: 'shop@example.invalid' },
        to: [{ name: 'Ján Novák', address: 'customer@example.invalid' }],
        replyTo: 'support@example.invalid',
        subject: 'Objednávka č. ' + round + ' – čaká na úhradu',
        text: 'Dobrý deň, vaša objednávka čaká na úhradu.',
        html: '<p>Dobrý deň, vaša objednávka <strong>čaká na úhradu</strong>.</p>',
      });
      assert.equal(result.envelope.from, 'shop@example.invalid');
      assert.deepEqual(result.envelope.to, ['customer@example.invalid']);
      if (!Buffer.isBuffer(result.message)) throw new Error('Expected buffered offline message');
      const message = result.message.toString('utf8');
      assert.match(message, /^From: .+<shop@example\.invalid>/m);
      assert.match(message, /Reply-To: support@example\.invalid/);
      assert.match(message, /Content-Type: multipart\/alternative/i);
      assert.match(message, /Content-Type: text\/plain; charset=utf-8/i);
      assert.match(message, /Content-Type: text\/html; charset=utf-8/i);
      transport.close();
    });
  }
});
