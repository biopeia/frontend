import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer as createHttpServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFrontendServer, FRONTEND_CURRENT_PATH, parseLocalBridgeUrl, parseLocalArchiveUrl} from '../scripts/frontend-server.js';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
async function close(server) {
  server.close();
  await once(server, 'close');
}

test('bridge URL is fixed to an explicit loopback current-view endpoint', () => {
  assert.equal(parseLocalBridgeUrl('http://127.0.0.1:4174/v1/current').pathname, '/v1/current');
  for (const url of [
    'https://127.0.0.1:4174/v1/current',
    'http://localhost:4174/v1/current',
    'http://192.0.2.4:4174/v1/current',
    'http://127.0.0.1:4174/v1/current?all=1',
    'http://user@127.0.0.1:4174/v1/current',
    'http://127.0.0.1:4174/other',
  ]) assert.throws(() => parseLocalBridgeUrl(url));
});

test('same-origin proxy forwards only bounded GET current reads with fixed Host and Origin', async t => {
  const upstream = createHttpServer((req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/v1/current');
    assert.match(req.headers.host, /^127\.0\.0\.1:\d+$/);
    assert.match(req.headers.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(req.headers.accept, 'application/json');
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end('{"schema":"test"}');
  });
  const bridgePort = await listen(upstream);
  const frontend = createFrontendServer({root: new URL('../dist/', import.meta.url).pathname, bridgeUrl: `http://127.0.0.1:${bridgePort}/v1/current`});
  t.after(async () => { await close(frontend); await close(upstream); });
  const frontendPort = await listen(frontend);
  const origin = `http://127.0.0.1:${frontendPort}`;
  const response = await fetch(`${origin}${FRONTEND_CURRENT_PATH}`, {headers: {Origin: origin}});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), '{"schema":"test"}');
});

test('proxy rejects wrong origin, query and methods without contacting the bridge', async t => {
  let contacted = false;
  const upstream = createHttpServer((_req, res) => { contacted = true; res.end('{}'); });
  const bridgePort = await listen(upstream);
  const frontend = createFrontendServer({root: new URL('../dist/', import.meta.url).pathname, bridgeUrl: `http://127.0.0.1:${bridgePort}/v1/current`});
  t.after(async () => { await close(frontend); await close(upstream); });
  const port = await listen(frontend);
  const origin = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${origin}${FRONTEND_CURRENT_PATH}`, {headers: {Origin: 'http://attacker.invalid'}})).status, 403);
  assert.equal((await fetch(`${origin}${FRONTEND_CURRENT_PATH}?query=1`, {headers: {Origin: origin}})).status, 400);
  assert.equal((await fetch(`${origin}${FRONTEND_CURRENT_PATH}`, {method: 'POST', headers: {Origin: origin}})).status, 405);
  assert.equal(contacted, false);
});

test('proxy converts upstream refusal and oversized responses to bounded JSON failures', async t => {
  let requests = 0;
  const upstream = createHttpServer((req, res) => {
    requests += 1;
    if (requests === 1) { res.writeHead(403); return res.end('{}'); }
    res.writeHead(200, {'Content-Length': '1000001'}); res.end();
  });
  const bridgePort = await listen(upstream);
  const frontend = createFrontendServer({root: new URL('../dist/', import.meta.url).pathname, bridgeUrl: `http://127.0.0.1:${bridgePort}/v1/current`});
  t.after(async () => { await close(frontend); await close(upstream); });
  const port = await listen(frontend);
  const origin = `http://127.0.0.1:${port}`;
  const denied = await fetch(`${origin}${FRONTEND_CURRENT_PATH}`, {headers: {Origin: origin}});
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), {error: 'origin_denied'});
  const oversized = await fetch(`${origin}${FRONTEND_CURRENT_PATH}`, {headers: {Origin: origin}});
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), {error: 'current_view_exceeds_response_limit'});
});

test('proxy reports an unavailable local bridge without fabricating a current view', async t => {
  const closed = createHttpServer();
  const bridgePort = await listen(closed);
  await close(closed);
  const frontend = createFrontendServer({root: new URL('../', import.meta.url).pathname, bridgeUrl: `http://127.0.0.1:${bridgePort}/v1/current`});
  t.after(() => close(frontend));
  const port = await listen(frontend);
  const origin = `http://127.0.0.1:${port}`;
  const response = await fetch(`${origin}${FRONTEND_CURRENT_PATH}`, {headers: {Origin: origin}});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {error: 'observation_bridge_unavailable'});
});

test('static app CSP permits only same-origin client reads', async t => {
  const server = createFrontendServer({root: new URL('../', import.meta.url).pathname});
  t.after(() => close(server));
  const port = await listen(server);
  const origin = `http://127.0.0.1:${port}`;
  const response = await fetch(origin, {headers: {Host: `127.0.0.1:${port}`}});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.doesNotMatch(response.headers.get('content-security-policy'), /connect-src 'none'/);
});

test('M1 session status exposes only lifecycle fields and remains separate from Observation', async t => {
  const base = await mkdtemp(join(tmpdir(), 'biopeia-m1-'));
  const dir = join(base, '.local', 'm1', 'sessions');
  await (await import('node:fs/promises')).mkdir(dir, {recursive:true});
  t.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, '123e4567-e89b-12d3-a456-426614174000.json');
  await writeFile(file, JSON.stringify({schema_version:1,run_id:'123e4567-e89b-12d3-a456-426614174000',world_id:'world.test',status:'completed',created_at:12,ended_at:14,last_verified_committed_tick:9,commit_id:'c9',pid:444,state_root:'/secret',error:'secret'}));
  const frontend = createFrontendServer({root:new URL('../', import.meta.url).pathname, sessionStatusFile:file});
  t.after(() => close(frontend));
  const port = await listen(frontend), origin = `http://127.0.0.1:${port}`;
  const response = await fetch(`${origin}/api/session/status`, {headers:{Origin:origin}});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {run_id:'123e4567-e89b-12d3-a456-426614174000',world_id:'world.test',status:'completed',created_at:12,ended_at:14,last_verified_committed_tick:9,commit_id:'c9'});
  await writeFile(file, JSON.stringify({schema_version:1,run_id:'123e4567-e89b-12d3-a456-426614174000',world_id:'world.test',status:'completed',last_verified_committed_tick:-1}));
  const malformed = await fetch(`${origin}/api/session/status`, {headers:{Origin:origin}});
  assert.equal(malformed.status, 200);
  assert.equal(Object.hasOwn(await malformed.json(), 'last_verified_committed_tick'), false);
});

test('M1 session status with a dead World identity is unavailable, not reported active', async t => {
  const base = await mkdtemp(join(tmpdir(), 'biopeia-m1-stale-'));
  const dir = join(base, '.local', 'm1', 'sessions');
  await (await import('node:fs/promises')).mkdir(dir, {recursive:true});
  t.after(() => rm(base, {recursive: true, force: true}));
  const file = join(dir, '123e4567-e89b-12d3-a456-426614174000.json');
  await writeFile(file, JSON.stringify({schema_version:1,run_id:'123e4567-e89b-12d3-a456-426614174000',world_id:'world.test',status:'running',pid:2147483647,process_identity:'stale'}));
  const frontend = createFrontendServer({root:new URL('../', import.meta.url).pathname, sessionStatusFile:file});
  t.after(() => close(frontend));
  const port = await listen(frontend), origin = `http://127.0.0.1:${port}`;
  const response = await fetch(`${origin}/api/session/status`, {headers:{Origin:origin}});
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {error:'session_status_unavailable'});
});

test('archive adapter URL rejects non-loopback and credentialed origins', () => {
  assert.equal(parseLocalArchiveUrl('http://127.0.0.1:4175').port, '4175');
  for (const url of ['http://localhost:4175', 'http://192.0.2.1:4175',
    'https://127.0.0.1:4175', 'http://user@127.0.0.1:4175',
    'http://127.0.0.1:4175/v2/archive/receipts']) assert.throws(() => parseLocalArchiveUrl(url));
});

test('archive proxy forwards bounded GET without granting write or cross-origin access', async t => {
  const upstream = createHttpServer((req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/v2/archive/receipts?limit=1');
    assert.equal(req.headers.origin, undefined);
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end('{"schema":"biopeia.observation.archive-http.v1","status":"results","receipts":[],"has_more":false,"next_after_receipt_sequence":0}');
  });
  const port = await listen(upstream);
  const frontend = createFrontendServer({archiveUrl:`http://127.0.0.1:${port}`});
  const frontendPort = await listen(frontend);
  t.after(async () => {await close(frontend); await close(upstream);});
  const base = `http://127.0.0.1:${frontendPort}`;
  const ok = await fetch(base + '/api/observation/archive/receipts?limit=1');
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).schema, 'biopeia.observation.archive-http.v1');
  assert.equal((await fetch(base + '/api/observation/archive/receipts', {method:'POST'})).status, 405);
  assert.equal((await fetch(base + '/api/observation/archive/receipts', {headers:{Origin:'http://evil.invalid'}})).status, 403);
});

test('archive proxy forwards capture catalog and bounded coverage without causal joins', async t => {
  const seen = [];
  const upstream = createHttpServer((req, res) => {
    seen.push(req.url);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v2/archive/captures') return res.end(JSON.stringify({
      schema:'biopeia.observation.archive-http.v1',status:'results',
      captures:[{capture_id:'capture-1',status:'closed_verified',initial_source_sequence:2,final_source_sequence:5}],
    }));
    if (req.url === '/v2/archive/coverage?capture_id=capture-1') return res.end(JSON.stringify({
      schema:'biopeia.observation.archive-http.v1',status:'results',
      coverage:{capture_id:'capture-1',status:'closed_verified',closure_verified:true,
        complete:false,received_not_persisted:1,known_source_gaps:1,unverifiable_intervals:0},
    }));
    res.writeHead(404);
    res.end(JSON.stringify({status:'not_found'}));
  });
  const port = await listen(upstream);
  const frontend = createFrontendServer({archiveUrl:`http://127.0.0.1:${port}`});
  const frontendPort = await listen(frontend);
  t.after(async () => { await close(frontend); await close(upstream); });
  const base = `http://127.0.0.1:${frontendPort}/api/observation/archive`;
  const captures = await fetch(base + '/captures');
  assert.equal(captures.status, 200);
  assert.equal((await captures.json()).captures[0].capture_id, 'capture-1');
  const coverage = await fetch(base + '/coverage?capture_id=capture-1');
  assert.equal(coverage.status, 200);
  const value = await coverage.json();
  assert.equal(value.coverage.complete, false);
  assert.equal(Object.hasOwn(value, 'world_run_id'), false);
  const missing = await fetch(base + '/coverage?capture_id=missing');
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {status:'not_found'});
  assert.deepEqual(seen, ['/v2/archive/captures',
    '/v2/archive/coverage?capture_id=capture-1', '/v2/archive/coverage?capture_id=missing']);
});

test('archive capture catalog fails closed when the adapter is unavailable', async t => {
  const upstream = createHttpServer((_req, res) => res.end('{}'));
  const port = await listen(upstream);
  await close(upstream);
  const frontend = createFrontendServer({archiveUrl:`http://127.0.0.1:${port}`});
  t.after(() => close(frontend));
  const frontendPort = await listen(frontend);
  const response = await fetch(`http://127.0.0.1:${frontendPort}/api/observation/archive/captures`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {error:'archive_unavailable'});
});
