/**
 * Pure procrastination tracking logic (no chrome.* or DOM).
 *
 * For testing: temporarily lower PROCRASTINATION_THRESHOLD_MS.
 */
export const PROCRASTINATION_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export function createProcrastinationEngine({
  now = () => Date.now()
} = {}) {
  let state = {
    tracking: false,
    startedAt: null
  };

  function startTracking() {
    if (state.tracking) return false;
    state.tracking = true;
    state.startedAt = now();
    return true;
  }

  function stopTracking() {
    state.tracking = false;
    state.startedAt = null;
  }

  function isTracking() {
    return !!state.tracking;
  }

  function getSnapshot() {
    return {
      tracking: state.tracking,
      startedAt: state.startedAt
    };
  }

  /**
   * checkElapsed: returns true iff threshold has been reached while tracking.
   * If it returns true, caller should typically stopTracking() after handling.
   */
  function checkElapsed(currentNow = now()) {
    if (!state.tracking || state.startedAt == null) return false;
    return (currentNow - state.startedAt) >= PROCRASTINATION_THRESHOLD_MS;
  }

  return {
    startTracking,
    stopTracking,
    isTracking,
    getSnapshot,
    checkElapsed
  };
}
