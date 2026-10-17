import test from 'node:test';
import assert from 'node:assert/strict';
import {ROUTES,routeFromPath,initialSource} from '../src/model.js';
import {renderScreen} from '../src/views.js';

test('V2 navigation exposes research and organism routes',()=>{
  for (const path of ['/research','/organism']) assert.equal(routeFromPath(path).path,path);
  assert.equal(new Set(ROUTES.map(route=>route.path)).size,ROUTES.length);
});
test('unavailable research is not described as admitted science',()=>{
  const html=renderScreen(routeFromPath('/research'),initialSource);
  assert.match(html,/Lab evidence adapter not authorized/);
  assert.match(html,/not automatically admitted/);
  assert.doesNotMatch(html,/data-action="execute"/);
});
test('organism screen does not invent cognitive claims',()=>{
  const html=renderScreen(routeFromPath('/organism'),initialSource);
  assert.match(html,/cannot establish learning/);
  assert.match(html,/NO ORGANISM CLAIMS/);
});
