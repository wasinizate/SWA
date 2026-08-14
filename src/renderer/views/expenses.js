// Expenses tab: a business-wide income summary (confirmed + slated +
// manual pay-statement income, minus expenses), an expense ledger, and
// manually-entered platform pay-statement totals (with the source PDF
// attachable as backup -- see 0007_expenses_and_income.sql's comment for
// why this isn't auto-parsed from the PDF).
//
// Unlike Orders/People, income statements don't get their own detail
// page -- their attachment grid is a small inline expandable row here,
// reusing orderDetail.js's attachment pattern (upload -> ArrayBuffer ->
// IPC, thumbnail/file-icon grid, Save/Delete) scoped to
// income_statement_id instead of order_id.

import {
  escapeHtml,
  formatMoney,
  formatBytes,
  previewText,
  parseMoneyToCents,
  toDateInputValue,
  orderStatusLabel,
  EXPENSE_CATEGORY_PRESETS,
} from '../helpers.js';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // keep in sync with incomeStatementAttachmentIpc.js's cap

function todayDateInputValue() {
  return toDateInputValue(new Date().toISOString());
}

// Merges three { period, total_cents }[] arrays (confirmed income,
// statement income, expenses -- all grouped by the same 'YYYY' or
// 'YYYY-MM' period string) into one net-per-period list. A period
// present in only one dataset still shows up, treating the others as 0
// for that period.
function computeNetByPeriod(confirmedRows, statementRows, expenseRows) {
  const toMap = (rows) => new Map(rows.map((r) => [r.period, r.total_cents]));
  const confirmedMap = toMap(confirmedRows);
  const statementMap = toMap(statementRows);
  const expenseMap = toMap(expenseRows);

  const periods = new Set([...confirmedMap.keys(), ...statementMap.keys(), ...expenseMap.keys()]);

  return Array.from(periods)
    .sort((a, b) => (a < b ? 1 : -1)) // newest first, same direction as the underlying queries
    .map((period) => ({
      period,
      netCents: (confirmedMap.get(period) || 0) + (statementMap.get(period) || 0) - (expenseMap.get(period) || 0),
    }));
}

export function renderExpensesView(container, { navigate }) {
  container.innerHTML = `
    <h1>Expenses</h1>

    <section class="card">
      <div class="totals-header">
        <h2>Income summary</h2>
        <div class="totals-toggle">
          <button type="button" class="totals-tab active" data-period="all">All time</button>
          <button type="button" class="totals-tab" data-period="year">By year</button>
          <button type="button" class="totals-tab" data-period="month">By month</button>
        </div>
      </div>
      <div id="income-summary-body"></div>
      <p class="hint">
        "Net" is confirmed income + income statements − expenses. Slated
        income (below) is money expected from unpaid orders -- not
        confirmed yet, so it's kept out of Net.
      </p>

      <h3>Slated income</h3>
      <div id="slated-income-body"></div>
    </section>

    <section class="card">
      <div class="section-header">
        <h2>Expenses</h2>
      </div>
      <form id="expense-form" class="inline-form">
        <input type="date" id="expense-date" required />
        <input type="number" id="expense-amount" step="0.01" min="0" placeholder="Amount" required />
        <input type="text" id="expense-category" placeholder="Category" list="expense-category-options" />
        <datalist id="expense-category-options">
          ${EXPENSE_CATEGORY_PRESETS.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}
        </datalist>
        <input type="text" id="expense-description" placeholder="Description" />
        <button type="submit">Add expense</button>
      </form>

      <div class="toolbar">
        <label>
          Category
          <select id="expense-filter-category">
            <option value="">All</option>
          </select>
        </label>
      </div>

      <table class="data-table">
        <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th></th></tr></thead>
        <tbody id="expense-rows"></tbody>
      </table>
    </section>

    <section class="card">
      <div class="section-header">
        <h2>Income statements</h2>
      </div>
      <p class="hint">
        Manually-entered totals from a platform's pay statement (e.g. an
        OnlyFans payout summary) -- attach the source PDF as backup.
      </p>
      <form id="statement-form" class="inline-form">
        <label>From <input type="date" id="statement-period-start" required /></label>
        <label>To <input type="date" id="statement-period-end" required /></label>
        <input type="text" id="statement-platform" placeholder="Platform (e.g. OnlyFans)" />
        <input type="number" id="statement-gross" step="0.01" min="0" placeholder="Gross" required />
        <input type="number" id="statement-fees" step="0.01" min="0" placeholder="Fees" value="0" />
        <input type="number" id="statement-net" step="0.01" min="0" placeholder="Net" required />
        <button type="submit">Add statement</button>
      </form>

      <table class="data-table">
        <thead>
          <tr><th>Period</th><th>Platform</th><th>Gross</th><th>Fees</th><th>Net</th><th>Attachments</th><th></th></tr>
        </thead>
        <tbody id="statement-rows"></tbody>
      </table>
    </section>
  `;

  // ---- Income summary -----------------------------------------------------

  let summaryPeriod = 'all';

  async function refreshSummary() {
    const [confirmed, slated, statements, expenseTotals] = await Promise.all([
      window.api.order.getTotalsAll(),
      window.api.order.getSlatedIncomeTotals(),
      window.api.incomeStatement.getTotals(),
      window.api.expense.getTotals(),
    ]);

    const summaryBody = container.querySelector('#income-summary-body');

    if (summaryPeriod === 'all') {
      const netCents = confirmed.allTimeCents + statements.allTimeCents - expenseTotals.allTimeCents;
      summaryBody.innerHTML = `
        <div class="income-summary-grid">
          <div class="income-stat">
            <div class="income-stat-label">Confirmed income</div>
            <div class="income-stat-value">${formatMoney(confirmed.allTimeCents)}</div>
          </div>
          <div class="income-stat">
            <div class="income-stat-label">Income statements</div>
            <div class="income-stat-value">${formatMoney(statements.allTimeCents)}</div>
          </div>
          <div class="income-stat">
            <div class="income-stat-label">Expenses</div>
            <div class="income-stat-value">${formatMoney(expenseTotals.allTimeCents)}</div>
          </div>
          <div class="income-stat income-stat-net">
            <div class="income-stat-label">Net</div>
            <div class="income-stat-value">${formatMoney(netCents)}</div>
          </div>
        </div>
      `;
    } else {
      const rows = computeNetByPeriod(
        summaryPeriod === 'year' ? confirmed.byYear : confirmed.byMonth,
        summaryPeriod === 'year' ? statements.byYear : statements.byMonth,
        summaryPeriod === 'year' ? expenseTotals.byYear : expenseTotals.byMonth
      );
      const columnLabel = summaryPeriod === 'year' ? 'Year' : 'Month';
      summaryBody.innerHTML = rows.length
        ? `<table class="data-table"><thead><tr><th>${columnLabel}</th><th>Net</th></tr></thead><tbody>${rows
            .map((r) => `<tr><td>${escapeHtml(r.period)}</td><td>${formatMoney(r.netCents)}</td></tr>`)
            .join('')}</tbody></table>`
        : '<p class="muted">No data yet.</p>';
    }

    // Slated income is a snapshot of what's currently pending, not
    // historical, so it isn't affected by the All time/Year/Month toggle
    // above -- it always shows the same thing regardless of that choice.
    const slatedBody = container.querySelector('#slated-income-body');
    if (slated.orders.length === 0) {
      slatedBody.innerHTML = '<p class="muted">No pending orders.</p>';
    } else {
      slatedBody.innerHTML = `
        <p class="totals-all-time">${formatMoney(slated.totalCents)}</p>
        <table class="data-table">
          <thead><tr><th>#</th><th>Client</th><th>Amount</th><th>Status</th><th>Due</th></tr></thead>
          <tbody>
            ${slated.orders
              .map(
                (o) => `
              <tr>
                <td><button class="link-button" data-open-order="${o.id}">#${o.id}</button></td>
                <td><button class="link-button" data-open-person="${o.person_id}">${escapeHtml(o.person_label)}</button></td>
                <td>${formatMoney(o.amount_cents, o.currency)}</td>
                <td>${escapeHtml(orderStatusLabel(o.status))}</td>
                <td>${o.delivery_due_date ?? ''}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      `;
      slatedBody.querySelectorAll('[data-open-order]').forEach((btn) => {
        btn.addEventListener('click', () => navigate('orderDetail', { orderId: Number(btn.dataset.openOrder) }));
      });
      slatedBody.querySelectorAll('[data-open-person]').forEach((btn) => {
        btn.addEventListener('click', () => navigate('personDetail', { personId: Number(btn.dataset.openPerson) }));
      });
    }
  }

  container.querySelectorAll('.totals-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      summaryPeriod = tab.dataset.period;
      container.querySelectorAll('.totals-tab').forEach((t) => t.classList.toggle('active', t === tab));
      refreshSummary();
    });
  });

  // ---- Expenses -------------------------------------------------------

  let allExpenses = [];

  async function refreshExpenses() {
    allExpenses = await window.api.expense.listAll();
    populateCategoryFilter();
    renderExpenseRows();
  }

  function populateCategoryFilter() {
    const filterSelect = container.querySelector('#expense-filter-category');
    const currentValue = filterSelect.value;
    const categories = Array.from(new Set(allExpenses.map((e) => e.category).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
    filterSelect.innerHTML = `<option value="">All</option>${categories
      .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
      .join('')}`;
    // Keep the previous selection if it still exists (e.g. after adding
    // a new expense in the same category); falls back to "All" if the
    // filtered category no longer has any expenses (e.g. it was just
    // deleted).
    filterSelect.value = currentValue;
  }

  function renderExpenseRows() {
    const filterValue = container.querySelector('#expense-filter-category').value;
    const rowsEl = container.querySelector('#expense-rows');
    const expenses = filterValue ? allExpenses.filter((e) => e.category === filterValue) : allExpenses;

    rowsEl.innerHTML =
      expenses.length === 0
        ? '<tr><td colspan="5" class="muted">No expenses yet.</td></tr>'
        : expenses
            .map(
              (e) => `
            <tr>
              <td>${e.date}</td>
              <td>${escapeHtml(e.category || '')}</td>
              <td><div class="description-preview">${escapeHtml(previewText(e.description))}</div></td>
              <td>${formatMoney(e.amount_cents, e.currency)}</td>
              <td><button class="danger btn-sm" data-delete-expense="${e.id}">Delete</button></td>
            </tr>`
            )
            .join('');

    rowsEl.querySelectorAll('[data-delete-expense]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this expense?')) return;
        await window.api.expense.delete(Number(btn.dataset.deleteExpense));
        await refreshExpenses();
        await refreshSummary();
      });
    });
  }

  container.querySelector('#expense-filter-category').addEventListener('change', renderExpenseRows);

  container.querySelector('#expense-date').value = todayDateInputValue();

  container.querySelector('#expense-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    await window.api.expense.create({
      date: container.querySelector('#expense-date').value,
      amountCents: parseMoneyToCents(container.querySelector('#expense-amount').value),
      category: container.querySelector('#expense-category').value.trim(),
      description: container.querySelector('#expense-description').value,
    });
    container.querySelector('#expense-form').reset();
    container.querySelector('#expense-date').value = todayDateInputValue();
    await refreshExpenses();
    await refreshSummary();
  });

  // ---- Income statements ------------------------------------------------

  const statementAttachmentObjectUrls = new Map(); // statementId -> url[]

  function revokeStatementAttachmentUrls(statementId) {
    (statementAttachmentObjectUrls.get(statementId) || []).forEach((url) => URL.revokeObjectURL(url));
    statementAttachmentObjectUrls.set(statementId, []);
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

  async function refreshStatementAttachments(statementId) {
    revokeStatementAttachmentUrls(statementId);
    const attachments = await window.api.incomeStatementAttachment.listByStatement(statementId);
    const grid = container.querySelector(`[data-attachment-grid="${statementId}"]`);
    if (!grid) return;

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

    for (const a of attachments) {
      if (!a.mime_type.startsWith('image/')) continue;
      const full = await window.api.incomeStatementAttachment.get(a.id);
      const blob = new Blob([full.data], { type: full.mime_type });
      const url = URL.createObjectURL(blob);
      statementAttachmentObjectUrls.get(statementId).push(url);
      const previewEl = grid.querySelector(`[data-attachment-preview="${a.id}"]`);
      if (previewEl) {
        previewEl.innerHTML = `<img class="attachment-thumb" src="${url}" alt="${escapeHtml(a.file_name)}" />`;
        previewEl.querySelector('img').addEventListener('click', () => openLightbox(url, a.file_name));
      }
    }

    grid.querySelectorAll('[data-save-attachment]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const savedPath = await window.api.incomeStatementAttachment.saveToDisk(Number(btn.dataset.saveAttachment));
          if (savedPath) alert(`Saved to:\n${savedPath}`);
        } catch (err) {
          alert(`Failed to save: ${err.message}`);
        }
      });
    });

    grid.querySelectorAll('[data-delete-attachment]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this attachment?')) return;
        await window.api.incomeStatementAttachment.delete(Number(btn.dataset.deleteAttachment));
        await refreshStatementAttachments(statementId);
        await refreshStatements(); // updates the row's attachment count
      });
    });
  }

  let allStatements = [];

  async function refreshStatements() {
    allStatements = await window.api.incomeStatement.listAll();
    const rowsEl = container.querySelector('#statement-rows');

    if (allStatements.length === 0) {
      rowsEl.innerHTML = '<tr><td colspan="7" class="muted">No income statements yet.</td></tr>';
      return;
    }

    const attachmentCounts = await Promise.all(
      allStatements.map((s) => window.api.incomeStatementAttachment.listByStatement(s.id))
    );

    rowsEl.innerHTML = allStatements
      .map(
        (s, index) => `
        <tr>
          <td>${s.period_start} &ndash; ${s.period_end}</td>
          <td>${escapeHtml(s.platform || '')}</td>
          <td>${formatMoney(s.gross_cents, s.currency)}</td>
          <td>${formatMoney(s.fees_cents, s.currency)}</td>
          <td>${formatMoney(s.net_cents, s.currency)}</td>
          <td><button type="button" class="link-button" data-toggle-attachments="${s.id}">${attachmentCounts[index].length} file(s)</button></td>
          <td><button class="danger btn-sm" data-delete-statement="${s.id}">Delete</button></td>
        </tr>
        <tr class="statement-attachments-row" data-attachments-row="${s.id}" hidden>
          <td colspan="7">
            <input type="file" data-statement-attachment-input="${s.id}" multiple />
            <div class="attachment-grid" data-attachment-grid="${s.id}"></div>
          </td>
        </tr>`
      )
      .join('');

    rowsEl.querySelectorAll('[data-toggle-attachments]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const statementId = Number(btn.dataset.toggleAttachments);
        const row = rowsEl.querySelector(`[data-attachments-row="${statementId}"]`);
        row.hidden = !row.hidden;
        if (!row.hidden) await refreshStatementAttachments(statementId);
      });
    });

    rowsEl.querySelectorAll('[data-statement-attachment-input]').forEach((input) => {
      input.addEventListener('change', async (event) => {
        const statementId = Number(input.dataset.statementAttachmentInput);
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
            await window.api.incomeStatementAttachment.add({
              incomeStatementId: statementId,
              fileName: file.name,
              mimeType: file.type || 'application/octet-stream',
              data: new Uint8Array(buffer),
            });
          } catch (err) {
            alert(`Failed to attach "${file.name}": ${err.message}`);
          }
        }

        await refreshStatementAttachments(statementId);
        await refreshStatements();
      });
    });

    rowsEl.querySelectorAll('[data-delete-statement]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this income statement? Its attachments are deleted too.')) return;
        await window.api.incomeStatement.delete(Number(btn.dataset.deleteStatement));
        await refreshStatements();
        await refreshSummary();
      });
    });
  }

  container.querySelector('#statement-period-start').value = todayDateInputValue();
  container.querySelector('#statement-period-end').value = todayDateInputValue();

  // Convenience only -- gross minus fees, but the field stays editable in
  // case a statement's real net doesn't work out to a plain subtraction
  // (e.g. additional adjustments on the actual statement).
  function autoFillNet() {
    const gross = parseMoneyToCents(container.querySelector('#statement-gross').value);
    const fees = parseMoneyToCents(container.querySelector('#statement-fees').value);
    container.querySelector('#statement-net').value = ((gross - fees) / 100).toFixed(2);
  }
  container.querySelector('#statement-gross').addEventListener('blur', autoFillNet);
  container.querySelector('#statement-fees').addEventListener('blur', autoFillNet);

  container.querySelector('#statement-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    await window.api.incomeStatement.create({
      // Date-only field, stored as the raw YYYY-MM-DD input value -- same
      // convention as order.js's date_paid/delivery_due_date (see
      // orderDetail.js), not the datetime-local ISO conversion helpers.
      periodStart: container.querySelector('#statement-period-start').value,
      periodEnd: container.querySelector('#statement-period-end').value,
      platform: container.querySelector('#statement-platform').value.trim(),
      grossCents: parseMoneyToCents(container.querySelector('#statement-gross').value),
      feesCents: parseMoneyToCents(container.querySelector('#statement-fees').value),
      netCents: parseMoneyToCents(container.querySelector('#statement-net').value),
    });
    container.querySelector('#statement-form').reset();
    container.querySelector('#statement-period-start').value = todayDateInputValue();
    container.querySelector('#statement-period-end').value = todayDateInputValue();
    await refreshStatements();
    await refreshSummary();
  });

  // ---- Initial load -------------------------------------------------------

  refreshSummary();
  refreshExpenses();
  refreshStatements();
}
