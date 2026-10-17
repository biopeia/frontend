import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {createFrontendServer} from './frontend-server.js';

const root = resolve(process.env.FRONTEND_ROOT || '.');
const bridgeUrl = process.env.FRONTEND_BRIDGE_URL;
const archiveUrl = process.env.OBSERVATION_ARCHIVE_URL;
const expectArchive = process.env.FRONTEND_ARCHIVE_ACCEPTANCE === '1';
const origin = process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:4173';
const chromeBin = process.env.CHROME_BIN || '/usr/bin/google-chrome';
if (!bridgeUrl?.startsWith('http://127.0.0.1:') || !bridgeUrl.endsWith('/v1/current')) {
  throw new Error('A live loopback Observation current-view bridge is required');
}
if (expectArchive && (!archiveUrl || !/^http:\/\/127\.0\.0\.1:\d+$/.test(archiveUrl))) {
  throw new Error('Archive browser acceptance requires an explicit loopback Observation archive adapter URL');
}
const originUrl = new URL(origin);
if (originUrl.protocol !== 'http:' || originUrl.hostname !== '127.0.0.1' || !originUrl.port) {
  throw new Error('Frontend origin must be an explicit loopback HTTP origin');
}

const profile = await mkdtemp(join(tmpdir(), 'biopeia-m1-live-chrome-'));
const frontend = createFrontendServer({root: resolve(root, 'dist'), bridgeUrl, ...(archiveUrl ? {archiveUrl} : {})});
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
  const responses = [];
  const consoleErrors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Network.requestWillBeSent') requests.push({requestId: message.params.requestId, url: message.params.request.url, method: message.params.request.method});
    if (message.method === 'Network.responseReceived') responses.push({requestId: message.params.requestId, url: message.params.response.url, status: message.params.response.status, mimeType: message.params.response.mimeType});
    if (message.method === 'Network.loadingFinished') responses.push({requestId: message.params.requestId, finished: true});
    if (message.method === 'Network.loadingFailed') responses.push({requestId: message.params.requestId, failed: message.params.errorText});
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
  await send('Accessibility.enable');
  await send('Network.enable');
  await send('Page.navigate', {url: origin + '/overview'});
  let connectedAt;
  let pageAttachedAt;
  let lastStatus = '';
  for (let i = 0; i < 1200; i += 1) {
    lastStatus = await evaluate("document.querySelector('.connection-indicator')?.innerText || ''");
    const preWorld503 = responses.find(response => response.url === origin + '/api/observation/current' && response.status === 503);
    if (!pageAttachedAt && preWorld503) {
      pageAttachedAt = new Date().toISOString();
      if (process.env.BROWSER_READY_PATH) {
        await writeFile(process.env.BROWSER_READY_PATH, JSON.stringify({browser_page_attached_at_utc: pageAttachedAt, pre_world_unavailable_read: true}), {flag: 'wx'});
      }
    }
    if (lastStatus.includes('Current view available')) { connectedAt = new Date().toISOString(); break; }
    // Model an explicit operator refresh while waiting for the bridge to become live;
    // do not wait for the app's one-second automatic refresh timer during a short run.
    if (['Observation unavailable', 'No retained messages', 'No supported messages'].some(status => lastStatus.includes(status))) {
      await evaluate("document.querySelector('#refresh')?.click()");
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!connectedAt) throw new Error(`Browser did not connect to the live current-view bridge; last UI status=${JSON.stringify(lastStatus)}`);
  const snapshots = [];
  const polls = [];
  const allowedFamilies = ['environment.render_scene', 'embodiment.render_morphology',
    'embodiment.body_pose', 'environment.finite_scalar_field'];
  const captureObservation = view => {
    const unexpected = view.families.filter(family => !allowedFamilies.includes(family));
    const missing = allowedFamilies.filter(family => !view.families.includes(family));
    if (unexpected.length || missing.length) {
      throw new Error(`Unexpected current-view claim families: ${JSON.stringify({unexpected, missing, families: view.families})}`);
    }
    const bodyCard = view.cards[view.families.indexOf('embodiment.body_pose')];
    const environmentCard = view.cards[view.families.indexOf('environment.finite_scalar_field')];
    const bodyTick = Number(bodyCard.match(/world\.world_causal_tick = (\d+)/)?.[1]);
    const bodyLineage = bodyCard.match(/embodiment_state_sha256: ([a-f0-9]{64})/)?.[1] || null;
    const environmentLineage = environmentCard.match(/owner_checkpoint_sha256: ([a-f0-9]{64})/)?.[1] || null;
    if (!Number.isSafeInteger(bodyTick) || !bodyLineage || !environmentLineage) {
      throw new Error('Rendered World tick or owner source-lineage digests were missing');
    }
    const observedAt = new Date().toISOString();
    const key = `${bodyTick}:${bodyLineage}:${environmentLineage}`;
    if (!snapshots.some(snapshot => snapshot.key === key)) snapshots.push({key, tick: bodyTick,
      observed_at_utc: observedAt, families: view.families, body_state_sha256: bodyLineage,
      environment_checkpoint_sha256: environmentLineage});
    const previous = [...polls].reverse().find(item => item.tick === bodyTick);
    if (previous && (previous.body_state_sha256 !== bodyLineage || previous.environment_checkpoint_sha256 !== environmentLineage)) {
      throw new Error(`A repeated read at World tick ${bodyTick} changed source lineage`);
    }
    polls.push({tick: bodyTick, observed_at_utc: observedAt, body_state_sha256: bodyLineage,
      environment_checkpoint_sha256: environmentLineage});
  };
  let lastView;
  // Keep the automatically completed first read; the World session may be short-lived.
  lastView = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.claim-card')];
    return {status: document.querySelector('.connection-indicator')?.innerText || '',
      families: cards.map(card => card.querySelector('h2')?.innerText || ''),
      cards: cards.map(card => card.innerText), bodyText: document.body.innerText};
  })()`);
  if (lastView.status.includes('Current view available')) captureObservation(lastView);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const beforeReads = requests.filter(request => request.url === origin + '/api/observation/current').length;
    await evaluate("document.querySelector('#refresh')?.click()");
    let readRequest;
    for (let wait = 0; wait < 80; wait += 1) {
      readRequest = requests.filter(request => request.url === origin + '/api/observation/current')[beforeReads];
      if (readRequest) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (readRequest) {
      for (let wait = 0; wait < 120; wait += 1) {
        const response = responses.find(item => item.requestId === readRequest.requestId && (item.finished || item.failed));
        if (response) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      for (let wait = 0; wait < 40; wait += 1) {
        const status = await evaluate("document.querySelector('.connection-indicator')?.innerText || ''");
        if (!status.includes('Reading Observation')) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    const view = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('.claim-card')];
      return {status: document.querySelector('.connection-indicator')?.innerText || '',
        families: cards.map(card => card.querySelector('h2')?.innerText || ''),
        cards: cards.map(card => card.innerText), bodyText: document.body.innerText};
    })()`);
    lastView = view;
    if (view.status.includes('Current view available')) {
      if (!view.bodyText.includes('not joined') && !view.bodyText.includes('not a shared snapshot')) throw new Error('Cross-owner limitation copy was absent');
      captureObservation(view);
      if (new Set(snapshots.map(snapshot => snapshot.tick)).size >= 2) break;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const ticks = [...new Set(snapshots.map(snapshot => snapshot.tick))];
  if (ticks.length < 2) throw new Error(`Browser did not render two distinct committed World ticks: ${JSON.stringify({snapshots, lastView, apiRequests: requests.filter(request => request.url.includes('/api/observation/current'))})}`);
  if (snapshots.some(snapshot => !snapshot.body_state_sha256 || !snapshot.environment_checkpoint_sha256)) throw new Error('Rendered claim lineage digests were missing');
  const apiReads = requests.filter(request => request.url === origin + '/api/observation/current');
  const foreign = requests.filter(request => new URL(request.url).origin !== origin);
  if (apiReads.length < 2 || apiReads.some(request => request.method !== 'GET')) throw new Error(`Expected repeated read-only same-origin GETs, got ${JSON.stringify(apiReads)}`);
  if (foreign.length) throw new Error(`Browser contacted a non-same-origin URL: ${JSON.stringify(foreign)}`);
  const initialAx = await send('Accessibility.getFullAXTree');
  const initialAxLabels = initialAx.nodes.map(node => node.name?.value).filter(Boolean);
  for (const label of ['Skip to main content', 'Toggle navigation', 'Refresh current Observation snapshot']) {
    if (!initialAxLabels.includes(label)) throw new Error(`Browser accessibility tree omitted the accessible name ${JSON.stringify(label)}; observed ${JSON.stringify(initialAxLabels)}`);
  }
  let archiveResult = null;
  if (expectArchive) {
    const archiveReads = () => requests.filter(request => request.url.startsWith(origin + '/api/observation/archive/'));
    await evaluate("document.querySelector('a[href=\"/archive-receipts\"]')?.click()");
    const waitFor = async (predicate, label) => {
      for (let i = 0; i < 200; i += 1) {
        const value = await evaluate(predicate);
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(`Archive browser acceptance timed out waiting for ${label}`);
    };
    const initialArchive = await waitFor("(() => { const m=document.querySelector('#archive-metadata')?.innerText||''; const r=document.querySelector('#archive-results')?.innerText||''; return m.includes('captures') && !m.includes('Reading local capture catalog') && !r.includes('Reading bounded local archive receipts…') ? {metadata:m, receipts:r} : null; })()", 'capture catalog and receipt page');
    const archiveAx = await send('Accessibility.getFullAXTree');
    const archiveAxLabels = archiveAx.nodes.map(node => node.name?.value).filter(Boolean);
    for (const label of ['Owner', 'Family', 'Revision', 'Apply filters']) {
      if (!archiveAxLabels.includes(label)) throw new Error(`Archive browser accessibility tree omitted ${JSON.stringify(label)}`);
    }
    const captureButtons = await evaluate("[...document.querySelectorAll('[data-archive-coverage]')].map(button=>button.getAttribute('data-archive-coverage'))");
    const receiptCards = await evaluate("[...document.querySelectorAll('#archive-results .panel')].map(card=>card.innerText)");
    if (!captureButtons.length || !receiptCards.length) throw new Error('Archive browser acceptance requires a real non-empty capture catalog and receipt page');
    await evaluate("document.querySelector('[data-archive-coverage]')?.click()");
    const coverage = await waitFor("(() => { const value=document.querySelector('#archive-coverage')?.innerText||''; return value.includes('Closure verified:') ? value : null; })()", 'selected capture coverage');
    if (!coverage.includes('not all World history') || /world_run_id|causal tick/i.test(coverage)) throw new Error(`Archive coverage presentation exceeded its bounded claim: ${coverage}`);
    const filterBefore = archiveReads().length;
    const filterState = await evaluate(`(() => {
      const card=document.querySelector('#archive-results .panel');
      const text=card?.innerText||'';
      const family=card?.querySelector('strong')?.innerText||'';
      const owner=text.match(/Authority:\\s*([^\\s]+)/)?.[1]||'';
      const revision=text.match(/Revision:\\s*([^\\s]+)/)?.[1]||'';
      return {owner,family,revision};
    })()`);
    if (!filterState.owner || !filterState.family || !filterState.revision) throw new Error('Archive receipt card omitted supported filter fields');
    await evaluate(`(() => {
      const form=document.querySelector('#archive-filter-form');
      form.elements.namedItem('owner').value=${JSON.stringify(filterState.owner)};
      form.elements.namedItem('family').value=${JSON.stringify(filterState.family)};
      form.elements.namedItem('revision').value=${JSON.stringify(filterState.revision)};
      form.elements.namedItem('owner').focus();
    })()`);
    await send('Input.dispatchKeyEvent', {type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, nativeVirtualKeyCode:13});
    await send('Input.dispatchKeyEvent', {type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, nativeVirtualKeyCode:13});
    const filteredReceipts = await waitFor("(() => { const result=document.querySelector('#archive-results')?.innerText||''; return result.includes('receipts in this page') && !result.includes('Reading bounded local archive receipts…') ? result : null; })()", 'filtered receipt page');
    const capturedArchiveReads = archiveReads();
    if (capturedArchiveReads.length <= filterBefore || capturedArchiveReads.some(request => request.method !== 'GET')) {
      throw new Error(`Archive UI did not issue a bounded same-origin read-only filter request: ${JSON.stringify(capturedArchiveReads)}`);
    }
    const filteredRequest = capturedArchiveReads.at(-1);
    const filteredUrl = new URL(filteredRequest.url);
    if (filteredUrl.searchParams.get('owner') !== filterState.owner || filteredUrl.searchParams.get('family') !== filterState.family ||
        filteredUrl.searchParams.get('revision') !== filterState.revision || filteredUrl.searchParams.get('limit') !== '25') {
      throw new Error(`Archive filters or page bound were not forwarded exactly: ${filteredRequest.url}`);
    }
    const beforeNextPage = capturedArchiveReads.length;
    const hasNextPage = await evaluate("Boolean(document.querySelector('#archive-next'))");
    if (hasNextPage) {
      await evaluate("document.querySelector('#archive-next').click()");
      await waitFor("(() => { const result=document.querySelector('#archive-results')?.innerText||''; return result.includes('receipts in this page') && !result.includes('Reading bounded local archive receipts…'); })()", 'next bounded receipt page');
      const nextRequest = archiveReads().slice(beforeNextPage).find(request => request.url.includes('/receipts?'));
      if (!nextRequest || new URL(nextRequest.url).searchParams.get('after') === '0') {
        throw new Error('Archive next-page control did not advance the receipt cursor');
      }
    }
    const archiveForeign = requests.filter(request => new URL(request.url).origin !== origin);
    if (archiveForeign.length) throw new Error(`Archive browser contacted a non-same-origin URL: ${JSON.stringify(archiveForeign)}`);
    archiveResult = {capture_count: captureButtons.length, initial_receipt_count: receiptCards.length,
      coverage_inspected: true, filtered_results_rendered: true, keyboard_filter_submission: true,
      accessible_filter_names: ['Owner', 'Family', 'Revision', 'Apply filters'], same_origin_gets: capturedArchiveReads,
      bounded_coverage_copy: coverage.includes('not all World history'), filtered_status: filteredReceipts.match(/[^\n]*/)?.[0]};
  }
  if (consoleErrors.length) throw new Error(`Browser reported errors or warnings: ${JSON.stringify(consoleErrors)}`);
  const screenshot = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
  const screenshotBytes = Buffer.from(screenshot.data, 'base64');
  if (!screenshotBytes.length) throw new Error('Browser screenshot was empty');
  const screenshotSha256 = createHash('sha256').update(screenshotBytes).digest('hex');
  await writeFile(join(profile, 'm1-live-browser.png'), screenshotBytes);
  console.log('M1_LIVE_BROWSER_RESULT=' + JSON.stringify({status: 'PASS', browser_version: version.Browser,
    frontend_origin: origin, browser_attached_at_utc: pageAttachedAt, first_live_read_at_utc: connectedAt, distinct_rendered_ticks: ticks,
    snapshots, polls, approved_claim_families: allowedFamilies,
    read_requests: apiReads, non_same_origin_requests: foreign, read_only_gets: true,
    archive_acceptance: archiveResult,
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
