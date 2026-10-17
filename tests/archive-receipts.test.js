import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveReceiptsUrl} from '../src/archive-receipts.js';

test('archive receipt query uses bounded receipt cursor and only supported metadata filters', () => {
  assert.equal(archiveReceiptsUrl(0, {}), '/api/observation/archive/receipts?limit=25&after=0');
  assert.equal(archiveReceiptsUrl(25, {owner:' embodiment ', family:' embodiment.body_pose ', revision:' v1 '}),
    '/api/observation/archive/receipts?limit=25&after=25&owner=embodiment&family=embodiment.body_pose&revision=v1');
  assert.equal(archiveReceiptsUrl(25, {run_id:'r1', owner:''}), '/api/observation/archive/receipts?limit=25&after=25');
});

test('archive receipt query rejects invalid cursor and overlong filters', () => {
  assert.throws(() => archiveReceiptsUrl(-1, {}), /cursor/);
  assert.throws(() => archiveReceiptsUrl(1.5, {}), /cursor/);
  assert.throws(() => archiveReceiptsUrl(0, {family:'x'.repeat(257)}), /filter/);
});
