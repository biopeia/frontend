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

test('spatial screens show source pose values but do not fabricate geometry', () => {
  const overview = renderScreen(ROUTES.find(route => route.path === '/overview'), availableSource);
  const spatial = renderScreen(ROUTES.find(route => route.path === '/spatial'), availableSource);
  assert.match(overview, /No authorized scene geometry/);
  assert.match(spatial, /No authorized scene geometry/);
  assert.match(spatial, /Position · m/);
  assert.match(spatial, /1\.00000, 2\.00000, 3\.00000/);
  assert.match(spatial, /coordinate-marker-panel/);
  assert.doesNotMatch(spatial, /<canvas|<mesh|animated body/i);
});

test('spatial explorer renders separate coordinate markers for each authorized M1 claim', () => {
  const html = renderScreen(ROUTES.find(route => route.path === '/spatial'), {...availableSource, claims: [bodyPose, scalarField]});
  assert.equal((html.match(/coordinate-marker-panel/g) ?? []).length, 2);
  assert.match(html, /embodiment\.body_pose/);
  assert.match(html, /environment\.finite_scalar_field/);
  assert.match(html, /<figure[^>]+aria-label="Independent coordinate marker/);
  assert.match(html, /Reference frame: <strong>world/);
  assert.match(html, /Body frame: <strong>root/);
  assert.match(html, /Reference frame: <strong>environment-local/);
  assert.match(html, /Identity: body=body-7/);
  assert.match(html, /Source context: world\.world_causal_tick = 12/);
  assert.match(html, /Source lineage: embodiment_state_sha256:/);
  assert.match(html, /Z coordinate · m/);
  assert.match(html, /Separate owner claims; no shared scene or coordinate join/);
  assert.match(html, /Auto-scaled independently for presentation only; not a physical scale/);
  assert.doesNotMatch(html, /<canvas|<mesh|animated body/i);
});

test('spatial marker follows changed source coordinates without changing the independent panel', () => {
  const moved = {...bodyPose, value: {...bodyPose.value, position: {...bodyPose.value.position, value: [-3, 0.5, 8]}}};
  const html = renderScreen(ROUTES.find(route => route.path === '/spatial'), {...availableSource, claims: [moved]});
  assert.match(html, /data-coordinate-x="-3" data-coordinate-y="0\.5" data-coordinate-z="8"/);
  const [, cx, cy] = html.match(/<circle cx="([\d.]+)" cy="([\d.]+)"/);
  assert.ok(Math.abs(Number(cx) - 45.21739130434783) < 1e-9);
  assert.ok(Math.abs(Number(cy) - 107.53623188405797) < 1e-9);
  const baselineHtml = renderScreen(ROUTES.find(route => route.path === '/spatial'), {...availableSource, claims: [bodyPose]});
  assert.notEqual(cx, baselineHtml.match(/<circle cx="([\d.]+)"/)[1]);
  assert.match(html, /Z coordinate · m[\s\S]*8\.00000/);
});

test('coordinate marker maps finite source XY into its own bounded plot and suppresses malformed values', () => {
  const route = ROUTES.find(route => route.path === '/spatial');
  const extreme = {...bodyPose, value: {...bodyPose.value, position: {...bodyPose.value.position, value: [-1e12, 1e12, 0]}}};
  const html = renderScreen(route, {...availableSource, claims: [extreme]});
  const [cx, cy] = html.match(/<circle cx="([\d.]+)" cy="([\d.]+)"/).slice(1).map(Number);
  assert.ok(cx >= 34 && cx <= 206);
  assert.ok(cy >= 34 && cy <= 206);

  for (const coordinates of [[1, 2], [1, Infinity, 3], ['1', 2, 3]]) {
    const invalid = {...bodyPose, value: {...bodyPose.value, position: {...bodyPose.value.position, value: coordinates}}};
    const invalidHtml = renderScreen(route, {...availableSource, claims: [invalid]});
    assert.doesNotMatch(invalidHtml, /coordinate-marker-panel/);
  }
});

test('stale spatial marker is retained only with explicit stale label', () => {
  const html = renderScreen(ROUTES.find(route => route.path === '/spatial'), {...availableSource, status: 'stale', stale: true});
  assert.match(html, /LAST KNOWN · STALE/);
  assert.match(html, /not a current Observation view/);
  assert.match(html, /coordinate-marker-panel/);
});

test('unsupported or empty spatial scope renders no coordinate marker', () => {
  const html = renderScreen(ROUTES.find(route => route.path === '/spatial'), {...initialSource, status: 'empty'});
  assert.doesNotMatch(html, /coordinate-marker-panel/);
  assert.match(html, /No authorized coordinate values available/);
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
