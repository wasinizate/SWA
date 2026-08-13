'use strict';

// Auto-lock: polls the OS-wide idle time (mouse/keyboard activity anywhere
// on the system, not just this window) and locks the vault once it passes
// the configured threshold. Using powerMonitor instead of tracking
// renderer DOM events means idle time is measured correctly even if the
// app window isn't focused.

const { powerMonitor } = require('electron');
const passphrase = require('./passphrase');

const POLL_INTERVAL_MS = 15_000;

let pollHandle = null;

// getTimeoutSeconds: a function returning the current timeout (called on
// every poll, so changing it in Settings takes effect immediately).
// onLock: called with a reason string after the vault has been locked.
function start(getTimeoutSeconds, onLock) {
  stop(); // clear any previous timer before starting a new one

  pollHandle = setInterval(() => {
    if (!passphrase.isUnlocked()) return; // nothing to do if already locked

    const timeoutSeconds = getTimeoutSeconds();
    const idleSeconds = powerMonitor.getSystemIdleTime();

    if (idleSeconds >= timeoutSeconds) {
      passphrase.lock();
      if (onLock) onLock('idle-timeout');
    }
  }, POLL_INTERVAL_MS);
}

function stop() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

module.exports = { start, stop };
