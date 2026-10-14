import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {createFrontendServer} from './frontend-server.js';

const root = resolve(process.env.FRONTEND_ROOT || '.');
const bridgeUrl = process.env.FRONTEND_BRIDGE_URL;
const origin = process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:4173';
const chromeBin = process.env.CHROME_BIN || '/usr/bin/google-chrome';
if (!bridgeUrl?.startsWith('http://127.0.0.1:') || !bridgeUrl.endsWith('/v1/current')) {
  throw new Error('A live loopback Observation current-view bridge is required');
}
const originUrl = new URL(origin);
if (originUrl.protocol !== 'http:' || originUrl.hostname !== '127.0.0.1' || !originUrl.port) {
  throw new Error('Frontend origin must be an explicit loopback HTTP origin');
}

const profile = await mkdtemp(join(tmpdir(), 'biopeia-m1-live-chrome-'));
const frontend = createFrontendServer({root: resolve(root, 'dist'), bridgeUrl});
frontend.listen(Number(originUrl.port), '127.0.0.1');
await once(frontend, 'listening');
let browser;
let socket;
try {
  const cdpUrl = process.env.CHROME_CDP_URL;
  let port;
  if (cdpUrl) {
    port = new URL(cdpUrl).port;
  } else {
    browser = spawn(chromeBin, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'about:blank',
    ], {stdio: 'ignore', detached: true});
    const activePortPath = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100; i += 1) {
      if (browser.exitCode !== null) throw new Error(`Chrome exited early: ${browser.exitCode}`);
      try { port = (await readFile(activePortPath, 'utf8')).split('\n')[0].trim(); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
  }
  if (!port) throw new Error('Chrome did not publish its DevTools endpoint');
  const devtoolsBase = cdpUrl || `http://127.0.0.1:${port}`;
  const versionResponse = await fetch(`${devtoolsBase}/json/version`);
  if (!versionResponse.ok) throw new Error(`Chrome version endpoint returned ${versionResponse.status}`);
  const version = await versionResponse.json();
  const targetResponse = await fetch(`${devtoolsBase}/json/new?${encodeURIComponent(origin + '/overview')}`, {method: 'PUT'});
  if (!targetResponse.ok) throw new Error(`Chrome could not create target: ${targetResponse.status}`);
  const target = await targetResponse.json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, {once: true});
    socket.addEventListener('error', reject, {once: true});
  });
  let nextId = 0;
  const pending = new Map();
  const requests = [];
  const consoleErrors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Network.requestWillBeSent') requests.push({url: message.params.request.url, method: message.params.request.method});
    if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails?.text || 'uncaught browser exception');
    if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) consoleErrors.push(message.params.args.map(arg => arg.value || arg.description || '').join(' '));
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, {resolve, reject});
    socket.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (result.exceptionDetails) throw new Error(`Browser evaluation failed: ${result.exceptionDetails.text}`);
    return result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.navigate', {url: origin + '/overview'});
  if (process.env.BROWSER_READY_PATH) {
    await writeFile(process.env.BROWSER_READY_PATH, JSON.stringify({browser_page_attached_at_utc: new Date().toISOString()}), {flag: 'wx'});
  }
  let connectedAt;
  let lastStatus = '';
  for (let i = 0; i < 1200; i += 1) {
    lastStatus = await evaluate("document.querySelector('.connection-indicator')?.innerText || ''");
    if (lastStatus.includes('Current view available')) { connectedAt = new Date().toISOString(); break; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!connectedAt) throw new Error(`Browser did not connect to the live current-view bridge; last UI status=${JSON.stringify(lastStatus)}`);
  const snapshots = [];
  const polls = [];
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const beforeReads = requests.filter(request => request.url === origin + '/api/observation/current').length;
    await evaluate("document.querySelector('#refresh')?.click()");
    for (let wait = 0; wait < 40; wait += 1) {
      const reads = requests.filter(request => request.url === origin + '/api/observation/current').length;
      if (reads > beforeReads) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const view = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('.claim-card')];
      return {status: document.querySelector('.connection-indicator')?.innerText || '',
        families: cards.map(card => card.querySelector('h2')?.innerText || ''),
        cards: cards.map(card => card.innerText), bodyText: document.body.innerText};
    })()`);
    if (view.status.includes('Current view available') && view.families.length === 2) {
      const allowed = ['embodiment.body_pose', 'environment.finite_scalar_field'];
      if (JSON.stringify(view.families) !== JSON.stringify(allowed)) throw new Error(`Unexpected claim families: ${JSON.stringify(view.families)}`);
      if (!view.bodyText.includes('not joined') && !view.bodyText.includes('not a shared snapshot')) throw new Error('Cross-owner limitation copy was absent');
      const bodyCard = view.cards[0];
      const bodyTick = Number(bodyCard.match(/world\.world_causal_tick = (\d+)/)?.[1]);
      const environmentCard = view.cards[1];
      const bodyLineage = bodyCard.match(/embodiment_state_sha256: ([a-f0-9]{64})/)?.[1] || null;
      const environmentLineage = environmentCard.match(/owner_checkpoint_sha256: ([a-f0-9]{64})/)?.[1] || null;
      if (Number.isSafeInteger(bodyTick)) {
        const poll = {tick: bodyTick, observed_at_utc: new Date().toISOString(),
          body_state_sha256: bodyLineage, environment_checkpoint_sha256: environmentLineage};
        const previous = [...polls].reverse().find(item => item.tick === bodyTick);
        if (previous && (previous.body_state_sha256 !== bodyLineage || previous.environment_checkpoint_sha256 !== environmentLineage)) {
          throw new Error(`A repeated read at World tick ${bodyTick} changed source lineage`);
        }
        polls.push(poll);
        const key = `${bodyTick}:${bodyLineage || ''}:${environmentLineage || ''}`;
        if (!snapshots.some(snapshot => snapshot.key === key)) snapshots.push({key, tick: bodyTick, observed_at_utc: new Date().toISOString(), families: view.families, body_state_sha256: bodyLineage, environment_checkpoint_sha256: environmentLineage});
      }
      if (new Set(snapshots.map(snapshot => snapshot.tick)).size >= 2) break;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const ticks = [...new Set(snapshots.map(snapshot => snapshot.tick))];
  if (ticks.length < 2) throw new Error(`Browser did not render two distinct committed World ticks: ${JSON.stringify(snapshots)}`);
  if (snapshots.some(snapshot => !snapshot.body_state_sha256 || !snapshot.environment_checkpoint_sha256)) throw new Error('Rendered claim lineage digests were missing');
  const apiReads = requests.filter(request => request.url === origin + '/api/observation/current');
  const foreign = requests.filter(request => new URL(request.url).origin !== origin);
  if (apiReads.length < 2 || apiReads.some(request => request.method !== 'GET')) throw new Error(`Expected repeated read-only same-origin GETs, got ${JSON.stringify(apiReads)}`);
  if (foreign.length) throw new Error(`Browser contacted a non-same-origin URL: ${JSON.stringify(foreign)}`);
  if (consoleErrors.length) throw new Error(`Browser reported errors or warnings: ${JSON.stringify(consoleErrors)}`);
  const screenshot = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
  const screenshotBytes = Buffer.from(screenshot.data, 'base64');
  if (!screenshotBytes.length) throw new Error('Browser screenshot was empty');
  const screenshotSha256 = createHash('sha256').update(screenshotBytes).digest('hex');
  await writeFile(join(profile, 'm1-live-browser.png'), screenshotBytes);
  console.log('M1_LIVE_BROWSER_RESULT=' + JSON.stringify({status: 'PASS', browser_version: version.Browser,
    frontend_origin: origin, browser_attached_at_utc: connectedAt, distinct_rendered_ticks: ticks,
    snapshots, polls, approved_claim_families: ['embodiment.body_pose', 'environment.finite_scalar_field'],
    read_requests: apiReads, non_same_origin_requests: foreign, read_only_gets: true,
    screenshot_sha256: screenshotSha256, console_errors_and_warnings: consoleErrors}));
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) {
    try { process.kill(-browser.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await once(browser, 'exit').catch(() => {});
  }
  frontend.close();
  await once(frontend, 'close').catch(() => {});
  await rm(profile, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
}
