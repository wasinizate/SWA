'use strict';

// Background poller for shared-folder collaborative sync (see
// syncFolder.js for the actual file I/O). Same polling shape as
// ../reminders/reminderScheduler.js (guards on the vault being
// unlocked), plus its own guards: sync must be enabled, a folder path
// configured, and a sync passphrase stored.
//
// Each tick: export shared clients to the folder, then scan for other
// instances' exports. An incoming bundle only becomes a "pending" item
// -- surfaced in Settings for a human to review and apply, never
// applied automatically -- if applyImport.js's existing previewImport()
// finds something to show *and* it's newer than what sync_seen already
// recorded for that source. This project's own existing design
// philosophy (applyImport.js's top comment: changes are "never applied
// silently") extends here on purpose, not by oversight.

const { Notification } = require('electron');
const passphrase = require('../security/passphrase');
const settingsRepo = require('../db/repositories/settings');
const syncPassphraseStore = require('./syncPassphrase');
const syncSeenRepo = require('../db/repositories/syncSeen');
const { exportSharedPersonsToFolder, scanFolderForIncoming } = require('./syncFolder');
const { previewImport } = require('../dataExchange/applyImport');

// 15 minutes -- not exposed as a setting, same "keep it simple" scope as
// reminderScheduler's own fixed interval. This is just the background
// safety net now that runNow() (see below) lets either side push/pull
// on demand instead of waiting on the poll -- was 2 minutes before that
// button existed, which was needlessly chatty for a background cycle
// nobody's actually watching in real time.
const POLL_INTERVAL_MS = 900_000;

let pollHandle = null;
let currentGetMainWindow = null;
// key (sourceInstanceId::personExternalId) -> { id, sourceInstanceId, personExternalId, bundle, preview }
let pending = new Map();

function pendingKey(sourceInstanceId, personExternalId) {
  return `${sourceInstanceId}::${personExternalId}`;
}

function hasPreviewContent(preview) {
  return (
    preview.newOrderCount > 0 ||
    preview.updates.length > 0 ||
    !preview.resolved ||
    (preview.personChanges && Object.keys(preview.personChanges).length > 0)
  );
}

function showNotification(title, body, getMainWindow) {
  if (!Notification.isSupported()) return;

  const notification = new Notification({ title, body });
  notification.on('click', () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });
  notification.show();
}

// Returns a small summary ({ written, newPendingCount }) so both the
// scheduled poll (which ignores it) and runNow() (which hands it to the
// "Sync now" button for a toast) can report what happened this cycle.
function runCycle(getMainWindow) {
  const folderPath = settingsRepo.getSyncFolderPath();
  const syncPass = syncPassphraseStore.getSyncPassphrase();
  if (!folderPath || !syncPass) return { written: 0, newPendingCount: 0 };

  const instanceId = settingsRepo.getSyncInstanceId();

  const { written } = exportSharedPersonsToFolder(folderPath, instanceId, syncPass);
  const { incoming } = scanFolderForIncoming(folderPath, instanceId, syncPass);

  let newPendingCount = 0;
  for (const item of incoming) {
    const key = pendingKey(item.sourceInstanceId, item.personExternalId);
    const seen = syncSeenRepo.get(item.sourceInstanceId, item.personExternalId);
    if (seen && seen.last_exported_at >= item.bundle.exportedAt) continue; // already processed this export or a newer one

    const preview = previewImport(item.bundle);
    if (!hasPreviewContent(preview)) {
      // Nothing to show (the two sides already agree) -- record as seen
      // so this doesn't get re-evaluated every tick, and move on.
      syncSeenRepo.markSeen(item.sourceInstanceId, item.personExternalId, item.bundle.exportedAt);
      continue;
    }

    const alreadyPending = pending.get(key);
    if (alreadyPending && alreadyPending.bundle.exportedAt === item.bundle.exportedAt) continue; // same still-unreviewed item, don't re-notify

    pending.set(key, { id: key, sourceInstanceId: item.sourceInstanceId, personExternalId: item.personExternalId, bundle: item.bundle, preview });
    newPendingCount += 1;
    showNotification('SWA sync', `New updates for "${preview.personLabel}" from a collaborator`, getMainWindow);
  }

  return { written, newPendingCount };
}

// getMainWindow: a function returning the current BrowserWindow (see
// reminderScheduler.js's own parameter for why a function, not the
// window itself). Stashed in currentGetMainWindow too so runNow() (a
// one-off manual cycle triggered from Settings, not the interval) can
// reuse the same window reference for its own incoming-update
// notifications without every caller needing to thread it through.
function start(getMainWindow) {
  stop();
  currentGetMainWindow = getMainWindow;
  pollHandle = setInterval(() => {
    if (!settingsRepo.getSyncEnabled()) return; // background cadence only -- runNow() below bypasses this on purpose
    if (!passphrase.isUnlocked()) return;
    try {
      runCycle(getMainWindow);
    } catch (err) {
      // A single bad cycle (e.g. a transient filesystem error) shouldn't
      // kill the poller for the rest of the session.
    }
  }, POLL_INTERVAL_MS);
}

// Runs one sync cycle immediately, for the "Sync now" button -- doesn't
// check settingsRepo.getSyncEnabled() the way the interval does, since
// "enabled" only governs the *background* cadence; someone who's turned
// that off (or just doesn't want to wait 15 minutes) can still push/pull
// on demand as long as a folder and passphrase are configured. Throws a
// clear error for the two things that actually block a manual run, same
// "thrown Error becomes a toast" convention used everywhere else in this
// app's IPC layer.
function runNow() {
  if (!settingsRepo.getSyncFolderPath()) throw new Error('Choose a sync folder first.');
  if (!syncPassphraseStore.getSyncPassphrase()) throw new Error('Set a sync passphrase first.');
  return runCycle(currentGetMainWindow || (() => null));
}

function stop() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  currentGetMainWindow = null;
  // Un-reviewed pending items are cleared, not persisted, on lock --
  // they hold decrypted bundle contents (client notes, financial data),
  // and "locked" should mean nothing decrypted stays resident in memory.
  // Nothing is actually lost: sync_seen was never updated for them, so
  // they're simply rediscovered (and re-notified) on the next unlock's
  // first cycle.
  pending.clear();
}

function listPending() {
  return Array.from(pending.values());
}

function getPending(id) {
  return pending.get(id);
}

function resolvePending(id) {
  pending.delete(id);
}

module.exports = { start, stop, runNow, listPending, getPending, resolvePending };
