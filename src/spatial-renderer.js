// Bounded, passive Spatial Explorer. Inputs are owner-authored projection values;
// this module never derives transforms, joins domains, or fills missing geometry.
const MAX_ENV_BYTES = 65_536;
const MAX_EMBODIMENT_BYTES = 262_144;
const MAX_ITEMS = 128;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const vec3 = value => Array.isArray(value) && value.length === 3 && value.every(finite);
const str = value => typeof value === 'string' && value.length > 0 && new TextEncoder().encode(value).length <= 128 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const keys = (obj, expected) => obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).sort().join('|') === [...expected].sort().join('|');
const bytes = value => { try { return new TextEncoder().encode(JSON.stringify(value)).length; } catch { return Infinity; } };
const f32 = value => Number.isFinite(Math.fround(value));
const representableVec = value => vec3(value) && value.every(f32);
const fail = message => ({ok:false, reason:message});

// RFC 8785's object-key ordering and ECMAScript JSON number/string encoding.
// These descriptors are JSON values (no cycles, undefined, or non-finite numbers).
function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${jcs(value[k])}`).join(',')}}`;
}
async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
const utf8Compare = (a,b) => {
  const x=new TextEncoder().encode(a), y=new TextEncoder().encode(b);
  for(let i=0;i<Math.min(x.length,y.length);i++) if(x[i]!==y[i]) return x[i]-y[i];
  return x.length-y.length;
};
// Python's producer orders Unicode strings by code point. For valid Unicode,
// UTF-8 byte order is equivalent and avoids JavaScript UTF-16 surrogate order.
const codePointCompare = (a,b) => {
  const x=Array.from(a, c=>c.codePointAt(0)), y=Array.from(b,c=>c.codePointAt(0));
  for(let i=0;i<Math.min(x.length,y.length);i++) if(x[i]!==y[i]) return x[i]-y[i];
  return x.length-y.length;
};

/** Strict structural preflight for Environment's approved closed descriptor. Digest verification is owner-side. */
export async function validateEnvironmentDescriptor(value) {
  if (!value || typeof value !== 'object' || bytes(value) > MAX_ENV_BYTES) return fail('Environment descriptor unavailable or exceeds 65,536 bytes.');
  if (!keys(value, ['schema_version','environment_id','environment_revision','render_geometry_sha256','length_unit','frame','items']) || value.schema_version !== 1 || value.length_unit !== 'm' || !str(value.environment_id) || !str(value.environment_revision) || !/^[a-f0-9]{64}$/.test(value.render_geometry_sha256)) return fail('Environment descriptor does not match the approved closed schema.');
  const f = value.frame;
  if (!keys(f, ['frame_id','parent_frame_id','origin_m','x_axis_in_parent','y_axis_in_parent','z_axis_in_parent','handedness','up_axis']) || !str(f.frame_id) || !str(f.parent_frame_id) || !vec3(f.origin_m) || ![f.x_axis_in_parent,f.y_axis_in_parent,f.z_axis_in_parent].every(vec3) || f.handedness !== 'RIGHT_HANDED' || !['X','Y','Z'].includes(f.up_axis)) return fail('Environment frame is invalid.');
  const axes=[f.x_axis_in_parent,f.y_axis_in_parent,f.z_axis_in_parent];
  const dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  if(axes.some(a=>Math.abs(Math.hypot(...a)-1)>1e-9) || Math.abs(dot(axes[0],axes[1]))>1e-9 || Math.abs(dot(axes[0],axes[2]))>1e-9 || Math.abs(dot(axes[1],axes[2]))>1e-9 || cross(axes[0],axes[1]).some((v,i)=>Math.abs(v-axes[2][i])>1e-9)) return fail('Environment frame basis is not right-handed orthonormal.');
  if (!Array.isArray(value.items) || value.items.length > MAX_ITEMS) return fail('Environment item count exceeds the approved bound.');
  const ids = new Set();
  for (const item of value.items) {
    if (!item || !str(item.object_id) || ids.has(item.object_id) || item.frame_id !== f.frame_id) return fail('Environment item identity or frame is invalid.');
    ids.add(item.object_id);
    if (item.kind === 'sphere') { if (!keys(item,['object_id','kind','frame_id','center_m','radius_m']) || !representableVec(item.center_m) || !finite(item.radius_m) || item.radius_m <= 0 || !f32(item.radius_m) || Math.fround(item.radius_m) === 0) return fail('Environment sphere is invalid.'); }
    else if (item.kind === 'ground_plane') { if (!keys(item,['object_id','kind','frame_id','normal','offset_m']) || !representableVec(item.normal) || !finite(item.offset_m) || !f32(item.offset_m) || Math.abs(Math.hypot(...item.normal)-1)>1e-9) return fail('Environment plane is invalid.'); }
    else return fail('Environment primitive is unsupported.');
  }
  const ordered={...value,items:[...value.items].sort((a,b)=>utf8Compare(a.object_id,b.object_id))};
  const {render_geometry_sha256,...preimage}=ordered;
  if(await sha256(jcs(preimage))!==value.render_geometry_sha256) return fail('Environment render geometry digest does not match its descriptor.');
  return {ok:true, value};
}

/** Validate only Embodiment static render morphology fields; no kinematics are inferred. */
export async function validateEmbodimentDescriptor(value) {
  if (!value || typeof value !== 'object' || bytes(value) > MAX_EMBODIMENT_BYTES) return fail('Embodiment descriptor unavailable or exceeds 262,144 bytes.');
  const required=['contract_revision','schema_version','body_id','embodiment_episode_id','morphology_revision','geometry_revision','render_geometry_sha256','coordinate_system','length_unit','segments','joints'];
  if (!keys(value,required) || value.contract_revision !== 'embodiment.render_morphology/v1' || value.schema_version!==1 || value.coordinate_system!=='right_handed_z_up' || value.length_unit!=='m' || !['body_id','embodiment_episode_id','morphology_revision','geometry_revision'].every(k=>str(value[k])) || !/^[a-f0-9]{64}$/.test(value.render_geometry_sha256)) return fail('Embodiment descriptor does not match the approved closed schema.');
  if (!Array.isArray(value.segments)||!Array.isArray(value.joints)||value.segments.length>128||value.joints.length>127) return fail('Embodiment topology exceeds the approved bounds.');
  const ids=new Set();
  for (const s of value.segments) { if (!keys(s,['segment_id','shape','dimensions_m','visual_origin_in_link_m']) || !str(s.segment_id)||ids.has(s.segment_id)||s.shape!=='box'||!representableVec(s.dimensions_m)||s.dimensions_m.some(n=>n<=0||Math.fround(n)===0)||!representableVec(s.visual_origin_in_link_m)) return fail('Embodiment segment is invalid or unrenderable.'); ids.add(s.segment_id); }
  // A morphology can contain links that carry topology but have no authored
  // visual shape. Joint endpoints declare those link IDs; they need not be
  // renderable segment IDs and must never cause synthesized geometry.
  const links=new Set(ids);
  const jointIds=new Set();
  for (const j of value.joints) { if (!keys(j,['joint_id','parent_link_id','child_link_id','joint_type','joint_origin_in_parent_m','axis_in_joint_frame']) || !str(j.joint_id)||jointIds.has(j.joint_id)||!str(j.parent_link_id)||!str(j.child_link_id)||j.parent_link_id===j.child_link_id||j.joint_type!=='revolute'||!vec3(j.joint_origin_in_parent_m)||!vec3(j.axis_in_joint_frame)||Math.hypot(...j.axis_in_joint_frame)<1e-12||Math.abs(Math.hypot(...j.axis_in_joint_frame)-1)>1e-9) return fail('Embodiment joint topology is invalid.'); jointIds.add(j.joint_id); links.add(j.parent_link_id); links.add(j.child_link_id); }
  if (links.size > 128) return fail('Embodiment topology exceeds the approved link bound.');
  const preimage={contract_revision:value.contract_revision,schema_version:value.schema_version,coordinate_system:value.coordinate_system,length_unit:value.length_unit,segments:[...value.segments].sort((a,b)=>codePointCompare(a.segment_id,b.segment_id)),joints:[...value.joints].sort((a,b)=>codePointCompare(a.joint_id,b.joint_id))};
  if(await sha256(`biopeia:embodiment.render_morphology/v1\n${jcs(preimage)}`)!==value.render_geometry_sha256) return fail('Embodiment render geometry digest does not match its descriptor.');
  return {ok:true,value};
}

// Mount only the spatial descriptor families validated by the current
// Observation contract; owner projections remain separate and are not joined.
export async function mountSpatialExplorer(container, {environment=null, embodiment=null, renderPose=null, environmentClaim=null, embodimentClaim=null, stale=false}={}) {
  const env=environment ? await validateEnvironmentDescriptor(environment) : fail('Environment projection not available in this Observation view.');
  const body=embodiment ? await validateEmbodimentDescriptor(embodiment) : fail('Embodiment projection not available in this Observation view.');
  const dynamics=body.ok&&renderPose ? validateBoundPose(body.value,renderPose) : fail('Dynamic Embodiment poses unavailable; no validated morphology-bound World cut was received.');
  container.innerHTML=`<div class="spatial-status" role="status">${env.ok||body.ok?'Owner projections are shown only within their declared frames.':'Spatial geometry unavailable in the current Observation view.'}</div><div class="spatial-view-grid">${viewMarkup('Environment static geometry',env.ok?`${escapeHtml(env.value.environment_id)} · ${escapeHtml(env.value.environment_revision)} · ${env.value.items.length} items · frame ${escapeHtml(env.value.frame.frame_id)} · m · right-handed · up ${escapeHtml(env.value.frame.up_axis)}`:`Unavailable · ${escapeHtml(env.reason)}`,env.ok?env.value.items.length:0,env.ok&&env.value.items.length>0,env.ok&&!env.value.items.length?'EMPTY':null)}${viewMarkup('Embodiment morphology',body.ok?`${escapeHtml(body.value.body_id)} · episode ${escapeHtml(body.value.embodiment_episode_id)} · morphology ${escapeHtml(body.value.morphology_revision)} · geometry ${escapeHtml(body.value.geometry_revision)} · ${body.value.segments.length} authored segments${dynamics.ok?'':'; awaiting a matching committed pose'}`:`Unavailable · ${escapeHtml(body.reason)}`,body.ok?body.value.segments.length:0,Boolean(dynamics.ok),null,body.ok)}</div><p class="fine" id="joint-marker-status" role="status">${escapeHtml(jointMarkerSummary(body,dynamics,stale))}</p><details class="panel spatial-inspector"><summary><span>Inspect selected source item</span><span class="small-tag">OWNER IDENTITY · PROVENANCE</span></summary><div class="panel-body"><label for="spatial-item-selection">Select an authored geometry item</label><select id="spatial-item-selection"></select><div id="spatial-selection-details" class="spatial-selection-details" role="status" aria-live="polite"></div><p class="fine">Selection inspects source-authored identity and provenance; it does not join Environment and Embodiment or infer physical placement.</p></div></details><p class="fine" id="spatial-pose-status" role="status">${poseStatus(dynamics,stale)} Environment and Embodiment remain separate; no common frame or joint scene is inferred.</p>`;
  const environmentCanvas=container.querySelector('#environment-view'),bodyCanvas=container.querySelector('#embodiment-view');
  if (env.ok) attachCamera(environmentCanvas, drawCanvas(environmentCanvas, env.value.items.map(item=>toZUp(item,env.value.frame.up_axis))));
  let bodyRenderer=body.ok&&dynamics.ok?drawBodyCanvas(bodyCanvas,body.value,dynamics.value.candidate.poses):null;
  let lastValidDynamics=dynamics.ok?dynamics:null;
  if(bodyRenderer)attachCamera(bodyCanvas,bodyRenderer);
  const updateSelection = attachSelection(container, {environment:env.ok?env.value:null, embodiment:body.ok?body.value:null, environmentClaim, embodimentClaim, dynamics, stale});
  return {environment:env, embodiment:body, dynamics, updatePose(nextClaim,nextStale=false){
    const next=body.ok&&nextClaim?validateBoundPose(body.value,nextClaim):fail('Dynamic Embodiment poses unavailable; no validated morphology-bound World cut was received.');
    let message;
    if(next.ok){
      if(bodyRenderer)bodyRenderer.setPoses(next.value.candidate.poses);
      else if(body.ok){bodyRenderer=drawBodyCanvas(container.querySelector('#embodiment-view'),body.value,next.value.candidate.poses);if(bodyRenderer)attachCamera(container.querySelector('#embodiment-view'),bodyRenderer);}
      lastValidDynamics=next;message=poseStatus(next,nextStale);
    } else {
      message=lastValidDynamics?.ok?`New pose withheld; last validated rendering retained · ${poseStatus(lastValidDynamics,true)} ${escapeHtml(next.reason)}`:poseStatus(next,nextStale);
    }
    const status=container.querySelector('#spatial-pose-status');if(status)status.textContent=`${message} Environment and Embodiment remain separate; no common frame or joint scene is inferred.`;
    const markerStatus=container.querySelector('#joint-marker-status');if(markerStatus)markerStatus.textContent=jointMarkerSummary(body,next.ok?next:lastValidDynamics,nextStale||!next.ok);
    updateSelection.updatePose(next,nextStale);
    return next;
  }, updateProvenance(nextEnvironmentClaim,nextEmbodimentClaim){
    updateSelection.updateProvenance(nextEnvironmentClaim,nextEmbodimentClaim);
  }};
}
function attachSelection(container, {environment, embodiment, environmentClaim, embodimentClaim, dynamics, stale}) {
  const selector=container.querySelector('#spatial-item-selection'), details=container.querySelector('#spatial-selection-details');
  if(!selector||!details)return {updatePose(){},updateProvenance(){}};
  const options=[];
  for(const item of environment?.items??[]) options.push({key:`environment:${item.object_id}`,label:`Environment · ${item.object_id}`,kind:'environment',item,descriptor:environment,claim:environmentClaim});
  for(const segment of embodiment?.segments??[]) options.push({key:`embodiment:${segment.segment_id}`,label:`Embodiment · ${segment.segment_id}`,kind:'embodiment',item:segment,descriptor:embodiment,claim:embodimentClaim});
  if(!options.length){const option=document.createElement('option');option.value='';option.textContent='No authored geometry item is available';selector.append(option);selector.disabled=true;details.textContent='No item identity can be selected from the current owner projections.';return {updatePose(){},updateProvenance(){}};}
  for(const record of options){const option=document.createElement('option');option.value=record.key;option.textContent=record.label;selector.append(option);}
  function show(){
    const record=options.find(option=>option.key===selector.value)??options[0];
    const observation=record.claim?.observation??{};
    const fields=[
      ['Owner authority',record.kind==='environment'?'Environment':'Embodiment'],
      ['Item identity',record.kind==='environment'?record.item.object_id:record.item.segment_id],
      ['Descriptor identity',record.kind==='environment'?`${record.descriptor.environment_id} · ${record.descriptor.environment_revision}`:`${record.descriptor.body_id} · ${record.descriptor.embodiment_episode_id}`],
      ['Morphology / geometry revision',record.kind==='embodiment'?`${record.descriptor.morphology_revision} · ${record.descriptor.geometry_revision}`:'Not applicable'],
      ['Geometry digest',record.descriptor.render_geometry_sha256],
      ['Shape · authored dimensions (m)',record.kind==='embodiment'?`${record.item.shape} · ${record.item.dimensions_m.join(', ')}`:record.item.kind],
      ['Asserter',actorText(observation.asserter)],['Producer',actorText(observation.producer)],
      ['Acquisition',observation.acquisition?.method??'Not available'],
      ['Observation delivery sequence · not causal time',record.claim?.deliverySequence??'Not available'],
      ['Source lineage',Array.isArray(observation.lineage?.parents)?observation.lineage.parents.map(parent=>`${parent.namespace}:${parent.reference}`).join('; ')||'Not supplied':'Not available'],
      ['Source domain time',Array.isArray(observation.domain_time)?observation.domain_time.map(time=>`${time.domain}.${time.kind}=${time.value}`).join('; ')||'Not supplied':'Not available'],
    ];
    if(record.kind==='embodiment'){
      const pose=dynamics.ok?dynamics.value.candidate.poses.find(value=>value.segment_id===record.item.segment_id):null;
      const cut=dynamics.ok?dynamics.value.cut:null;
      fields.push(['Declared joints · topology only',record.descriptor.joints.map(joint=>`${joint.joint_id}: ${joint.parent_link_id} → ${joint.child_link_id} (${joint.joint_type}, axis ${joint.axis_in_joint_frame.join(', ')})`).join('; ')||'None declared']);
      fields.push(['Dynamic pose',pose?`${stale?'Last known validated pose · stale':'Validated in current bounded read · source freshness not established'}; World ${dynamics.value.candidate.source_world_id}; cut ${cut.causal_tick} · ${cut.commit_id}; position ${pose.translation_m.join(', ')} m`:'Not available for this selected segment']);
      fields.push(['Joint visualization limit',record.descriptor.joints.length?jointMarkerStates(record.descriptor,dynamics.ok?dynamics.value.candidate.poses:[]).map(state=>`${state.joint_id}: ${state.available?'topology-only origin marker available; no child pose or joint motion inferred':`origin marker unavailable · ${state.reason}`}`).join('; '):'No joints declared']);
    }
    details.replaceChildren(...fields.map(([label,value])=>{const row=document.createElement('p');row.className='property';const name=document.createElement('span');name.textContent=label;const content=document.createElement('strong');content.textContent=String(value);row.append(name,content);return row;}));
  }
  selector.value=options[0].key;selector.addEventListener('change',show);show();
  return {
    updatePose(nextDynamics,nextStale) { dynamics=nextDynamics; stale=nextStale; show(); },
    updateProvenance(nextEnvironmentClaim,nextEmbodimentClaim) {
      for (const record of options) record.claim=record.kind==='environment'?nextEnvironmentClaim:nextEmbodimentClaim;
      show();
    },
  };
}
function actorText(value){return value?`${value.kind}: ${value.identifier}`:'Not available';}
export function validateBoundPose(morphology,claim){
  const candidate=claim?.candidate,association=claim?.world_association,cut=association?.committed_cut;
  if(!candidate||!cut||candidate.body_id!==morphology.body_id||candidate.embodiment_episode_id!==morphology.embodiment_episode_id||candidate.morphology_revision!==morphology.morphology_revision||candidate.geometry_revision!==morphology.geometry_revision||candidate.render_geometry_sha256!==morphology.render_geometry_sha256||candidate.target_causal_tick!==cut.causal_tick||candidate.source_world_id!==cut.world_id||association.association_kind!=='transient_current_committed_cut')return fail('Embodiment pose withheld: morphology identity, geometry digest or committed World cut does not match.');
  const expected=[...morphology.segments.map(item=>item.segment_id)].sort();
  const actual=[...candidate.poses.map(item=>item.segment_id)].sort();
  if(expected.length!==actual.length||expected.some((id,index)=>id!==actual[index]))return fail('Embodiment pose withheld: transforms do not exactly cover the authored renderable segments.');
  return {ok:true,value:{candidate,cut}};
}
function poseStatus(dynamics,stale){
  if(!dynamics.ok)return escapeHtml(dynamics.reason);
  const {candidate,cut}=dynamics.value;
  return `${stale?'Last known validated pose · stale':'Validated in current bounded read · source freshness not established'} · World ${escapeHtml(candidate.source_world_id)} · committed cut ${cut.causal_tick} · ${escapeHtml(cut.commit_id)}.`;
}
function jointMarkerSummary(body,dynamics,stale=false){
  if(!body.ok)return 'Topology-only joint-origin markers unavailable: no validated morphology is present.';
  if(!body.value.joints.length)return 'No authored joints are declared; no joint markers are rendered.';
  const states=dynamics.ok?jointMarkerStates(body.value,dynamics.value.candidate.poses):jointMarkerStates(body.value,[]);
  return `Topology-only joint-origin markers${stale?' · last validated pose, stale':''} (not child poses or articulated motion): ${states.map(state=>`${state.joint_id} · ${state.available?'marker available':'marker unavailable · '+state.reason}`).join('; ')}.`;
}
function viewMarkup(title, detail, count, renderable,emptyState=null,canvasSlot=renderable){const id=title.startsWith('Environment')?'environment-view':'embodiment-view';return `<section class="panel spatial-owner-panel ${id==='embodiment-view'?'spatial-body-panel':''}"><div class="panel-heading"><h2>${title}</h2><span class="small-tag">${emptyState??(count?(renderable?'OWNER DATA':'PARTIAL · NOT PLACED'):'UNAVAILABLE')}</span></div><p class="fine">${detail}</p>${canvasSlot?`<div class="spatial-camera" role="group" aria-label="Presentation-only camera controls"><button type="button" data-camera="left" data-view="${id}" aria-label="Rotate ${title} view left">Rotate left</button><button type="button" data-camera="right" data-view="${id}" aria-label="Rotate ${title} view right">Rotate right</button><button type="button" data-camera="tilt-up" data-view="${id}" aria-label="Tilt ${title} view up">Tilt up</button><button type="button" data-camera="tilt-down" data-view="${id}" aria-label="Tilt ${title} view down">Tilt down</button><button type="button" data-camera="zoom-in" data-view="${id}" aria-label="Zoom ${title} view in">Zoom in</button><button type="button" data-camera="zoom-out" data-view="${id}" aria-label="Zoom ${title} view out">Zoom out</button><button type="button" data-camera="pan-left" data-view="${id}" aria-label="Pan ${title} view left">Pan left</button><button type="button" data-camera="pan-right" data-view="${id}" aria-label="Pan ${title} view right">Pan right</button><button type="button" data-camera="pan-up" data-view="${id}" aria-label="Pan ${title} view up">Pan up</button><button type="button" data-camera="pan-down" data-view="${id}" aria-label="Pan ${title} view down">Pan down</button><button type="button" data-camera="reset" data-view="${id}" aria-label="Reset ${title} view">Reset</button></div><div class="spatial-canvas-wrap"><canvas id="${id}" class="spatial-webgl" aria-label="${title}; source-owned geometry; presentation-only viewport" role="img"></canvas></div>`:''}<p class="fine">${count?`${count} owner-authored primitive(s); this view does not establish physical or cross-domain placement.`:emptyState==='EMPTY'?'The valid descriptor contains no Environment geometry.':'No geometry is synthesized.'}</p></section>`;}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function toZUp(item,up){
  const map=v=>up==='X'?[v[1],v[2],v[0]]:up==='Y'?[v[0],-v[2],v[1]]:[...v];
  return item.kind==='sphere'?{...item,center_m:map(item.center_m)}:item.kind==='ground_plane'?{...item,normal:map(item.normal)}:item;
}
function primitiveMesh(item) {
  const out=[];
  const tri=(a,b,c)=>out.push(...a,...b,...c);
  if(item.kind==='sphere') {
    const lat=12,lon=20,r=item.radius_m,c=item.center_m;
    const point=(u,v)=>[c[0]+r*Math.cos(v)*Math.cos(u),c[1]+r*Math.cos(v)*Math.sin(u),c[2]+r*Math.sin(v)];
    for(let y=0;y<lat;y++) for(let x=0;x<lon;x++){const u=x/lon*Math.PI*2,v=(y/lat-.5)*Math.PI,u2=(x+1)/lon*Math.PI*2,v2=((y+1)/lat-.5)*Math.PI;tri(point(u,v),point(u2,v),point(u2,v2));tri(point(u,v),point(u2,v2),point(u,v2));}
  } else if(item.kind==='ground_plane') {
    // The source plane is infinite; this finite camera-space crop is explicitly presentation-only.
    const n=item.normal,d=item.offset_m,p=n.map(v=>v*d);
    const ref=Math.abs(n[2])<.9?[0,0,1]:[0,1,0];
    const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const norm=a=>{const l=Math.hypot(...a);return a.map(v=>v/l);};
    const u=norm(cross(n,ref)),v=norm(cross(n,u)),point=(a,b)=>p.map((x,i)=>x+u[i]*a+v[i]*b);
    const a=point(-3,-3),b=point(3,-3),c=point(3,3),e=point(-3,3);tri(a,b,c);tri(a,c,e);
  } else if(item.shape==='box') {
    const [x,y,z]=item.dimensions_m.map(v=>v/2),o=item.visual_origin_in_link_m;
    const v=[[-x,-y,-z],[x,-y,-z],[x,y,-z],[-x,y,-z],[-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z]].map(q=>q.map((n,i)=>n+o[i]));
    for(const f of [[0,1,2,0,2,3],[4,6,5,4,7,6],[0,4,5,0,5,1],[1,5,6,1,6,2],[2,6,7,2,7,3],[3,7,4,3,4,0]]) for(const i of f) out.push(...v[i]);
  }
  return new Float32Array(out);
}
function drawBodyCanvas(canvas,morphology,poses){
  if(!canvas)return null;
  const gl=canvas.getContext('webgl',{alpha:true,antialias:true});if(!gl)return failCanvas(canvas,'WebGL is unavailable; body geometry was not rendered.');
  const vs=`attribute vec3 p;uniform float angle;uniform float pitch;uniform float scale;uniform vec3 center;uniform vec3 translation;uniform vec4 orientation;uniform vec2 pan;uniform mediump float markerMode;vec3 qrotate(vec4 q,vec3 v){return v+2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v);}void main(){vec3 q=qrotate(orientation,p)+translation-center;float c=cos(angle),s=sin(angle);float x=c*q.x-s*q.y;float y=s*q.x+c*q.y;float cp=cos(pitch),sp=sin(pitch);float viewY=cp*y-sp*q.z;float viewZ=sp*y+cp*q.z;gl_Position=vec4(x*scale+pan.x,viewY*scale+pan.y,-viewZ*scale,1.0);gl_PointSize=markerMode>.5?10.0:1.0;}`;
  const fs=`precision mediump float;uniform float markerMode;void main(){gl_FragColor=markerMode>.5?vec4(1.0,.72,.16,1.0):vec4(.34,.72,.95,1.0);}`;
  const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('body shader failed');return s;};
  const program=gl.createProgram();try{gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))return failCanvas(canvas,'WebGL body renderer could not initialize.');}catch{return failCanvas(canvas,'WebGL body renderer could not initialize.');}
  const poseById=new Map(poses.map(pose=>[pose.segment_id,pose]));
  const meshes=morphology.segments.map(segment=>({segment,pose:poseById.get(segment.segment_id),data:primitiveMesh(segment)}));
  if(meshes.some(mesh=>!mesh.pose||!mesh.data.length||[...mesh.data,...mesh.pose.translation_m,...mesh.pose.orientation_xyzw].some(n=>!finite(n)||!f32(n))))return failCanvas(canvas,'Morphology-bound pose is incomplete or outside renderable range.');
  const rotate=rotateByQuaternion;
  const markers=jointMarkerStates(morphology,poses).filter(marker=>marker.available);
  const bounds=[[Infinity,-Infinity],[Infinity,-Infinity],[Infinity,-Infinity]];
  for(const {data,pose} of meshes)for(let i=0;i<data.length;i+=3){const v=rotate(pose.orientation_xyzw,[data[i],data[i+1],data[i+2]]).map((n,j)=>n+pose.translation_m[j]);for(let j=0;j<3;j++){bounds[j][0]=Math.min(bounds[j][0],v[j]);bounds[j][1]=Math.max(bounds[j][1],v[j]);}}
  for(const marker of markers)for(let j=0;j<3;j++){bounds[j][0]=Math.min(bounds[j][0],marker.position_m[j]);bounds[j][1]=Math.max(bounds[j][1],marker.position_m[j]);}
  const center=bounds.map(([lo,hi])=>(lo+hi)/2),extent=Math.max(...bounds.map(([lo,hi])=>hi-lo),1e-9);if(!center.every(finite)||!finite(extent)||!finite(2/extent))return failCanvas(canvas,'Pose bounds cannot be represented safely.');
  const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.max(1,canvas.clientWidth*dpr);canvas.height=Math.max(1,canvas.clientHeight*dpr);gl.viewport(0,0,canvas.width,canvas.height);gl.useProgram(program);
  const loc=gl.getAttribLocation(program,'p'),angleLoc=gl.getUniformLocation(program,'angle'),pitchLoc=gl.getUniformLocation(program,'pitch'),scaleLoc=gl.getUniformLocation(program,'scale'),panLoc=gl.getUniformLocation(program,'pan'),centerLoc=gl.getUniformLocation(program,'center'),translationLoc=gl.getUniformLocation(program,'translation'),orientationLoc=gl.getUniformLocation(program,'orientation'),markerModeLoc=gl.getUniformLocation(program,'markerMode');
  const buffers=meshes.map(mesh=>{const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.data,gl.STATIC_DRAW);return {...mesh,buffer};});
  gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);let camera={angle:-.55,pitch:.52,zoom:1,panX:0,panY:0};
  const markerBuffer=markers.length?gl.createBuffer():null;
  const render=()=>{gl.clearColor(.035,.055,.08,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.uniform1f(angleLoc,camera.angle);gl.uniform1f(pitchLoc,camera.pitch);gl.uniform1f(scaleLoc,1.25/extent*camera.zoom);gl.uniform2f(panLoc,camera.panX,camera.panY);gl.uniform3f(centerLoc,...center);gl.uniform1f(markerModeLoc,0);for(const mesh of buffers){gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);gl.uniform3f(translationLoc,...mesh.pose.translation_m);gl.uniform4f(orientationLoc,...mesh.pose.orientation_xyzw);gl.drawArrays(gl.TRIANGLES,0,mesh.data.length/3);}if(markerBuffer){const positions=jointMarkerStates(morphology,buffers.map(mesh=>({segment_id:mesh.segment.segment_id,...mesh.pose}))).filter(marker=>marker.available).flatMap(marker=>marker.position_m);gl.bindBuffer(gl.ARRAY_BUFFER,markerBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(positions),gl.DYNAMIC_DRAW);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);gl.uniform3f(translationLoc,0,0,0);gl.uniform4f(orientationLoc,0,0,0,1);gl.uniform1f(markerModeLoc,1);gl.drawArrays(gl.POINTS,0,positions.length/3);}};
  render();return {setPoses(nextPoses){const map=new Map(nextPoses.map(pose=>[pose.segment_id,pose]));if(map.size!==buffers.length||buffers.some(mesh=>!map.has(mesh.segment.segment_id)))return false;for(const mesh of buffers)mesh.pose=map.get(mesh.segment.segment_id);render();return true;},adjust(action){if(action==='left')camera.angle-=.18;else if(action==='right')camera.angle+=.18;else if(action==='tilt-up')camera.pitch=Math.min(1.35,camera.pitch+.12);else if(action==='tilt-down')camera.pitch=Math.max(-1.35,camera.pitch-.12);else if(action==='zoom-in')camera.zoom=Math.min(8,camera.zoom*1.25);else if(action==='zoom-out')camera.zoom=Math.max(.2,camera.zoom/1.25);else if(action==='pan-left')camera.panX=Math.max(-1.5,camera.panX-.12);else if(action==='pan-right')camera.panX=Math.min(1.5,camera.panX+.12);else if(action==='pan-up')camera.panY=Math.min(1.5,camera.panY+.12);else if(action==='pan-down')camera.panY=Math.max(-1.5,camera.panY-.12);else if(action==='reset')camera={angle:-.55,pitch:.52,zoom:1,panX:0,panY:0};render();}};
}
function rotateByQuaternion(q,v){const [x,y,z,w]=q,uv=[y*v[2]-z*v[1],z*v[0]-x*v[2],x*v[1]-y*v[0]],uuv=[y*uv[2]-z*uv[1],z*uv[0]-x*uv[2],x*uv[1]-y*uv[0]];return v.map((n,i)=>n+2*(w*uv[i]+uuv[i]));}
/** Topological joint-origin markers only; no child transform or joint motion is derived. */
export function jointMarkerStates(morphology,poses){
  const poseById=new Map((poses??[]).map(pose=>[pose.segment_id,pose]));
  return morphology.joints.map(joint=>{
    const parentPose=poseById.get(joint.parent_link_id);
    if(!parentPose||!Array.isArray(parentPose.translation_m)||!Array.isArray(parentPose.orientation_xyzw))return {joint_id:joint.joint_id,available:false,reason:'parent link pose unavailable'};
    const position_m=rotateByQuaternion(parentPose.orientation_xyzw,joint.joint_origin_in_parent_m).map((n,i)=>n+parentPose.translation_m[i]);
    if(position_m.length!==3||position_m.some(n=>!finite(n)||!f32(n)))return {joint_id:joint.joint_id,available:false,reason:'transformed parent-frame origin is not renderable'};
    return {joint_id:joint.joint_id,available:true,position_m};
  });
}
function drawCanvas(canvas, items) {
  if(!items.length||!canvas) return null;
  const gl=canvas.getContext('webgl',{alpha:true,antialias:true}); if(!gl) return failCanvas(canvas,'WebGL is unavailable; geometry was not rendered.');
  const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.max(1,canvas.clientWidth*dpr);canvas.height=Math.max(1,canvas.clientHeight*dpr);gl.viewport(0,0,canvas.width,canvas.height);
  const vs=`attribute vec3 p; uniform float angle; uniform float pitch; uniform float scale; uniform vec3 center; uniform vec2 pan; void main(){vec3 q=p-center;float c=cos(angle),s=sin(angle);float x=c*q.x-s*q.y;float y=s*q.x+c*q.y;float cp=cos(pitch),sp=sin(pitch);float viewY=cp*y-sp*q.z;float viewZ=sp*y+cp*q.z;gl_Position=vec4(x*scale+pan.x,viewY*scale+pan.y,-viewZ*scale,1.0);}`;
  const fs=`precision mediump float; uniform vec4 color; void main(){gl_FragColor=color;}`;
  const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw Error('WebGL shader failed');return s;};
  const program=gl.createProgram();
  try { gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))return failCanvas(canvas,'WebGL renderer could not initialize; geometry was not rendered.'); }
  catch { return failCanvas(canvas,'WebGL renderer could not initialize; geometry was not rendered.'); }
  gl.useProgram(program);const loc=gl.getAttribLocation(program,'p'),angleLoc=gl.getUniformLocation(program,'angle'),pitchLoc=gl.getUniformLocation(program,'pitch'),scaleLoc=gl.getUniformLocation(program,'scale'),panLoc=gl.getUniformLocation(program,'pan'),color=gl.getUniformLocation(program,'color'),centerLoc=gl.getUniformLocation(program,'center');
  const meshes=items.map(item=>({item,data:primitiveMesh(item)})).filter(mesh=>mesh.data.length);
  if(!meshes.length||meshes.some(mesh=>{for(const n of mesh.data)if(!Number.isFinite(n)||!f32(n))return true;return false;})) return failCanvas(canvas,'Geometry exceeds the renderable numeric range; this projection was withheld.');
  const bounds=[[Infinity,-Infinity],[Infinity,-Infinity],[Infinity,-Infinity]];
  for(const mesh of meshes) for(let i=0;i<mesh.data.length;i++) { const axis=i%3,n=mesh.data[i];bounds[axis][0]=Math.min(bounds[axis][0],n);bounds[axis][1]=Math.max(bounds[axis][1],n); }
  const center=bounds.map(([lo,hi])=>(lo+hi)/2), extent=Math.max(...bounds.map(([lo,hi])=>hi-lo),1e-9);
  if(!center.every(finite)||!finite(extent)||extent<=0||!finite(2.0/extent)) return failCanvas(canvas,'Geometry bounds cannot be represented safely; this projection was withheld.');
  let camera={angle:-.55,pitch:.52,zoom:1,panX:0,panY:0};
  const buffers=meshes.map(({item,data})=>{const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);return {item,data,buffer};});
  gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);
  const render=()=>{gl.clearColor(.035,.055,.08,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.uniform1f(angleLoc,camera.angle);gl.uniform1f(pitchLoc,camera.pitch);gl.uniform1f(scaleLoc,1.25/extent*camera.zoom);gl.uniform2f(panLoc,camera.panX,camera.panY);gl.uniform3f(centerLoc,...center);for(const {item,data,buffer} of buffers){gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);gl.uniform4f(color,item.kind==='ground_plane'?.25:.34,item.kind==='sphere'?.72:.66,item.kind==='sphere'?.95:.82,1);gl.drawArrays(gl.TRIANGLES,0,data.length/3);}};
  render();
  return {adjust(action){if(action==='left')camera.angle-=.18;else if(action==='right')camera.angle+=.18;else if(action==='tilt-up')camera.pitch=Math.min(1.35,camera.pitch+.12);else if(action==='tilt-down')camera.pitch=Math.max(-1.35,camera.pitch-.12);else if(action==='zoom-in')camera.zoom=Math.min(8,camera.zoom*1.25);else if(action==='zoom-out')camera.zoom=Math.max(.2,camera.zoom/1.25);else if(action==='pan-left')camera.panX=Math.max(-1.5,camera.panX-.12);else if(action==='pan-right')camera.panX=Math.min(1.5,camera.panX+.12);else if(action==='pan-up')camera.panY=Math.min(1.5,camera.panY+.12);else if(action==='pan-down')camera.panY=Math.max(-1.5,camera.panY-.12);else if(action==='reset')camera={angle:-.55,pitch:.52,zoom:1,panX:0,panY:0};render();}};
}
function failCanvas(canvas,message){const panel=canvas.closest('.spatial-owner-panel');const note=document.createElement('p');note.className='fine';note.setAttribute('role','status');note.textContent=message;panel?.append(note);const tag=panel?.querySelector('.small-tag');if(tag)tag.textContent='UNRENDERABLE';panel?.querySelector('.spatial-camera')?.remove();canvas.remove();return null;}
function attachCamera(canvas, camera){if(!canvas||!camera)return;canvas.closest('.spatial-owner-panel')?.querySelectorAll('[data-camera]').forEach(button=>button.addEventListener('click',()=>camera.adjust(button.dataset.camera)));}
