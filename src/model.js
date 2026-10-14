// Only display capabilities available through a separately approved read adapter.
// No synthetic runtime claims, no local state interpreted as source state.
export const ROUTES = Object.freeze([
  {path:'/worlds', label:'Worlds & Runs', title:'Worlds & Runs', intro:'Discover Worlds and run contexts made available by an authorized publication source.'},
  {path:'/overview', label:'World Overview', title:'World Overview', intro:'Inspect committed World context and compatible published spatial evidence.'},
  {path:'/spatial', label:'Spatial Explorer', title:'Spatial Explorer', intro:'Explore spatial claims only where geometry, units and frames are source-backed.'},
  {path:'/timeline', label:'Causal Timeline', title:'Causal Timeline', intro:'Inspect committed World cuts separately from publication and delivery status.'},
  {path:'/sensorimotor', label:'Sensorimotor Trace', title:'Sensorimotor Trace', intro:'Follow only explicit source-published sensorimotor relations.'},
  {path:'/claims', label:'Claim Inspector', title:'Claim Inspector', intro:'Examine the authority, time, revision, provenance and scope of published claims.'},
  {path:'/connection', label:'Connection & Access', title:'Connection & Access', intro:'Review publication access and supported read-only capabilities.'}
]);
export const AVAILABILITY = Object.freeze(['not-configured','loading','available','empty','unknown','denied','unavailable','unsupported','disconnected','stale','incomplete','gap','conflict','error']);
export function statusLabel(status) {
  const labels = {
    'not-configured':'No source configured',loading:'Loading',available:'Available',empty:'No retained publications',
    unknown:'Unknown',denied:'Access denied',unavailable:'Source unavailable',unsupported:'Unsupported contract',
    disconnected:'Disconnected',stale:'Stale publication',incomplete:'Incomplete delivery',gap:'Delivery gap',
    conflict:'Conflicting publications',error:'Read error'
  };
  if (!AVAILABILITY.includes(status)) throw new Error('Invalid availability status');
  return labels[status];
}
export const initialSource = Object.freeze({status:'not-configured',world:null,run:null,cut:null,delivery:null,claims:[],capabilities:[]});
export function assertReadOnlySource(source) {
  if (!source || typeof source!=='object' || !AVAILABILITY.includes(source.status)) throw Error('Invalid source availability');
  if (!Array.isArray(source.claims) || !Array.isArray(source.capabilities)) throw Error('Invalid publication collection');
  if (source.status === 'not-configured' && (source.claims.length || source.cut)) throw Error('Configured data without source');
  return source;
}
export function routeFromPath(path) { return ROUTES.find(route => route.path === path) ?? ROUTES[1]; }
export function sourceRef(value) { return value === null || value === undefined || value === '' ? 'Not available' : String(value); }
