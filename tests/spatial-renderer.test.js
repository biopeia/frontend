import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEnvironmentDescriptor,validateEmbodimentDescriptor,validateEmbodimentPoses} from '../src/spatial-renderer.js';

const frame={frame_id:'env.frame',parent_frame_id:'world',origin_m:[0,0,0],x_axis_in_parent:[1,0,0],y_axis_in_parent:[0,1,0],z_axis_in_parent:[0,0,1],handedness:'RIGHT_HANDED',up_axis:'Z'};
const env={schema_version:1,environment_id:'environment.demo',environment_revision:'r1',render_geometry_sha256:'022f7875e378b8d9196f13528af47723ffd352f70e379e404946acb3ddc41a9d',length_unit:'m',frame:{...frame,frame_id:'environment.frame',parent_frame_id:'environment.parent-frame'},items:[]};
const embodiment={contract_revision:'embodiment.render_morphology/v1',schema_version:1,body_id:'body.one',embodiment_episode_id:'episode.one',morphology_revision:'m1',geometry_revision:'g1',render_geometry_sha256:'62a6a5dc9be0d29cabfbd1d5c55079988dd7e6f85b6f14816d15ebae8ef0c234',coordinate_system:'right_handed_z_up',length_unit:'m',segments:[{segment_id:'body.root',shape:'box',dimensions_m:[0.2,0.1,0.1],visual_origin_in_link_m:[0,0,0]}],joints:[]};

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
test('does not accept dynamic transforms without an exact-cut verifier',async()=>{
 const poses={body_id:'body.one',embodiment_episode_id:'episode.one',morphology_revision:'m1',geometry_revision:'g1',render_geometry_sha256:embodiment.render_geometry_sha256,source_world_id:'w1',confirmed_cut_reference:'opaque',physical_step_id:'step-1',reference_frame:'physics3d.world',length_unit:'m',poses:[{segment_id:'body.root',translation_m:[0,0,0],orientation_xyzw:[0,0,0,1]}],completeness:'complete'};
 assert.equal((await validateEmbodimentPoses(embodiment,poses,null)).ok,false);
 assert.equal((await validateEmbodimentPoses(embodiment,poses,()=>true)).ok,true);
 assert.equal((await validateEmbodimentPoses(embodiment,{...poses,poses:[]},()=>true)).ok,false);
});
