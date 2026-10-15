import test from 'node:test';
import assert from 'node:assert/strict';
import {ROUTES, initialSource} from '../src/model.js';
import {renderScreen} from '../src/views.js';

const bodyPose = {
  deliverySequence: 8,
  family: 'embodiment.body_pose',
  identities: [
    {kind: 'body', value: 'body-7', issuer: {kind: 'embodiment_owner_boundary', identifier: 'embodiment_owner_boundary'}},
    {kind: 'embodiment_episode', value: 'episode-3', issuer: {kind: 'embodiment_owner_boundary', identifier: 'embodiment_owner_boundary'}},
    {kind: 'morphology_revision', value: 'morphology-r2', issuer: {kind: 'embodiment_owner_boundary', identifier: 'embodiment_owner_boundary'}},
  ],
  value: {
    position: {value: [1, 2, 3], unit: 'm'},
    orientation: {value_xyzw: [0, 0, 0, 1], representation: 'unit_quaternion_xyzw', convention: 'right_handed_hamilton_q_v_q_conjugate'},
    reference_frame: 'world', body_frame: 'root',
  },
  observation: {
    claim: {family: {authority: 'embodiment', path: ['body_pose'], contract: {contract_id: 'embodiment.body_pose', revision: 'v1'}}, epistemic_kind: 'authoritative_state'},
    context_time: [{domain: 'world', kind: 'world_causal_tick', value: 12}],
    lineage: {parents: [{namespace: 'embodiment_state_sha256', reference: 'a'.repeat(64)}]},
    asserter: {kind: 'embodiment_owner_boundary', identifier: 'embodiment_owner_boundary'},
    producer: {kind: 'embodiment_owner_projection', identifier: 'embodiment_owner_projection'},
    acquisition: {method: 'embodiment_owner_state_projection'},
  },
};

const availableSource = {...initialSource, status: 'available', claims: [bodyPose], scope: 'bounded_in_memory_current_subset', freshness: 'not_established_by_snapshot', coherence: 'per_message_only_no_cross_owner_snapshot_guarantee'};
const scalarField = {
  deliverySequence: 9,
  family: 'environment.finite_scalar_field',
  identities: [{kind: 'environment', value: 'environment-2', issuer: {kind: 'environment_owner_boundary', identifier: 'environment_owner_boundary'}}],
  value: {quantity_kind: 'finite_scalar_field', value: 0.25, valid_range: [0, 1], point_m: [-2, 4, 6], reference_frame: 'environment-local'},
  observation: {
    claim: {family: {authority: 'environment', path: ['finite_scalar_field'], contract: {contract_id: 'biopeia.environment.finite-scalar-field', revision: '1'}}, epistemic_kind: 'authoritative_state'},
    context_time: [{domain: 'world', kind: 'world_causal_tick', value: 12}],
    lineage: {parents: [{namespace: 'owner_checkpoint_sha256', reference: 'b'.repeat(64)}]},
    asserter: {kind: 'environment_owner_boundary', identifier: 'environment_owner_boundary'},
    producer: {kind: 'environment_projection', identifier: 'environment_projection'},
    acquisition: {method: 'environment_owner_projection'},
  },
};

test('all seven peer routes render without inventing a World or run join', () => {
  const html = ROUTES.map(route => renderScreen(route, availableSource));
  assert.equal(new Set(html).size, 7);
  for (const page of html) {
    assert.ok(!page.includes('runtime_tick_events'));
    assert.ok(!page.includes('Committed World revision: 12'));
  }
});

test('Spatial Explorer exposes a separate renderer slot but current claims cannot populate geometry', () => {
  const overview = renderScreen(ROUTES.find(route => route.path === '/overview'), availableSource);
  const spatial = renderScreen(ROUTES.find(route => route.path === '/spatial'), availableSource);
  assert.match(overview, /No authorized scene geometry/);
  assert.match(spatial, /id=\"spatial-explorer\"/);
  assert.doesNotMatch(spatial, /data-observation-region=\"spatial-renderer\"/);
  assert.match(spatial, /Current Observation contract has no spatial geometry families/);
  assert.match(spatial, /embodiment\.body_pose/);
  assert.doesNotMatch(spatial, /environment\.finite_scalar_field/);
  assert.doesNotMatch(spatial, /coordinate-marker-panel|<canvas|<mesh|animated body/i);
});

test('Spatial Explorer keeps stale and empty status explicit without presenting source claims as geometry', () => {
  const stale = renderScreen(ROUTES.find(route => route.path === '/spatial'), {...availableSource, status: 'stale', stale: true});
  assert.match(stale, /LAST KNOWN · STALE/);
  assert.match(stale, /not a current Observation view/);
  assert.doesNotMatch(stale, /coordinate-marker-panel|<canvas/);
  const empty = renderScreen(ROUTES.find(route => route.path === '/spatial'), {...initialSource, status: 'empty'});
  assert.match(empty, /No approved claims retained/);
  assert.doesNotMatch(empty, /coordinate-marker-panel|<canvas/);
});

test('claim display preserves identity, authority, frame, source time, lineage and local delivery sequence', () => {
  const html = renderScreen(ROUTES.find(route => route.path === '/claims'), availableSource);
  for (const value of ['body-7', 'episode-3', 'morphology-r2', 'embodiment', 'world_causal_tick = 12', 'embodiment_state_sha256', 'a'.repeat(64), 'Local delivery sequence · not causal time']) {
    assert.ok(html.includes(value), `expected displayed field: ${value}`);
  }
  assert.match(html, /Source lineage/);
  assert.match(html, /not joined into a shared snapshot/);
});

test('claim DOM identity includes the identity issuer', () => {
  const first = {...bodyPose, identities: [bodyPose.identities[0]]};
  const second = {...bodyPose, identities: [{...bodyPose.identities[0], issuer: {kind: 'other_owner', identifier: 'other'}}]};
  const html = renderScreen(ROUTES.find(route => route.path === '/claims'), {...availableSource, claims: [first, second]});
  const keys = [...html.matchAll(/data-key="([^"]+)"/g)].map(match => match[1]);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
});

test('claim DOM identity safely encodes delimiter characters in opaque identity fields', () => {
  const first = {...bodyPose, identities: [{...bodyPose.identities[0], issuer: {kind: 'a:b', identifier: 'c'}}]};
  const second = {...bodyPose, identities: [{...bodyPose.identities[0], issuer: {kind: 'a', identifier: 'b:c'}}]};
  const html = renderScreen(ROUTES.find(route => route.path === '/claims'), {...availableSource, claims: [first, second]});
  const keys = [...html.matchAll(/data-key="([^"]+)"/g)].map(match => match[1]);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
});

test('HTML from source claims is escaped before display', () => {
  const hostile = {...bodyPose, identities: [{...bodyPose.identities[0], value: '<script>alert(1)</script>'}]};
  const html = renderScreen(ROUTES.find(route => route.path === '/claims'), {...availableSource, claims: [hostile]});
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('empty current subset is not shown as source absence', () => {
  const html = renderScreen(ROUTES.find(route => route.path === '/overview'), {...initialSource, status: 'empty', claims: [], scope: 'bounded_in_memory_current_subset'});
  assert.match(html, /not evidence that source state is absent/);
});

test('last-known claims are explicitly stale after availability failure', () => {
  const html = renderScreen(ROUTES.find(route => route.path === '/claims'), {...availableSource, status:'stale', stale:true, unavailableStatus:'disconnected'});
  assert.match(html,/LAST KNOWN · STALE/);
  assert.match(html,/not a current Observation view/);
  assert.match(html,/STALE · LAST KNOWN/);
});

test('history, world catalog and sensorimotor relations remain explicitly unsupported', () => {
  assert.match(renderScreen(ROUTES.find(route => route.path === '/timeline'), availableSource), /Historical timeline not supported/);
  assert.match(renderScreen(ROUTES.find(route => route.path === '/worlds'), availableSource), /World discovery, run enumeration/);
  assert.match(renderScreen(ROUTES.find(route => route.path === '/sensorimotor'), availableSource), /No relation contract is available/);
});
