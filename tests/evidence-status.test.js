import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyEvidence,describeEvidence} from '../src/evidence-status.js';
const provenance={sha256:'a'.repeat(64),revision:'lab@123'};
test('withholds unverified records',()=>{assert.equal(classifyEvidence(null).state,'unavailable');assert.equal(classifyEvidence({admission:{status:'admitted',authority:'lab'}}).state,'unavailable');});
test('does not promote exploratory evidence',()=>assert.equal(classifyEvidence({provenance}).state,'exploratory'));
test('reproduction is not admission',()=>assert.equal(classifyEvidence({provenance,reproduction:{status:'reproduced',independent_runs:2}}).state,'reproduced'));
test('only explicit Lab admission is admitted',()=>{assert.equal(classifyEvidence({provenance,admission:{status:'admitted',authority:'lab',decision_id:'LAB-1'}}).state,'admitted');assert.equal(classifyEvidence({provenance,admission:{status:'admitted',authority:'world',decision_id:'1'}}).state,'exploratory');});
test('exposes source provenance unchanged',()=>assert.deepEqual(describeEvidence({provenance}).digest,provenance.sha256));
