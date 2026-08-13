'use strict';

// Builds a small, self-contained HTML document for a single order. This is
// the source document that exportOrderPdf.js loads into a hidden window
// and renders to PDF via Electron's printToPDF(). Kept as a pure function
// (data in, HTML string out) so it's easy to reason about independently of
// the PDF/window plumbing.

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoney(cents, currency) {
  const dollars = (cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(dollars);
  } catch (err) {
    // Intl throws on an unrecognized currency code -- fall back gracefully.
    return `${dollars.toFixed(2)} ${currency || 'USD'}`;
  }
}

function buildOrderReceiptHtml({ order, person, platformAccount }) {
  const descriptionHtml = escapeHtml(order.description || '(no description)').replace(/\n/g, '<br />');
  const accountLabel = platformAccount
    ? `${escapeHtml(platformAccount.platform_name)} - ${escapeHtml(platformAccount.username)}`
    : '(none linked)';
  const deliveryDue = order.delivery_due_date
    ? `${order.delivery_due_date}${order.delivery_due_time ? ` at ${order.delivery_due_time}` : ''}`
    : '(none)';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; color: #111; padding: 40px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .muted { color: #666; font-size: 12px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  td { padding: 6px 0; border-bottom: 1px solid #ddd; vertical-align: top; }
  td.label { color: #666; width: 160px; }
  .section-label { color: #666; font-size: 12px; margin-bottom: 6px; }
  .description { white-space: pre-wrap; border: 1px solid #ddd; border-radius: 6px; padding: 12px; }
</style>
</head>
<body>
  <h1>Order #${order.id}</h1>
  <div class="muted">Generated ${escapeHtml(new Date().toLocaleString())}</div>
  <table>
    <tr><td class="label">Client</td><td>${escapeHtml(person.private_label)}</td></tr>
    <tr><td class="label">Platform account</td><td>${accountLabel}</td></tr>
    <tr><td class="label">Amount</td><td>${formatMoney(order.amount_cents, order.currency)}</td></tr>
    <tr><td class="label">Status</td><td>${escapeHtml(order.status)}</td></tr>
    <tr><td class="label">Date paid</td><td>${escapeHtml(order.date_paid || '(not recorded)')}</td></tr>
    <tr><td class="label">Delivery due</td><td>${escapeHtml(deliveryDue)}</td></tr>
    <tr><td class="label">Payment method</td><td>${escapeHtml(order.payment_method || '(not recorded)')}</td></tr>
  </table>
  <div class="section-label">Description</div>
  <div class="description">${descriptionHtml}</div>
</body>
</html>`;
}

module.exports = { buildOrderReceiptHtml };
