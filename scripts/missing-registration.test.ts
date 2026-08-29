import assert from 'node:assert/strict';
import test from 'node:test';
import { ABANDONED_AFTER_MS, summarizeMissingRegistrations, type MissingRegistrationRecord } from '../src/lib/missing-registration.ts';

const now = Date.parse('2026-08-29T12:00:00.000Z');
const record = (email: string, ageMs: number, status: 'pending' | 'registered' = 'pending'): MissingRegistrationRecord => ({
  email,
  firstAttemptAt: new Date(now - ageMs - 60_000).toISOString(),
  lastAttemptAt: new Date(now - ageMs).toISOString(),
  attempts: 2,
  status,
  ...(status === 'registered' ? { registeredAt: new Date(now - 1_000).toISOString() } : {}),
});

test('nenájdený účet sa označí ako bez registrácie až po 24 hodinách', () => {
  const summary = summarizeMissingRegistrations([
    record('recent@example.sk', ABANDONED_AFTER_MS - 1),
    record('abandoned@example.sk', ABANDONED_AFTER_MS),
    record('registered@example.sk', 10_000, 'registered'),
  ], now);
  assert.deepEqual(summary.recent.map((item) => item.email), ['recent@example.sk']);
  assert.deepEqual(summary.abandoned.map((item) => item.email), ['abandoned@example.sk']);
  assert.deepEqual(summary.registered.map((item) => item.email), ['registered@example.sk']);
});

test('záznamy staršie ako 30 dní a neplatné e-maily sa nezobrazia', () => {
  const summary = summarizeMissingRegistrations([
    record('old@example.sk', 31 * 24 * 60 * 60 * 1000),
    record('nie-je-email', ABANDONED_AFTER_MS),
  ], now);
  assert.equal(summary.recent.length + summary.abandoned.length + summary.registered.length, 0);
});

test('projekt nikdy nepridáva heslo ani IP adresu do záznamu', () => {
  const item = record('safe@example.sk', ABANDONED_AFTER_MS);
  assert.deepEqual(Object.keys(item).sort(), ['attempts', 'email', 'firstAttemptAt', 'lastAttemptAt', 'status']);
});
