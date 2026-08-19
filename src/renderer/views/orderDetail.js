// A single order's own page -- like a ticket in a ticketing system.
// Reached from a person's condensed order list or the global Orders page.
// This view only ever exists for an order that's already been created
// (personDetail.js creates a blank one and navigates straight here), so
// unlike the old inline form, there's no create/edit mode switch to track.

import { escapeHtml, formatMoney, parseMoneyToCents, PAYMENT_METHOD_PRESETS, buildStatusOptions, loadingHtml } from '../helpers.js';
import { promptForPassphrase } from '../exportPassphrasePrompt.js';
import { createAttachmentGrid } from '../attachmentGrid.js';
import { showToast } from '../toast.js';

export function renderOrderDetailView(container, { navigate, orderId }) {
  container.innerHTML = loadingHtml();
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
            <button type="button" class="btn-secondary" id="order-export-data">Export order</button>
            <button type="button" class="danger" id="order-delete">Delete order</button>
          </div>
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
      showToast('Saved.');
    });

    container.querySelector('#order-export-pdf').addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      btn.disabled = true;
      try {
        const savedPath = await window.api.order.exportPdf(orderId);
        if (savedPath) showToast(`Saved PDF to: ${savedPath}`);
      } catch (err) {
        alert(`Failed to export PDF: ${err.message}`);
      } finally {
        btn.disabled = false;
      }
    });

    // Exports just this order (and its client's identity, so the
    // recipient's instance can attach it to the right person) to a
    // passphrase-encrypted file -- see settings.js's "Import" card and
    // personDetail.js's "Export client" button (same underlying
    // mechanism, this is the single-order version of it).
    container.querySelector('#order-export-data').addEventListener('click', async () => {
      const passphrase = await promptForPassphrase({
        title: 'Export order',
        helpText:
          "Choose a passphrase to protect this file, then share it with the recipient a different way than the file itself (e.g. tell them in person or a separate message) -- not your vault passphrase.",
      });
      if (!passphrase) return;

      try {
        const savedPath = await window.api.dataExchange.exportOrder(orderId, order.person_id, passphrase);
        if (savedPath) showToast(`Saved to: ${savedPath}`);
      } catch (err) {
        alert(`Failed to export: ${err.message}`);
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

    const attachmentGrid = createAttachmentGrid({
      gridEl: container.querySelector('#attachment-grid'),
      inputEl: container.querySelector('#attachment-input'),
      api: {
        list: () => window.api.orderAttachment.listByOrder(orderId),
        get: (id) => window.api.orderAttachment.get(id),
        add: ({ fileName, mimeType, data }) => window.api.orderAttachment.add({ orderId, fileName, mimeType, data }),
        saveToDisk: (id) => window.api.orderAttachment.saveToDisk(id),
        remove: (id) => window.api.orderAttachment.delete(id),
      },
    });

    await attachmentGrid.refresh();
  }
}
