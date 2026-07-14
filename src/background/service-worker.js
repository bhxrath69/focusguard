import { createPomodoroEngine } from './pomodoroEngine.js';
import { MESSAGE_TYPES } from '../shared/messages.js';
import { getAllowlistFromStorage } from '../shared/allowlistStorage.js';
import { createProcrastinationEngine, PROCRASTINATION_THRESHOLD_MS } from './procrastinationEngine.js';
import {
  appendPomodoroHistoryEntry,
  getNextPomodoroHistoryCounter,
  getPomodoroHistory,
  getPomodoroHistoryEntrySortNewestFirst
} from '../shared/historyStorage.js';

const ALARM_NAME = 'FOCUSGUARD_POMODORO_PHASE_END';

const PROCRASTINATION_ALARM_NAME = 'FOCUSGUARD_PROCRASTINATION_30MIN';

const presets = {
  default: {
    id: 'default',
    workDurationMs: 25 * 60 * 1000,
    breakDurationMs: 5 * 60 * 1000
  }
};

// -------- TEMP TESTING OVERRIDE (remove/disable after Phase B verification) --------
// If you set `chrome.storage.local.workDurationOverrideMs` to a positive number,
// the engine preset will use that duration for work sessions.
const WORK_DURATION_OVERRIDE_KEY = 'workDurationOverrideMs';
// ----------------------------------------------------------------------------------------


function notify(title, body) {
  return chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message: body
  });
}

const engine = createPomodoroEngine({

  presets,
  onSessionCompleted: async ({ completedPhase, nextPhase }) => {
    if (completedPhase === 'work') {

      notify('When your work session is complete, take a break.', 'FocusGuard');

      // Phase B: create a history entry for completed work sessions.
      // Notes are Phase C, so initialize to empty.
      const counter = await getNextPomodoroHistoryCounter();

      // Best-effort duration: we don’t currently persist per-session duration in the engine snapshot.
      // For Phase B we store `durationMs` as the preset work duration captured at entry creation time.
      // This is stable and doesn’t affect timer behavior.
      const workDurationMs = engineState?.workDurationMs ?? presets.default.workDurationMs;

      const completedAt = Date.now();
      const entry = {
        id: String(counter),
        name: `Pomodoro #${counter}`,
        completedAt,
        durationMs: workDurationMs,
        notes: ''
      };

      await appendPomodoroHistoryEntry(entry, { maxEntries: 15 });
    }

    if (completedPhase === 'break') {
      notify('Break finished. Time to focus again.', 'FocusGuard');
    }

    // Immediately schedule next phase if user has not paused/reset.
    if (engineState.running) {
      scheduleNext();
    }

    // Ensure popup sees updated history.
    broadcastState();
  },
  now: () => Date.now()
});


const procrastinationEngine = createProcrastinationEngine({
  now: () => Date.now()
});

let engineState = { running: false, workDurationMs: presets.default.workDurationMs };


// Procrastination monitoring state (in-memory)
let procrastinationState = {
  tracking: false,
  startedAt: null
};

async function isProcrastinationEnabled() {
  const res = await chrome.storage.local.get({ procrastinationMonitoringEnabled: true });
  return !!res.procrastinationMonitoringEnabled;
}

async function getAllowlist() {
  return await getAllowlistFromStorage();
}

function normalizeHostnameFromUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function notifyProcrastinationElapsed() {
  return notify('You have been procrastinating for 30 minutes.', 'FocusGuard');
}

async function maybeStartProcrastinationTrackingForUrl(url) {
  const enabled = await isProcrastinationEnabled();
  if (!enabled) return;

  const hostname = normalizeHostnameFromUrl(url);
  if (!hostname) return;

  const allowlist = await getAllowlist();
  const allowed = allowlist.includes(hostname);

  if (allowed) {
    // If we're on an allowed site, stop tracking + clear any alarm.
    stopProcrastinationTrackingAndClearAlarm();
    return;
  }

  // Not allowed -> start tracking and arm alarm (only once).
  if (!procrastinationEngine.isTracking()) {
    procrastinationEngine.startTracking();
    procrastinationState = procrastinationEngine.getSnapshot();
    clearProcrastinationAlarm();
    scheduleProcrastinationAlarm();
  }
}

function scheduleProcrastinationAlarm() {
  if (!procrastinationEngine.isTracking()) return;

  const startedAt = procrastinationState.startedAt ?? Date.now();
  const when = startedAt + PROCRASTINATION_THRESHOLD_MS;
  chrome.alarms.create(PROCRASTINATION_ALARM_NAME, { when });
}

function clearProcrastinationAlarm() {
  chrome.alarms.clear(PROCRASTINATION_ALARM_NAME);
}

function stopProcrastinationTrackingAndClearAlarm() {
  procrastinationEngine.stopTracking();
  procrastinationState = procrastinationEngine.getSnapshot();
  clearProcrastinationAlarm();
}

async function handleActiveSiteChange(tab) {
  if (!tab) return;
  const url = tab.url || '';
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;

  await maybeStartProcrastinationTrackingForUrl(url);
}

function getActiveTabUrl() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs?.[0]?.url || null);
    });
  });
}

async function persistRunningFlag() {
  // For future extensibility; v1 keeps everything in-memory.
  engineState = { ...engineState, running: engine.getSnapshot().running };
}

function scheduleNext() {
  const snap = engine.getSnapshot();
  if (!snap.running) return;

  // Use chrome.alarms for MV3 non-persistence.
  // Set by timestamp.
  chrome.alarms.create(ALARM_NAME, {
    when: (Date.now() + snap.remainingMs)
  });
}

function clearTimerAlarms() {
  chrome.alarms.clear(ALARM_NAME);
}

async function broadcastState() {
  // Popup may not be open; avoid hard failures.
  const pomodoro = engine.getSnapshot();
  const procrastination = procrastinationEngine.getSnapshot();

  let history = [];
  try {
    history = await getPomodoroHistory();
    history.sort(getPomodoroHistoryEntrySortNewestFirst);
  } catch {
    history = [];
  }

  chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.BG_TO_UI_STATE,
    state: {
      pomodoro,
      procrastination,
      history
    }
  }).catch(() => {});
}



chrome.runtime.onInstalled.addListener(() => {
  // Seed default snapshot.
  broadcastState();

  // Seed procrastination tracking based on current active tab (if enabled).
  syncProcrastinationWithActiveTab().catch(() => {});
});

// Procrastination monitoring: watch focus/URL changes.
chrome.tabs.onActivated.addListener((activeInfo) => {
  // activeInfo.tabId is available in MV3
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    handleActiveSiteChange(tab).catch?.(() => {});
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // We only care about actual URL changes.
  if (!changeInfo?.url) return;

  chrome.tabs.get(tabId, (tab) => {
    handleActiveSiteChange(tab).catch?.(() => {});
  });
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  // When focus changes, pick current active tab in that window.
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    stopProcrastinationTrackingAndClearAlarm();
    return;
  }

  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    handleActiveSiteChange(tabs?.[0]).catch?.(() => {});
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    const result = engine.onAlarmFired();
    persistRunningFlag();

    // After engine completion, user is considered paused because engine sets running=false.
    // For Phase 1, we auto-run subsequent phases only if user hasn't paused/reset.
    if (result && result.nextPhase && result.nextPhase !== 'idle') {
      const armed = engine.resume();
      persistRunningFlag();
      if (armed) {
        clearTimerAlarms();
        scheduleNext();
        broadcastState();
      }
    } else {
      clearTimerAlarms();
      broadcastState();
    }
    return;
  }

  if (alarm.name === PROCRASTINATION_ALARM_NAME) {
    // If toggle turned off, ignore.
    isProcrastinationEnabled()
      .then((enabled) => {
        if (!enabled) {
          stopProcrastinationTrackingAndClearAlarm();
          return;
        }

        const elapsed = procrastinationEngine.checkElapsed(Date.now());
        if (elapsed) {
          procrastinationState = procrastinationEngine.getSnapshot();
          notifyProcrastinationElapsed();
          stopProcrastinationTrackingAndClearAlarm();
        }
      })
      .catch(() => {});
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!changes.procrastinationMonitoringEnabled) return;

  const newVal = !!changes.procrastinationMonitoringEnabled.newValue;
  if (!newVal) {
    stopProcrastinationTrackingAndClearAlarm();
    return;
  }

  // If toggled on, immediately evaluate current active tab.
  getActiveTabUrl()
    .then((url) => {
      if (url) maybeStartProcrastinationTrackingForUrl(url);
    })
    .catch(() => {});
});

async function syncProcrastinationWithActiveTab() {
  const url = await getActiveTabUrl();
  if (url) maybeStartProcrastinationTrackingForUrl(url);
}

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {

  if (!message || !message.type) return;

  if (message.type === MESSAGE_TYPES.UI_TO_BG_GET_STATE) {
    sendResponse?.({ ok: true, state: engine.getSnapshot() });
    return;
  }

  if (message.type === MESSAGE_TYPES.UI_TO_BG_START) {
    clearTimerAlarms();

    // TEMP override for testing work session duration only (Phase B).
    // Setting workDurationOverrideMs to a small positive number makes the next work session complete faster.
    // Disable by deleting the key or setting it to 0.
    try {
      const ovrRes = await chrome.storage.local.get({ [WORK_DURATION_OVERRIDE_KEY]: 0 });
      const overrideMs = Number(ovrRes[WORK_DURATION_OVERRIDE_KEY]);
      if (overrideMs > 0) {
        engine.setPreset('default');
        presets.default.workDurationMs = overrideMs;
      }
    } catch {
      // ignore override failures
    }

    const snap = engine.start();
    engineState.running = true;
    engineState.workDurationMs = snap?.remainingMs ?? presets.default.workDurationMs;
    scheduleNext();
    broadcastState();
    sendResponse?.({ ok: true });
  }




  if (message.type === MESSAGE_TYPES.UI_TO_BG_PAUSE) {
    const res = engine.pause();
    engineState.running = false;
    clearTimerAlarms();
    broadcastState();
    sendResponse?.({ ok: true, res });
  }


  if (message.type === MESSAGE_TYPES.UI_TO_BG_RESET) {
    engine.reset();
    engineState.running = false;
    clearTimerAlarms();
    broadcastState();
    sendResponse?.({ ok: true });
  }


  if (message.type === MESSAGE_TYPES.UI_TO_BG_SET_PRESET) {
    engine.setPreset(message.presetId);
    broadcastState();
    sendResponse?.({ ok: true });
  }
});

