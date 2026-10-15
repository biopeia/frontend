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

test('all seven peer routes render without inventing a World or run join', () => {
  const html = ROUTES.map(route => renderScreen(route, availableSource));
  assert.equal(new Set(html).size, 7);
  for (const page of html) {
    assert.ok(!page.includes('runtime_tick_events'));
    assert.ok(!page.includes('Committed World revision: 12'));
  }
});

test('spatial screens show source pose values but do not fabricate geometry', () => {
  for (const path of ['/overview', '/spatial']) {
    const html = renderScreen(ROUTES.find(route => route.path === path), availableSource);
    assert.match(html, /No authorized scene geometry/);
    assert.match(html, /Position · m/);
    assert.match(html, /1\.00000, 2\.00000, 3\.00000/);
    assert.doesNotMatch(html, /<canvas|<mesh|animated body/i);
  }
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
