import test from 'node:test';
import assert from 'node:assert/strict';
import {ROUTES,AVAILABILITY,initialSource,assertReadOnlySource,routeFromPath,statusLabel} from '../src/model.js';
test('seven ungrouped peer-level screens',()=>{assert.equal(ROUTES.length,7);assert.equal(new Set(ROUTES.map(x=>x.path)).size,7);});
test('truthful disconnected baseline has no claims or asserted cut',()=>{assert.equal(assertReadOnlySource(initialSource).claims.length,0);assert.equal(initialSource.cut,null);});
test('reject fabricated claims in unconfigured source',()=>assert.throws(()=>assertReadOnlySource({...initialSource,claims:[{value:1}]})));
test('all availability states map to textual labels',()=>AVAILABILITY.forEach(x=>assert.ok(statusLabel(x).length)));
test('unknown path returns overview shell',()=>assert.equal(routeFromPath('/non-existent').path,'/overview'));
