import test from 'node:test';
import assert from 'node:assert/strict';
import {ROUTES} from '../src/model.js';
import {renderScreen} from '../src/views.js';
test('each approved route renders distinct evidence-first UI',()=> {
 const html=ROUTES.map(renderScreen);
 assert.equal(new Set(html).size,7);
 for(const page of html){assert.ok(page.includes('Not available')||page.includes('No ')||page.includes('Not configured')||page.includes('not '));assert.ok(!page.includes('runtime_tick_events')); }
});
test('spatial screens refuse fabricated geometry',()=> {
 for(const path of ['/overview','/spatial']) {
 const html=renderScreen(ROUTES.find(r=>r.path===path));
 assert.match(html,/No source-backed world geometry|Spatial evidence unavailable/);
 assert.match(html,/No synthetic scene is displayed/);
 }
});
test('claim and timeline views preserve provenance and causal distinctions',()=>{
 assert.match(renderScreen(ROUTES[5]),/Semantic authority/);
 assert.match(renderScreen(ROUTES[5]),/World cut and lineage/);
 assert.match(renderScreen(ROUTES[3]),/delivery/);
 assert.match(renderScreen(ROUTES[3]),/World-verified/);
});
test('browser diagnostics never claim an approved access contract',()=>{
 const html=renderScreen(ROUTES[6]);
 assert.match(html,/Not authorized/);
 assert.match(html,/Not implemented/);
 assert.match(html,/Observation #37/);
});
