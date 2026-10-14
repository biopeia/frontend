import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {once} from 'node:events';
import {createFrontendServer} from './frontend-server.js';

const root = resolve(process.env.FRONTEND_ROOT || '.');
const bridgeUrl = process.env.FRONTEND_BRIDGE_URL;
const expectedOrigin = process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:4173';
const expectUnavailable = process.env.EXPECT_UNAVAILABLE === '1';
const chrome = process.env.CHROME_BIN || '/usr/bin/google-chrome';
if (!bridgeUrl || !bridgeUrl.startsWith('http://127.0.0.1:') || !bridgeUrl.endsWith('/v1/current')) {
  throw new Error('A live loopback Observation current-view bridge is required');
}

const originUrl = new URL(expectedOrigin);
if (originUrl.protocol !== 'http:' || originUrl.hostname !== '127.0.0.1' || !originUrl.port) {
  throw new Error('Frontend acceptance origin must be an explicit 127.0.0.1 HTTP origin');
}

const browserProfile = process.env.FRONTEND_BROWSER_PROFILE || await mkdtemp(join(tmpdir(), 'biopeia-chrome-'));
await mkdir(browserProfile, {recursive: true});
const frontend = createFrontendServer({root: process.env.FRONTEND_DIST || join(root, 'dist'), bridgeUrl});
frontend.listen(Number(originUrl.port), '127.0.0.1');
await once(frontend, 'listening');
const actualAddress = frontend.address();
if (actualAddress.port !== Number(originUrl.port)) throw new Error('Frontend bound an unexpected port');

let browser;
let socket;
try {
  browser = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    '--remote-allow-origins=*', `--user-data-dir=${browserProfile}`, 'about:blank',
  ], {stdio: 'ignore'});
  const activePortPath = join(browserProfile, 'DevToolsActivePort');
  let activePort;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (browser.exitCode !== null) throw new Error(`Chrome exited early with status ${browser.exitCode}`);
    try { activePort = (await readFile(activePortPath, 'utf8')).split('\n')[0].trim(); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  if (!activePort) throw new Error('Chrome did not publish its DevTools endpoint');
  const versionResponse = await fetch(`http://127.0.0.1:${activePort}/json/version`);
  if (!versionResponse.ok) throw new Error(`Chrome DevTools version endpoint returned ${versionResponse.status}`);
  const version = await versionResponse.json();
  const targetResponse = await fetch(`http://127.0.0.1:${activePort}/json/new?${encodeURIComponent(expectedOrigin + '/overview')}`, {method: 'PUT'});
  if (!targetResponse.ok) throw new Error(`Chrome could not create browser target: ${targetResponse.status}`);
  const target = await targetResponse.json();

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, {once: true});
    socket.addEventListener('error', reject, {once: true});
  });
  let nextId = 0;
  const pending = new Map();
  const requests = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Network.requestWillBeSent') requests.push({url: message.params.request.url, method: message.params.request.method});
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, {resolve, reject});
    socket.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (response.exceptionDetails) throw new Error(`Browser expression failed: ${response.exceptionDetails.text}`);
    return response.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.navigate', {url: expectedOrigin + '/overview'});
  let status = '';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    status = await evaluate("document.querySelector('.connection-indicator')?.innerText || ''");
    if (status.includes(expectUnavailable ? 'Observation unavailable' : 'Current view available')) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (expectUnavailable) {
    if (!status.includes('Observation unavailable')) throw new Error(`Browser did not report unavailable Observation: ${status}`);
    const unavailable = await evaluate(`(() => ({
      bodyText: document.body.innerText,
      claims: document.querySelectorAll('.claim-card').length,
      diagnostic: document.querySelector('.notice')?.innerText || ''
    }))()`);
    if (unavailable.claims !== 0 || !unavailable.diagnostic.includes('READ UNAVAILABLE') ||
        !unavailable.diagnostic.includes('No source-state conclusion')) {
      throw new Error(`Browser did not preserve the bounded unavailable state: ${JSON.stringify(unavailable)}`);
    }
    await evaluate("document.querySelector('#refresh').click()");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const count = requests.filter(request => request.url === expectedOrigin + '/api/observation/current').length;
      const currentStatus = await evaluate("document.querySelector('.connection-indicator')?.innerText || ''");
      if (count >= 2 && currentStatus.includes('Observation unavailable')) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const apiReads = requests.filter(request => request.url === expectedOrigin + '/api/observation/current');
    if (apiReads.length !== 2 || apiReads.some(request => request.method !== 'GET')) {
      throw new Error(`Unavailable-state browser should make exactly two bounded GET reads, observed ${JSON.stringify(apiReads)}`);
    }
    if (requests.some(request => !request.url.startsWith(expectedOrigin))) {
      throw new Error(`Browser contacted a non-same-origin source: ${JSON.stringify(requests)}`);
    }
    console.log('M1_BROWSER_RESULT=' + JSON.stringify({
      status: 'PASS',
      browser_version: version.Browser,
      frontend_origin: expectedOrigin,
      unavailable_state_truthful: true,
      claims_rendered: [],
      read_requests: apiReads,
      non_same_origin_requests: [],
    }));
  } else {
  if (!status.includes('Current view available')) throw new Error(`Browser did not render available publications: ${status}`);
  const firstRead = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.claim-card')];
    return {title: document.title, families: cards.map(card => card.querySelector('h2')?.innerText), cards: cards.map(card => card.innerText), bodyText: document.body.innerText};
  })()`);
  const expectedFamilies = ['embodiment.body_pose', 'environment.finite_scalar_field'];
  if (JSON.stringify(firstRead.families) !== JSON.stringify(expectedFamilies)) {
    throw new Error(`Browser displayed unexpected claim families: ${JSON.stringify(firstRead.families)}`);
  }
  for (const [index, markers] of [
    ['Semantic authority', 'Contract', 'body.acceptance.sensorimotor-v1', 'episode.acceptance.sensorimotor-v1', 'Source lineage'],
    ['Semantic authority', 'Contract', 'environment.acceptance.sensorimotor-v1', 'resource.acceptance.scalar-field-v1', 'Source lineage'],
  ].entries()) {
    for (const marker of markers) if (!firstRead.cards[index].includes(marker)) throw new Error(`Rendered claim ${expectedFamilies[index]} omitted ${marker}`);
  }
  if (!firstRead.bodyText.includes('not a shared snapshot') && !firstRead.bodyText.includes('not joined')) {
    throw new Error('The UI did not retain its non-join limitation copy');
  }
  await evaluate("document.querySelector('#refresh').click()");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const count = requests.filter(request => request.url === expectedOrigin + '/api/observation/current').length;
    const refreshText = await evaluate("document.querySelector('#refresh')?.innerText || ''");
    if (count >= 2 && refreshText.includes('Refresh read')) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const apiReads = requests.filter(request => request.url === expectedOrigin + '/api/observation/current');
  if (apiReads.length !== 2 || apiReads.some(request => request.method !== 'GET')) {
    throw new Error(`Expected exactly two bounded GET reads, observed ${JSON.stringify(apiReads)}`);
  }
  const unexpectedNetwork = requests.filter(request => !request.url.startsWith(expectedOrigin));
  if (unexpectedNetwork.length) throw new Error(`Browser contacted a non-same-origin source: ${JSON.stringify(unexpectedNetwork)}`);
  const result = {
    status: 'PASS',
    browser_version: version.Browser,
    frontend_origin: expectedOrigin,
    claims_rendered: firstRead.families,
    claim_identity_and_provenance_visible: true,
    read_requests: apiReads,
    non_same_origin_requests: unexpectedNetwork,
  };
  console.log('M1_BROWSER_RESULT=' + JSON.stringify(result));
  }
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) browser.kill('SIGTERM');
  frontend.close();
  await once(frontend, 'close').catch(() => {});
  if (!process.env.FRONTEND_BROWSER_PROFILE) await rm(browserProfile, {recursive: true, force: true});
}
