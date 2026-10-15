import {fetchCurrentObservation, ObservationReadError} from './observation-client.js';
import {createSnapshotRefresh} from './snapshot-refresh.js';
import {renderScreen} from './views.js';
import './style.css';
import {ROUTES, initialSource, routeFromPath} from './model.js';

const app = document.getElementById('app');
const initialTheme = localStorage.getItem('biopeia-theme');
let theme = initialTheme === 'light' || initialTheme === 'dark' ? initialTheme : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
let source = initialSource;
let session = {status:'unknown'};
let menuOpen = false;

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function getRoute() { return routeFromPath(location.pathname); }
function statusText() {
  return ({
    'not-configured': 'Not connected', loading: 'Reading Observation', available: 'Current view available',
    empty: 'No retained messages', unsupported: 'No supported messages', denied: 'Read denied',
    unavailable: 'Observation unavailable', disconnected: 'Bridge disconnected', error: 'Invalid response',
  })[source.status] ?? 'Availability unknown';
}
function sessionPanel() {
  const labels = {running:'World session active', completed:'World session completed', stopped:'World session stopped', failed:'World session failed', unknown:'World session status unknown'};
  const cut = Number.isInteger(session.last_verified_committed_tick) ? ` · last confirmed tick ${session.last_verified_committed_tick}` : '';
  return `<div class="notice" role="status" aria-live="polite"><strong>${labels[session.status] ?? labels.unknown}</strong><span>${session.world_id ? `${escapeHtml(session.world_id)} · ${escapeHtml(session.run_id ?? '')}` : 'Lifecycle is separate from Observation connection and read availability.'}${escapeHtml(cut)}</span></div>`;
}
function notice() {
  const messages = {
    'not-configured': ['NOT CONNECTED', 'No authorized Observation source is configured. Nothing here asserts actual World, Organism or experiment state.'],
    loading: ['READING CURRENT VIEW', 'A bounded, read-only snapshot request is in progress. Snapshots do not preserve missed intermediate publications or establish source freshness.'],
    available: ['BOUNDED CURRENT VIEW', 'Claims are shown separately with their source authority and provenance. Delivery sequence is not causal time; no cross-owner snapshot is implied.'],
    empty: ['EMPTY RETAINED SUBSET', 'Observation returned no messages in this bounded current subset. This is not evidence that source state or publications are absent.'],
    unsupported: ['NO SUPPORTED CLAIMS', 'The current subset contains no claim family supported by this frontend slice. This does not imply source absence.'],
    denied: ['READ DENIED', 'The current-view read was denied. This is not evidence of source-state absence.'],
    unavailable: ['READ UNAVAILABLE', 'The Observation endpoint did not provide a usable current view. No source-state conclusion is made.'],
    disconnected: ['BRIDGE DISCONNECTED', 'The local Observation bridge could not be reached. No source-state conclusion is made.'],
    error: ['RESPONSE WITHHELD', 'The Observation response failed validation and was not displayed.'],
  };
  const [title, description] = messages[source.status] ?? ['AVAILABILITY UNKNOWN', 'The source state is not established.'];
  return `<div class="notice" role="status" aria-live="polite"><strong>${title}</strong><span>${description}</span></div>`;
}
function sidebar(route) {
  return `<aside class="sidebar ${menuOpen ? 'open' : ''}" aria-label="Primary navigation"><a href="/worlds" data-nav class="brand" aria-label="Biopeia Worlds and Runs"><span class="brandmark">◈</span><span><strong>BIOPEIA</strong><small>OBSERVATION</small></span></a><div class="nav-label">EXPLORE</div><nav aria-label="Seven peer-level screens">${ROUTES.map((r,i)=>`<a data-nav href="${r.path}" ${route.path===r.path?'aria-current="page"':''}><span class="nav-numeral">0${i+1}</span><span>${r.label}</span></a>`).join('')}</nav><div class="sidebar-footer"><span class="status-dot" aria-hidden="true"></span><span>${escapeHtml(statusText())}</span><p>Passive visualization only</p></div></aside>`;
}
function screen(route) { return renderScreen(route, source); }
function lastChecked() {
  if (!source.lastCheckedAt) return '<span class="fine">Not checked yet</span>';
  const checkedAt = new Date(source.lastCheckedAt);
  if (!Number.isFinite(checkedAt.getTime())) return '<span class="fine">Local check time unavailable</span>';
  const display = new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(checkedAt);
  return `<span class="fine" title="Local browser request completion time; not source time or freshness">Last checked (local): <time datetime="${checkedAt.toISOString()}">${escapeHtml(display)}</time></span>`;
}
function focusedControl() {
  const active = document.activeElement;
  if (!active || !app.contains(active)) return null;
  if (active.id) return `#${CSS.escape(active.id)}`;
  if (active.matches('a[data-nav]')) return `a[data-nav][href="${CSS.escape(active.getAttribute('href'))}"]`;
  return null;
}
function render() {
  const focusTarget = focusedControl();
  const route = getRoute();
  document.documentElement.dataset.theme = theme;
  document.title = `${route.label} · Biopeia`;
  const loading = source.status === 'loading';
  app.innerHTML = `<a class="skip-link" href="#content">Skip to main content</a><div class="app-shell">${sidebar(route)}<div class="app-main"><header class="topbar"><button type="button" class="menu-button" id="menu" aria-label="Toggle navigation" aria-expanded="${menuOpen}">☰</button><span>Independent observation workspace</span><div class="top-actions"><span class="connection-indicator" aria-live="polite">● ${escapeHtml(statusText())}</span>${lastChecked()}<button id="refresh" type="button" aria-label="Refresh current Observation snapshot">${loading?'Reading…':'Refresh read'}</button><button id="theme" type="button" aria-label="Switch to ${theme==='light'?'dark':'light'} theme">${theme==='light'?'Dark':'Light'} theme</button></div></header><main id="content" tabindex="-1"><div class="page-heading"><div><div class="eyebrow">BIOPEIA / OBSERVATION</div><h1>${escapeHtml(route.title)}</h1><p>${escapeHtml(route.intro)}</p></div><span class="mode-chip">READ ONLY · M1</span></div>${sessionPanel()}${notice()}${screen(route)}<footer>Biopeia · Independent passive presentation · No causal controls · No experimental evidence admission</footer></main></div></div>`;
  app.querySelectorAll('a[data-nav]').forEach(el=>el.addEventListener('click',e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0)return;e.preventDefault();history.pushState({},'',el.getAttribute('href'));menuOpen=false;render();document.getElementById('content').focus();}));
  app.querySelector('#theme').addEventListener('click',()=>{theme=theme==='dark'?'light':'dark';localStorage.setItem('biopeia-theme',theme);render();});
  app.querySelector('#menu').addEventListener('click',()=>{menuOpen=!menuOpen;render();});
  app.querySelector('#refresh').addEventListener('click',()=>void refreshController.refresh());
  if (focusTarget) app.querySelector(focusTarget)?.focus({preventScroll: true});
}

const refreshController = createSnapshotRefresh({
  readSnapshot: async () => {
    try {
      return await fetchCurrentObservation();
    } catch (error) {
      throw error instanceof ObservationReadError ? error : new ObservationReadError('error', 'Observation response could not be read');
    }
  },
  onState: next => {
    source = next;
    render();
  },
});

window.addEventListener('popstate',()=>{menuOpen=false;render();});
render();
refreshController.start();
async function refreshSession() {
  try {
    const response = await fetch('/api/session/status', {headers:{Accept:'application/json'}, cache:'no-store'});
    if (!response.ok) throw new Error('session status unavailable');
    const value = await response.json();
    if (!['running','completed','stopped','failed'].includes(value.status)) throw new Error('invalid session status');
    const next = value;
    if (JSON.stringify(next) !== JSON.stringify(session)) { session = next; render(); }
  } catch { if (session.status !== 'unknown') { session = {status:'unknown'}; render(); } }
}
void refreshSession();
window.setInterval(() => void refreshSession(), 1000);
