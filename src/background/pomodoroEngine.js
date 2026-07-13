// Pure timer state machine.
// No DOM/UI code here.

export function createPomodoroEngine({
  presets,
  onSessionCompleted,
  now = () => Date.now()
}) {
  let state = {
    presetId: presets.default.id,
    phase: 'idle', // 'work' | 'break' | 'idle'
    workDurationMs: presets.default.workDurationMs,
    breakDurationMs: presets.default.breakDurationMs,
    remainingMs: 0,
    running: false,
    // For alarms scheduling: how much time was left at the moment we armed the next tick/finish.
    finishAt: null,
    version: 0
  };

  function getSnapshot() {
    return {
      phase: state.phase,
      presetId: state.presetId,
      remainingMs: Math.max(0, state.remainingMs),
      finishAt: state.finishAt,
      running: state.running
    };
  }

  function setPreset(presetId) {
    const preset = Object.values(presets).find(p => p.id === presetId);
    if (!preset) return;

    state.presetId = preset.id;
    state.workDurationMs = preset.workDurationMs;
    state.breakDurationMs = preset.breakDurationMs;
    // If idle, apply remaining to work by default.
    if (!state.running && state.phase === 'idle') {
      state.remainingMs = state.workDurationMs;
    }
    state.version++;
  }

  function start() {
    if (state.running) return;

    state.running = true;
    state.phase = 'work';
    state.remainingMs = state.workDurationMs;
    state.finishAt = now() + state.remainingMs;
    state.version++;

    return {
      phase: state.phase,
      finishAt: state.finishAt,
      remainingMs: state.remainingMs
    };
  }

  function pause() {
    if (!state.running) return null;

    const remaining = Math.max(0, state.finishAt - now());
    state.running = false;
    state.remainingMs = remaining;
    state.finishAt = null;
    state.version++;

    return {
      remainingMs: state.remainingMs
    };
  }

  function reset() {
    state.running = false;
    state.phase = 'idle';
    state.finishAt = null;
    state.remainingMs = 0;
    state.version++;
  }

  function resume() {
    if (state.running) return null;
    if (state.phase === 'idle') {
      // If user resumes from idle, treat as start.
      return start();
    }

    state.running = true;
    state.finishAt = now() + state.remainingMs;
    state.version++;

    return {
      phase: state.phase,
      finishAt: state.finishAt,
      remainingMs: state.remainingMs
    };
  }

  // Called when background service worker receives an alarm trigger.
  function onAlarmFired() {
    if (!state.running || state.finishAt == null) {
      return null;
    }

    // Compute remaining to be safe, but treat as completion.
    state.running = false;
    state.remainingMs = 0;
    const completedPhase = state.phase;
    state.finishAt = null;

    if (completedPhase === 'work') {
      state.phase = 'break';
      state.remainingMs = state.breakDurationMs;
    } else if (completedPhase === 'break') {
      state.phase = 'work';
      state.remainingMs = state.workDurationMs;
    } else {
      state.phase = 'idle';
    }

    state.version++;

    // Background decides whether to immediately schedule next phase and whether to show notification.
    onSessionCompleted?.({ completedPhase, nextPhase: state.phase });

    return {
      completedPhase,
      nextPhase: state.phase,
      nextRemainingMs: state.remainingMs
    };
  }

  return {
    getSnapshot,
    setPreset,
    start,
    pause,
    reset,
    resume,
    onAlarmFired
  };
}

