import {renderScreen} from './views.js';
import './style.css';
import {ROUTES, initialSource, routeFromPath, sourceRef, statusLabel, assertReadOnlySource} from './model.js';

const app = document.getElementById('app');
const initialTheme = localStorage.getItem('biopeia-theme');
let theme = initialTheme === 'light' || initialTheme === 'dark' ? initialTheme : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
let source = assertReadOnlySource(initialSource);
let menuOpen = false;
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function safeText(value) { return escapeHtml(sourceRef(value)); }
function getRoute() {return routeFromPath(location.pathname);}
function emptyState(route) {
  const isSpatial = route.path === '/spatial' || route.path === '/overview';
  const message = isSpatial ? 'No compatible published geometry is available in this unconnected session.' :
    route.path === '/timeline' ? 'No verified World cut history is available to inspect.' :
    route.path === '/sensorimotor' ? 'No source-asserted links are available. Relations are never inferred.' :
    route.path === '/claims' ? 'No authorized claims are available for provenance inspection.' :
    route.path === '/worlds' ? 'No authorized World or run catalog is connected.' :
    'No authorized source is configured.';
  return `<div class="no-data" role="status"><span class="eyebrow">UNAVAILABLE · NO OBSERVATIONAL SOURCE</span><div class="empty-symbol" aria-hidden="true">◌</div><h2>${isSpatial ? 'Spatial evidence unavailable' : 'No publication data available'}</h2><p>${message}</p><p class="fine">This is a disconnected application shell, not evidence of source-state absence.</p><a class="text-link" href="/connection" data-nav>Review connection & access →</a></div>`;
}
function sidebar(route) {
  return `<aside class="sidebar ${menuOpen ? 'open' : ''}" aria-label="Primary navigation"><a href="/worlds" data-nav class="brand" aria-label="Biopeia Worlds and Runs"><span class="brandmark">◈</span><span><strong>BIOPEIA</strong><small>OBSERVATION</small></span></a><div class="nav-label">EXPLORE</div><nav aria-label="Seven peer-level screens">${ROUTES.map((r,i)=>`<a data-nav href="${r.path}" ${route.path===r.path?'aria-current="page"':''}><span class="nav-numeral">0${i+1}</span><span>${r.label}</span></a>`).join('')}</nav><div class="sidebar-footer"><span class="status-dot" aria-hidden="true"></span><span>Not connected</span><p>Passive visualization only</p></div></aside>`;
}
function contextStrip() {return `<div class="context-strip" aria-label="Publication context"><div><span>WORLD</span><strong>${safeText(source.world)}</strong></div><div><span>RUN</span><strong>${safeText(source.run)}</strong></div><div><span>COMMITTED CUT</span><strong>${safeText(source.cut)}</strong></div><div><span>DELIVERY</span><strong>${source.delivery ? safeText(source.delivery) : statusLabel(source.status)}</strong></div></div>`;}
function inspectionPanel(){return `<section class="panel evidence"><div class="panel-heading"><h2>Publication integrity</h2><span class="small-tag">READ ONLY</span></div><dl class="details"><dt>Observation source</dt><dd>Not configured</dd><dt>Source authority</dt><dd>Not available</dd><dt>World commit</dt><dd>Not verified</dd><dt>Delivery sequence</dt><dd>Not available</dd><dt>Retention / coverage</dt><dd>Unknown</dd></dl><p class="fine">No inferred causality, activity or organism state.</p></section>`;}
function screen(route) { return renderScreen(route); }
function render(){ const route = getRoute(); document.documentElement.dataset.theme=theme;document.title=`${route.label} · Biopeia`;app.innerHTML=`<a class="skip-link" href="#content">Skip to main content</a><div class="app-shell">${sidebar(route)}<div class="app-main"><header class="topbar"><button type="button" class="menu-button" id="menu" aria-label="Toggle navigation" aria-expanded="${menuOpen}">☰</button><span>Independent observation workspace</span><div class="top-actions"><span class="connection-indicator">● No source connected</span><button id="theme" type="button" aria-label="Switch to ${theme==='light'?'dark':'light'} theme">${theme==='light'?'Dark':'Light'} theme</button></div></header><main id="content" tabindex="-1"><div class="page-heading"><div><div class="eyebrow">BIOPEIA / OBSERVATION</div><h1>${escapeHtml(route.title)}</h1><p>${escapeHtml(route.intro)}</p></div><span class="mode-chip">READ-ONLY SHELL</span></div><div class="notice" role="note"><strong>NOT CONNECTED</strong><span>No authorized Observation source is configured. Nothing shown here asserts actual World, Organism or experiment state.</span></div>${contextStrip()}${screen(route)}<footer>Biopeia · Independent passive presentation · No causal controls · No experimental evidence admission</footer></main></div></div>`;
app.querySelectorAll('a[data-nav]').forEach(el=>el.addEventListener('click',e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0)return;e.preventDefault();history.pushState({},'',el.getAttribute('href'));menuOpen=false;render();document.getElementById('content').focus();}));
app.querySelector('#theme').addEventListener('click',()=>{theme=theme==='dark'?'light':'dark';localStorage.setItem('biopeia-theme',theme);render();});
app.querySelector('#menu').addEventListener('click',()=>{menuOpen=!menuOpen;render();});
}
window.addEventListener('popstate',()=>{menuOpen=false;render();});render();
