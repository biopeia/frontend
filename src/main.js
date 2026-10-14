import {fetchCurrentObservation, ObservationReadError} from './observation-client.js';
import {renderScreen} from './views.js';
import './style.css';
import {ROUTES, initialSource, routeFromPath} from './model.js';

const app = document.getElementById('app');
const initialTheme = localStorage.getItem('biopeia-theme');
let theme = initialTheme === 'light' || initialTheme === 'dark' ? initialTheme : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
let source = initialSource;
let menuOpen = false;
let loading = false;

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function getRoute() { return routeFromPath(location.pathname); }
function statusText() {
  return ({
    'not-configured': 'Not connected', loading: 'Reading Observation', available: 'Current view available',
    empty: 'No retained messages', unsupported: 'No supported messages', denied: 'Read denied',
    unavailable: 'Observation unavailable', disconnected: 'Bridge disconnected', error: 'Invalid response',
  })[source.status] ?? 'Availability unknown';
}
function notice() {
  const messages = {
    'not-configured': ['NOT CONNECTED', 'No authorized Observation source is configured. Nothing here asserts actual World, Organism or experiment state.'],
    loading: ['READING CURRENT VIEW', 'A single bounded, read-only Observation request is in progress. No polling or causal operation is performed.'],
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
function render() {
  const route = getRoute();
  document.documentElement.dataset.theme = theme;
  document.title = `${route.label} · Biopeia`;
  app.innerHTML = `<a class="skip-link" href="#content">Skip to main content</a><div class="app-shell">${sidebar(route)}<div class="app-main"><header class="topbar"><button type="button" class="menu-button" id="menu" aria-label="Toggle navigation" aria-expanded="${menuOpen}">☰</button><span>Independent observation workspace</span><div class="top-actions"><span class="connection-indicator" aria-live="polite">● ${escapeHtml(statusText())}</span><button id="refresh" type="button" ${loading?'disabled':''}>${loading?'Reading…':'Refresh read'}</button><button id="theme" type="button" aria-label="Switch to ${theme==='light'?'dark':'light'} theme">${theme==='light'?'Dark':'Light'} theme</button></div></header><main id="content" tabindex="-1"><div class="page-heading"><div><div class="eyebrow">BIOPEIA / OBSERVATION</div><h1>${escapeHtml(route.title)}</h1><p>${escapeHtml(route.intro)}</p></div><span class="mode-chip">READ ONLY · M1</span></div>${notice()}${screen(route)}<footer>Biopeia · Independent passive presentation · No causal controls · No experimental evidence admission</footer></main></div></div>`;
  app.querySelectorAll('a[data-nav]').forEach(el=>el.addEventListener('click',e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0)return;e.preventDefault();history.pushState({},'',el.getAttribute('href'));menuOpen=false;render();document.getElementById('content').focus();}));
  app.querySelector('#theme').addEventListener('click',()=>{theme=theme==='dark'?'light':'dark';localStorage.setItem('biopeia-theme',theme);render();});
  app.querySelector('#menu').addEventListener('click',()=>{menuOpen=!menuOpen;render();});
  app.querySelector('#refresh').addEventListener('click',refresh);
}

async function refresh() {
  if (loading) return;
  loading = true;
  source = {...source, status: 'loading'};
  render();
  try {
    source = await fetchCurrentObservation();
  } catch (error) {
    source = {...initialSource, status: error instanceof ObservationReadError ? error.status : 'error'};
  } finally {
    loading = false;
    render();
  }
}

window.addEventListener('popstate',()=>{menuOpen=false;render();});
render();
void refresh();
