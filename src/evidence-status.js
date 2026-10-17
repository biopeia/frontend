// Pure, read-only presentation classification. Never upgrades scientific authority.
export const EVIDENCE_STATES = Object.freeze(['unavailable','exploratory','reproduced','admitted']);
export function classifyEvidence(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return {state:'unavailable',reason:'No verified Lab record'};
  const provenance = record.provenance;
  if (!provenance || typeof provenance !== 'object' || !/^[a-f0-9]{64}$/i.test(provenance.sha256 ?? '') || typeof provenance.revision !== 'string' || !provenance.revision.trim()) {
    return {state:'unavailable',reason:'Missing verifiable provenance'};
  }
  if (record.admission?.status === 'admitted' && record.admission?.authority === 'lab' && typeof record.admission?.decision_id === 'string' && record.admission.decision_id.trim()) {
    return {state:'admitted',reason:'Lab admission explicitly recorded'};
  }
  if (record.reproduction?.status === 'reproduced' && Number.isInteger(record.reproduction?.independent_runs) && record.reproduction.independent_runs > 0) {
    return {state:'reproduced',reason:'Reproduction recorded; no Lab admission inferred'};
  }
  return {state:'exploratory',reason:'Provenance recorded; scientific validation not established'};
}
export function describeEvidence(record) {
  const result = classifyEvidence(record);
  return Object.freeze({...result, revision: record?.provenance?.revision ?? null, digest: record?.provenance?.sha256 ?? null});
}
