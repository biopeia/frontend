import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveIntervals} from '../src/archive-intervals.js';

test('renders closed intervals and explicitly open unverified tail', () => {
  assert.equal(archiveIntervals([[2,2],[4,null]]), '2–2; 4–open, unverified to present');
});
test('distinguishes empty, absent and malformed intervals', () => {
  assert.equal(archiveIntervals([]), 'none recorded');
  assert.equal(archiveIntervals(undefined), 'not asserted');
  for (const value of [[[5,2]], [[2]], [[2,null,'reason']], [[1,2,3]]])
    assert.equal(archiveIntervals(value), 'invalid interval data');
});
test('preserves and escapes reason-bearing gap triples', () => {
  assert.equal(archiveIntervals([[3,3,'source gap']], true), '3–3 (reason: source gap)');
  assert.equal(archiveIntervals([[3,4,'<script>']], true), '3–4 (reason: &lt;script&gt;)');
  assert.equal(archiveIntervals([], true), 'none recorded');
  assert.equal(archiveIntervals([[2,null,'open']], true), 'invalid interval data');
});
