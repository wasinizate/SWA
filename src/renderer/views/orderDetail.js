// A single order's own page -- like a ticket in a ticketing system.
// Reached from a person's condensed order list or the global Orders page.
// This view only ever exists for an order that's already been created
// (personDetail.js creates a blank one and navigates straight here), so
// unlike the old inline form, there's no create/edit mode switch to track.

import { escapeHtml, formatMoney, parseMoneyToCents, PAYMENT_METHOD_PRESETS, buildStatusOptions, loadingHtml } from '../helpers.js';
import { promptForPassphrase } from '../exportPassphrasePrompt.js';
import { createAttachmentGrid } from '../attachmentGrid.js';
import { createLineItemRows } from '../lineItemRows.js';
import { openModal } from '../modal.js';
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

        <label>
          Load template
          <select id="calc-template-select">
            <option value="">-- Select a template --</option>
          </select>
        </label>

        <table class="data-table">
          <thead><tr><th>Item</th><th>Rate ($/unit)</th><th>Qty</th><th>Subtotal</th><th></th></tr></thead>
          <tbody id="calc-rows"></tbody>
        </table>
        <button type="button" class="btn-secondary btn-sm" id="calc-add-row">Add line</button>

        <div class="calc-totals">
          <p class="calc-total-line">Subtotal: <strong id="calc-subtotal">$0.00</strong></p>
          <label class="calc-discount-label">
            Discount %
            <input type="number" id="calc-discount" min="0" max="100" step="0.1" value="0" />
          </label>
          <p class="calc-total-line">Total: <strong id="calc-total">$0.00</strong></p>
        </div>

        <div class="form-actions">
          <button type="button" class="btn-secondary" id="calc-use-total">Use this total for Amount</button>
          <button type="button" class="btn-secondary" id="calc-insert-description">Insert breakdown into description</button>
          <button type="button" class="btn-secondary" id="calc-save-template">Save as template</button>
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

    // ---- Price calculator (rows are client-side only; templates are the
    // only part of this that touches the DB, via priceTemplate.*) -------

    const lineItemRows = createLineItemRows({
      tbody: container.querySelector('#calc-rows'),
      onChange: updateCalcTotals,
    });

    function discountPercent() {
      const value = Number.parseFloat(container.querySelector('#calc-discount').value);
      if (Number.isNaN(value)) return 0;
      return Math.min(Math.max(value, 0), 100);
    }

    function calcTotalCents() {
      return Math.round(lineItemRows.totalCents() * (1 - discountPercent() / 100));
    }

    function updateCalcTotals() {
      container.querySelector('#calc-subtotal').textContent = formatMoney(lineItemRows.totalCents());
      container.querySelector('#calc-total').textContent = formatMoney(calcTotalCents());
    }

    function calcBreakdownText() {
      const itemLines = lineItemRows
        .getLines()
        .filter((line) => line.label || line.rate || line.qty)
        .map((line) => {
          const qty = line.qty || '0';
          const rate = formatMoney(parseMoneyToCents(line.rate));
          const subtotal = formatMoney(Math.round(parseMoneyToCents(line.rate) * (Number.parseFloat(line.qty) || 0)));
          return `${line.label || 'Item'} — ${qty} × ${rate} = ${subtotal}`;
        });
      itemLines.push(`Subtotal: ${formatMoney(lineItemRows.totalCents())}`);
      const discount = discountPercent();
      if (discount > 0) itemLines.push(`Discount: ${discount}%`);
      itemLines.push(`Total: ${formatMoney(calcTotalCents())}`);
      return itemLines.join('\n');
    }

    // The order's currently-selected platform account (read live from
    // the <select>, not the saved order -- so switching it before saving
    // already affects which templates sort first below).
    function currentPlatformName() {
      const account = accounts.find((a) => a.id === Number(container.querySelector('#order-account').value));
      return account ? account.platform_name : '';
    }

    let allTemplates = [];

    async function loadTemplateOptions() {
      allTemplates = await window.api.priceTemplate.listAll();
      const platform = currentPlatformName();

      // Templates for this order's own platform sort first, so the
      // relevant ones are right at the top instead of buried
      // alphabetically among every other platform's.
      const sorted = [...allTemplates].sort((a, b) => {
        const aMatches = a.platform_name === platform ? 0 : 1;
        const bMatches = b.platform_name === platform ? 0 : 1;
        if (aMatches !== bMatches) return aMatches - bMatches;
        return `${a.platform_name} ${a.label}`.localeCompare(`${b.platform_name} ${b.label}`);
      });

      container.querySelector('#calc-template-select').innerHTML = `
        <option value="">-- Select a template --</option>
        ${sorted.map((t) => `<option value="${t.id}">${escapeHtml(t.platform_name)} — ${escapeHtml(t.label)}</option>`).join('')}
      `;
    }

    container.querySelector('#calc-template-select').addEventListener('change', (event) => {
      const select = event.currentTarget;
      const templateId = Number(select.value);
      if (!templateId) return;

      if (lineItemRows.getLines().length > 0 && !confirm('Replace the current calculator lines with this template?')) {
        select.value = '';
        return;
      }

      const template = allTemplates.find((t) => t.id === templateId);
      select.value = '';
      if (!template) return;

      lineItemRows.setLines(template.items);
      container.querySelector('#calc-discount').value = template.default_discount_percent || 0;
      updateCalcTotals();
    });

    container.querySelector('#order-account').addEventListener('change', loadTemplateOptions);
    container.querySelector('#calc-discount').addEventListener('input', updateCalcTotals);

    container.querySelector('#calc-add-row').addEventListener('click', () => lineItemRows.addLine());

    container.querySelector('#calc-use-total').addEventListener('click', () => {
      container.querySelector('#order-amount').value = (calcTotalCents() / 100).toFixed(2);
    });

    container.querySelector('#calc-insert-description').addEventListener('click', () => {
      const textarea = container.querySelector('#order-description');
      const breakdown = calcBreakdownText();
      textarea.value = textarea.value.trim() ? `${textarea.value}\n\n${breakdown}` : breakdown;
    });

    // Captures the calculator's current rows + discount as a new,
    // reusable template -- the quick-save counterpart to "Load template"
    // above; the full library (rename/edit/delete) lives in Settings'
    // "Price templates" card.
    container.querySelector('#calc-save-template').addEventListener('click', () => {
      const lines = lineItemRows.getLines().filter((line) => line.label || line.rate || line.qty);
      if (lines.length === 0) {
        alert('Add at least one line before saving a template.');
        return;
      }

      openModal({
        title: 'Save as price template',
        render: (body, close) => {
          body.innerHTML = `
            <form id="save-template-form">
              <label>Platform <input type="text" id="template-platform" value="${escapeHtml(currentPlatformName())}" required /></label>
              <label>Label <input type="text" id="template-label" placeholder="e.g. Custom video" required /></label>
              <div class="form-actions">
                <button type="submit">Save</button>
              </div>
            </form>
          `;
          body.querySelector('#save-template-form').addEventListener('submit', async (event) => {
            event.preventDefault();
            await window.api.priceTemplate.create({
              platformName: body.querySelector('#template-platform').value,
              label: body.querySelector('#template-label').value,
              defaultDiscountPercent: discountPercent(),
              items: lines.map((line) => ({
                label: line.label,
                rateCents: parseMoneyToCents(line.rate),
                defaultQty: Number.parseFloat(line.qty) || 0,
              })),
            });
            close();
            showToast('Template saved.');
            await loadTemplateOptions();
          });
        },
      });
    });

    lineItemRows.render();
    updateCalcTotals();
    await loadTemplateOptions();

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
