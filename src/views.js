// Evidence-first views over the bounded current Observation subset only.
const esc = value => String(value ?? 'Not available').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const panel = (title, body, tag = 'CURRENT VIEW') => `<section class="panel"><div class="panel-heading"><h2>${esc(title)}</h2><span class="small-tag">${esc(tag)}</span></div><div class="panel-body">${body}</div></section>`;
const note = (title, description, kind = 'UNKNOWN') => `<div class="empty-detail" role="status"><span class="state-pill">${esc(kind)}</span><h3>${esc(title)}</h3><p>${esc(description)}</p><p class="fine">This describes only the bounded retained Observation subset; it is not evidence that source state is absent.</p></div>`;
const item = (label, value) => `<div class="property"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
const link = (route, text) => `<a class="text-link" href="${esc(route)}" data-nav>${esc(text)} →</a>`;
const guide = steps => `<ol class="guidance">${steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol>`;
const vector = value => Array.isArray(value) ? value.map(part => Number(part).toPrecision(6)).join(', ') : 'Not available';
const actor = value => value ? `${value.kind}: ${value.identifier}` : 'Not available';

function identityDetails(claim) {
  return claim.identities.map(identity => item(`Identity · ${identity.kind}`, `${identity.value} (issuer ${actor(identity.issuer)})`)).join('');
}

function transformationDetails(observation) {
  const transform = observation.lineage.transformation;
  if (!transform) return item('Projection', 'Not supplied');
  const configuration = Array.isArray(transform.effective_configuration)
    ? transform.effective_configuration.map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : value}`).join('; ')
    : 'Not supplied';
  return item('Projection', `${transform.transformation_id}@${transform.revision}`) + item('Projection configuration · source-declared', configuration);
}

function valueDetails(claim) {
  const value = claim.value;
  if (claim.family === 'embodiment.body_pose') {
    return item('Position · m', vector(value.position.value)) +
      item('Orientation · unit quaternion XYZW', vector(value.orientation.value_xyzw)) +
      item('Reference frame', value.reference_frame) + item('Body frame', value.body_frame);
  }
  if (claim.family === 'environment.render_scene') {
    return item('Environment', value.environment_id) + item('Environment revision', value.environment_revision) +
      item('Geometry digest', value.render_geometry_sha256) + item('Length unit', value.length_unit) +
      item('Coordinate frame', value.frame?.frame_id) + item('Authored geometry items', Array.isArray(value.items) ? value.items.length : 'Not available');
  }
  if (claim.family === 'embodiment.render_morphology') {
    return item('Body', value.body_id) + item('Embodiment episode', value.embodiment_episode_id) +
      item('Morphology revision', value.morphology_revision) + item('Geometry revision', value.geometry_revision) +
      item('Geometry digest', value.render_geometry_sha256) + item('Coordinate system', value.coordinate_system) +
      item('Authored segments', Array.isArray(value.segments) ? value.segments.length : 'Not available') +
      item('Joints', Array.isArray(value.joints) ? value.joints.length : 'Not available');
  }
  if (claim.family === 'embodiment.render_link_pose') {
    const candidate = value.candidate ?? {};
    const cut = value.world_association?.committed_cut ?? {};
    return item('Body', candidate.body_id) + item('Embodiment episode', candidate.embodiment_episode_id) +
      item('Morphology / geometry revision', `${candidate.morphology_revision ?? 'Not available'} / ${candidate.geometry_revision ?? 'Not available'}`) +
      item('Pose candidate source tick', candidate.source_causal_tick) + item('Pose candidate target tick', candidate.target_causal_tick) +
      item('Associated committed World cut', `${cut.world_id ?? 'Not available'} · ${cut.causal_tick ?? 'Not available'} · ${cut.commit_id ?? 'Not available'}`) +
      item('Physical step', candidate.physical_step_id) + item('Authored link poses', Array.isArray(candidate.poses) ? candidate.poses.length : 'Not available') +
      item('Coordinate system · unit', `${candidate.coordinate_system ?? 'Not available'} · ${candidate.length_unit ?? 'Not available'}`);
  }
  return item('Quantity kind', value.quantity_kind) + item('Value · unit 1', value.value) +
    item('Declared range', Array.isArray(value.valid_range) ? `[${value.valid_range.join(', ')}]` : 'Not available') + item('Sample point · m', vector(value.point_m)) +
    item('Reference frame', value.reference_frame);
}

function claimCard(claim) {
  const observation = claim.observation;
  const semantic = observation.claim;
  const family = semantic.family;
  const contextTimes = observation.context_time.length
    ? observation.context_time.map(time => `${time.domain}.${time.kind} = ${time.value}`).join('; ')
    : 'Not supplied';
  const parents = observation.lineage.parents.length
    ? observation.lineage.parents.map(parent => `${parent.namespace}: ${parent.reference}`).join('; ')
    : 'Not supplied';
  const header = `${family.authority}.${family.path.join('.')}`;
  const identityKey = JSON.stringify(claim.identities.map(identity => {
    const issuer = identity.issuer;
    return [issuer?.kind ?? null, issuer?.identifier ?? null, identity.kind, identity.value];
  }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
  const key = `${family.authority}.${family.path.join('.')}:${identityKey}`;
  return `<article class="panel claim-card" data-key="${esc(key)}"><div class="panel-heading"><h2>${esc(header)}</h2><span class="small-tag">${esc(family.contract.revision)}</span></div><div class="panel-body">
    ${item('Semantic authority', family.authority)}${item('Contract', `${family.contract.contract_id}@${family.contract.revision}`)}
    ${item('Epistemic kind', semantic.epistemic_kind)}${identityDetails(claim)}${valueDetails(claim)}
    ${item('Asserter', actor(observation.asserter))}${item('Producer', actor(observation.producer))}
    ${item('Acquisition', observation.acquisition.method)}${item('Source time / context', contextTimes)}
    ${item('Source lineage', parents)}${transformationDetails(observation)}${item('Local delivery sequence · not causal time', claim.deliverySequence)}
  </div></article>`;
}

function claimsSection(source, {title = 'Independent owner publications', emptyTitle = 'No approved claims retained'} = {}) {
  if (!source.claims.length) {
    const copy = source.status === 'empty' ? 'The approved bounded current subset contains no retained messages.' :
      source.status === 'unsupported' ? 'The response contained no claim family supported by this Frontend slice.' :
      'No validated current Observation messages are available in this read.';
    return panel(title, note(emptyTitle, copy, source.status.toUpperCase()), source.status.toUpperCase());
  }
  const staleNotice = source.stale ? '<p class="fine stale-label"><strong>LAST KNOWN · STALE</strong> These retained claims are not a current Observation view.</p>' : '';
  return panel(title, `${staleNotice}<p class="fine">These are separate owner claims from one bounded current view. They are not joined into a shared snapshot, and delivery order is not causal order.</p><div class="claim-grid">${source.claims.map(claimCard).join('')}</div>`, source.stale ? 'STALE · LAST KNOWN' : 'READ ONLY');
}

function coordinateMarker(claim, stale) {
  const value = claim.value;
  const family = claim.family;
  const isBodyPose = claim.family === 'embodiment.body_pose';
  const coordinates = isBodyPose ? value?.position?.value : value?.point_m;
  const frame = value?.reference_frame;
  if (!['embodiment.body_pose', 'environment.finite_scalar_field'].includes(family) ||
      !Array.isArray(coordinates) || coordinates.length !== 3 ||
      !coordinates.every(Number.isFinite) || typeof frame !== 'string' || !frame) return '';

  const [x, y, z] = coordinates;
  // Each claim is independently centered and scaled; this is a display mapping,
  // not a physical scale and never compares coordinates across claims.
  const extent = Math.max(1, Math.abs(x), Math.abs(y)) * 1.15;
  const center = 120;
  const radius = 86;
  const markerX = center + x / extent * radius;
  const markerY = center - y / extent * radius;
  const title = family;
  const bodyFrame = isBodyPose ? value?.body_frame : null;
  const identities = claim.identities.map(identity => `${identity.kind}=${identity.value} (issuer ${actor(identity.issuer)})`).join('; ') || 'Not supplied';
  const contextTimes = claim.observation.context_time.map(time => `${time.domain}.${time.kind} = ${time.value}`).join('; ') || 'Not supplied';
  const parents = claim.observation.lineage.parents.map(parent => `${parent.namespace}: ${parent.reference}`).join('; ') || 'Not supplied';
  const identityKey = JSON.stringify(claim.identities.map(identity => [identity.issuer?.kind ?? null, identity.issuer?.identifier ?? null, identity.kind, identity.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const key = `${family}:${identityKey}`;
  return `<article class="panel coordinate-marker-panel" data-key="${esc(key)}" data-coordinate-x="${esc(x)}" data-coordinate-y="${esc(y)}" data-coordinate-z="${esc(z)}">
    <div class="panel-heading"><h2>${esc(title)}</h2><span class="small-tag">${esc(claim.observation.claim.family.contract.revision)} · ${stale ? 'STALE' : 'OWNER CLAIM'}</span></div>
    <div class="panel-body"><p class="fine">Separate owner claims; no shared scene or coordinate join.</p>
      <p class="fine">Identity: ${esc(identities)}<br>Source context: ${esc(contextTimes)}<br>Source lineage: ${esc(parents)}</p>
      <figure class="coordinate-marker-figure" aria-label="Independent coordinate marker for ${esc(title)} in frame ${esc(frame)}">
        <svg viewBox="0 0 240 240" role="img" aria-label="Coordinate components X and Y in metres; independently auto-scaled for presentation">
          <line x1="24" y1="${center}" x2="216" y2="${center}" class="coordinate-axis" />
          <line x1="${center}" y1="24" x2="${center}" y2="216" class="coordinate-axis" />
          <text x="218" y="${center + 4}" class="coordinate-label">X</text>
          <text x="${center + 4}" y="18" class="coordinate-label">Y</text>
          <circle cx="${markerX}" cy="${markerY}" r="6" class="coordinate-marker" aria-hidden="true" />
        </svg>
        <figcaption>Reference frame: <strong>${esc(frame)}</strong>${bodyFrame ? ` · Body frame: <strong>${esc(bodyFrame)}</strong>` : ''} · X/Y components (m)</figcaption>
      </figure>
      <div class="property"><span>Z coordinate · m</span><strong>${esc(Number(z).toPrecision(6))}</strong></div>
      <p class="fine">Auto-scaled independently for presentation only; not a physical scale.</p>
    </div>
  </article>`;
}

function spatialMarkers(source) {
  const markers = source.claims.map(claim => coordinateMarker(claim, source.stale)).filter(Boolean);
  if (!markers.length) {
    const title = source.claims.length ? 'No authorized coordinate values available' : 'No authorized coordinate values available';
    const description = source.claims.length
      ? 'The retained approved claims do not contain a supported finite coordinate triplet for this marker view.'
      : 'No validated coordinate values are present in this bounded retained Observation subset.';
    return panel('Independent coordinate evidence', note(title, description, source.status.toUpperCase()), source.stale ? 'STALE · LAST KNOWN' : 'NO MARKERS');
  }
  return panel('Independent coordinate evidence', `<p class="fine">Each marker represents one owner claim only. Claims remain separate; this is not a physical scene, shared coordinate space, or causal snapshot.</p><div class="coordinate-marker-grid">${markers.join('')}</div>`, source.stale ? 'STALE · LAST KNOWN' : 'SEPARATE MARKERS');
}

function connectionState(source) {
  const labels = {
    'not-configured': ['NOT CONFIGURED', 'No approved local read has completed.'],
    loading: ['LOADING', 'A bounded current-view read is in progress.'],
    available: ['AVAILABLE', 'Approved claim messages were returned from the bounded current subset.'],
    empty: ['EMPTY RETAINED SUBSET', 'No approved messages are retained in this current subset; source absence is not implied.'],
    unsupported: ['UNSUPPORTED', 'No supported claim family was available to this frontend slice.'],
    denied: ['DENIED', 'The read was denied; this says nothing about source presence.'],
    disconnected: ['DISCONNECTED', 'The local Observation bridge could not be reached.'],
    unavailable: ['UNAVAILABLE', 'The local Observation read did not complete.'],
    stale: ['LAST KNOWN · STALE', 'The last validated snapshot is retained in memory after a failed read; current availability is not established.'],
    error: ['INVALID RESPONSE', 'The response failed validation and was withheld.'],
  };
  return labels[source.status] ?? ['UNKNOWN', 'Availability is not established.'];
}

export function renderScreen(route, source) {
  const claims = source.claims.length;
  switch (route.path) {
    case '/worlds':
      return `${panel('Worlds & runs catalog', note('Catalog not supported by this contract', 'The local endpoint exposes a bounded current subset only. It does not provide World discovery, run enumeration, or a completeness guarantee.'), 'UNSUPPORTED')}<div data-observation-region="claims">${claimsSection(source, {title: 'Current owner publications'})}</div>`;
    case '/overview': {
      const hasGeometry = source.claims.some(claim => ['environment.render_scene', 'embodiment.render_morphology'].includes(claim.family));
      const boundary = hasGeometry
        ? note('Owner geometry projections available', 'Authorized geometry descriptors are present in this bounded read. Environment and Embodiment remain separate; no shared physical scene or causal snapshot is implied.')
        : note('No authorized scene geometry', 'BodyPose provides source-backed position and orientation values, not body geometry. This view does not construct meshes, animate bodies, or infer a complete World scene.');
      return `<div data-observation-region="overview-metrics"><div class="metric-grid">${panel('Read availability', item('State', connectionState(source)[0]) + item('Retained approved messages', claims), source.status.toUpperCase())}${panel('Scope', item('Observation scope', source.scope ?? 'Not established'), 'BOUNDED')}${panel('Coherence', item('Cross-owner snapshot', 'Not guaranteed') + item('Freshness', 'Not established'), 'NO JOIN')}</div></div>${panel('Spatial evidence boundary', boundary, hasGeometry ? 'SEPARATE OWNER DATA' : 'NO SCENE')}<div data-observation-region="claims">${claimsSection(source, {title: 'Owner publications · not a composite World snapshot'})}</div>${panel('Interpretation boundary', guide(['Each claim retains its own semantic authority, identity, source time and lineage.', 'World commit status is not inferred from delivery sequence.', 'BodyPose values and scalar-field samples are not joined by shared names, values, frames or arrival order.']), 'READ ONLY')}`;
    }
    case '/spatial': {
      // Keep the renderer subtree outside snapshot-patched regions: replacing it
      // on every Observation refresh would reset its presentation-only camera.
      const hasSpatial = source.claims.some(claim => ['environment.render_scene','embodiment.render_morphology'].includes(claim.family));
      return `<section class="panel"><div class="panel-heading"><h2>Spatial Explorer · owner projections</h2><span class="small-tag">READ ONLY · SEPARATE DOMAINS</span></div><div class="panel-body" id="spatial-explorer"></div></section>${panel('Spatial evidence boundary', `<p id="spatial-evidence-status" role="status">${source.stale ? 'Last validated spatial projections retained in memory · stale; current source availability is not established.' : source.status === 'available' && hasSpatial ? 'Current bounded Observation read; claims remain separate and no shared causal scene is implied.' : 'No validated spatial descriptor is present in the retained Observation subset.'}</p><p class="fine">Only uniquely identified, validated Environment and Embodiment geometry descriptors are rendered. Missing or ambiguous claims remain unavailable; no geometry or transform is inferred.</p>`, source.stale ? 'STALE · LAST KNOWN' : hasSpatial ? 'OWNER DATA' : 'UNAVAILABLE')}<details class="spatial-diagnostics"><summary>Inspect separate owner claims and provenance</summary><div data-observation-region="claims">${claimsSection(source, {title: 'Spatially relevant owner claims'})}</div></details>`;
    }
    case '/timeline':
      return `${panel('Causal history', note('Historical timeline not supported', 'The current-view endpoint is bounded and in-memory. Its local delivery sequence is not World causal time and cannot reconstruct committed-cut history.'), 'NO HISTORY')}<div data-observation-region="claims">${claimsSection(source, {title: 'Current messages · not a timeline'})}</div>`;
    case '/sensorimotor':
      return `${panel('Source-asserted relations', note('No relation contract is available in M1', 'The two admitted claim families do not assert a sensorimotor relationship. No correlation or causal link is inferred from values, frames, identifiers, or delivery order.'), 'NO LINKS')}<div data-observation-region="claims">${claimsSection(source, {title: 'Unjoined source claims'})}</div>`;
    case '/claims':
      return `<div data-observation-region="claims">${claimsSection(source, {title: 'Claim inspection', emptyTitle: 'No validated claim to inspect'})}</div>`;
    case '/organism':
      return `${panel('Organism evidence', note('Organism-owned observation contract unavailable', 'The current authorized read adapter does not expose longitudinal cognitive, experiential, or executive state. Motion and weight changes cannot establish learning, intention, or cognition.'), 'NO ORGANISM CLAIMS')}<div data-observation-region="claims">${claimsSection(source, {title: 'Current publications · not organism cognition'})}</div>`;
    case '/research':
      return `${panel('Scientific evidence admission', note('Lab evidence adapter not authorized', 'No approved Lab research read contract is wired to this frontend. Experimental results, provenance digests, independent reproductions and admission decisions cannot be inferred from World or Observation publications.'), 'NO LAB ADAPTER')}${panel('Interpretation rules', guide(['Exploratory evidence remains exploratory until a competent scientific disposition is recorded.', 'A reproduced result is not automatically admitted by Lab.', 'Observation delivery and World commits do not authorize experimental interventions.']), 'SCIENTIFIC BOUNDARY')}`;
    case '/connection': {
      const [tag, description] = connectionState(source);
      return `<div data-observation-region="connection-metrics"><div class="metric-grid">${panel('Local Observation read', item('Availability', tag) + item('Endpoint', '/api/observation/current') + item('Method', 'GET · read only'), tag)}${panel('Scope and guarantees', item('Subset', source.scope ?? 'Not established') + item('Freshness', source.freshness ?? 'Not established') + item('Cross-owner coherence', source.coherence ?? 'Not established'), 'LIMITED')}${panel('Unsupported capabilities', item('History / persistence', 'Not supported') + item('Runtime control', 'Not supported') + item('Source census', 'Not supported'), 'OUT OF SCOPE')}</div></div><div data-observation-region="connection-diagnostic">${panel('Read diagnostic', `<p role="status">${esc(description)}</p><p class="fine">A valid empty view, denied read, error, or disconnected bridge is never presented as proof that a World, body, organism, resource, or publication does not exist.</p>`, 'PASSIVE')}</div><div data-observation-region="claims">${claimsSection(source, {title: 'Messages in the current read'})}</div>`;
    }
    default:
      return note('Unrecognized route', 'Use one of the seven supported application routes.');
  }
}
