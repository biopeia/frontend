import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeCurrentEnvelope, fetchCurrentObservation, ObservationReadError, CURRENT_SCHEMA_ID} from '../src/observation-client.js';

const actor = (kind, identifier) => ({kind, identifier});
function bodyPoseMessage(sequence = 1) {
  return {delivery_sequence: sequence, observation: {
    claim: {
      family: {authority: 'embodiment', path: ['body_pose'], contract: {contract_id: 'embodiment.body_pose', revision: 'v1'}},
      subject: {kind: 'body', key: 'body-a', identities: ['body', 'embodiment_episode', 'morphology_revision'].map((kind, i) => ({identity: {kind, value: `${kind}-a`, issuer: actor('embodiment', 'embodiment-a'), scope: null, lifetime: null}, asserter: actor('embodiment', 'embodiment-a')}))},
      epistemic_kind: 'authoritative_state',
      value: {position: {value: [1, 2, 3], unit: 'm'}, orientation: {value_xyzw: [0, 0, 0, 1], representation: 'unit_quaternion_xyzw', convention: 'right_handed_hamilton_q_v_q_conjugate'}, reference_frame: 'world', body_frame: 'root'},
    },
    acquisition: {method: 'embodiment_owner_state_projection', measurement_source: null},
    asserter: actor('embodiment_owner_boundary', 'embodiment_owner_boundary'),
    producer: actor('embodiment_owner_projection', 'embodiment_owner_projection'),
    domain_time: [],
    context_time: [{domain: 'world', kind: 'world_causal_tick', value: 4}],
    lineage: {parents: [{namespace: 'embodiment_state_sha256', reference: 'a'.repeat(64)}], transformation: {transformation_id: 'embodiment.body_pose.project_observation', revision: '1', effective_configuration: [['world_id', 'world-a'], ['causal_tick', 4], ['body_id', 'body-a'], ['embodiment_episode_id', 'episode-a'], ['morphology_revision', 'morphology-r1'], ['reference_frame', 'world'], ['body_frame', 'root']]}},
    conditions: [],
  }};
}
function finiteScalarMessage(sequence = 2) {
  return {delivery_sequence: sequence, observation: {
    claim: {
      family: {authority: 'environment', path: ['finite_scalar_field'], contract: {contract_id: 'biopeia.environment.finite-scalar-field', revision: '1'}},
      subject: {kind: 'environment.finite_resource_field', key: 'resource-a', identities: ['environment', 'environment_resource'].map(kind => ({identity: {kind, value: `${kind}-a`, issuer: actor('environment', 'environment-a'), scope: null, lifetime: null}, asserter: actor('environment', 'environment-a')}))},
      epistemic_kind: 'domain_derived',
      value: {quantity_kind: 'dimensionless_scalar_field', value: 0.25, unit: '1', valid_range: [0, 1], reference_frame: 'environment-local', point_m: [1, 2, 3]},
    },
    acquisition: {method: 'environment_field_evaluation', measurement_source: null},
    asserter: actor('environment_owner_boundary', 'environment.identified_finite_scalar_field'),
    producer: actor('environment_projection', 'environment.identified_finite_scalar_field.project_observation'),
    domain_time: [],
    context_time: [{domain: 'world', kind: 'world_source_causal_tick', value: 3}, {domain: 'world', kind: 'world_target_causal_tick', value: 4}],
    lineage: {parents: [{namespace: 'owner_checkpoint_sha256', reference: 'b'.repeat(64)}], transformation: {transformation_id: 'environment.finite_scalar_field.project_observation', revision: '1', effective_configuration: [['world_id', 'world-a'], ['physical_step_id', 'step-3'], ['field_revision', 'field-r1'], ['environment_revision', 'environment-r1'], ['frame_id', 'environment-local']]}},
    conditions: [],
  }};
}
function renderDescriptorMessage(family, sequence = 3) {
  const env = family === 'environment.render_scene';
  const identityValues = env
    ? {environment: 'environment-a', environment_revision: 'environment-r1'}
    : {body: 'body-a', embodiment_episode: 'episode-a', morphology_revision: 'morphology-r1', geometry_revision: 'geometry-r1'};
  const value = env
    ? {schema_version: 1, environment_id: identityValues.environment, environment_revision: identityValues.environment_revision, length_unit: 'm', frame: {frame_id: 'environment-local', parent_frame_id: 'world', origin_m: [0, 0, 0], x_axis_in_parent: [1, 0, 0], y_axis_in_parent: [0, 1, 0], z_axis_in_parent: [0, 0, 1], handedness: 'RIGHT_HANDED', up_axis: 'Z'}, items: [], render_geometry_sha256: 'c'.repeat(64)}
    : {contract_revision: 'embodiment.render_morphology/v1', schema_version: 1, body_id: identityValues.body, embodiment_episode_id: identityValues.embodiment_episode, morphology_revision: identityValues.morphology_revision, geometry_revision: identityValues.geometry_revision, render_geometry_sha256: 'd'.repeat(64), coordinate_system: 'right_handed_z_up', length_unit: 'm', segments: [], joints: []};
  const subjectKind = env ? 'environment' : 'embodiment_body';
  return {delivery_sequence: sequence, observation: {
    claim: {family: {authority: env ? 'environment' : 'embodiment', path: [env ? 'render_scene' : 'render_morphology'], contract: {contract_id: env ? 'biopeia.environment.render-scene' : 'embodiment.render_morphology', revision: env ? '1' : 'v1'}}, subject: {kind: subjectKind, key: Object.values(identityValues)[0], identities: Object.entries(identityValues).map(([kind, val]) => ({identity: {kind, value: val, issuer: actor(env ? 'environment_owner_projection' : 'embodiment_owner_projection', 'owner_projection'), scope: null, lifetime: null}, asserter: actor(env ? 'environment_owner_projection' : 'embodiment_owner_projection', 'owner_projection')}))}, epistemic_kind: 'authoritative_state', value},
    acquisition: {method: 'owner_projection', measurement_source: null}, asserter: actor(env ? 'environment_owner_projection' : 'embodiment_owner_projection', 'owner_projection'), producer: actor(env ? 'environment_owner_projection' : 'embodiment_owner_projection', 'owner_projection'), domain_time: [], context_time: [], lineage: {parents: [{namespace: 'render_geometry_sha256', reference: value.render_geometry_sha256}], transformation: {transformation_id: 'owner.static_render_projection', revision: '1', effective_configuration: Object.entries(identityValues)}}, conditions: [],
  }};
}
function renderPoseMessage(sequence = 4) {
  const bodyId = 'body-a';
  const candidate = {contract_revision: 'embodiment.render_link_pose_candidate/v1', body_id: bodyId, embodiment_episode_id: 'episode-a', morphology_revision: 'morphology-r1', geometry_revision: 'geometry-r1', render_geometry_sha256: 'e'.repeat(64), source_world_id: 'world-a', physical_step_id: 'step-4', environment_revision: 'environment-r1', solver_config_revision: 'solver-r1', source_causal_tick: 4, target_causal_tick: 5, reference_frame: 'physics3d.world', coordinate_system: 'right_handed_z_up', length_unit: 'm', completeness: 'complete', poses: [{segment_id: 'link-a', translation_m: [1, 2, 3], orientation_xyzw: [0, 0, 0, 1]}]};
  const checkpoint = {owner: 'embodiment', owner_identity: bodyId, checkpoint_id: 'checkpoint-5', schema_version: '1', locator: 'local:checkpoint-5', sha256: 'b'.repeat(64)};
  const cut = {world_id: 'world-a', causal_tick: 5, commit_id: 'world-a:commit:5', participant_ids: [['embodiment', bodyId]], presence_owner_links: [['organism', 'organism-a', bodyId]], owner_checkpoint_references: [checkpoint]};
  const association = {association_kind: 'transient_current_committed_cut', projection_sha256: 'f'.repeat(64), committed_cut: cut, owner_checkpoint_reference: checkpoint};
  const ids = {body: bodyId, embodiment_episode: candidate.embodiment_episode_id, morphology_revision: candidate.morphology_revision, geometry_revision: candidate.geometry_revision};
  return {delivery_sequence: sequence, observation: {
    claim: {family: {authority: 'embodiment', path: ['render_link_pose'], contract: {contract_id: 'embodiment.render_link_pose', revision: 'v1'}}, subject: {kind: 'embodiment_body', key: bodyId, identities: Object.entries(ids).map(([kind, value]) => ({identity: {kind, value, issuer: actor('embodiment', bodyId), scope: null, lifetime: null}, asserter: actor('embodiment', bodyId)}))}, epistemic_kind: 'authoritative_state', value: {candidate, world_association: association}},
    acquisition: {method: 'embodiment_owner_render_pose_candidate', measurement_source: null}, asserter: actor('embodiment_owner_boundary', 'embodiment.owner_checkpoint'), producer: actor('embodiment_owner_projection', 'embodiment.render_link_pose_candidate'), domain_time: [], context_time: [{domain: 'world', kind: 'world_causal_tick', value: 5}], lineage: {parents: [{namespace: 'embodiment_owner_checkpoint_sha256', reference: checkpoint.sha256}, {namespace: 'embodiment_render_geometry_sha256', reference: candidate.render_geometry_sha256}], transformation: {transformation_id: 'world.transient_associate_embodiment_render_pose', revision: '1', effective_configuration: [['world_id', 'world-a'], ['causal_tick', '5'], ['commit_id', cut.commit_id], ['checkpoint_id', checkpoint.checkpoint_id], ['projection_sha256', association.projection_sha256]]}}, conditions: [],
  }};
}
function current(messages = []) {
  return {schema: CURRENT_SCHEMA_ID, availability: messages.length ? 'available' : 'current_view_empty', absence_semantics: 'not_evidence_of_source_absence', scope: 'bounded_in_memory_current_subset', freshness: 'not_established_by_snapshot', coherence: 'per_message_only_no_cross_owner_snapshot_guarantee', messages};
}

test('accepts BodyPose only under exact family contract and preserves opaque source envelope', () => {
  const decoded = decodeCurrentEnvelope(current([bodyPoseMessage()]));
  assert.equal(decoded.status, 'available');
  assert.equal(decoded.claims[0].family, 'embodiment.body_pose');
  assert.equal(decoded.claims[0].observation.context_time[0].value, 4);
  assert.equal(decoded.claims[0].deliverySequence, 1);
  assert.equal(decoded.scope, 'bounded_in_memory_current_subset');
});

test('accepts the bounded finite scalar field with identity, units, World cuts and transformation lineage', () => {
  const decoded = decodeCurrentEnvelope(current([finiteScalarMessage()]));
  assert.equal(decoded.status, 'available');
  assert.equal(decoded.claims[0].family, 'environment.finite_scalar_field');
  assert.equal(decoded.claims[0].value.value, 0.25);
  assert.deepEqual(decoded.claims[0].observation.context_time.map(time => time.value), [3, 4]);
});

test('accepts static render descriptors only under the approved owner projection envelope', () => {
  for (const family of ['environment.render_scene', 'embodiment.render_morphology']) {
    const decoded = decodeCurrentEnvelope(current([renderDescriptorMessage(family)]));
    assert.equal(decoded.claims[0].family, family);
    assert.ok(decoded.claims[0].value.render_geometry_sha256);

    const forgedActor = renderDescriptorMessage(family);
    forgedActor.observation.asserter.identifier = 'unverified';
    assert.throws(() => decodeCurrentEnvelope(current([forgedActor])), /provenance mismatch/);

    const forgedTransform = renderDescriptorMessage(family);
    forgedTransform.observation.lineage.transformation.transformation_id = 'unverified_projection';
    assert.throws(() => decodeCurrentEnvelope(current([forgedTransform])), /transformation provenance/);
  }
});

test('accepts render pose only with exact Embodiment checkpoint membership and World cut lineage', () => {
  const message = renderPoseMessage();
  const decoded = decodeCurrentEnvelope(current([message]));
  assert.equal(decoded.claims[0].family, 'embodiment.render_link_pose');
  const bad = renderPoseMessage();
  bad.observation.claim.value.world_association.committed_cut.causal_tick = 6;
  assert.throws(() => decodeCurrentEnvelope(current([bad])), /World cut association/);
});

test('empty current subset remains distinct and explicitly is not source absence', () => {
  const payload = current();
  const decoded = decodeCurrentEnvelope(payload);
  assert.equal(decoded.status, 'empty');
  assert.equal(payload.absence_semantics, 'not_evidence_of_source_absence');
});

test('filters unsupported families without displaying their values', () => {
  const unsupported = bodyPoseMessage();
  unsupported.observation.claim.family = {authority: 'organism', path: ['private_state'], contract: {contract_id: 'organism.private_state', revision: '1'}};
  const decoded = decodeCurrentEnvelope(current([unsupported]));
  assert.equal(decoded.status, 'unsupported');
  assert.deepEqual(decoded.claims, []);
});

test('rejects unknown schema, unapproved contract revision and malformed approved values', () => {
  assert.throws(() => decodeCurrentEnvelope({...current(), schema: 'biopeia.observation.current.v9'}), {name: 'ObservationReadError'});
  const changedContract = bodyPoseMessage();
  changedContract.observation.claim.family.contract.revision = 'v2';
  assert.throws(() => decodeCurrentEnvelope(current([changedContract])), /contract mismatch/);
  const malformed = bodyPoseMessage();
  malformed.observation.claim.value.position.unit = 'cm';
  assert.throws(() => decodeCurrentEnvelope(current([malformed])), /BodyPose value/);
});

test('rejects approved-family messages with substituted provenance or missing transformation context', () => {
  const wrongProducer = bodyPoseMessage();
  wrongProducer.observation.producer.identifier = 'unverified-producer';
  assert.throws(() => decodeCurrentEnvelope(current([wrongProducer])), /provenance mismatch/);
  const missingContext = finiteScalarMessage();
  missingContext.observation.lineage.transformation.effective_configuration = [['world_id', 'world-a']];
  assert.throws(() => decodeCurrentEnvelope(current([missingContext])), /context is incomplete/);
});

test('rejects false empty/available claims and altered snapshot guarantees', () => {
  assert.throws(() => decodeCurrentEnvelope({...current([bodyPoseMessage()]), availability: 'current_view_empty'}));
  assert.throws(() => decodeCurrentEnvelope({...current(), freshness: 'fresh'}));
});

test('fetch uses only the fixed same-origin read endpoint and no-store semantics', async () => {
  let request;
  const result = await fetchCurrentObservation({fetchImpl: async (url, options) => {
    request = {url, options};
    return new Response(JSON.stringify(current([bodyPoseMessage()])), {status: 200, headers: {'Content-Type': 'application/json'}});
  }});
  assert.equal(request.url, '/api/observation/current');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.cache, 'no-store');
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(result.claims.length, 1);
});

test('distinguishes denied, unsupported, transport, and malformed responses', async () => {
  for (const [status, expected] of [[403, 'denied'], [404, 'unsupported'], [503, 'unavailable']]) {
    await assert.rejects(fetchCurrentObservation({fetchImpl: async () => new Response('', {status})}), error => error instanceof ObservationReadError && error.status === expected);
  }
  await assert.rejects(fetchCurrentObservation({fetchImpl: async () => { throw new Error('offline'); }}), error => error.status === 'disconnected');
  await assert.rejects(fetchCurrentObservation({fetchImpl: async () => new Response('{', {status: 200, headers: {'Content-Type': 'application/json'}})}), /malformed JSON/);
});

test('enforces response byte cap before decoding', async () => {
  const large = new Response('x'.repeat(64), {status: 200, headers: {'Content-Type': 'application/json'}});
  await assert.rejects(fetchCurrentObservation({fetchImpl: async () => large, maxBytes: 16}), /size limit/);
});
