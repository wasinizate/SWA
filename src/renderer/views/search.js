// The full Search results page. The primary way to search is the
// always-visible sidebar quick-search (shell.js), which links here via
// its "See all N results" row (or a double-click on the search box) for
// the complete list -- this page isn't reachable from its own nav item.
//
// Order results link to the order's own detail page as before; an order
// with a delivery due date (the only kind that shows up on the Calendar
// at all -- see calendar.js's listWithDeliveryDueDates merge) also gets a
// small calendar shortcut that jumps the Calendar view to that date.

import { escapeHtml, formatMoney, previewText, orderStatusLabel, SEARCH_MIN_QUERY_LENGTH } from '../helpers.js';

const MIN_QUERY_LENGTH = SEARCH_MIN_QUERY_LENGTH;
const DEBOUNCE_MS = 200;

export function renderSearchView(container, { navigate, query: initialQuery }) {
  container.innerHTML = `
    <h1>Search</h1>
    <p class="muted">
      Search clients (label, notes, platform handles), orders (description, feedback, payment
      method), and content items (title, description, type) -- tags on any of them count too, so a
      tag search surfaces both the clients who want it and the content that has it.
    </p>

    <div class="toolbar">
      <input type="search" id="search-input" placeholder="Type at least ${MIN_QUERY_LENGTH} characters…" autofocus />
    </div>

    <div id="search-results"></div>
  `;

  const input = container.querySelector('#search-input');
  const resultsEl = container.querySelector('#search-results');

  let debounceHandle = null;
  // Bumped on every new search; a slower older response is discarded if a
  // newer one already landed, so fast typing can't flash stale results.
  let requestId = 0;

  function renderMessage(message) {
    resultsEl.innerHTML = `<p class="muted">${escapeHtml(message)}</p>`;
  }

  function renderResults(people, orders, contentItems) {
    if (people.length === 0 && orders.length === 0 && contentItems.length === 0) {
      renderMessage('No matches.');
      return;
    }

    const peopleSection =
      people.length === 0
        ? ''
        : `
      <h2>Clients (${people.length})</h2>
      <table class="data-table">
        <thead><tr><th>Client</th><th>Notes</th></tr></thead>
        <tbody>
          ${people
            .map(
              (p) => `
            <tr>
              <td>
                <button class="link-button" data-open-person="${p.id}">${escapeHtml(p.private_label)}</button>
                ${
                  p.matched_tags
                    ? `<div class="tag-list">${p.matched_tags
                        .split(', ')
                        .map((label) => `<span class="tag-chip" title="Matched via tag">🏷 ${escapeHtml(label)}</span>`)
                        .join('')}</div>`
                    : ''
                }
              </td>
              <td><div class="description-preview">${escapeHtml(previewText(p.general_notes || p.screening_notes))}</div></td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`;

    const ordersSection =
      orders.length === 0
        ? ''
        : `
      <h2>Orders (${orders.length})</h2>
      <table class="data-table">
        <thead><tr><th>#</th><th>Client</th><th>Date paid</th><th>Amount</th><th>Status</th><th>Description</th><th></th></tr></thead>
        <tbody>
          ${orders
            .map(
              (o) => `
            <tr>
              <td><button class="link-button" data-open-order="${o.id}">#${o.id}</button></td>
              <td><button class="link-button" data-open-person="${o.person_id}">${escapeHtml(o.person_label)}</button></td>
              <td>${o.date_paid ?? ''}</td>
              <td>${formatMoney(o.amount_cents, o.currency)}</td>
              <td>${escapeHtml(orderStatusLabel(o.status))}</td>
              <td><div class="description-preview">${escapeHtml(previewText(o.description))}</div></td>
              <td>${
                o.delivery_due_date
                  ? `<button class="link-button" data-open-calendar="${o.id}" title="View due date on calendar">📅</button>`
                  : ''
              }</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`;

    const contentSection =
      contentItems.length === 0
        ? ''
        : `
      <h2>Content (${contentItems.length})</h2>
      <table class="data-table">
        <thead><tr><th>Title</th><th>Type</th><th>Description</th></tr></thead>
        <tbody>
          ${contentItems
            .map(
              (c) => `
            <tr>
              <td>
                <button class="link-button" data-open-content="${c.id}">${escapeHtml(c.title)}</button>
                ${
                  c.matched_tags
                    ? `<div class="tag-list">${c.matched_tags
                        .split(', ')
                        .map((label) => `<span class="tag-chip" title="Matched via tag">🏷 ${escapeHtml(label)}</span>`)
                        .join('')}</div>`
                    : ''
                }
              </td>
              <td>${escapeHtml(c.content_type)}</td>
              <td><div class="description-preview">${escapeHtml(previewText(c.description))}</div></td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`;

    resultsEl.innerHTML = peopleSection + ordersSection + contentSection;

    resultsEl.querySelectorAll('[data-open-person]').forEach((btn) => {
      btn.addEventListener('click', () => navigate('personDetail', { personId: Number(btn.dataset.openPerson) }));
    });
    resultsEl.querySelectorAll('[data-open-order]').forEach((btn) => {
      btn.addEventListener('click', () => navigate('orderDetail', { orderId: Number(btn.dataset.openOrder) }));
    });
    resultsEl.querySelectorAll('[data-open-calendar]').forEach((btn) => {
      btn.addEventListener('click', () => navigate('calendar', { focusOrderId: Number(btn.dataset.openCalendar) }));
    });
    resultsEl.querySelectorAll('[data-open-content]').forEach((btn) => {
      btn.addEventListener('click', () => navigate('contentDetail', { contentItemId: Number(btn.dataset.openContent) }));
    });
  }

  async function runSearch() {
    const query = input.value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      renderMessage(`Type at least ${MIN_QUERY_LENGTH} characters to search.`);
      return;
    }

    const thisRequest = ++requestId;
    const { people, orders, contentItems } = await window.api.search.query(query);
    if (thisRequest !== requestId) return; // superseded by a newer keystroke

    renderResults(people, orders, contentItems);
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(runSearch, DEBOUNCE_MS);
  });

  // Arriving here from the sidebar quick-search's "See all results" link
  // (shell.js) pre-fills and runs the query immediately, rather than
  // making the user retype it.
  if (initialQuery) {
    input.value = initialQuery;
    runSearch();
  } else {
    renderMessage(`Type at least ${MIN_QUERY_LENGTH} characters to search.`);
  }
}
