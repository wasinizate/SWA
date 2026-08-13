// A single order's own page -- like a ticket in a ticketing system.
// Reached from a person's condensed order list or the global Orders page.
// This view only ever exists for an order that's already been created
// (personDetail.js creates a blank one and navigates straight here), so
// unlike the old inline form, there's no create/edit mode switch to track.

import {
  escapeHtml,
  formatMoney,
  formatBytes,
  parseMoneyToCents,
  PAYMENT_METHOD_PRESETS,
  buildStatusOptions,
} from '../helpers.js';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // keep in sync with orderAttachmentIpc.js's server-side cap

export function renderOrderDetailView(container, { navigate, orderId }) {
  container.innerHTML = '<p>Loading...</p>';
  load();

  async function load() {
    const order = await window.api.order.get(orderId);
    if (!order) {
      container.innerHTML = '<p>Order not found.</p><button id="back" type="button">Back to Clients</button>';
      container.querySelector('#back').addEventListener('click', () => navigate('people'));
      return;
    }

    const person = await window.api.person.get(order.person_id);
    const accounts = await window.api.platformAccount.listByPerson(order.person_id);

    container.innerHTML = `
      <button class="link-button" id="back" type="button">&larr; Back to ${escapeHtml(person.private_label)}</button>
      <h1>Order #${order.id}</h1>

      <section class="card">
        <h2>Details</h2>
        <form id="order-form">
          <div class="inline-form">
            <select id="order-account">
              <option value="">(no linked account)</option>
              ${accounts
                .map(
                  (a) =>
                    `<option value="${a.id}" ${a.id === order.platform_account_id ? 'selected' : ''}>${escapeHtml(a.platform_name)} - ${escapeHtml(a.username)}</option>`
                )
                .join('')}
            </select>
            <input type="number" id="order-amount" placeholder="Amount" step="0.01" min="0" value="${(order.amount_cents / 100).toFixed(2)}" required />
            <input type="date" id="order-date-paid" value="${order.date_paid ?? ''}" />
            <select id="order-status">${buildStatusOptions(order.status)}</select>
            <input type="text" id="order-payment-method" placeholder="Payment method" list="payment-method-options" value="${escapeHtml(order.payment_method || '')}" />
          </div>
          <datalist id="payment-method-options"></datalist>

          <label>
            Delivery due
            <input type="date" id="order-delivery-due-date" value="${order.delivery_due_date ?? ''}" />
          </label>
          <label>
            Due time (optional)
            <input type="time" id="order-delivery-due-time" value="${order.delivery_due_time ?? ''}" />
          </label>
          <p class="hint">Automatically shows on the Calendar once a due date is set.</p>

          <label class="description-label">
            Description
            <textarea
              id="order-description"
              class="description-field"
              rows="8"
              placeholder="What's included, revisions, deadlines -- anything you'll want to check back on while working"
            >${escapeHtml(order.description)}</textarea>
          </label>

          <div class="form-actions">
            <button type="submit">Save changes</button>
            <button type="button" class="btn-secondary" id="order-export-pdf">Export PDF</button>
            <button type="button" class="danger" id="order-delete">Delete order</button>
          </div>
          <p class="hint" id="save-confirmation" hidden>Saved.</p>
        </form>
      </section>

      <details class="calculator">
        <summary>Price calculator</summary>
        <table class="data-table">
          <thead><tr><th>Item</th><th>Rate ($/unit)</th><th>Qty</th><th>Subtotal</th><th></th></tr></thead>
          <tbody id="calc-rows"></tbody>
        </table>
        <button type="button" class="btn-secondary btn-sm" id="calc-add-row">Add line</button>
        <p class="calc-total-line">Calculator total: <strong id="calc-total">$0.00</strong></p>
        <div class="form-actions">
          <button type="button" class="btn-secondary" id="calc-use-total">Use this total for Amount</button>
          <button type="button" class="btn-secondary" id="calc-insert-description">Insert breakdown into description</button>
        </div>
      </details>

      <section class="card">
        <h2>Feedback &amp; reflection</h2>
        <p class="hint">How did it go? What did the client think? Would you do it again? Notes for your own reference -- helps spot patterns across clients over time.</p>
        <label>
          Notes
          <textarea id="order-feedback-notes" rows="4">${escapeHtml(order.feedback_notes)}</textarea>
        </label>
        <label>
          Would you work with them again?
          <select id="order-would-repeat">
            <option value="" ${!order.would_repeat ? 'selected' : ''}>(not set)</option>
            <option value="yes" ${order.would_repeat === 'yes' ? 'selected' : ''}>Yes</option>
            <option value="no" ${order.would_repeat === 'no' ? 'selected' : ''}>No</option>
            <option value="maybe" ${order.would_repeat === 'maybe' ? 'selected' : ''}>Maybe</option>
          </select>
        </label>
      </section>

      <section class="card">
        <h2>Attachments</h2>
        <p class="hint">Screenshots or example files for this order -- stored encrypted, right alongside everything else.</p>
        <input type="file" id="attachment-input" multiple />
        <div class="attachment-grid" id="attachment-grid"></div>
      </section>
    `;

    container.querySelector('#back').addEventListener('click', () => navigate('personDetail', { personId: order.person_id }));

    // ---- Save / export / delete ----------------------------------------

    container.querySelector('#order-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const accountValue = container.querySelector('#order-account').value;
      await window.api.order.update(orderId, {
        platformAccountId: accountValue ? Number(accountValue) : null,
        amountCents: parseMoneyToCents(container.querySelector('#order-amount').value),
        datePaid: container.querySelector('#order-date-paid').value || null,
        status: container.querySelector('#order-status').value || 'pending',
        paymentMethod: container.querySelector('#order-payment-method').value,
        description: container.querySelector('#order-description').value,
        deliveryDueDate: container.querySelector('#order-delivery-due-date').value || null,
        deliveryDueTime: container.querySelector('#order-delivery-due-time').value || null,
        feedbackNotes: container.querySelector('#order-feedback-notes').value,
        wouldRepeat: container.querySelector('#order-would-repeat').value,
      });
      const confirmation = container.querySelector('#save-confirmation');
      confirmation.hidden = false;
      setTimeout(() => (confirmation.hidden = true), 1500);
    });

    container.querySelector('#order-export-pdf').addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      btn.disabled = true;
      try {
        const savedPath = await window.api.order.exportPdf(orderId);
        if (savedPath) alert(`Saved PDF to:\n${savedPath}`);
      } catch (err) {
        alert(`Failed to export PDF: ${err.message}`);
      } finally {
        btn.disabled = false;
      }
    });

    container.querySelector('#order-delete').addEventListener('click', async () => {
      if (!confirm('Delete this order? This cannot be undone.')) return;
      await window.api.order.delete(orderId);
      navigate('personDetail', { personId: order.person_id });
    });

    // ---- Price calculator (client-side only, no DB involved) ----------

    let calcLines = [];

    function calcLineSubtotalCents(line) {
      const rateCents = parseMoneyToCents(line.rate);
      const qty = Number.parseFloat(line.qty) || 0;
      return Math.round(rateCents * qty);
    }

    function calcTotalCents() {
      return calcLines.reduce((sum, line) => sum + calcLineSubtotalCents(line), 0);
    }

    function updateCalcTotals() {
      container.querySelectorAll('[data-calc-subtotal]').forEach((cell) => {
        const index = Number(cell.dataset.calcSubtotal);
        cell.textContent = formatMoney(calcLineSubtotalCents(calcLines[index]));
      });
      container.querySelector('#calc-total').textContent = formatMoney(calcTotalCents());
    }

    function renderCalcRows() {
      const tbody = container.querySelector('#calc-rows');
      tbody.innerHTML = calcLines
        .map(
          (line, index) => `
          <tr>
            <td><input type="text" data-calc-index="${index}" data-calc-field="label" value="${escapeHtml(line.label)}" placeholder="e.g. Custom video" /></td>
            <td><input type="number" data-calc-index="${index}" data-calc-field="rate" value="${escapeHtml(line.rate)}" step="0.01" min="0" placeholder="0.00" /></td>
            <td><input type="number" data-calc-index="${index}" data-calc-field="qty" value="${escapeHtml(line.qty)}" step="0.01" min="0" placeholder="0" /></td>
            <td data-calc-subtotal="${index}">${formatMoney(calcLineSubtotalCents(line))}</td>
            <td><button type="button" class="danger" data-calc-remove="${index}">Remove</button></td>
          </tr>`
        )
        .join('');

      // Update state + just the affected cells on every keystroke, rather
      // than re-rendering the whole table -- re-rendering would recreate
      // the <input> elements and kick focus out mid-typing.
      tbody.querySelectorAll('[data-calc-field]').forEach((input) => {
        input.addEventListener('input', () => {
          const index = Number(input.dataset.calcIndex);
          calcLines[index][input.dataset.calcField] = input.value;
          updateCalcTotals();
        });
      });

      tbody.querySelectorAll('[data-calc-remove]').forEach((btn) => {
        btn.addEventListener('click', () => {
          calcLines.splice(Number(btn.dataset.calcRemove), 1);
          renderCalcRows();
        });
      });

      updateCalcTotals();
    }

    function calcBreakdownText() {
      const itemLines = calcLines
        .filter((line) => line.label || line.rate || line.qty)
        .map((line) => {
          const qty = line.qty || '0';
          const rate = formatMoney(parseMoneyToCents(line.rate));
          const subtotal = formatMoney(calcLineSubtotalCents(line));
          return `${line.label || 'Item'} — ${qty} × ${rate} = ${subtotal}`;
        });
      itemLines.push(`Total: ${formatMoney(calcTotalCents())}`);
      return itemLines.join('\n');
    }

    container.querySelector('#calc-add-row').addEventListener('click', () => {
      calcLines.push({ label: '', rate: '', qty: '' });
      renderCalcRows();
    });

    container.querySelector('#calc-use-total').addEventListener('click', () => {
      container.querySelector('#order-amount').value = (calcTotalCents() / 100).toFixed(2);
    });

    container.querySelector('#calc-insert-description').addEventListener('click', () => {
      const textarea = container.querySelector('#order-description');
      const breakdown = calcBreakdownText();
      textarea.value = textarea.value.trim() ? `${textarea.value}\n\n${breakdown}` : breakdown;
    });

    renderCalcRows();

    // ---- Payment-method suggestions -------------------------------------

    const usedPaymentMethods = (await window.api.order.listByPerson(order.person_id))
      .map((o) => o.payment_method)
      .filter(Boolean);
    const allPaymentOptions = Array.from(new Set([...PAYMENT_METHOD_PRESETS, ...usedPaymentMethods]));
    container.querySelector('#payment-method-options').innerHTML = allPaymentOptions
      .map((value) => `<option value="${escapeHtml(value)}"></option>`)
      .join('');

    // ---- Attachments -----------------------------------------------------

    let attachmentObjectUrls = [];

    function revokeAttachmentObjectUrls() {
      attachmentObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      attachmentObjectUrls = [];
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

      container.appendChild(overlay);
    }

    async function refreshAttachments() {
      revokeAttachmentObjectUrls();
      const attachments = await window.api.orderAttachment.listByOrder(orderId);
      const grid = container.querySelector('#attachment-grid');

      if (attachments.length === 0) {
        grid.innerHTML = '<p class="muted">No attachments yet.</p>';
        return;
      }

      grid.innerHTML = attachments
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
        const full = await window.api.orderAttachment.get(a.id);
        const blob = new Blob([full.data], { type: full.mime_type });
        const url = URL.createObjectURL(blob);
        attachmentObjectUrls.push(url);
        const previewEl = grid.querySelector(`[data-attachment-preview="${a.id}"]`);
        if (previewEl) {
          previewEl.innerHTML = `<img class="attachment-thumb" src="${url}" alt="${escapeHtml(a.file_name)}" />`;
          previewEl.querySelector('img').addEventListener('click', () => openLightbox(url, a.file_name));
        }
      }

      grid.querySelectorAll('[data-save-attachment]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            const savedPath = await window.api.orderAttachment.saveToDisk(Number(btn.dataset.saveAttachment));
            if (savedPath) alert(`Saved to:\n${savedPath}`);
          } catch (err) {
            alert(`Failed to save: ${err.message}`);
          }
        });
      });

      grid.querySelectorAll('[data-delete-attachment]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this attachment?')) return;
          await window.api.orderAttachment.delete(Number(btn.dataset.deleteAttachment));
          await refreshAttachments();
        });
      });
    }

    container.querySelector('#attachment-input').addEventListener('change', async (event) => {
      const files = Array.from(event.target.files || []);
      event.target.value = ''; // allow re-selecting the same file(s) later
      if (files.length === 0) return;

      for (const file of files) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          alert(`"${file.name}" is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). The limit is 20MB per file.`);
          continue;
        }
        const buffer = await file.arrayBuffer();
        try {
          await window.api.orderAttachment.add({
            orderId,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            data: new Uint8Array(buffer),
          });
        } catch (err) {
          alert(`Failed to attach "${file.name}": ${err.message}`);
        }
      }

      await refreshAttachments();
    });

    await refreshAttachments();
  }
}
