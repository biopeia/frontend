import {createServer as createHttpServer, request as httpRequest} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile, stat, lstat} from 'node:fs/promises';
import {extname, join, resolve, sep} from 'node:path';

export const MAX_BRIDGE_RESPONSE_BYTES = 1_000_000;
const CONTENT_TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml'};
const BRIDGE_PATH = '/v1/current';
const FRONTEND_PATH = '/api/observation/current';
const SESSION_PATH = '/api/session/status';
const SESSION_STATES = new Set(['running', 'completed', 'stopped', 'failed']);

async function readSessionStatus(file) {
  if (!file) return null;
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || !/^[0-9a-f-]{36}\.json$/i.test(file.split(/[\\/]/).at(-1))) return null;
  const record = JSON.parse(await readFile(file, 'utf8'));
  if (record.schema_version !== 1 || record.run_id !== file.split(/[\\/]/).at(-1).slice(0, -5) || !SESSION_STATES.has(record.status)) return null;
  if (record.status === 'running') {
    if (!Number.isSafeInteger(record.pid) || record.pid < 1 || typeof record.process_identity !== 'string') return null;
    try {
      const stat = await readFile(`/proc/${record.pid}/stat`, 'utf8');
      const start = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
      const argv = await readFile(`/proc/${record.pid}/cmdline`);
      if (!argv.includes(Buffer.from('world-m1')) || createHash('sha256').update(Buffer.concat([Buffer.from(start), Buffer.from([0]), argv])).digest('hex') !== record.process_identity) return null;
    } catch { return null; }
  }
  const result = {run_id:record.run_id, world_id:record.world_id, status:record.status};
  for (const key of ['created_at','ended_at','last_verified_committed_tick','commit_id']) {
    if (record[key] !== undefined && (key === 'commit_id' ? typeof record[key] === 'string' : key === 'last_verified_committed_tick' ? Number.isSafeInteger(record[key]) && record[key] >= 0 : Number.isFinite(record[key]))) result[key] = record[key];
  }
  return result;
}

async function sessionStatus(req, res, server, file) {
  const origin = originFor(server);
  if (req.headers.host !== expectedHost(server)) return sendJson(res, 400, 'invalid_host');
  if ((req.headers.origin !== undefined && req.headers.origin !== origin) || (req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'same-origin')) return sendJson(res, 403, 'origin_denied');
  if (req.method !== 'GET') return sendJson(res, 405, 'method_not_allowed');
  if (req.url !== SESSION_PATH || hasRequestBody(req)) return sendJson(res, 400, 'invalid_read_request');
  try {
    const value = await readSessionStatus(file);
    if (!value) return sendJson(res, 404, 'session_status_unavailable');
    const body = Buffer.from(JSON.stringify(value));
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Connection':'close'});
    res.end(body);
  } catch { sendJson(res, 503, 'session_status_unavailable'); }
}

export function parseLocalBridgeUrl(value = 'http://127.0.0.1:4174/v1/current') {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('Observation bridge URL must be an absolute URL'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== BRIDGE_PATH || url.username || url.password || url.search || url.hash) {
    throw new TypeError('Observation bridge must be the exact local loopback HTTP current-view route');
  }
  return url;
}

function sendJson(res, status, code) {
  const body = Buffer.from(JSON.stringify({error: code}));
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Connection': 'close'});
  res.end(body);
}

function originFor(server) {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 4173;
  return `http://127.0.0.1:${port}`;
}

function expectedHost(server) {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 4173;
  return `127.0.0.1:${port}`;
}

function hasRequestBody(req) {
  return req.headers['transfer-encoding'] !== undefined || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0');
}

function proxyCurrent(req, res, server, bridgeUrl) {
  const origin = originFor(server);
  if (req.headers.host !== expectedHost(server)) return sendJson(res, 400, 'invalid_host');
  if ((req.headers.origin !== undefined && req.headers.origin !== origin) ||
      (req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'same-origin')) {
    return sendJson(res, 403, 'origin_denied');
  }
  if (req.method !== 'GET') return sendJson(res, 405, 'method_not_allowed');
  if (req.url !== FRONTEND_PATH || hasRequestBody(req)) return sendJson(res, req.url?.startsWith(`${FRONTEND_PATH}?`) ? 400 : 404, 'invalid_read_request');

  const upstream = httpRequest(bridgeUrl, {method: 'GET', headers: {
    Accept: 'application/json',
    Host: bridgeUrl.host,
    Origin: origin,
    Connection: 'close',
  }});
  let settled = false;
  const fail = (status, code) => {
    if (settled || res.destroyed) return;
    settled = true;
    upstream.destroy();
    sendJson(res, status, code);
  };
  upstream.setTimeout(1500, () => fail(503, 'observation_bridge_unavailable'));
  upstream.on('response', upstreamRes => {
    const announced = Number(upstreamRes.headers['content-length']);
    if (Number.isFinite(announced) && announced > MAX_BRIDGE_RESPONSE_BYTES) return fail(413, 'current_view_exceeds_response_limit');
    if (upstreamRes.statusCode !== 200) {
      const status = upstreamRes.statusCode === 413 ? 413 : upstreamRes.statusCode === 403 ? 403 : upstreamRes.statusCode === 404 ? 404 : 503;
      upstreamRes.resume();
      return fail(status, status === 413 ? 'current_view_exceeds_response_limit' : status === 403 ? 'origin_denied' : status === 404 ? 'not_found' : 'current_view_unavailable');
    }
    const chunks = [];
    let size = 0;
    upstreamRes.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BRIDGE_RESPONSE_BYTES) return fail(413, 'current_view_exceeds_response_limit');
      chunks.push(chunk);
    });
    upstreamRes.on('end', () => {
      if (settled || res.destroyed) return;
      settled = true;
      const body = Buffer.concat(chunks);
      res.writeHead(200, {'Content-Type': upstreamRes.headers['content-type'] || 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Connection': 'close'});
      res.end(body);
    });
    upstreamRes.on('error', () => fail(503, 'observation_bridge_unavailable'));
  });
  upstream.on('error', () => fail(503, 'observation_bridge_unavailable'));
  upstream.end();
}

export function createFrontendServer({root = 'dist', bridgeUrl = process.env.OBSERVATION_BRIDGE_URL || 'http://127.0.0.1:4174/v1/current', sessionStatusFile = process.env.BIOPEIA_M1_SESSION_STATUS_FILE} = {}) {
  const staticRoot = resolve(root);
  const localBridgeUrl = parseLocalBridgeUrl(bridgeUrl);
  const server = createHttpServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch { return sendJson(res, 400, 'invalid_request'); }
    if (url.pathname === FRONTEND_PATH) return proxyCurrent(req, res, server, localBridgeUrl);
    if (url.pathname === SESSION_PATH) return void sessionStatus(req, res, server, sessionStatusFile);
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, 'not_found');
    if (req.headers.host !== expectedHost(server)) return sendJson(res, 400, 'invalid_host');
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, 'method_not_allowed');
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return sendJson(res, 400, 'invalid_path'); }
    const file = resolve(join(staticRoot, pathname.replace(/^\/+/, '')));
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) return sendJson(res, 403, 'path_denied');
    let target = file;
    try { if (!(await stat(target)).isFile()) target = join(staticRoot, 'index.html'); }
    catch { target = extname(file) ? file : join(staticRoot, 'index.html'); }
    try {
      const body = await readFile(target);
      res.writeHead(200, {
        'Content-Type': CONTENT_TYPES[extname(target)] || 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' https://raw.githubusercontent.com; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { sendJson(res, 404, 'not_found'); }
  });
  return server;
}

export const FRONTEND_CURRENT_PATH = FRONTEND_PATH;
