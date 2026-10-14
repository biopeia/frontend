const CURRENT_SCHEMA = 'biopeia.observation.current.v1';
const MAX_RESPONSE_BYTES = 1_000_000;

export class ObservationReadError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ObservationReadError';
    this.status = status;
  }
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.trim().length > 0;
const finiteVector = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);

function requireRecord(value, label) {
  if (!isRecord(value)) throw new ObservationReadError('error', `Malformed ${label}`);
  return value;
}

function validateIdentity(subject, requiredKinds) {
  const assertions = subject?.identities;
  if (!Array.isArray(assertions)) throw new ObservationReadError('error', 'Malformed typed identities');
  const found = new Map();
  for (const assertion of assertions) {
    const identity = requireRecord(assertion?.identity, 'identity assertion');
    if (!isText(identity.kind) || !isText(identity.value) || !isRecord(identity.issuer) || !isText(identity.issuer.kind) || !isText(identity.issuer.identifier)) {
      throw new ObservationReadError('error', 'Malformed typed identity');
    }
    if (found.has(identity.kind)) throw new ObservationReadError('error', 'Duplicate typed identity');
    found.set(identity.kind, identity);
  }
  for (const kind of requiredKinds) if (!found.has(kind)) throw new ObservationReadError('error', `Missing ${kind} identity`);
  return [...found.values()];
}

function validateTransformation(observation, expectedId, requiredKeys) {
  const transformation = observation.lineage.transformation;
  if (!isRecord(transformation) || transformation.transformation_id !== expectedId ||
      !Array.isArray(transformation.effective_configuration) ||
      !transformation.effective_configuration.every(entry => Array.isArray(entry) && entry.length === 2 && isText(entry[0]))) {
    throw new ObservationReadError('error', 'Missing or invalid source transformation');
  }
  const keys = transformation.effective_configuration.map(([key]) => key);
  if (new Set(keys).size !== keys.length || !requiredKeys.every(key => keys.includes(key))) {
    throw new ObservationReadError('error', 'Source transformation context is incomplete');
  }
}

function validateObservation(message) {
  const envelope = requireRecord(message, 'Observation message');
  if (!Number.isSafeInteger(envelope.delivery_sequence) || envelope.delivery_sequence < 0) {
    throw new ObservationReadError('error', 'Invalid local delivery sequence');
  }
  const observation = requireRecord(envelope.observation, 'semantic observation');
  const claim = requireRecord(observation.claim, 'claim');
  const family = requireRecord(claim.family, 'claim family');
  const contract = requireRecord(family.contract, 'claim contract');
  if (!Array.isArray(family.path) || !family.path.length || !family.path.every(isText)) throw new ObservationReadError('error', 'Malformed family path');
  const qualified = [family.authority, ...family.path].join('.');
  const approved = {
    'embodiment.body_pose': {authority: 'embodiment', contractId: 'embodiment.body_pose', revision: 'v1', kind: 'authoritative_state'},
    'environment.finite_scalar_field': {authority: 'environment', contractId: 'biopeia.environment.finite-scalar-field', revision: '1', kind: 'domain_derived'},
  }[qualified];
  if (!approved) return null;
  if (family.authority !== approved.authority || contract.contract_id !== approved.contractId || contract.revision !== approved.revision || claim.epistemic_kind !== approved.kind) {
    throw new ObservationReadError('error', 'Approved family contract mismatch');
  }
  const subject = requireRecord(claim.subject, 'claim subject');
  const value = requireRecord(claim.value, 'claim value');
  const asserter = requireRecord(observation.asserter, 'claim asserter');
  const producer = requireRecord(observation.producer, 'claim producer');
  const lineage = requireRecord(observation.lineage, 'claim lineage');
  const acquisition = requireRecord(observation.acquisition, 'acquisition basis');
  if (!isText(asserter.kind) || !isText(asserter.identifier) || !isText(producer.kind) || !isText(producer.identifier) || !isText(acquisition.method)) {
    throw new ObservationReadError('error', 'Malformed source provenance');
  }
  const expectedProvenance = qualified === 'embodiment.body_pose'
    ? {asserter: ['embodiment_owner_boundary', 'embodiment_owner_boundary'], producer: ['embodiment_owner_projection', 'embodiment_owner_projection'], acquisition: 'embodiment_owner_state_projection'}
    : {asserter: ['environment_owner_boundary', 'environment.identified_finite_scalar_field'], producer: ['environment_projection', 'environment.identified_finite_scalar_field.project_observation'], acquisition: 'environment_field_evaluation'};
  if (asserter.kind !== expectedProvenance.asserter[0] || asserter.identifier !== expectedProvenance.asserter[1] ||
      producer.kind !== expectedProvenance.producer[0] || producer.identifier !== expectedProvenance.producer[1] ||
      acquisition.method !== expectedProvenance.acquisition) {
    throw new ObservationReadError('error', 'Approved family source provenance mismatch');
  }
  if (!Array.isArray(observation.context_time) || !Array.isArray(observation.domain_time) || !Array.isArray(lineage.parents) ||
      !lineage.parents.every(parent => isRecord(parent) && isText(parent.namespace) && isText(parent.reference)) ||
      (lineage.transformation !== null && (!isRecord(lineage.transformation) || !isText(lineage.transformation.transformation_id) || !isText(lineage.transformation.revision) ||
        !Array.isArray(lineage.transformation.effective_configuration) || !lineage.transformation.effective_configuration.every(entry => Array.isArray(entry) && entry.length === 2 && isText(entry[0])))) ||
      !observation.context_time.every(time => isRecord(time) && isText(time.domain) && isText(time.kind) && ['string', 'number'].includes(typeof time.value)) ||
      !observation.domain_time.every(time => isRecord(time) && isText(time.domain) && isText(time.kind) && ['string', 'number'].includes(typeof time.value))) {
    throw new ObservationReadError('error', 'Malformed source lineage or time references');
  }
  if (qualified === 'embodiment.body_pose') {
    const identities = validateIdentity(subject, ['body', 'embodiment_episode', 'morphology_revision']);
    const position = requireRecord(value.position, 'BodyPose position');
    const orientation = requireRecord(value.orientation, 'BodyPose orientation');
    if (!finiteVector(position.value, 3) || position.unit !== 'm' || !finiteVector(orientation.value_xyzw, 4) ||
        orientation.representation !== 'unit_quaternion_xyzw' || orientation.convention !== 'right_handed_hamilton_q_v_q_conjugate' ||
        Math.abs(orientation.value_xyzw.reduce((sum, part) => sum + part * part, 0) - 1) > 1e-5 ||
        !isText(value.reference_frame) || !isText(value.body_frame)) {
      throw new ObservationReadError('error', 'Malformed approved BodyPose value');
    }
    if (!observation.context_time.some(time => time.domain === 'world' && time.kind === 'world_causal_tick' && Number.isSafeInteger(time.value) && time.value >= 0) ||
        !lineage.parents.some(parent => parent.namespace === 'embodiment_state_sha256' && /^[a-f0-9]{64}$/.test(parent.reference))) {
      throw new ObservationReadError('error', 'BodyPose is missing its World cut or owner-state lineage');
    }
    validateTransformation(observation, 'embodiment.body_pose.project_observation', ['world_id', 'causal_tick', 'body_id', 'embodiment_episode_id', 'morphology_revision', 'reference_frame', 'body_frame']);
    return {deliverySequence: envelope.delivery_sequence, observation, family: qualified, identities, value};
  }
  const identities = validateIdentity(subject, ['environment', 'environment_resource']);
  if (value.quantity_kind !== 'dimensionless_scalar_field' || value.unit !== '1' || !Array.isArray(value.valid_range) ||
      value.valid_range.length !== 2 || value.valid_range[0] !== 0 || value.valid_range[1] !== 1 ||
      typeof value.value !== 'number' || !Number.isFinite(value.value) || value.value < 0 || value.value > 1 ||
      !finiteVector(value.point_m, 3) || !isText(value.reference_frame)) {
    throw new ObservationReadError('error', 'Malformed approved finite scalar field value');
  }
  if (!observation.context_time.some(time => time.domain === 'world' && time.kind === 'world_source_causal_tick' && Number.isSafeInteger(time.value) && time.value >= 0) ||
      !observation.context_time.some(time => time.domain === 'world' && time.kind === 'world_target_causal_tick' && Number.isSafeInteger(time.value) && time.value >= 0) ||
      !lineage.parents.some(parent => parent.namespace === 'owner_checkpoint_sha256' && /^[a-f0-9]{64}$/.test(parent.reference))) {
    throw new ObservationReadError('error', 'Finite scalar field is missing World cut context or owner-checkpoint lineage');
  }
  validateTransformation(observation, 'environment.finite_scalar_field.project_observation', ['world_id', 'physical_step_id', 'field_revision', 'environment_revision', 'frame_id']);
  return {deliverySequence: envelope.delivery_sequence, observation, family: qualified, identities, value};
}

export function decodeCurrentEnvelope(payload) {
  const envelope = requireRecord(payload, 'current-view envelope');
  if (envelope.schema !== CURRENT_SCHEMA) throw new ObservationReadError('unsupported', 'Unsupported Observation schema');
  if (envelope.absence_semantics !== 'not_evidence_of_source_absence' ||
      envelope.scope !== 'bounded_in_memory_current_subset' ||
      envelope.freshness !== 'not_established_by_snapshot' ||
      envelope.coherence !== 'per_message_only_no_cross_owner_snapshot_guarantee') {
    throw new ObservationReadError('error', 'Current-view limits do not match the approved contract');
  }
  if (!['available', 'current_view_empty'].includes(envelope.availability) || !Array.isArray(envelope.messages)) {
    throw new ObservationReadError('error', 'Malformed current-view availability');
  }
  const claims = envelope.messages.map(validateObservation).filter(Boolean);
  if (envelope.availability === 'available' && envelope.messages.length === 0) throw new ObservationReadError('error', 'Inconsistent current-view availability');
  if (envelope.availability === 'current_view_empty' && envelope.messages.length !== 0) throw new ObservationReadError('error', 'Inconsistent empty current view');
  return Object.freeze({status: claims.length ? 'available' : envelope.messages.length ? 'unsupported' : 'empty', claims: Object.freeze(claims), scope: envelope.scope, freshness: envelope.freshness, coherence: envelope.coherence});
}

async function readBoundedBody(response, limit) {
  const announced = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(announced) && announced > limit) throw new ObservationReadError('error', 'Observation response exceeds the browser size limit');
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw new ObservationReadError('error', 'Observation response exceeds the browser size limit');
    return new TextDecoder().decode(bytes);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ObservationReadError('error', 'Observation response exceeds the browser size limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function fetchCurrentObservation({fetchImpl = globalThis.fetch, endpoint = '/api/observation/current', maxBytes = MAX_RESPONSE_BYTES} = {}) {
  if (typeof fetchImpl !== 'function' || endpoint !== '/api/observation/current') throw new ObservationReadError('unsupported', 'Unsupported Observation read endpoint');
  let response;
  try {
    response = await fetchImpl(endpoint, {method: 'GET', headers: {Accept: 'application/json'}, cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(2000)});
  } catch {
    throw new ObservationReadError('disconnected', 'Observation bridge is unavailable');
  }
  if (response.status === 403) throw new ObservationReadError('denied', 'Observation read was denied');
  if (response.status === 404) throw new ObservationReadError('unsupported', 'Observation bridge route is unavailable');
  if (response.status !== 200) throw new ObservationReadError('unavailable', 'Observation bridge did not return a current view');
  if (!response.headers?.get?.('content-type')?.toLowerCase().startsWith('application/json')) throw new ObservationReadError('error', 'Observation response is not JSON');
  let payload;
  try { payload = JSON.parse(await readBoundedBody(response, maxBytes)); }
  catch (error) {
    if (error instanceof ObservationReadError) throw error;
    throw new ObservationReadError('error', 'Observation response is malformed JSON');
  }
  return decodeCurrentEnvelope(payload);
}

export const CURRENT_SCHEMA_ID = CURRENT_SCHEMA;
export const CURRENT_RESPONSE_LIMIT_BYTES = MAX_RESPONSE_BYTES;
