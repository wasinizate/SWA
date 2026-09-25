// Two import paths for income_statements (see 0007_expenses_and_income.sql),
// both feeding the exact same manual-entry fields expenses.js's own
// "Add statement" form already writes to -- neither one ever saves
// anything without a human seeing and being able to correct the numbers
// first. That review step is the actual mitigation for the risk this
// whole feature was originally declined over ("a bad parse could
// silently produce a wrong income number") -- see that migration's own
// comment, and src/main/incomeImport/'s parsers for the extraction side.

import { escapeHtml, formatMoney, parseMoneyToCents, ipcErrorMessage } from './helpers.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';

// ---- PDF import -----------------------------------------------------------

export function openPdfStatementImportModal({ onImported }) {
  openModal({
    title: 'Import statement from PDF',
    render: (body, close) => {
      body.innerHTML = `
        <p class="hint">
          Upload a platform pay-statement PDF. The fields below are a best-effort guess from its
          text, not a guaranteed-correct read -- check every one against the actual statement (the
          raw extracted text is shown underneath the form for exactly that) before saving. Nothing
          is written until you submit.
        </p>
        <input type="file" id="pdf-import-file" accept="application/pdf,.pdf" />
        <div id="pdf-import-form-body"></div>
      `;

      body.querySelector('#pdf-import-file').addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const formBody = body.querySelector('#pdf-import-form-body');
        formBody.innerHTML = '<p class="loading-state">Reading PDF…</p>';
        try {
          const buffer = await file.arrayBuffer();
          const result = await window.api.incomeImport.parsePdf(new Uint8Array(buffer));
          renderPdfGuessForm(formBody, result, file, close, onImported);
        } catch (err) {
          formBody.innerHTML = `<p class="error">Couldn't read that PDF: ${escapeHtml(ipcErrorMessage(err))}</p>`;
        }
      });
    },
  });
}

function renderPdfGuessForm(formBody, result, file, close, onImported) {
  const g = result.guessed;
  const dollars = (cents) => (cents !== null && cents !== undefined ? (cents / 100).toFixed(2) : '');

  formBody.innerHTML = `
    <form id="pdf-import-statement-form">
      <div class="inline-form">
        <label>From <input type="date" id="pdf-period-start" value="${g.periodStart || ''}" required /></label>
        <label>To <input type="date" id="pdf-period-end" value="${g.periodEnd || ''}" required /></label>
      </div>
      <input type="text" id="pdf-platform" placeholder="Platform" value="${escapeHtml(g.platform || '')}" />
      <div class="inline-form">
        <input type="number" id="pdf-gross" step="0.01" min="0" placeholder="Gross" value="${dollars(g.grossCents)}" required />
        <input type="number" id="pdf-fees" step="0.01" min="0" placeholder="Fees" value="${dollars(g.feesCents) || '0.00'}" />
        <input type="number" id="pdf-net" step="0.01" min="0" placeholder="Net" value="${dollars(g.netCents)}" required />
      </div>
      <div class="form-actions">
        <button type="submit">Save statement</button>
      </div>
    </form>
    <details>
      <summary>Raw extracted text (double-check the guess above against this)</summary>
      <pre class="pdf-extracted-text">${escapeHtml(result.text)}</pre>
    </details>
  `;

  formBody.querySelector('#pdf-import-statement-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitBtn = formBody.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const created = await window.api.incomeStatement.create({
        periodStart: formBody.querySelector('#pdf-period-start').value,
        periodEnd: formBody.querySelector('#pdf-period-end').value,
        platform: formBody.querySelector('#pdf-platform').value.trim(),
        grossCents: parseMoneyToCents(formBody.querySelector('#pdf-gross').value),
        feesCents: parseMoneyToCents(formBody.querySelector('#pdf-fees').value),
        netCents: parseMoneyToCents(formBody.querySelector('#pdf-net').value),
      });

      // Auto-attaches the source PDF as backup -- same convention this
      // page's manual "Add statement" flow already offers via its own
      // attachment grid, just done immediately instead of a second step.
      const buffer = await file.arrayBuffer();
      await window.api.incomeStatementAttachment.add({
        incomeStatementId: created.id,
        fileName: file.name,
        mimeType: file.type || 'application/pdf',
        data: new Uint8Array(buffer),
      });

      close();
      showToast('Statement imported from PDF.');
      if (onImported) onImported();
    } catch (err) {
      alert(`Failed to save: ${ipcErrorMessage(err)}`);
      submitBtn.disabled = false;
    }
  });
}

// ---- CSV import -------------------------------------------------------

// Each field this importer can fill on an income_statements row. `match`
// is used only to pre-select a column guess when a CSV's own header
// looks like it -- never trusted blindly, just saves clicking every
// dropdown by hand for the common case of sensibly-named columns.
const CSV_FIELD_DEFS = [
  { key: 'periodStart', label: 'Date (period start)', required: true, match: /date|period|start/i },
  { key: 'periodEnd', label: 'Period end (optional -- defaults to the date above)', required: false, match: /end/i },
  { key: 'platform', label: 'Platform (optional)', required: false, match: /platform|site/i },
  { key: 'gross', label: 'Gross amount', required: true, match: /gross|earn|revenue/i },
  { key: 'fees', label: 'Fees (optional -- defaults to 0)', required: false, match: /fee/i },
  { key: 'net', label: 'Net amount', required: true, match: /net|payout|total/i },
];

export function openCsvStatementImportModal({ onImported }) {
  openModal({
    title: 'Import statements from CSV',
    wide: true,
    render: (body, close) => {
      body.innerHTML = `
        <p class="hint">
          Works with any CSV export -- map its columns to the fields below (a header that looks
          right is pre-selected, but always double check), preview the result, then import. Each
          data row becomes one income statement.
        </p>
        <input type="file" id="csv-import-file" accept=".csv,text/csv" />
        <div id="csv-import-mapping-body"></div>
      `;

      body.querySelector('#csv-import-file').addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const mappingBody = body.querySelector('#csv-import-mapping-body');
        mappingBody.innerHTML = '<p class="loading-state">Reading CSV…</p>';
        try {
          const text = await file.text();
          const parsed = await window.api.incomeImport.parseCsv(text);
          if (parsed.rows.length === 0) {
            mappingBody.innerHTML = '<p class="error">No data rows found in that file.</p>';
            return;
          }
          renderCsvMappingForm(mappingBody, parsed, close, onImported);
        } catch (err) {
          mappingBody.innerHTML = `<p class="error">Couldn't read that file: ${escapeHtml(ipcErrorMessage(err))}</p>`;
        }
      });
    },
  });
}

// ---- CSV date cells -> this app's YYYY-MM-DD ------------------------------
// Never hands an ISO-looking string to new Date(): "2026-01-05" parses as
// UTC midnight, which is Jan 4 in US time zones, so every date imported a
// day early. ISO dates are read by their written components instead, and
// slash dates by an explicit month-first/day-first order (see
// detectSlashDateOrder()). Returns null -- not a guess -- for anything
// unparseable or impossible (e.g. 31/02), so the row is skipped and
// reported rather than written with a wrong date.

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/;
const SLASH_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/;

function isoFromParts(year, month, day) {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

// order: 'mdy' (US, 01/05/2026 = Jan 5) or 'dmy' (01/05/2026 = May 1).
function csvDateToIso(raw, order = 'mdy') {
  const value = (raw || '').trim();
  if (!value) return null;

  const iso = ISO_DATE.exec(value);
  if (iso) return isoFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slash = SLASH_DATE.exec(value);
  if (slash) {
    const [first, second] = [Number(slash[1]), Number(slash[2])];
    const year = slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3]);
    return order === 'dmy' ? isoFromParts(year, second, first) : isoFromParts(year, first, second);
  }

  // Month-name formats ("Jan 5, 2026", "5 January 2026"): these parse as
  // local time, so reading the local date back out is safe.
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return isoFromParts(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
}

// Decides month-first vs day-first from the file itself: a value like
// 25/01/2026 can only be day-first, 01/25/2026 only month-first. Returns
// the order plus whether the file ever proved it (if every slash date is
// ambiguous, like 03/04/2026, the preview lets the user pick).
function detectSlashDateOrder(values) {
  let dayFirstEvidence = false;
  let monthFirstEvidence = false;
  let hasSlashDates = false;
  for (const raw of values) {
    const slash = SLASH_DATE.exec((raw || '').trim());
    if (!slash) continue;
    hasSlashDates = true;
    const [first, second] = [Number(slash[1]), Number(slash[2])];
    if (first > 12 && second <= 12) dayFirstEvidence = true;
    if (second > 12 && first <= 12) monthFirstEvidence = true;
  }
  const order = dayFirstEvidence && !monthFirstEvidence ? 'dmy' : 'mdy';
  return { hasSlashDates, order, proven: dayFirstEvidence !== monthFirstEvidence };
}

// CSV exports often carry currency symbols, thousands separators, or
// parenthesized negatives ("$1,234.56", "(12.34)") that
// parseMoneyToCents (helpers.js -- built for this app's own clean form
// inputs) was never meant to handle. Scoped to this file rather than
// helpers.js since it's specific to messy external input.
function parseFlexibleMoneyToCents(raw) {
  if (!raw) return 0;
  const trimmed = raw.trim();
  const isNegative = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed.replace(/[()$,\s]/g, '');
  const value = Number.parseFloat(cleaned);
  if (Number.isNaN(value)) return 0;
  return Math.round(value * 100) * (isNegative ? -1 : 1);
}

function renderCsvMappingForm(mappingBody, parsed, close, onImported) {
  const { headers, rows } = parsed;

  function guessColumnIndex(field) {
    const index = headers.findIndex((h) => field.match.test(h));
    return index === -1 ? '' : String(index);
  }

  function optionsHtml(selectedValue) {
    return (
      `<option value="">-- none --</option>` +
      headers.map((h, i) => `<option value="${i}" ${String(i) === selectedValue ? 'selected' : ''}>${escapeHtml(h)}</option>`).join('')
    );
  }

  mappingBody.innerHTML = `
    <div class="csv-mapping-grid">
      ${CSV_FIELD_DEFS.map(
        (f) => `
        <label>
          ${escapeHtml(f.label)}${f.required ? ' *' : ''}
          <select id="csv-map-${f.key}" data-csv-map>${optionsHtml(guessColumnIndex(f))}</select>
        </label>`
      ).join('')}
      <label id="csv-date-order-wrap" hidden>
        Date format
        <select id="csv-date-order">
          <option value="mdy">Month first (01/25/2026)</option>
          <option value="dmy">Day first (25/01/2026)</option>
        </select>
      </label>
    </div>
    <h3>Preview</h3>
    <div id="csv-preview-body"></div>
    <p class="error" id="csv-import-error" hidden></p>
    <div class="form-actions">
      <button type="button" id="csv-import-confirm">Import ${rows.length} row(s)</button>
    </div>
  `;

  function currentMapping() {
    const mapping = {};
    for (const f of CSV_FIELD_DEFS) {
      const value = mappingBody.querySelector(`#csv-map-${f.key}`).value;
      mapping[f.key] = value === '' ? null : Number(value);
    }
    return mapping;
  }

  const dateOrderWrap = mappingBody.querySelector('#csv-date-order-wrap');
  const dateOrderSelect = mappingBody.querySelector('#csv-date-order');
  let dateOrderPickedByUser = false;
  dateOrderSelect.addEventListener('change', () => {
    dateOrderPickedByUser = true;
    updatePreview();
  });

  // Shown only when the mapped date columns actually hold slash dates, and
  // pre-set to whatever the file itself proves (see detectSlashDateOrder()).
  function syncDateOrder(mapping) {
    const values = [];
    for (const key of ['periodStart', 'periodEnd']) {
      if (mapping[key] !== null) for (const row of rows) values.push(row[mapping[key]]);
    }
    const detected = detectSlashDateOrder(values);
    dateOrderWrap.hidden = !detected.hasSlashDates;
    if (!dateOrderPickedByUser) dateOrderSelect.value = detected.order;
  }

  function buildStatementFromRow(row, mapping) {
    const cell = (key) => (mapping[key] !== null ? (row[mapping[key]] || '').trim() : '');
    const order = dateOrderSelect.value;
    const periodStart = csvDateToIso(cell('periodStart'), order);
    const periodEndCell = cell('periodEnd');
    const periodEnd = (periodEndCell && csvDateToIso(periodEndCell, order)) || periodStart;
    return {
      periodStart,
      periodEnd,
      platform: cell('platform'),
      grossCents: parseFlexibleMoneyToCents(cell('gross')),
      feesCents: mapping.fees !== null ? parseFlexibleMoneyToCents(cell('fees')) : 0,
      netCents: parseFlexibleMoneyToCents(cell('net')),
    };
  }

  function requiredFieldsMapped(mapping) {
    return mapping.periodStart !== null && mapping.gross !== null && mapping.net !== null;
  }

  function updatePreview() {
    const mapping = currentMapping();
    syncDateOrder(mapping);
    const previewEl = mappingBody.querySelector('#csv-preview-body');
    if (!requiredFieldsMapped(mapping)) {
      previewEl.innerHTML = '<p class="muted">Map the required fields (marked *) to see a preview.</p>';
      return;
    }

    const previewRows = rows.slice(0, 5).map((row) => buildStatementFromRow(row, mapping));
    previewEl.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Period</th><th>Platform</th><th>Gross</th><th>Fees</th><th>Net</th></tr></thead>
        <tbody>
          ${previewRows
            .map(
              (s) => `
            <tr>
              <td>${s.periodStart || '<span class="error">unparseable date</span>'} &ndash; ${s.periodEnd || ''}</td>
              <td>${escapeHtml(s.platform)}</td>
              <td>${formatMoney(s.grossCents)}</td>
              <td>${formatMoney(s.feesCents)}</td>
              <td>${formatMoney(s.netCents)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
      ${rows.length > 5 ? `<p class="hint">+ ${rows.length - 5} more row(s), not shown here.</p>` : ''}
    `;
  }

  mappingBody.querySelectorAll('[data-csv-map]').forEach((select) => select.addEventListener('change', updatePreview));
  updatePreview();

  mappingBody.querySelector('#csv-import-confirm').addEventListener('click', async () => {
    const errorEl = mappingBody.querySelector('#csv-import-error');
    errorEl.hidden = true;
    const mapping = currentMapping();
    if (!requiredFieldsMapped(mapping)) {
      errorEl.textContent = 'Map the required fields (marked *) before importing.';
      errorEl.hidden = false;
      return;
    }

    const confirmBtn = mappingBody.querySelector('#csv-import-confirm');
    confirmBtn.disabled = true;

    let imported = 0;
    let skipped = 0;
    for (const row of rows) {
      const statement = buildStatementFromRow(row, mapping);
      // Only an unparseable date is skipped outright -- income_statements'
      // period_start/period_end are NOT NULL, so there's nothing to
      // insert without one. A $0 gross/net is unusual but not invalid
      // (some periods genuinely earn nothing), so those still import.
      if (!statement.periodStart) {
        skipped += 1;
        continue;
      }
      try {
        await window.api.incomeStatement.create(statement);
        imported += 1;
      } catch (err) {
        skipped += 1;
      }
    }

    close();
    showToast(`Imported ${imported} statement(s)${skipped > 0 ? `, skipped ${skipped} (couldn't read a date)` : ''}.`);
    if (onImported) onImported();
  });
}
