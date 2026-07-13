const ALLOWLIST_STORAGE_KEY = 'allowlist';

function normalizeAllowlistInput(items) {
  return (items ?? [])
    .map(x => (typeof x === 'string' ? x : String(x ?? '')))
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

// Parses comma-separated UI string into storage array.
export function parseAllowlistFromCommaString(input) {
  if (typeof input !== 'string') return [];
  return normalizeAllowlistInput(
    input
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  );
}

export async function getAllowlistFromStorage() {
  const res = await chrome.storage.local.get({ [ALLOWLIST_STORAGE_KEY]: [] });
  return normalizeAllowlistInput(res[ALLOWLIST_STORAGE_KEY]);
}

export async function setAllowlistInStorage(allowlistArray) {
  const normalized = normalizeAllowlistInput(allowlistArray);
  await chrome.storage.local.set({ [ALLOWLIST_STORAGE_KEY]: normalized });
  return normalized;
}
