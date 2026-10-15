import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpatialRenderController} from '../src/spatial-render-controller.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
const input = (pose, embodiment = {revision:'m1'}, stale = false) => ({
  environment: {revision:'e1'}, embodiment, renderPose: pose, stale, status:'available',
});

test('applies the latest pose received while asynchronous mount is pending', async () => {
  const pending = deferred();
  const updates = [];
  const container = {isConnected:true};
  const controller = createSpatialRenderController({mount:() => pending.promise});
  controller.reconcile(container, input({tick:1}));
  controller.reconcile(container, input({tick:2}));
  pending.resolve({updatePose:(pose, stale) => updates.push({pose, stale})});
  await pending.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(updates, [{pose:{tick:2}, stale:false}]);
});

test('refreshes selected-item provenance without remounting unchanged geometry', async () => {
  const descriptor = {revision:'m1'};
  const firstClaim = {deliverySequence:1, observation:{lineage:{parents:[{namespace:'render_geometry_sha256',reference:'a'}]}}};
  const nextClaim = {deliverySequence:7, observation:{lineage:{parents:[{namespace:'render_geometry_sha256',reference:'a'}]}}};
  let mounts = 0;
  const provenance = [];
  const controller = createSpatialRenderController({mount:() => {
    mounts += 1;
    return Promise.resolve({updatePose() {}, updateProvenance: (...claims) => provenance.push(claims)});
  }});
  const container = {isConnected:true};
  const initial = {...input({tick:1}, descriptor), environmentClaim:firstClaim, embodimentClaim:firstClaim};
  controller.reconcile(container, initial);
  await new Promise(resolve => setImmediate(resolve));
  controller.reconcile(container, {...initial, environmentClaim:nextClaim, embodimentClaim:nextClaim});
  assert.equal(mounts, 1);
  assert.deepEqual(provenance, [[nextClaim,nextClaim]]);
});

test('remounts with the newest descriptor if it changes during initialization', async () => {
  const first = deferred();
  const second = deferred();
  const calls = [];
  const container = {isConnected:true};
  const controller = createSpatialRenderController({mount:(node, value) => {
    calls.push(value.embodiment.revision);
    return calls.length === 1 ? first.promise : second.promise;
  }});
  controller.reconcile(container, input({tick:1}, {revision:'m1'}));
  controller.reconcile(container, input({tick:2}, {revision:'m2'}));
  first.resolve({updatePose:() => assert.fail('obsolete renderer must not receive latest pose'), dispose() {}});
  await first.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['m1', 'm2']);
  second.resolve({updatePose:() => {}, dispose() {}});
  await second.promise;
  await new Promise(resolve => setImmediate(resolve));
});

test('disposes a renderer completed for a route node that has been detached', async () => {
  const pending = deferred();
  const container = {isConnected:true};
  const controller = createSpatialRenderController({mount:() => pending.promise});
  controller.reconcile(container, input({tick:1}));
  container.isConnected = false;
  let disposed = false;
  pending.resolve({updatePose:() => assert.fail('detached renderer must not be updated'), dispose:() => { disposed = true; }});
  await pending.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, true);
});
