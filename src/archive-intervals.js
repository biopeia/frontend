const escapeArchiveHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function archiveIntervals(value, withReason = false) {
  if (!Array.isArray(value)) return 'not asserted';
  if (value.length === 0) return 'none recorded';
  if (!value.every(entry => Array.isArray(entry) && entry.length === (withReason ? 3 : 2) &&
    Number.isSafeInteger(entry[0]) && entry[0] >= 0 &&
    (entry[1] === null && !withReason || Number.isSafeInteger(entry[1]) && entry[1] >= entry[0]) &&
    (!withReason || typeof entry[2] === 'string'))) return 'invalid interval data';
  return value.map(entry => escapeArchiveHtml(entry[0]) + '–' +
    (entry[1] === null ? 'open, unverified to present' : escapeArchiveHtml(entry[1])) +
    (withReason ? ' (reason: ' + escapeArchiveHtml(entry[2]) + ')' : '')).join('; ');
}
