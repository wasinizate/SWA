// Shared "what's the relationship between these two clients" flow --
// used from Settings' possible-duplicates list, from the Clients list's
// linking mode (see people.js), and from a client's own "Linked
// clients" card. Three outcomes:
//   - Keep separate, just link them -- a lightweight, reversible note
//     that these two might be connected (see person_links,
//     0019_person_links.sql). Never merges or moves any data.
//   - Merge into A / Merge into B -- the real fix for a confirmed
//     duplicate (see person.js's mergeInto()): everything the other one
//     owns moves over, then it's deleted. Permanent.
// Nothing here ever happens automatically -- always a human choice,
// confirmed with an explicit dialog before the destructive merge option
// specifically (linking has nothing to confirm -- it changes nothing
// about either client's own data, so it's low-stakes enough not to need
// one).

import { escapeHtml } from './helpers.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';

export function openPersonLinkModal({ personAId, personBId, onResolved }) {
  openModal({
    title: 'Link or merge clients',
    render: async (body, close) => {
      body.innerHTML = '<p class="loading-state">Loading…</p>';
      const [personA, personB] = await Promise.all([window.api.person.get(personAId), window.api.person.get(personBId)]);
      if (!personA || !personB) {
        body.innerHTML = '<p>One of these clients no longer exists (already merged or deleted?).</p>';
        return;
      }

      body.innerHTML = `
        <p class="hint">
          Not sure yet whether "${escapeHtml(personA.private_label)}" and "${escapeHtml(personB.private_label)}" are the
          same person? Link them -- a note on both pages, nothing else changes, undo any time. Sure they're
          the same? Merge -- everything moves onto one record and the other is deleted. This can't be undone.
        </p>
        <label>
          Link note (optional)
          <input type="text" id="link-note" placeholder="e.g. same handle reused on Reddit" />
        </label>
        <div class="form-actions">
          <button type="button" class="btn-secondary" id="just-link">Keep separate, just link them</button>
        </div>
        <p class="hint">Or merge permanently:</p>
        <div class="merge-choice-grid">
          <button type="button" class="btn-secondary" id="keep-a">Merge -- keep "${escapeHtml(personA.private_label)}"</button>
          <button type="button" class="btn-secondary" id="keep-b">Merge -- keep "${escapeHtml(personB.private_label)}"</button>
        </div>
      `;

      body.querySelector('#just-link').addEventListener('click', async () => {
        const note = body.querySelector('#link-note').value.trim();
        try {
          await window.api.personLink.create(personAId, personBId, note);
          close();
          showToast(`Linked "${personA.private_label}" and "${personB.private_label}".`);
          if (onResolved) onResolved(null);
        } catch (err) {
          alert(`Failed to link: ${err.message}`);
        }
      });

      body.querySelector('#keep-a').addEventListener('click', () =>
        runMerge(personB.id, personA.id, personA.private_label, personB.private_label)
      );
      body.querySelector('#keep-b').addEventListener('click', () =>
        runMerge(personA.id, personB.id, personB.private_label, personA.private_label)
      );

      async function runMerge(loserId, survivorId, survivorLabel, loserLabel) {
        if (!confirm(`Merge "${loserLabel}" into "${survivorLabel}"? "${loserLabel}" will be deleted. This cannot be undone.`)) return;
        try {
          await window.api.person.mergeInto(loserId, survivorId);
          close();
          showToast(`Merged. "${loserLabel}" is gone -- everything it had is now on "${survivorLabel}".`);
          if (onResolved) onResolved(survivorId);
        } catch (err) {
          alert(`Failed to merge: ${err.message}`);
        }
      }
    },
  });
}
