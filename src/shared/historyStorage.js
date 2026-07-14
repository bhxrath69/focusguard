const POMODORO_HISTORY_KEY = 'pomodoroHistory';
const POMODORO_HISTORY_COUNTER_KEY = 'pomodoroHistoryCounter';

function normalizePomodoroHistoryEntry(entry) {
  const e = entry ?? {};

  return {
    id: typeof e.id === 'string' ? e.id : String(e.id ?? ''),
    name: typeof e.name === 'string' ? e.name : '',
    completedAt: typeof e.completedAt === 'number' ? e.completedAt : Number(e.completedAt ?? 0),
    durationMs: typeof e.durationMs === 'number' ? e.durationMs : Number(e.durationMs ?? 0),
    notes: typeof e.notes === 'string' ? e.notes : ''
  };
}

export function getPomodoroHistoryEntrySortNewestFirst(a, b) {
  const ac = typeof a?.completedAt === 'number' ? a.completedAt : 0;
  const bc = typeof b?.completedAt === 'number' ? b.completedAt : 0;
  return bc - ac;
}

export async function getPomodoroHistory() {
  const res = await chrome.storage.local.get({
    [POMODORO_HISTORY_KEY]: []
  });

  const list = Array.isArray(res[POMODORO_HISTORY_KEY]) ? res[POMODORO_HISTORY_KEY] : [];
  return list.map(normalizePomodoroHistoryEntry);
}

export async function getPomodoroHistoryCounter() {
  const res = await chrome.storage.local.get({
    [POMODORO_HISTORY_COUNTER_KEY]: 0
  });
  const v = res[POMODORO_HISTORY_COUNTER_KEY];
  return typeof v === 'number' ? v : Number(v ?? 0);
}

export async function getNextPomodoroHistoryCounter() {
  // Monotonic counter: increment and return previous+1.
  const current = await getPomodoroHistoryCounter();
  const next = current + 1;
  await chrome.storage.local.set({ [POMODORO_HISTORY_COUNTER_KEY]: next });
  return next;
}

async function enforceMax15ByCompletedAt(history) {
  const max = 15;
  if (history.length <= max) return history;

  // Delete oldest by completedAt.
  const sortedAsc = [...history].sort((a, b) => {
    const ac = typeof a?.completedAt === 'number' ? a.completedAt : 0;
    const bc = typeof b?.completedAt === 'number' ? b.completedAt : 0;
    return ac - bc;
  });

  const kept = sortedAsc.slice(sortedAsc.length - max);
  return kept;
}

export async function appendPomodoroHistoryEntry(entry, { maxEntries = 15 } = {}) {
  const history = await getPomodoroHistory();

  const normalized = normalizePomodoroHistoryEntry(entry);
  history.push(normalized);

  const finalHistory = history.length > maxEntries ? await enforceMax15ByCompletedAt(history) : history;
  await chrome.storage.local.set({ [POMODORO_HISTORY_KEY]: finalHistory });
  return finalHistory;
}

export async function updateEntryName(id, name) {
  const history = await getPomodoroHistory();
  const targetId = String(id);
  const nextName = typeof name === 'string' ? name : String(name ?? '');

  const updated = history.map((e) => (String(e.id) === targetId ? { ...e, name: nextName } : e));
  await chrome.storage.local.set({ [POMODORO_HISTORY_KEY]: updated });
  return updated;
}

export async function updateEntryNotes(id, notes) {
  const history = await getPomodoroHistory();
  const targetId = String(id);
  const nextNotes = typeof notes === 'string' ? notes : String(notes ?? '');

  const updated = history.map((e) => (String(e.id) === targetId ? { ...e, notes: nextNotes } : e));
  await chrome.storage.local.set({ [POMODORO_HISTORY_KEY]: updated });
  return updated;
}


