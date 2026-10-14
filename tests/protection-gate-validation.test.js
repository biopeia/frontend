import test from 'node:test';
import assert from 'node:assert/strict';

test('temporary branch-protection validation intentionally fails the required build check', () => {
  assert.fail('Intentional validation of the protected-main required-check gate; this PR must never merge.');
});
