import test from 'node:test';
import assert from 'node:assert/strict';
import {createPresentationScheduler} from '../src/presentation-scheduler.js';

function fakeFrames() {
  let next = 0;
  const callbacks = new Map();
  return {
    requestFrame(fn) { const id = ++next; callbacks.set(id,fn); return id; },
    cancelFrame(id) { callbacks.delete(id); },
    flush() { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(fn => fn()); },
  };
}

test('applies only the newest pending view and reports coalesced UI updates', () => {
  const frames = fakeFrames();
  const applied = [];
  const omitted = [];
  const scheduler = createPresentationScheduler(value => applied.push(value), {
    requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame, report: count => omitted.push(count),
  });
  scheduler.schedule('sample 1');
  scheduler.schedule('sample 2');
  scheduler.schedule('sample 3');
  frames.flush();
  assert.deepEqual(applied,['sample 3']);
  assert.deepEqual(omitted,[2]);
});

test('stopped scheduler does not apply pending views', () => {
  const frames = fakeFrames();
  let applied = 0;
  const scheduler = createPresentationScheduler(() => applied++, {requestFrame:frames.requestFrame,cancelFrame:frames.cancelFrame});
  scheduler.schedule('pending');
  scheduler.stop();
  frames.flush();
  assert.equal(applied,0);
});
