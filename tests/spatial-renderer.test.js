import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validateEnvironmentDescriptor,validateEmbodimentDescriptor,validateBoundPose,jointMarkerStates} from '../src/spatial-renderer.js';
import * as spatialRenderer from '../src/spatial-renderer.js';

const frame={frame_id:'env.frame',parent_frame_id:'world',origin_m:[0,0,0],x_axis_in_parent:[1,0,0],y_axis_in_parent:[0,1,0],z_axis_in_parent:[0,0,1],handedness:'RIGHT_HANDED',up_axis:'Z'};
const env={schema_version:1,environment_id:'environment.demo',environment_revision:'r1',render_geometry_sha256:'022f7875e378b8d9196f13528af47723ffd352f70e379e404946acb3ddc41a9d',length_unit:'m',frame:{...frame,frame_id:'environment.frame',parent_frame_id:'environment.parent-frame'},items:[]};
const embodiment={contract_revision:'embodiment.render_morphology/v1',schema_version:1,body_id:'body.one',embodiment_episode_id:'episode.one',morphology_revision:'m1',geometry_revision:'g1',render_geometry_sha256:'62a6a5dc9be0d29cabfbd1d5c55079988dd7e6f85b6f14816d15ebae8ef0c234',coordinate_system:'right_handed_z_up',length_unit:'m',segments:[{segment_id:'body.root',shape:'box',dimensions_m:[0.2,0.1,0.1],visual_origin_in_link_m:[0,0,0]}],joints:[]};
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const codePointCompare=(a,b)=>{const x=Array.from(a,c=>c.codePointAt(0)),y=Array.from(b,c=>c.codePointAt(0));for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;};
const embodimentDigest=descriptor=>createHash('sha256').update(`biopeia:embodiment.render_morphology/v1\n${canonical({contract_revision:descriptor.contract_revision,schema_version:descriptor.schema_version,coordinate_system:descriptor.coordinate_system,length_unit:descriptor.length_unit,segments:[...descriptor.segments].sort((a,b)=>codePointCompare(a.segment_id,b.segment_id)),joints:[...descriptor.joints].sort((a,b)=>codePointCompare(a.joint_id,b.joint_id))})}`).digest('hex');

test('accepts Environment empty descriptor without inventing primitives or trusting a forged digest',async()=>{
 assert.equal((await validateEnvironmentDescriptor(env)).ok,true);
 assert.equal((await validateEnvironmentDescriptor({...env,environment_revision:'r2'})).ok,false);
});
test('rejects unknown Environment fields, invalid frame and oversized lists',async()=>{
  assert.equal((await validateEnvironmentDescriptor({...env,floor:true})).ok,false);
  assert.equal((await validateEnvironmentDescriptor({...env,frame:{...env.frame,parent_frame_id:''}})).ok,false);
  assert.equal((await validateEnvironmentDescriptor({...env,frame:{...env.frame,z_axis_in_parent:[0,0,2]}})).ok,false);
  assert.equal((await validateEnvironmentDescriptor({...env,items:Array.from({length:129},(_,n)=>({object_id:`p${n}`,kind:'sphere',frame_id:'environment.frame',center_m:[0,0,0],radius_m:1}))})).ok,false);
});
test('rejects render values that cannot be represented as finite geometry',async()=>{
  assert.equal((await validateEnvironmentDescriptor({...env,items:[{object_id:'s',kind:'sphere',frame_id:'environment.frame',center_m:[Number.MAX_VALUE,0,0],radius_m:1}]})).ok,false);
  assert.equal((await validateEmbodimentDescriptor({...embodiment,segments:[{...embodiment.segments[0],dimensions_m:[1e-50,1,1]}]})).ok,false);
});
test('validates bounded Embodiment static descriptor and closed keys',async()=>{
  assert.equal((await validateEmbodimentDescriptor(embodiment)).ok,true);
  assert.equal((await validateEmbodimentDescriptor({...embodiment,private_solver_value:2})).ok,false);
  assert.equal((await validateEmbodimentDescriptor({...embodiment,segments:[{...embodiment.segments[0],dimensions_m:[0,1,1]}]})).ok,false);
});
test('binds physical poses only to the exact authored morphology and committed World cut',()=>{
 const pose={candidate:{body_id:embodiment.body_id,embodiment_episode_id:embodiment.embodiment_episode_id,morphology_revision:embodiment.morphology_revision,geometry_revision:embodiment.geometry_revision,render_geometry_sha256:embodiment.render_geometry_sha256,source_world_id:'world.real',target_causal_tick:17,poses:[{segment_id:'body.root',translation_m:[1,2,3],orientation_xyzw:[0,0,0,1]}]},world_association:{association_kind:'transient_current_committed_cut',committed_cut:{world_id:'world.real',causal_tick:17,commit_id:'world.real:commit:17'}}};
 assert.equal(validateBoundPose(embodiment,pose).ok,true);
 assert.equal(validateBoundPose(embodiment,{...pose,candidate:{...pose.candidate,render_geometry_sha256:'0'.repeat(64)}}).ok,false);
 assert.equal(validateBoundPose(embodiment,{...pose,world_association:{...pose.world_association,committed_cut:{...pose.world_association.committed_cut,causal_tick:18}}}).ok,false);
 assert.equal(validateBoundPose(embodiment,{...pose,candidate:{...pose.candidate,poses:[]}}).ok,false);
});
test('places only topology-origin markers from an exactly available parent pose, never a child pose',()=>{
 const morphology={...embodiment,joints:[{joint_id:'joint.root-carrier',parent_link_id:'body.root',child_link_id:'body.carrier',joint_type:'revolute',joint_origin_in_parent_m:[1,0,0],axis_in_joint_frame:[0,0,1]}]};
 const pose=[{segment_id:'body.root',translation_m:[1,2,3],orientation_xyzw:[0,0,Math.SQRT1_2,Math.SQRT1_2]}];
 const [state]=jointMarkerStates(morphology,pose);
 assert.equal(state.joint_id,'joint.root-carrier');
 assert.equal(state.available,true);
 state.position_m.forEach((value,index)=>assert.ok(Math.abs(value-[1,3,3][index])<1e-12));
 assert.equal('child_pose' in state,false);
});
test('reports a topology-only joint marker unavailable when its parent link has no render pose',()=>{
 const morphology={...embodiment,joints:[{joint_id:'joint.carrier-tip',parent_link_id:'body.carrier',child_link_id:'body.tip',joint_type:'revolute',joint_origin_in_parent_m:[0,0,0],axis_in_joint_frame:[0,0,1]}]};
 assert.deepEqual(jointMarkerStates(morphology,[{segment_id:'body.root',translation_m:[0,0,0],orientation_xyzw:[0,0,0,1]}]),[{joint_id:'joint.carrier-tip',available:false,reason:'parent link pose unavailable'}]);
});
test('accepts topology-only carrier links without fabricating renderable segments',async()=>{
 const candidate={...embodiment,joints:[{joint_id:'joint.root-carrier',parent_link_id:'body.root',child_link_id:'body.carrier',joint_type:'revolute',joint_origin_in_parent_m:[0,0,0],axis_in_joint_frame:[0,0,1]}]};
 candidate.render_geometry_sha256=embodimentDigest(candidate);
 const result=await validateEmbodimentDescriptor(candidate);
 assert.equal(result.ok,true);
 assert.equal(result.value.segments.length,1);
 assert.equal(result.value.joints[0].child_link_id,'body.carrier');
});
test('uses producer-compatible Unicode code-point ordering in Embodiment digests',async()=>{
 const candidate={...embodiment,segments:[
  {segment_id:'\u{10000}',shape:'box',dimensions_m:[1,1,1],visual_origin_in_link_m:[0,0,0]},
  {segment_id:'\uE000',shape:'box',dimensions_m:[1,1,1],visual_origin_in_link_m:[0,0,0]},
 ]};
 candidate.render_geometry_sha256=embodimentDigest(candidate);
 assert.equal((await validateEmbodimentDescriptor(candidate)).ok,true);
 assert.ok('\u{10000}' < '\uE000', 'UTF-16 ordering differs from Unicode code-point ordering for this pair');
});
test('rejects duplicate IDs and oversized topology-only link sets',async()=>{
 const duplicate={...embodiment,joints:[{joint_id:'j',parent_link_id:'body.root',child_link_id:'body.root',joint_type:'revolute',joint_origin_in_parent_m:[0,0,0],axis_in_joint_frame:[0,0,1]}]};
 duplicate.render_geometry_sha256=embodimentDigest(duplicate);
 assert.equal((await validateEmbodimentDescriptor(duplicate)).ok,false);
 const oversized={...embodiment,joints:Array.from({length:127},(_,i)=>({joint_id:`j${i}`,parent_link_id:`link${i}`,child_link_id:`link${i+1}`,joint_type:'revolute',joint_origin_in_parent_m:[0,0,0],axis_in_joint_frame:[0,0,1]}))};
 oversized.render_geometry_sha256=embodimentDigest(oversized);
 assert.equal((await validateEmbodimentDescriptor(oversized)).ok,false);
});
test('does not expose dynamic pose acceptance before a World proof boundary is integrated',()=>{
 assert.equal('validateEmbodimentPoses' in spatialRenderer,false);
 assert.equal(spatialRenderer.mountSpatialExplorer.length,1);
});

test('keeps markerMode uniform precision identical across body shader stages',()=>{
 const source=readFileSync(fileURLToPath(new URL('../src/spatial-renderer.js',import.meta.url)),'utf8');
 const start=source.indexOf('function drawBodyCanvas(');
 const end=source.indexOf('function drawCanvas(',start);
 assert.ok(start>=0&&end>start,'body renderer shader source is present');
 const bodySource=source.slice(start,end);
 const [,vertexShader]=bodySource.match(/const vs=`([^`]+)`;/)??[];
 const [,fragmentShader]=bodySource.match(/const fs=`([^`]+)`;/)??[];
 assert.ok(vertexShader&&fragmentShader,'both body shader stages are present');
 const effectiveUniformPrecision=shader=>{
  const explicit=shader.match(/uniform\s+(lowp|mediump|highp)\s+float\s+markerMode\s*;/)?.[1];
  if(explicit)return explicit;
  return shader.match(/precision\s+(lowp|mediump|highp)\s+float\s*;/)?.[1]??null;
 };
 assert.equal(effectiveUniformPrecision(vertexShader),'mediump');
 assert.equal(effectiveUniformPrecision(fragmentShader),'mediump');
});
