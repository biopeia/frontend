import test from 'node:test';
import assert from 'node:assert/strict';
import {assessArchivePage} from '../src/replay-integrity.js';
test('never infers causal history from delivery sequence',()=>{const r=assessArchivePage({records:[{capture_session_id:'s',delivery_sequence:1},{capture_session_id:'s',delivery_sequence:3}]});assert.equal(r.records[1].continuity,'delivery-gap');assert.equal(r.records[1].causalTick,null);assert.equal(r.completeCausalHistory,false);});
test('duplicate delivery is not silently deduplicated',()=>assert.equal(assessArchivePage({records:[{capture_session_id:'s',delivery_sequence:2},{capture_session_id:'s',delivery_sequence:2}]}).records[1].continuity,'duplicate-or-out-of-order'));
test('different sessions are not joined',()=>assert.equal(assessArchivePage({records:[{capture_session_id:'a',delivery_sequence:1},{capture_session_id:'b',delivery_sequence:9}]}).records[1].continuity,'unknown'));
test('rejects unbounded and malformed data',()=>{assert.throws(()=>assessArchivePage({records:new Array(501).fill({})}));assert.throws(()=>assessArchivePage({records:[{capture_session_id:'a',delivery_sequence:-1}]}));});
