// Shared attachment grid + lightbox UI: upload -> thumbnail/file-icon
// grid -> save-to-disk/delete, with an image lightbox on click. Used by
// orderDetail.js (order attachments) and expenses.js (income-statement
// attachments, one instance per expanded row) -- previously two
// byte-for-byte-identical copies of this, differing only in which
// window.api.*Attachment methods to call.

import { escapeHtml, formatBytes } from './helpers.js';
import { showToast } from './toast.js';

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // keep in sync with the *AttachmentIpc.js files' server-side caps

// api: { list(): Promise<meta[]>, get(id): Promise<{data, mime_type, file_name}>,
//        add({fileName, mimeType, data}): Promise<void>, saveToDisk(id): Promise<path|null>,
//        remove(id): Promise<void> }
// gridEl/inputEl: the specific <div>/<input type="file"> elements to
// drive -- callers own creating/locating these (expenses.js has many,
// one per income-statement row; orderDetail.js has one, fixed).
// onChange: optional callback fired after any add/delete, for callers
// that need to refresh something else too (e.g. expenses.js's
// attachment-count column on the statement row).
export function createAttachmentGrid({ gridEl, inputEl, api, onChange }) {
  let objectUrls = [];

  function revokeObjectUrls() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls = [];
  }

  function openLightbox(url, altText) {
    const overlay = document.createElement('div');
    overlay.className = 'lightbox';
    overlay.innerHTML = `<button type="button" class="btn-secondary lightbox-close">Close</button><img src="${url}" alt="${escapeHtml(altText)}" />`;

    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKeydown);
    }
    function onKeydown(event) {
      if (event.key === 'Escape') close();
    }
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.classList.contains('lightbox-close')) close();
    });
    document.addEventListener('keydown', onKeydown);

    document.body.appendChild(overlay);
  }

  async function refresh() {
    revokeObjectUrls();
    const attachments = await api.list();

    if (attachments.length === 0) {
      gridEl.innerHTML = '<p class="muted">No attachments yet.</p>';
      return;
    }

    gridEl.innerHTML = attachments
      .map(
        (a) => `
        <div class="attachment-item">
          <div data-attachment-preview="${a.id}">
            ${a.mime_type.startsWith('image/') ? '' : '<div class="attachment-file">📎</div>'}
          </div>
          <div class="attachment-name">${escapeHtml(a.file_name)}</div>
          <div class="attachment-meta">${formatBytes(a.byte_size)}</div>
          <div class="attachment-actions">
            <button type="button" class="btn-secondary btn-sm" data-save-attachment="${a.id}">Save</button>
            <button type="button" class="danger btn-sm" data-delete-attachment="${a.id}">Delete</button>
          </div>
        </div>`
      )
      .join('');

    // The metadata list above deliberately excludes file bytes to stay
    // cheap -- fetch the actual data for image thumbnails only, one
    // attachment at a time.
    for (const a of attachments) {
      if (!a.mime_type.startsWith('image/')) continue;
      const full = await api.get(a.id);
      const blob = new Blob([full.data], { type: full.mime_type });
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      const previewEl = gridEl.querySelector(`[data-attachment-preview="${a.id}"]`);
      if (previewEl) {
        previewEl.innerHTML = `<img class="attachment-thumb" src="${url}" alt="${escapeHtml(a.file_name)}" />`;
        previewEl.querySelector('img').addEventListener('click', () => openLightbox(url, a.file_name));
      }
    }

    gridEl.querySelectorAll('[data-save-attachment]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const savedPath = await api.saveToDisk(Number(btn.dataset.saveAttachment));
          if (savedPath) showToast(`Saved to: ${savedPath}`);
        } catch (err) {
          alert(`Failed to save: ${err.message}`);
        }
      });
    });

    gridEl.querySelectorAll('[data-delete-attachment]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this attachment?')) return;
        await api.remove(Number(btn.dataset.deleteAttachment));
        await refresh();
        if (onChange) onChange();
      });
    });
  }

  // Shared by both the file-input `change` handler and the paste handler
  // below -- same per-file size check/upload/error-alert either way, the
  // only difference is where the FileList came from.
  async function addFiles(files) {
    if (files.length === 0) return;

    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        alert(`"${file.name}" is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). The limit is 20MB per file.`);
        continue;
      }
      const buffer = await file.arrayBuffer();
      try {
        await api.add({ fileName: file.name, mimeType: file.type || 'application/octet-stream', data: new Uint8Array(buffer) });
      } catch (err) {
        alert(`Failed to attach "${file.name}": ${err.message}`);
      }
    }

    await refresh();
    if (onChange) onChange();
  }

  // expenses.js can call createAttachmentGrid() again on the *same*
  // still-mounted <input>/<div> (opening a statement row's attachments
  // twice without an add/delete rebuilding that row's markup in between)
  // -- guard both wiring blocks below so a second call doesn't stack a
  // second set of listeners on top of the first, which would silently
  // upload/paste every file multiple times.
  if (inputEl && !inputEl.dataset.attachmentGridWired) {
    inputEl.dataset.attachmentGridWired = 'true';
    inputEl.addEventListener('change', async (event) => {
      const files = Array.from(event.target.files || []);
      event.target.value = ''; // allow re-selecting the same file(s) later
      await addFiles(files);
    });
  }

  // Clipboard sources differ slightly by OS/tool -- some populate
  // clipboardData.files directly (same shape as a drag-drop), others
  // only populate .items with a file-kind entry that needs getAsFile().
  // Tries the direct path first since it's the common case.
  function filesFromClipboard(clipboardData) {
    if (!clipboardData) return [];
    if (clipboardData.files && clipboardData.files.length > 0) return Array.from(clipboardData.files);
    return Array.from(clipboardData.items || [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter(Boolean);
  }

  if (gridEl && !gridEl.dataset.attachmentGridWired) {
    gridEl.dataset.attachmentGridWired = 'true';

    // Paste only reaches whichever element currently has focus, so the
    // grid needs to be focusable -- tabIndex makes a plain <div> a valid
    // paste target once clicked. A one-time hint above the grid (rather
    // than baked into refresh()'s own markup, which gets replaced on
    // every render) makes that discoverable without extra state to track.
    gridEl.tabIndex = 0;
    gridEl.insertAdjacentHTML('beforebegin', '<p class="hint">Click here, then press Ctrl+V to paste a screenshot.</p>');

    gridEl.addEventListener('paste', async (event) => {
      const rawFiles = filesFromClipboard(event.clipboardData);
      if (rawFiles.length === 0) return;
      event.preventDefault();

      // A pasted image often has a generic/empty name (varies by OS) --
      // fall back to something identifiable, with the loop index folded
      // in so pasting several images at once can't collide on the same
      // generated name.
      const files = rawFiles.map((file, index) => {
        if (file.name) return file;
        const ext = (file.type.split('/')[1] || 'png').split('+')[0];
        return new File([file], `pasted-image-${Date.now()}-${index}.${ext}`, { type: file.type });
      });

      await addFiles(files);
    });
  }

  return { refresh };
}
