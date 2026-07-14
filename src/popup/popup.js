import { MESSAGE_TYPES } from '../shared/messages.js';
import {
  getAllowlistFromStorage,
  parseAllowlistFromCommaString,
  setAllowlistInStorage
} from '../shared/allowlistStorage.js';

const timeLeftEl = document.getElementById('timeLeft');

const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');

const newWebsiteInput = document.getElementById('newWebsiteInput');
const addWebsiteBtn = document.getElementById('addWebsiteBtn');
const allowedWebsitesListEl = document.getElementById('allowedWebsitesList');

function formatMs(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

let pomodoroTickIntervalId = null;
let pomodoroCurrentState = null;

function computeRemainingMsFromState(state) {
  const finishAt = state?.finishAt;
  if (!state?.running) return 0;

  if (typeof finishAt === 'number') {
    return Math.max(0, finishAt - Date.now());
  }

  // Fallback (older snapshot without finishAt)
  return Math.max(0, state?.remainingMs ?? 0);
}

function stopPomodoroTicking() {
  if (pomodoroTickIntervalId != null) {
    clearInterval(pomodoroTickIntervalId);
    pomodoroTickIntervalId = null;
  }
}

function startPomodoroTickingIfNeeded(state) {
  const running = !!state?.running;
  const finishAt = state?.finishAt;

  if (!running || typeof finishAt !== 'number') {
    stopPomodoroTicking();
    return;
  }

  if (pomodoroTickIntervalId != null) return;

  pomodoroCurrentState = state;

  pomodoroTickIntervalId = setInterval(() => {
    const remainingMs = computeRemainingMsFromState(pomodoroCurrentState);
    timeLeftEl.textContent = formatMs(remainingMs);
  }, 1000);
}

function renderPomodoroState(pomodoro) {
  const remainingMs = computeRemainingMsFromState(pomodoro);
  timeLeftEl.textContent = formatMs(remainingMs);

  const running = !!pomodoro.running;
  startBtn.disabled = running;
  resetBtn.disabled = false;

  startPomodoroTickingIfNeeded(pomodoro);
}

/**
 * Phase A live procrastination timer (popup only).
 * Uses procrastination.startedAt and procrastination.tracking from BG_TO_UI_STATE.
 */
const distractionTimerEl = document.getElementById('distractionTimer');
const distractionWrapEl = document.getElementById('distractionWrap');

let distractionTickIntervalId = null;
let distractionCurrentStartedAt = null;
let distractionCurrentTracking = false;

function stopDistractionTicking() {
  if (distractionTickIntervalId != null) {
    clearInterval(distractionTickIntervalId);
    distractionTickIntervalId = null;
  }
  distractionCurrentStartedAt = null;
  distractionCurrentTracking = false;
  if (distractionWrapEl) distractionWrapEl.classList.remove('visible');
}

function startDistractionTicking(startedAt) {
  if (!distractionTimerEl || typeof startedAt !== 'number') return;

  if (distractionTickIntervalId != null) return;

  distractionCurrentStartedAt = startedAt;
  distractionCurrentTracking = true;

  if (distractionWrapEl) distractionWrapEl.classList.add('visible');

  const tick = () => {
    if (!distractionCurrentTracking || typeof distractionCurrentStartedAt !== 'number') return;
    const elapsedMs = Date.now() - distractionCurrentStartedAt;
    distractionTimerEl.textContent = formatMs(elapsedMs);
  };

  tick();
  distractionTickIntervalId = setInterval(tick, 1000);
}

function renderProcrastinationState(procrastination) {
  const tracking = !!procrastination?.tracking;
  const startedAt = procrastination?.startedAt;

  if (!tracking || typeof startedAt !== 'number') {
    stopDistractionTicking();
    return;
  }

  // If we're already ticking, keep ticking (switching to a new startedAt resets display correctly)
  if (distractionTickIntervalId != null && distractionCurrentStartedAt === startedAt) {
    return;
  }

  stopDistractionTicking();
  startDistractionTicking(startedAt);
}

function normalizeSingleWebsiteInput(raw) {
  const parsed = parseAllowlistFromCommaString(raw);
  // parseAllowlistFromCommaString already splits commas + trims + lowercases + filters empties.
  // For "single domain" input, we just take the first entry (at most).
  return parsed[0] ?? null;
}

async function renderAllowlistList() {
  if (!allowedWebsitesListEl) return;

  const allowlist = await getAllowlistFromStorage();
  allowedWebsitesListEl.innerHTML = '';

  for (const site of allowlist) {
    const item = document.createElement('div');
    item.className = 'allowed-item';

    const text = document.createElement('span');
    text.className = 'allowed-item-text';
    text.textContent = site;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'allowed-item-remove';
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', async () => {
      const next = allowlist.filter(s => s !== site);
      await setAllowlistInStorage(next);
      await renderAllowlistList();
    });

    item.appendChild(text);
    item.appendChild(removeBtn);
    allowedWebsitesListEl.appendChild(item);
  }
}

async function addWebsiteFromInput() {
  if (!newWebsiteInput) return;
  const candidate = normalizeSingleWebsiteInput(newWebsiteInput.value);
  if (!candidate) return;

  const allowlist = await getAllowlistFromStorage();
  if (allowlist.includes(candidate)) {
    newWebsiteInput.value = '';
    return;
  }

  await setAllowlistInStorage([...allowlist, candidate]);
  newWebsiteInput.value = '';
  await renderAllowlistList();
}

newWebsiteInput?.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  await addWebsiteFromInput();
});

addWebsiteBtn?.addEventListener('click', async () => {
  await addWebsiteFromInput();
});

startBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: MESSAGE_TYPES.UI_TO_BG_START }).catch(() => {});
});

resetBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: MESSAGE_TYPES.UI_TO_BG_RESET }).catch(() => {});
});

const historyListEl = document.getElementById('historyList');

let expandedHistoryCardId = null;
let latestHistory = [];

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '<')
    .replaceAll('>', '>')
    .replaceAll('"', '"')
    .replaceAll("'", '&#039;');
}


function renderHistory(history) {
  latestHistory = Array.isArray(history) ? history : [];

  if (!historyListEl) return;

  historyListEl.innerHTML = '';

  if (latestHistory.length === 0) {
    const empty = document.createElement('div');
    empty.style.fontSize = '11px';
    empty.style.color = 'rgba(255, 30, 78, 0.65)';
    empty.textContent = 'No completed work sessions yet.';
    historyListEl.appendChild(empty);
    return;
  }

  for (const entry of latestHistory) {
    const id = String(entry.id);

    const card = document.createElement('div');
    card.className = 'history-card';
    card.dataset.entryId = id;

    const header = document.createElement('div');
    header.className = 'history-card-header';

    const titleSpan = document.createElement('div');
    titleSpan.className = 'history-card-title';
    titleSpan.textContent = entry.name || `Pomodoro #${id}`;

    const chevron = document.createElement('div');
    chevron.className = 'history-card-chevron';
    chevron.textContent = expandedHistoryCardId === id ? '▾' : '▸';

    header.appendChild(titleSpan);
    header.appendChild(chevron);

    header.addEventListener('click', () => {
      // Toggle expand/collapse. Phase B rename should not be debounced; just save immediately.
      const nextExpanded = expandedHistoryCardId === id ? null : id;
      expandedHistoryCardId = nextExpanded;
      renderHistory(latestHistory);
    });

    card.appendChild(header);

    if (expandedHistoryCardId === id) {
      const body = document.createElement('div');
      body.className = 'history-card-body';

      const renameRow = document.createElement('div');
      renameRow.className = 'history-rename-row';

      const input = document.createElement('input');
      input.className = 'history-rename-input';
      input.type = 'text';
      input.value = entry.name || '';
      input.placeholder = 'Rename pomodoro';

      input.addEventListener('input', async () => {
        // Immediate persistence for Phase B.
        const nextName = input.value;
        // Storage helper imported dynamically below to avoid top-level cycle.
        const { updateEntryName } = await import('../shared/historyStorage.js');
        await updateEntryName(id, nextName);

        // Update local view.
        const idx = latestHistory.findIndex(e => String(e.id) === id);
        if (idx >= 0) latestHistory[idx] = { ...latestHistory[idx], name: nextName };
      });

      renameRow.appendChild(input);
      body.appendChild(renameRow);

      const hint = document.createElement('div');
      hint.className = 'history-rename-saveHint';
      hint.textContent = 'Saved immediately.';
      body.appendChild(hint);

      card.appendChild(body);
    }

    historyListEl.appendChild(card);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== MESSAGE_TYPES.BG_TO_UI_STATE) return;

  const pomodoro = msg.state?.pomodoro ?? msg.state;
  const procrastination = msg.state?.procrastination ?? null;
  const history = msg.state?.history ?? [];

  renderPomodoroState(pomodoro);

  if (procrastination) renderProcrastinationState(procrastination);
  else stopDistractionTicking();

  renderHistory(history);
});


async function initFromBackground() {
  try {
    const res = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.UI_TO_BG_GET_STATE });
    const state = res?.state;

    const pomodoro = state?.pomodoro ?? state;
    const procrastination = state?.procrastination ?? null;

    renderPomodoroState(pomodoro ?? { running: false, phase: 'idle', remainingMs: 0, finishAt: null });

    if (procrastination) renderProcrastinationState(procrastination);
    else stopDistractionTicking();
  } catch {
    renderPomodoroState({ phase: 'idle', remainingMs: 0, running: false, finishAt: null });
    stopDistractionTicking();
  }
}


const procrastinationToggleEl = document.getElementById('procrastinationToggle');

async function getProcrastinationEnabledDefaultTrue() {
  const res = await chrome.storage.local.get({ procrastinationMonitoringEnabled: true });
  return !!res.procrastinationMonitoringEnabled;
}

async function setProcrastinationEnabled(value) {
  await chrome.storage.local.set({ procrastinationMonitoringEnabled: !!value });
}

async function syncToggleFromStorage() {
  if (!procrastinationToggleEl) return;
  procrastinationToggleEl.checked = await getProcrastinationEnabledDefaultTrue();
}

async function onToggleChanged() {
  if (!procrastinationToggleEl) return;
  await setProcrastinationEnabled(procrastinationToggleEl.checked);
}

initFromBackground();
renderAllowlistList();
syncToggleFromStorage();
renderHistory([]);


procrastinationToggleEl?.addEventListener('change', () => {
  onToggleChanged().catch(() => {});
});

window.addEventListener('beforeunload', () => {
  stopPomodoroTicking();
  stopDistractionTicking();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    stopPomodoroTicking();
    stopDistractionTicking();
  }
});


