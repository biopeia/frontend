const FILTERS = ['owner', 'family', 'revision'];

export function archiveReceiptsUrl(after, filters = {}) {
  if (!Number.isSafeInteger(after) || after < 0) throw new TypeError('Invalid archive receipt cursor');
  const params = new URLSearchParams({limit:'25', after:String(after)});
  for (const key of FILTERS) {
    const value = typeof filters[key] === 'string' ? filters[key].trim() : '';
    if (value.length > 256) throw new TypeError(`Invalid archive ${key} filter`);
    if (value) params.set(key, value);
  }
  return `/api/observation/archive/receipts?${params}`;
}
