import assert from 'node:assert/strict';
import test from 'node:test';
import { isPlaceholderSecret, isStrongSecret } from '../src/lib/secret-validation.ts';

test('production secrets reject examples and placeholders', () => {
  assert.equal(isPlaceholderSecret('SEM_VLOZTE_DLHY_NAHODNY_TAJNY_RETAZEC_MIN_32_ZNAKOV'), true);
  assert.equal(isStrongSecret('SEM_VLOZTE_DLHY_NAHODNY_TAJNY_RETAZEC_MIN_32_ZNAKOV', 32), false);
  assert.equal(isStrongSecret('change-me-this-is-not-a-real-production-secret', 32), false);
});

test('production secrets accept a sufficiently long non-placeholder value', () => {
  assert.equal(isStrongSecret('Tx8vL4qR9mN2zK7pH5cW3sB6yF1dG0aJ', 32), true);
});
