// Shared line-item editor: a table of label/rate/qty rows with a live
// per-row subtotal, used by both the order calculator (orderDetail.js)
// and the price-template editor (settings.js) -- pulled out so the two
// don't carry two slowly-diverging copies of the same row-editing logic
// (same reasoning as importPanel.js/modal.js last round).
//
// Owns its own state array. The caller reads it via getLines(), replaces
// it wholesale via setLines() (e.g. loading a template), and is notified
// via onChange() after every edit so it can recompute whatever total it
// cares about -- a plain sum here, a discounted total on the calculator.

import { escapeHtml, formatMoney, parseMoneyToCents } from './helpers.js';

export function createLineItemRows({ tbody, onChange }) {
  let lines = [];

  function lineSubtotalCents(line) {
    const rateCents = parseMoneyToCents(line.rate);
    const qty = Number.parseFloat(line.qty) || 0;
    return Math.round(rateCents * qty);
  }

  function totalCents() {
    return lines.reduce((sum, line) => sum + lineSubtotalCents(line), 0);
  }

  function updateSubtotals() {
    tbody.querySelectorAll('[data-row-subtotal]').forEach((cell) => {
      const index = Number(cell.dataset.rowSubtotal);
      cell.textContent = formatMoney(lineSubtotalCents(lines[index]));
    });
  }

  function render() {
    tbody.innerHTML = lines
      .map(
        (line, index) => `
        <tr>
          <td><input type="text" data-row-index="${index}" data-row-field="label" value="${escapeHtml(line.label)}" placeholder="e.g. Custom video" /></td>
          <td><input type="number" data-row-index="${index}" data-row-field="rate" value="${escapeHtml(line.rate)}" step="0.01" min="0" placeholder="0.00" /></td>
          <td><input type="number" data-row-index="${index}" data-row-field="qty" value="${escapeHtml(line.qty)}" step="0.01" min="0" placeholder="0" /></td>
          <td data-row-subtotal="${index}">${formatMoney(lineSubtotalCents(line))}</td>
          <td><button type="button" class="danger btn-sm" data-row-remove="${index}">Remove</button></td>
        </tr>`
      )
      .join('');

    // Update state + just the subtotal cells on every keystroke, rather
    // than re-rendering the whole table -- re-rendering would recreate
    // the <input> elements and kick focus out mid-typing.
    tbody.querySelectorAll('[data-row-field]').forEach((input) => {
      input.addEventListener('input', () => {
        const index = Number(input.dataset.rowIndex);
        lines[index][input.dataset.rowField] = input.value;
        updateSubtotals();
        if (onChange) onChange();
      });
    });

    tbody.querySelectorAll('[data-row-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        lines.splice(Number(btn.dataset.rowRemove), 1);
        render();
        if (onChange) onChange();
      });
    });
  }

  function getLines() {
    return lines;
  }

  // Accepts either the {label, rate, qty} string shape used while
  // editing, or a saved template item's {label, rate_cents, default_qty}
  // shape -- converting the latter once here means callers never have to
  // remember which format they're holding.
  function setLines(newLines) {
    lines = (newLines || []).map((l) => ({
      label: l.label ?? '',
      rate: l.rate !== undefined ? l.rate : formatDollarsForInput(l.rate_cents),
      qty: l.qty !== undefined ? l.qty : l.default_qty !== undefined ? String(l.default_qty) : '',
    }));
    render();
    if (onChange) onChange();
  }

  function addLine(prefill) {
    lines.push(prefill || { label: '', rate: '', qty: '' });
    render();
    if (onChange) onChange();
  }

  return { getLines, setLines, addLine, totalCents, render };
}

function formatDollarsForInput(cents) {
  if (cents === undefined || cents === null) return '';
  return (cents / 100).toFixed(2);
}
