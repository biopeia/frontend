import {archiveIntervals} from './archive-intervals.js';
import {fetchCurrentObservation, ObservationReadError} from './observation-client.js';
import {createSnapshotRefresh} from './snapshot-refresh.js';
import {createObservationStore} from './observation-store.js';
import {createPresentationScheduler} from './presentation-scheduler.js';
import {renderScreen} from './views.js';
import {mountSpatialExplorer} from './spatial-renderer.js';
import {createSpatialRenderController} from './spatial-render-controller.js';
import './style.css';
import {ROUTES, initialSource, routeFromPath} from './model.js';

const app = document.getElementById('app');
const initialTheme = localStorage.getItem('biopeia-theme');
let theme = initialTheme === 'light' || initialTheme === 'dark' ? initialTheme : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
let session = {status:'unknown'};
let menuOpen = false;
let shellMounted = false;
let selectedClaimFamily = '';
const spatialRenderController = createSpatialRenderController({mount: mountSpatialExplorer});

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function getRoute() { return routeFromPath(location.pathname); }
function statusText(source) {
  return ({'not-configured':'Not connected', loading:'Reading Observation', available: source.stale ? 'Last known view · stale' : 'Current view available',
    empty:'No retained messages', unsupported:'No supported messages', denied:'Read denied', unavailable:'Observation unavailable',
    disconnected:'Bridge disconnected', error:'Invalid response', stale:'Last known view · stale'})[source.status] ?? 'Availability unknown';
}
function sessionPanel(value) {
  const labels = {running:'World session active', completed:'World session completed', stopped:'World session stopped', failed:'World session failed', unknown:'World session status unknown'};
  const freshness = value.status === 'unknown' ? ' · last known, not re-verified' : '';
  const cut = Number.isInteger(value.last_verified_committed_tick) ? ` · ${value.status === 'unknown' ? 'last known confirmed tick' : 'last confirmed tick'} ${value.last_verified_committed_tick}` : '';
  const identity = value.world_id ? `${escapeHtml(value.world_id)} · ${escapeHtml(value.run_id ?? '')}${freshness} · Observation claims are not joined to this session.` : 'Lifecycle is separate from Observation connection and read availability; no claim-to-session join is established.';
  return `<strong>${labels[value.status] ?? labels.unknown}</strong><span>${identity}${escapeHtml(cut)}</span>`;
}
function notice(source) {
  if (source.stale && source.claims.length) {
    return `<strong>LAST KNOWN · STALE</strong><span>The last validated Observation snapshot is retained in memory. A later read failed (${escapeHtml(source.unavailableStatus ?? 'unavailable')}); its source freshness is not established.</span>`;
  }
  const messages = {
    'not-configured':['NOT CONNECTED','No authorized Observation source is configured. Nothing here asserts actual World, Organism or experiment state.'],
    loading:['READING CURRENT VIEW','A bounded, read-only snapshot request is in progress. Snapshots do not preserve missed intermediate publications or establish source freshness.'],
    available:['BOUNDED CURRENT VIEW','Claims are shown separately with their source authority and provenance. Delivery sequence is not causal time; no cross-owner snapshot is implied.'],
    empty:['EMPTY RETAINED SUBSET','Observation returned no messages in this bounded current subset. This is not evidence that source state or publications are absent.'],
    unsupported:['NO SUPPORTED CLAIMS','The current subset contains no claim family supported by this frontend slice. This does not imply source absence.'],
    denied:['READ DENIED','The current-view read was denied. This is not evidence of source-state absence.'],
    unavailable:['READ UNAVAILABLE','The Observation endpoint did not provide a usable current view. No source-state conclusion is made.'],
    disconnected:['BRIDGE DISCONNECTED','The local Observation bridge could not be reached. No source-state conclusion is made.'],
    error:['RESPONSE WITHHELD','The Observation response failed validation and was not displayed.'],
  };
  const [title, description] = messages[source.status] ?? ['AVAILABILITY UNKNOWN','The source state is not established.'];
  return `<strong>${title}</strong><span>${description}</span>`;
}
function sidebar(route, source) {
  return `<aside class="sidebar ${menuOpen ? 'open' : ''}" aria-label="Primary navigation"><a href="/worlds" data-nav class="brand" aria-label="Biopeia Worlds and Runs"><span class="brandmark brand-logo" aria-hidden="true">B</span><span><strong>BIOPEIA</strong><small>OBSERVATION</small></span></a><div class="nav-label">EXPLORE</div><nav aria-label="Biopeia observatory screens">${ROUTES.map((r,i)=>`<a data-nav href="${r.path}" ${route.path===r.path?'aria-current="page"':''}><span class="nav-numeral">0${i+1}</span><span>${r.label}</span></a>`).join('')}</nav><div class="sidebar-footer"><span class="status-dot" aria-hidden="true"></span><span id="sidebar-status">${escapeHtml(statusText(source))}</span><p>Passive visualization only</p></div></aside>`;
}
function lastChecked(source) {
  const raw = source.lastCheckedAt ?? source.lastAttemptAt;
  if (!raw) return '<span class="fine" id="last-checked">Not checked yet</span>';
  const checkedAt = new Date(raw);
  if (!Number.isFinite(checkedAt.getTime())) return '<span class="fine" id="last-checked">Local check time unavailable</span>';
  const display = new Intl.DateTimeFormat(undefined, {hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(checkedAt);
  return `<span class="fine" id="last-checked" title="Local browser request completion time; not source time or freshness">${source.stale?'Last valid view (local)':'Last checked (local)'}: <time datetime="${checkedAt.toISOString()}">${escapeHtml(display)}</time></span>`;
}
function compatibleNode(current, next) {
  if (current.nodeType !== next.nodeType) return false;
  if (current.nodeType === Node.ELEMENT_NODE && current.tagName !== next.tagName) return false;
  if (current.nodeType === Node.ELEMENT_NODE && current.dataset.key !== next.dataset.key && (current.dataset.key || next.dataset.key)) return false;
  return true;
}
function patchNode(current, next) {
  if (current.nodeType === Node.TEXT_NODE || current.nodeType === Node.COMMENT_NODE) {
    if (current.data !== next.data) current.data = next.data;
    return;
  }
  for (const attribute of [...current.attributes]) {
    if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  }
  for (const attribute of [...next.attributes]) {
    if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  }
  patchChildren(current, next);
}
function patchChildren(current, next) {
  const nextChildren = [...next.childNodes];
  const keyed = new Map();
  for (const child of current.children) {
    if (!child.dataset.key) continue;
    const queue = keyed.get(child.dataset.key) ?? [];
    queue.push(child);
    keyed.set(child.dataset.key, queue);
  }
  let cursor = current.firstChild;
  for (const nextChild of nextChildren) {
    const key = nextChild.nodeType === Node.ELEMENT_NODE ? nextChild.dataset.key : undefined;
    let currentChild = key ? keyed.get(key)?.shift() : cursor;
    if (currentChild && !compatibleNode(currentChild, nextChild)) currentChild = null;
    if (!currentChild) {
      currentChild = nextChild.cloneNode(true);
      current.insertBefore(currentChild, cursor);
    } else {
      if (currentChild !== cursor) current.insertBefore(currentChild, cursor);
      patchNode(currentChild, nextChild);
    }
    cursor = currentChild.nextSibling;
  }
  while (cursor) { const nextSibling = cursor.nextSibling; cursor.remove(); cursor = nextSibling; }
}
function patchHtml(current, html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  patchChildren(current, template.content);
}

async function archiveReadFailure(response, label) {
  const failure = await response.json().catch(() => ({}));
  const reason = typeof failure.status === 'string' ? failure.status :
    typeof failure.error === 'string' ? failure.error : 'unknown';
  return new Error(label + ' (' + response.status + ', ' + reason + ')');
}
let archiveCaptureCatalog = null;
let archiveCoverage = null;
let archiveMetadataToken = 0;
let archiveCoverageToken = 0;
async function readArchiveMetadata() {
  const token = ++archiveMetadataToken;
  const target = document.querySelector('#archive-metadata');
  if (!target) return;
  target.textContent = 'Reading local capture catalog…';
  try {
    const response = await fetch('/api/observation/archive/captures', {cache:'no-store',credentials:'same-origin'});
    if (!response.ok) throw await archiveReadFailure(response, 'Capture catalog unavailable');
    const catalog = await response.json();
    if (catalog.schema !== 'biopeia.observation.archive-http.v1' || !Array.isArray(catalog.captures)) throw new Error('Unsupported capture catalog');
    if (token !== archiveMetadataToken || !target.isConnected || getRoute().path !== '/archive-receipts') return;
    archiveCaptureCatalog = catalog;
    archiveCoverage = null;
    target.innerHTML = '<p class="fine">Capture intervals are local Observation archive metadata, not complete World run history.</p>' +
      '<p role="status">' + escapeHtml(catalog.status) + ' · ' + catalog.captures.length + ' captures</p>' +
      '<div class="claim-grid">' + catalog.captures.map(s => '<article class="panel"><div class="panel-body"><strong>Capture ' + escapeHtml(s.capture_id) +
      '</strong><p>Status: ' + escapeHtml(s.status) + '</p><p>Source sequence interval: ' +
      escapeHtml(s.initial_source_sequence ?? 'not asserted') + ' – ' + escapeHtml(s.final_source_sequence ?? 'not asserted') +
      '</p><button type="button" data-archive-coverage="' + escapeHtml(s.capture_id) + '">Inspect coverage for capture ' + escapeHtml(s.capture_id) + '</button></div></article>').join('') + '</div>' +
      '<div id="archive-coverage" role="status">Select a capture to inspect bounded coverage.</div>';
  } catch (error) {
    if (token === archiveMetadataToken && target.isConnected && getRoute().path === '/archive-receipts') target.textContent = error.message;
  }
}
async function readArchiveCoverage(captureId) {
  const token = ++archiveCoverageToken;
  const target = document.querySelector('#archive-coverage');
  if (!target || !archiveCaptureCatalog?.captures.some(c => c.capture_id === captureId)) return;
  target.textContent = 'Reading declared capture coverage…';
  try {
    const response = await fetch('/api/observation/archive/coverage?capture_id=' + encodeURIComponent(captureId), {cache:'no-store',credentials:'same-origin'});
    if (!response.ok) throw await archiveReadFailure(response, 'Coverage unavailable');
    const payload = await response.json();
    if (payload.schema !== 'biopeia.observation.archive-http.v1' || !('coverage' in payload)) throw new Error('Unsupported coverage response');
    if (token !== archiveCoverageToken || !target.isConnected || getRoute().path !== '/archive-receipts') return;
    archiveCoverage = payload;
    const coverage = payload.coverage;
    target.innerHTML = coverage ? '<p><strong>Capture ' + escapeHtml(coverage.capture_id) + '</strong> · ' + escapeHtml(coverage.status) +
      '</p><p>Closure verified: ' + escapeHtml(coverage.closure_verified) + ' · Declared interval complete: ' +
      escapeHtml(coverage.complete) + '</p><p>Received not persisted: ' + archiveIntervals(coverage.received_not_persisted, true) +
      ' · Known source gaps: ' + archiveIntervals(coverage.known_source_gaps, true) +
      ' · Unverifiable intervals: ' + archiveIntervals(coverage.unverifiable_intervals) +
      '</p><p class="fine">These flags concern only the declared capture interval, not all World history.</p>' :
      '<p>Coverage not available for this capture. No completeness is inferred.</p>';
  } catch (error) {
    if (token === archiveCoverageToken && target.isConnected && getRoute().path === '/archive-receipts') target.textContent = error.message;
  }
}
let archivePage = null;
let archiveRequestToken = 0;
async function readArchive(after = 0) {
  const token = ++archiveRequestToken;
  const target = document.querySelector('#archive-history');
  if (!target) return;
  target.textContent = 'Reading bounded local archive receipts…';
  try {
    const response = await fetch('/api/observation/archive/receipts?limit=25&after=' + after, {cache:'no-store',credentials:'same-origin'});
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      const reason = typeof failure.status === 'string' ? failure.status : typeof failure.error === 'string' ? failure.error : 'archive_unavailable';
      throw new Error('Archive read unavailable (' + response.status + ', ' + reason + ')');
    }
    const payload = await response.json();
    if (payload.schema !== 'biopeia.observation.archive-http.v1' || !Array.isArray(payload.receipts) ||
        typeof payload.has_more !== 'boolean' || !Number.isSafeInteger(payload.next_after_receipt_sequence)) throw new Error('Unsupported archive response');
    if (token !== archiveRequestToken || !target.isConnected || getRoute().path !== '/archive-receipts') return;
    archivePage = payload;
    target.innerHTML = '<p class="fine">Local receipt order only; not World causal time or proof of complete history. No World/run join is inferred.</p>' +
      '<p role="status">' + escapeHtml(payload.status) + ' · ' + payload.receipts.length + ' receipts in this page</p>' +
      '<div class="claim-grid">' + payload.receipts.map(r => '<article class="panel"><div class="panel-body">' +
        '<strong>' + escapeHtml(r.family) + '</strong><p>Authority: ' + escapeHtml(r.authority) +
        ' · Revision: ' + escapeHtml(r.revision) + '</p><p>Local receipt: ' + escapeHtml(r.receipt_sequence) +
        ' · Capture: ' + escapeHtml(r.capture_id ?? 'not asserted') + ' · Source delivery: ' +
        escapeHtml(r.source_sequence ?? 'not asserted') + '</p><p class="fine">Digest: ' +
        escapeHtml(r.content_sha256) + '</p></div></article>').join('') + '</div>' +
      (payload.has_more ? '<button type="button" id="archive-next">Next receipt page</button>' : '<p class="fine">No further receipts in this bounded query; this does not establish complete source history.</p>');
  } catch (error) {
    if (token === archiveRequestToken && target.isConnected && getRoute().path === '/archive-receipts') {
      target.textContent = error.message + '. The current-view data remains independent.';
    }
  }
}

function renderRoute(source = observationStore.getState()) {
  const route = getRoute();
  document.title = `${route.label} · Biopeia`;
  document.querySelector('#page-title').textContent = route.title;
  document.querySelector('#page-intro').textContent = route.intro;
  document.querySelectorAll('a[data-nav]').forEach(link => {
    if (link.closest('nav')) {
      if (link.getAttribute('href') === route.path) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    }
  });
  renderObservationScreen(route, source, {replaceRoute: true});
  if (route.path === '/archive-receipts') { void readArchive(0); void readArchiveMetadata(); }
}
function renderObservationScreen(route, source, {replaceRoute = false} = {}) {
  const screen = document.querySelector('#observation-screen');
  const focusedLink = screen?.contains(document.activeElement) ? document.activeElement.closest('a[href]') : null;
  const focusHref = focusedLink?.getAttribute('href');
  const scrollY = window.scrollY;
  const selection = window.getSelection();
  const selectedText = selection && !selection.isCollapsed ? {
    anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode, focusOffset: selection.focusOffset,
  } : null;
  const next = renderScreen(route, source, {claimFamily: selectedClaimFamily});
  if (screen) {
    if (replaceRoute || !screen.querySelector('[data-observation-region]')) {
      patchHtml(screen, next);
    } else {
      // Snapshot changes patch only explicitly data-dependent regions. Static
      // route content is not traversed or reconciled on each Observation read.
      const template = document.createElement('template');
      template.innerHTML = next;
      const nextRegions = new Map([...template.content.querySelectorAll('[data-observation-region]')]
        .map(region => [region.dataset.observationRegion, region]));
      for (const region of screen.querySelectorAll('[data-observation-region]')) {
        const replacement = nextRegions.get(region.dataset.observationRegion);
        if (replacement) patchHtml(region, replacement.innerHTML);
      }
    }
  }
  if (focusHref) screen.querySelector(`a[href="${CSS.escape(focusHref)}"]`)?.focus({preventScroll:true});
  if (selectedText && screen.contains(selectedText.anchorNode) && screen.contains(selectedText.focusNode)) {
    const bound = (node, offset) => Math.min(offset, node.nodeType === Node.TEXT_NODE ? node.length : node.childNodes.length);
    window.getSelection()?.setBaseAndExtent(selectedText.anchorNode, bound(selectedText.anchorNode, selectedText.anchorOffset), selectedText.focusNode, bound(selectedText.focusNode, selectedText.focusOffset));
  }
  if (route.path === '/spatial') {
    const spatial = screen?.querySelector('#spatial-explorer');
    if (spatial) {
      const environmentClaim = singleSpatialClaimRecord(source, 'environment.render_scene');
      const embodimentClaim = singleSpatialClaimRecord(source, 'embodiment.render_morphology');
      const environment = environmentClaim?.value ?? null;
      const embodiment = embodimentClaim?.value ?? null;
      const renderPose = singleSpatialClaim(source, 'embodiment.render_link_pose');
      // Mount is asynchronous (digest validation and WebGL setup). Reconcile
      // the newest view once it resolves rather than dropping refreshes while
      // initialization is in flight. Detached route nodes are never updated.
      spatialRenderController.reconcile(spatial, {environment, embodiment, renderPose, environmentClaim, embodimentClaim, stale:source.stale, status:source.status});
      const evidence = screen.querySelector('#spatial-evidence-status');
      const hasSpatial = Boolean(environment || embodiment);
      if (evidence) evidence.textContent = source.stale
        ? 'Last validated spatial projections retained in memory · stale; current source availability is not established.'
        : source.status === 'available' && hasSpatial
          ? 'Current bounded Observation read; claims remain separate and no shared causal scene is implied.'
          : 'No validated spatial descriptor is present in the retained Observation subset.';
    }
  }
  if (window.scrollY !== scrollY) window.scrollTo(window.scrollX, scrollY);
}
function singleSpatialClaim(source, family) {
  const matches = source.claims.filter(claim => claim.family === family);
  return matches.length === 1 ? matches[0].value : null;
}
function singleSpatialClaimRecord(source, family) {
  const matches = source.claims.filter(claim => claim.family === family);
  return matches.length === 1 ? matches[0] : null;
}
function renderShell(source) {
  const route = getRoute();
  document.documentElement.dataset.theme = theme;
  document.title = `${route.label} · Biopeia`;
  app.innerHTML = `<a class="skip-link" href="#content">Skip to main content</a><div class="app-shell">${sidebar(route, source)}<div class="app-main"><header class="topbar"><button type="button" class="menu-button" id="menu" aria-label="Toggle navigation" aria-expanded="${menuOpen}">☰</button><span>Independent observation workspace</span><div class="top-actions"><span id="connection-indicator" class="connection-indicator" aria-live="polite">● ${escapeHtml(statusText(source))}</span>${lastChecked(source)}<button id="refresh" type="button" aria-label="Refresh current Observation snapshot">Refresh read</button><button id="theme" type="button" aria-label="Switch to ${theme==='light'?'dark':'light'} theme">${theme==='light'?'Dark':'Light'} theme</button></div></header><main id="content" tabindex="-1"><div class="page-heading"><div><div class="eyebrow">BIOPEIA / OBSERVATION</div><h1 id="page-title"></h1><p id="page-intro"></p></div><span class="mode-chip">V2 CANDIDATE · READ ONLY</span></div><div class="notice" id="session-panel" role="status" aria-live="polite">${sessionPanel(session)}</div><div class="notice" id="observation-notice" role="status" aria-live="polite">${notice(source)}</div><div id="observation-screen"></div><footer>Biopeia · Independent passive presentation · No causal controls · No experimental evidence admission</footer></main></div></div>`;
  renderRoute(source);
  shellMounted = true;
}
function updateStatus(source) {
  const indicator = document.querySelector('#connection-indicator');
  if (indicator) indicator.textContent = `● ${statusText(source)}`;
  const sidebar = document.querySelector('#sidebar-status');
  if (sidebar) sidebar.textContent = statusText(source);
  const checked = document.querySelector('#last-checked');
  const nextChecked = lastChecked(source);
  if (checked && nextChecked.includes('id="last-checked"')) checked.outerHTML = nextChecked;
  const refresh = document.querySelector('#refresh');
  // Keep the visible label stable: changing it on every current-view request
  // can wrap the button and shift the top bar while the page is being read.
  // Expose request activity to assistive technology without changing layout.
  if (refresh) refresh.setAttribute('aria-busy', String(source.isRefreshing));
  const note = document.querySelector('#observation-notice');
  const nextNotice = notice(source);
  if (note && note.innerHTML !== nextNotice) note.innerHTML = nextNotice;
}

const observationStore = createObservationStore({initialState: initialSource});

function mount() {
  if (shellMounted) return;
  renderShell(observationStore.getState());
  app.addEventListener('change', event => {
    if (event.target?.id !== 'claim-family-filter') return;
    selectedClaimFamily = event.target.value;
    const route = getRoute();
    if (route.path === '/archive-receipts') return;
    renderRoute();
  });
  app.addEventListener('click', event => {
    const navLink = event.target.closest('a[data-nav]');
    if (navLink) {
      if (event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0) return;
      event.preventDefault();
      history.pushState({},'',navLink.getAttribute('href'));
      menuOpen = false;
      document.querySelector('.sidebar').classList.remove('open');
      document.querySelector('#menu').setAttribute('aria-expanded','false');
      renderRoute();
      document.getElementById('content').focus();
      return;
    }
    const coverageButton = event.target.closest('[data-archive-coverage]');
    if (coverageButton) { void readArchiveCoverage(coverageButton.getAttribute('data-archive-coverage')); return; }
    if (event.target.closest('#archive-next')) {
      if (archivePage?.has_more) void readArchive(archivePage.next_after_receipt_sequence);
      return;
    }
    if (event.target.closest('#theme')) {
      theme = theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('biopeia-theme',theme);
      document.documentElement.dataset.theme = theme;
      event.target.closest('#theme').textContent = theme === 'light' ? 'Dark theme' : 'Light theme';
      event.target.closest('#theme').setAttribute('aria-label',`Switch to ${theme==='light'?'dark':'light'} theme`);
    } else if (event.target.closest('#menu')) {
      menuOpen = !menuOpen;
      document.querySelector('.sidebar').classList.toggle('open',menuOpen);
      document.querySelector('#menu').setAttribute('aria-expanded',String(menuOpen));
    } else if (event.target.closest('#refresh')) void refreshController.refresh();
  });
}

const statusPresentation = createPresentationScheduler(updateStatus);
const dataPresentation = createPresentationScheduler((_selected, source) => {
  if (shellMounted) renderObservationScreen(getRoute(),source);
});
observationStore.subscribe(source => `${source.status}|${source.stale}|${source.isRefreshing}|${source.lastCheckedAt}|${source.lastAttemptAt}|${source.unavailableStatus}`, (_selected, source) => statusPresentation.schedule(source));
observationStore.subscribe(source => JSON.stringify([source.claims,source.scope,source.status,source.stale]), (selected, source) => dataPresentation.schedule(selected, source));
observationStore.subscribe(source => source, () => { if (!shellMounted) mount(); });

mount();

const refreshController = createSnapshotRefresh({
  store: observationStore,
  readSnapshot: async ({signal} = {}) => {
    try { return await fetchCurrentObservation({signal}); }
    catch (error) { throw error instanceof ObservationReadError ? error : new ObservationReadError('error','Observation response could not be read'); }
  },
});

window.addEventListener('popstate', () => { menuOpen = false; renderRoute(); });
refreshController.start();

let sessionReadInFlight = false;
async function refreshSession() {
  if (sessionReadInFlight) return;
  sessionReadInFlight = true;
  try {
    const response = await fetch('/api/session/status',{headers:{Accept:'application/json'},cache:'no-store'});
    if (!response.ok) throw new Error('session status unavailable');
    const value = await response.json();
    if (!['running','completed','stopped','failed'].includes(value.status)) throw new Error('invalid session status');
    if (JSON.stringify(value) !== JSON.stringify(session)) {
      session = value;
      const panel = document.querySelector('#session-panel');
      if (panel) panel.innerHTML = sessionPanel(session);
    }
  } catch {
    if (session.status !== 'unknown') {
      session = {...session,status:'unknown'};
      const panel = document.querySelector('#session-panel');
      if (panel) panel.innerHTML = sessionPanel(session);
    }
  } finally {
    sessionReadInFlight = false;
  }
}
void refreshSession();
window.setInterval(() => void refreshSession(),1000);
