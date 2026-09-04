// Root controller. There's no framework/router library here -- `boot()`
// just looks at the vault's status and swaps the entire #app contents for
// the right "screen". Each screen module is responsible for its own
// contents and event listeners.

import { renderSetupView } from './views/setup.js';
import { renderLockScreen } from './views/lockScreen.js';
import { renderForcePassphraseResetView } from './views/forcePassphraseReset.js';
import { renderShell } from './views/shell.js';

const root = document.getElementById('app');

async function boot() {
  const status = await window.api.vault.status();

  if (!status.initialized) {
    renderSetupView(root, { onComplete: boot });
    return;
  }
  if (!status.unlocked) {
    renderLockScreen(root, { status, onUnlocked: boot });
    return;
  }
  if (status.mustResetPassphrase) {
    // Unlocked via the recovery phrase -- see security/passphrase.js's
    // mustResetPassphrase flag. Blocks access to the rest of the app
    // until a new passphrase (and, separately, a new recovery phrase) is
    // set, since the one just used no longer proves anything was
    // memorized.
    renderForcePassphraseResetView(root, { onComplete: boot });
    return;
  }
  renderShell(root, { onLocked: boot });
}

// The main process pushes this event whenever auto-lock (or a manual
// "Lock now" click) fires, so the UI drops back to the lock screen right
// away even if the user isn't actively doing anything in the app.
window.api.vault.onLocked(() => {
  boot();
});

boot();
