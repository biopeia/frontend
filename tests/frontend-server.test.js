import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer as createHttpServer} from 'node:http';
import {once} from 'node:events';
import {createFrontendServer, FRONTEND_CURRENT_PATH, parseLocalBridgeUrl} from '../scripts/frontend-server.js';

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
