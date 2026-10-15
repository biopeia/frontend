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
  const preimage={contract_revision:value.contract_revision,schema_version:value.schema_version,coordinate_system:value.coordinate_system,length_unit:value.length_unit,segments:[...value.segments].sort((a,b)=>a.segment_id<b.segment_id?-1:a.segment_id>b.segment_id?1:0),joints:[...value.joints].sort((a,b)=>a.joint_id<b.joint_id?-1:a.joint_id>b.joint_id?1:0)};
  if(await sha256(`biopeia:embodiment.render_morphology/v1\n${jcs(preimage)}`)!==value.render_geometry_sha256) return fail('Embodiment render geometry digest does not match its descriptor.');
  return {ok:true,value};
}

/** Dynamic values are never accepted for composition absent the caller's World-owned proof verifier. */
export async function validateEmbodimentPoses(descriptor, poseSet, verifyWorldCut) {
  const valid=await validateEmbodimentDescriptor(descriptor); if(!valid.ok) return valid;
  const binding=['body_id','embodiment_episode_id','morphology_revision','geometry_revision','render_geometry_sha256'];
  if (!poseSet || !keys(poseSet,['body_id','embodiment_episode_id','morphology_revision','geometry_revision','render_geometry_sha256','source_world_id','confirmed_cut_reference','physical_step_id','reference_frame','length_unit','poses','completeness']) || binding.some(k=>poseSet[k]!==descriptor[k]) || !['source_world_id','confirmed_cut_reference','physical_step_id'].every(k=>str(poseSet[k])) || poseSet.reference_frame!=='physics3d.world' || poseSet.length_unit!=='m' || poseSet.completeness!=='complete' || !Array.isArray(poseSet.poses) || poseSet.poses.length!==descriptor.segments.length) return fail('Dynamic poses do not exactly bind to the static descriptor.');
  const expected=new Set(descriptor.segments.map(s=>s.segment_id));
  for(const p of poseSet.poses) { if(!keys(p,['segment_id','translation_m','orientation_xyzw'])||!expected.delete(p.segment_id)||!representableVec(p.translation_m)||!Array.isArray(p.orientation_xyzw)||p.orientation_xyzw.length!==4||!p.orientation_xyzw.every(v=>finite(v)&&f32(v))||Math.abs(Math.hypot(...p.orientation_xyzw)-1)>1e-6) return fail('Dynamic link transform set is partial or invalid.'); }
  if(expected.size) return fail('Dynamic transform set is incomplete.');
  // Invoke the World-owned proof verifier only after the candidate is a bounded,
  // structurally valid, exactly bound pose set. It must be synchronous: an
  // asynchronous verdict cannot authorize rendering in this call path.
  let cutVerified=false;
  try { cutVerified=typeof verifyWorldCut==='function' && verifyWorldCut(poseSet)===true; } catch { cutVerified=false; }
  return cutVerified ? {ok:true,value:poseSet} : fail('Dynamic poses are not rendered: a World-owned verifier has not established their exact committed cut.');
}

// The current observation contract carries no spatial descriptor families. This
// mount is intentionally an adapter boundary, not an implicit data join.
export async function mountSpatialExplorer(container, {environment=null, embodiment=null, dynamics=null, verifyWorldCut=null}={}) {
  const env=environment ? await validateEnvironmentDescriptor(environment) : fail('Environment projection not available in this Observation view.');
  const body=embodiment ? await validateEmbodimentDescriptor(embodiment) : fail('Embodiment projection not available in this Observation view.');
  const poses=dynamics && body.ok ? await validateEmbodimentPoses(body.value,dynamics,verifyWorldCut) : fail('Dynamic Embodiment poses unavailable; no motion is inferred.');
  container.innerHTML=`<div class="spatial-status" role="status">${env.ok||body.ok?'Partial owner projections available; domains are shown in separate coordinate views.':'Spatial geometry unavailable in the current Observation contract.'}</div><div class="spatial-view-grid">${viewMarkup('Environment static geometry',env.ok?`${escapeHtml(env.value.environment_id)} · ${escapeHtml(env.value.environment_revision)} · ${env.value.items.length} items · frame ${escapeHtml(env.value.frame.frame_id)} · m · right-handed · up ${escapeHtml(env.value.frame.up_axis)}`:`Unavailable · ${escapeHtml(env.reason)}`,env.ok?env.value.items.length:0,env.ok&&env.value.items.length>0,env.ok&&!env.value.items.length?'EMPTY':null)}${viewMarkup(poses.ok?'Embodiment · verified link poses':'Embodiment morphology',poses.ok?`${escapeHtml(body.value.body_id)} · source World ${escapeHtml(poses.value.source_world_id)} · cut ${escapeHtml(poses.value.confirmed_cut_reference)} · physics3d.world · m · right-handed Z-up`:body.ok?`${escapeHtml(body.value.body_id)} · geometry ${escapeHtml(body.value.geometry_revision)} · ${body.value.segments.length} link-local boxes; transforms unavailable, so no body is drawn`: `Unavailable · ${escapeHtml(body.reason)}`,poses.ok?body.value.segments.length:body.ok?body.value.segments.length:0,poses.ok&&body.value.segments.length>0)}</div><p class="fine">Owner projections remain independent; no shared frame or coherent World cut is implied. ${escapeHtml(poses.ok?'Verified dynamic poses are available for a separate future presentation adapter.':poses.reason)}</p>`;
  const canvases=container.querySelectorAll('.spatial-webgl');
  if (env.ok) attachCamera(canvases[0], drawCanvas(canvases[0], env.value.items.map(item=>toZUp(item,env.value.frame.up_axis))));
  // A verified pose set is rendered in its own World frame viewport. It is never
  // overlaid with Environment without a separate frame/cut composition contract.
  if (poses.ok) attachCamera(canvases[1], drawCanvas(canvases[1], body.value.segments.map(segment=>{const pose=poses.value.poses.find(p=>p.segment_id===segment.segment_id);return {...segment,transform:pose};})));
  return {environment:env, embodiment:body, dynamics:poses};
}
function viewMarkup(title, detail, count, renderable,emptyState=null){const id=title.startsWith('Environment')?'environment-view':'embodiment-view';return `<section class="panel spatial-owner-panel"><div class="panel-heading"><h2>${title}</h2><span class="small-tag">${emptyState??(count?(renderable?'OWNER DATA':'PARTIAL · NOT PLACED'):'UNAVAILABLE')}</span></div><p class="fine">${detail}</p>${renderable?`<div class="spatial-camera" aria-label="Presentation-only camera controls"><button type="button" data-camera="left" data-view="${id}" aria-label="Rotate ${title} view left">Rotate left</button><button type="button" data-camera="right" data-view="${id}" aria-label="Rotate ${title} view right">Rotate right</button><button type="button" data-camera="tilt-up" data-view="${id}" aria-label="Tilt ${title} view up">Tilt up</button><button type="button" data-camera="tilt-down" data-view="${id}" aria-label="Tilt ${title} view down">Tilt down</button><button type="button" data-camera="zoom-in" data-view="${id}" aria-label="Zoom ${title} view in">Zoom in</button><button type="button" data-camera="zoom-out" data-view="${id}" aria-label="Zoom ${title} view out">Zoom out</button><button type="button" data-camera="reset" data-view="${id}" aria-label="Reset ${title} view">Reset</button></div><div class="spatial-canvas-wrap"><canvas id="${id}" class="spatial-webgl" aria-label="${title}; source-owned geometry; presentation-only viewport" role="img"></canvas></div>`:''}<p class="fine">${count?`${count} owner-authored primitive(s); this view does not establish physical or cross-domain placement.`:emptyState==='EMPTY'?'The valid descriptor contains no Environment geometry.':'No geometry is synthesized.'}</p></section>`;}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function applyPose(point, pose) {
  const [x,y,z]=point, [qx,qy,qz,qw]=pose.orientation_xyzw;
  const tx=2*(qy*z-qz*y), ty=2*(qz*x-qx*z), tz=2*(qx*y-qy*x);
  return [x+qw*tx+(qy*tz-qz*ty)+pose.translation_m[0], y+qw*ty+(qz*tx-qx*tz)+pose.translation_m[1], z+qw*tz+(qx*ty-qy*tx)+pose.translation_m[2]];
}
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
    for(const f of [[0,1,2,0,2,3],[4,6,5,4,7,6],[0,4,5,0,5,1],[1,5,6,1,6,2],[2,6,7,2,7,3],[3,7,4,3,4,0]]) for(const i of f) { const p=v[i]; if(item.transform) out.push(...applyPose(p,item.transform)); else out.push(...p); }
  }
  return new Float32Array(out);
}
function drawCanvas(canvas, items) {
  if(!items.length||!canvas) return null;
  const gl=canvas.getContext('webgl',{alpha:true,antialias:true}); if(!gl) return failCanvas(canvas,'WebGL is unavailable; geometry was not rendered.');
  const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.max(1,canvas.clientWidth*dpr);canvas.height=Math.max(1,canvas.clientHeight*dpr);gl.viewport(0,0,canvas.width,canvas.height);
  const vs=`attribute vec3 p; uniform float angle; uniform float pitch; uniform float scale; uniform vec3 center; void main(){vec3 q=p-center;float c=cos(angle),s=sin(angle);float x=c*q.x-s*q.y;float y=s*q.x+c*q.y;float cp=cos(pitch),sp=sin(pitch);float viewY=cp*y-sp*q.z;float viewZ=sp*y+cp*q.z;gl_Position=vec4(x*scale,viewY*scale,-viewZ*scale,1.0);}`;
  const fs=`precision mediump float; uniform vec4 color; void main(){gl_FragColor=color;}`;
  const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw Error('WebGL shader failed');return s;};
  const program=gl.createProgram();
  try { gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))return failCanvas(canvas,'WebGL renderer could not initialize; geometry was not rendered.'); }
  catch { return failCanvas(canvas,'WebGL renderer could not initialize; geometry was not rendered.'); }
  gl.useProgram(program);const loc=gl.getAttribLocation(program,'p'),angleLoc=gl.getUniformLocation(program,'angle'),pitchLoc=gl.getUniformLocation(program,'pitch'),scaleLoc=gl.getUniformLocation(program,'scale'),color=gl.getUniformLocation(program,'color'),centerLoc=gl.getUniformLocation(program,'center');
  const meshes=items.map(item=>({item,data:primitiveMesh(item)})).filter(mesh=>mesh.data.length);
  if(!meshes.length||meshes.some(mesh=>{for(const n of mesh.data)if(!Number.isFinite(n)||!f32(n))return true;return false;})) return failCanvas(canvas,'Geometry exceeds the renderable numeric range; this projection was withheld.');
  const bounds=[[Infinity,-Infinity],[Infinity,-Infinity],[Infinity,-Infinity]];
  for(const mesh of meshes) for(let i=0;i<mesh.data.length;i++) { const axis=i%3,n=mesh.data[i];bounds[axis][0]=Math.min(bounds[axis][0],n);bounds[axis][1]=Math.max(bounds[axis][1],n); }
  const center=bounds.map(([lo,hi])=>(lo+hi)/2), extent=Math.max(...bounds.map(([lo,hi])=>hi-lo),1e-9);
  if(!center.every(finite)||!finite(extent)||extent<=0||!finite(2.0/extent)) return failCanvas(canvas,'Geometry bounds cannot be represented safely; this projection was withheld.');
  let camera={angle:-.55,pitch:.52,zoom:1};
  const buffers=meshes.map(({item,data})=>{const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);return {item,data,buffer};});
  gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);
  const render=()=>{gl.clearColor(.035,.055,.08,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.uniform1f(angleLoc,camera.angle);gl.uniform1f(pitchLoc,camera.pitch);gl.uniform1f(scaleLoc,1.25/extent*camera.zoom);gl.uniform3f(centerLoc,...center);for(const {item,data,buffer} of buffers){gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);gl.uniform4f(color,item.kind==='ground_plane'?.25:.34,item.kind==='sphere'?.72:.66,item.kind==='sphere'?.95:.82,1);gl.drawArrays(gl.TRIANGLES,0,data.length/3);}};
  render();
  return {adjust(action){if(action==='left')camera.angle-=.18;else if(action==='right')camera.angle+=.18;else if(action==='tilt-up')camera.pitch=Math.min(1.35,camera.pitch+.12);else if(action==='tilt-down')camera.pitch=Math.max(-1.35,camera.pitch-.12);else if(action==='zoom-in')camera.zoom=Math.min(8,camera.zoom*1.25);else if(action==='zoom-out')camera.zoom=Math.max(.2,camera.zoom/1.25);else if(action==='reset')camera={angle:-.55,pitch:.52,zoom:1};render();}};
}
function failCanvas(canvas,message){const panel=canvas.closest('.spatial-owner-panel');const note=document.createElement('p');note.className='fine';note.setAttribute('role','status');note.textContent=message;panel?.append(note);const tag=panel?.querySelector('.small-tag');if(tag)tag.textContent='UNRENDERABLE';panel?.querySelector('.spatial-camera')?.remove();canvas.remove();return null;}
function attachCamera(canvas, camera){if(!canvas||!camera)return;canvas.closest('.spatial-owner-panel')?.querySelectorAll('[data-camera]').forEach(button=>button.addEventListener('click',()=>camera.adjust(button.dataset.camera)));}
