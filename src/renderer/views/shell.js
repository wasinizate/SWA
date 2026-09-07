// The main app shell shown once the vault is unlocked: a sidebar for
// navigation plus a content area that the active view renders into.

import { renderDashboardView } from './dashboard.js';
import { renderPeopleView } from './people.js';
import { renderPersonDetailView } from './personDetail.js';
import { renderOrderDetailView } from './orderDetail.js';
import { renderOrdersView } from './orders.js';
import { renderContentLibraryView } from './contentLibrary.js';
import { renderContentDetailView } from './contentDetail.js';
import { renderAnalyticsView } from './analytics.js';
import { renderCalendarView } from './calendar.js';
import { renderSearchView } from './search.js';
import { renderExpensesView } from './expenses.js';
import { renderSettingsView } from './settings.js';
import { maybeShowDueDateSummary } from '../dueDateSummary.js';
import { escapeHtml, previewText, SEARCH_MIN_QUERY_LENGTH } from '../helpers.js';
import { applyTheme } from '../theme.js';

const SIDEBAR_SEARCH_DEBOUNCE_MS = 200;
const SIDEBAR_SEARCH_MIN_LENGTH = SEARCH_MIN_QUERY_LENGTH;
const SIDEBAR_SEARCH_PREVIEW_LIMIT = 5;

// Module-scoped (not per-call) so the single pair of document-level
// listeners set up below survives across multiple renderShell() calls in
// one session (once per unlock -- see the comment at the bottom of this
// file) without piling up a new pair of listeners on every unlock.
// currentSearchDropdown always points at whichever dropdown element is
// live right now.
let documentListenersAttached = false;
let currentSearchDropdown = null;

export function renderShell(root, { onLocked }) {
  root.innerHTML = `
    <div class="shell">
      <nav class="sidebar">
        <div class="brand">SWA</div>
        <div class="sidebar-search">
          <input type="search" id="sidebar-search-input" placeholder="Search…" autocomplete="off" />
          <div class="sidebar-search-dropdown" id="sidebar-search-dropdown" aria-hidden="true"></div>
        </div>
        <ul class="nav-list">
          <li><button class="nav-link" data-view="dashboard">Dashboard</button></li>
          <li><button class="nav-link" data-view="people">Clients</button></li>
          <li><button class="nav-link" data-view="orders">Orders</button></li>
          <li><button class="nav-link" data-view="contentLibrary">Content</button></li>
          <li><button class="nav-link" data-view="analytics">Analytics</button></li>
          <li><button class="nav-link" data-view="calendar">Calendar</button></li>
          <li><button class="nav-link" data-view="expenses">Expenses</button></li>
          <li><button class="nav-link" data-view="settings">Settings</button></li>
        </ul>
        <button id="lock-now" class="lock-button" type="button">Lock now</button>
      </nav>
      <main class="content" id="content"></main>
    </div>
  `;

  const content = root.querySelector('#content');

  function navigate(viewName, params = {}) {
    root.querySelectorAll('.nav-link[data-view]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });
    content.innerHTML = '';

    if (viewName === 'dashboard') renderDashboardView(content, { navigate });
    else if (viewName === 'people') renderPeopleView(content, { navigate, quietOnly: params.quietOnly });
    else if (viewName === 'personDetail') renderPersonDetailView(content, { navigate, personId: params.personId });
    else if (viewName === 'orderDetail') renderOrderDetailView(content, { navigate, orderId: params.orderId });
    else if (viewName === 'orders') renderOrdersView(content, { navigate });
    else if (viewName === 'contentLibrary') renderContentLibraryView(content, { navigate });
    else if (viewName === 'contentDetail') renderContentDetailView(content, { navigate, contentItemId: params.contentItemId });
    else if (viewName === 'analytics') renderAnalyticsView(content, { navigate });
    else if (viewName === 'calendar') renderCalendarView(content, { navigate, focusOrderId: params.focusOrderId });
    else if (viewName === 'search') renderSearchView(content, { navigate, query: params.query });
    else if (viewName === 'expenses') renderExpensesView(content, { navigate });
    else if (viewName === 'settings') renderSettingsView(content, { navigate });
  }

  root.querySelectorAll('.nav-link[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.view));
  });

  root.querySelector('#lock-now').addEventListener('click', async () => {
    await window.api.vault.lock();
    onLocked();
  });

  setUpSidebarSearch(root, navigate);

  navigate('people');

  // Once per unlock (renderShell runs exactly once each time the vault
  // unlocks -- see app.js), not on every click around the app.
  maybeShowDueDateSummary(navigate);

  // The saved theme lives in the encrypted DB, so it can only be applied
  // post-unlock -- the setup/lock screens always render in the Default
  // look. See settings.js's "Appearance" section for where this gets
  // changed.
  window.api.settings.getTheme().then((theme) => applyTheme(theme));
}

// Always-visible search in the sidebar (as opposed to the dedicated
// Search page in search.js, which this dropdown's "See all" link opens
// for the full list). Reuses the same window.api.search.query() call
// search.js uses -- no separate backend path.
function setUpSidebarSearch(root, navigate) {
  const input = root.querySelector('#sidebar-search-input');
  const dropdown = root.querySelector('#sidebar-search-dropdown');
  currentSearchDropdown = dropdown;

  let debounceHandle = null;
  let requestId = 0;

  // .open (not the `hidden` attribute) so the dropdown can actually
  // transition open/closed -- see main.css's .sidebar-search-dropdown
  // comment for why. aria-hidden mirrors it for the same reason `hidden`
  // provided that on its own before.
  function showDropdown() {
    dropdown.classList.add('open');
    dropdown.setAttribute('aria-hidden', 'false');
  }

  function hideDropdown() {
    dropdown.classList.remove('open');
    dropdown.setAttribute('aria-hidden', 'true');
  }

  function openResult(viewName, params) {
    hideDropdown();
    input.value = '';
    navigate(viewName, params);
  }

  function renderResults(query, people, orders, contentItems) {
    if (people.length === 0 && orders.length === 0 && contentItems.length === 0) {
      dropdown.innerHTML = '<p class="muted">No matches.</p>';
      showDropdown();
      return;
    }

    const peopleRows = people
      .slice(0, SIDEBAR_SEARCH_PREVIEW_LIMIT)
      .map(
        (p) =>
          `<button type="button" class="sidebar-search-result" data-open-person="${p.id}">${escapeHtml(p.private_label)}</button>`
      )
      .join('');

    const orderRows = orders
      .slice(0, SIDEBAR_SEARCH_PREVIEW_LIMIT)
      .map(
        (o) =>
          `<button type="button" class="sidebar-search-result" data-open-order="${o.id}">#${o.id} — ${escapeHtml(o.person_label)} — ${escapeHtml(previewText(o.description, 36))}</button>`
      )
      .join('');

    const contentRows = contentItems
      .slice(0, SIDEBAR_SEARCH_PREVIEW_LIMIT)
      .map(
        (c) =>
          `<button type="button" class="sidebar-search-result" data-open-content="${c.id}">${escapeHtml(c.title)}</button>`
      )
      .join('');

    const total = people.length + orders.length + contentItems.length;
    const isCapped =
      people.length > SIDEBAR_SEARCH_PREVIEW_LIMIT ||
      orders.length > SIDEBAR_SEARCH_PREVIEW_LIMIT ||
      contentItems.length > SIDEBAR_SEARCH_PREVIEW_LIMIT;

    dropdown.innerHTML = `
      ${people.length > 0 ? `<div class="sidebar-search-section-title">Clients</div>${peopleRows}` : ''}
      ${orders.length > 0 ? `<div class="sidebar-search-section-title">Orders</div>${orderRows}` : ''}
      ${contentItems.length > 0 ? `<div class="sidebar-search-section-title">Content</div>${contentRows}` : ''}
      ${isCapped ? `<button type="button" class="sidebar-search-result sidebar-search-see-all" data-see-all>See all ${total} results</button>` : ''}
    `;
    showDropdown();

    dropdown.querySelectorAll('[data-open-person]').forEach((btn) => {
      btn.addEventListener('click', () => openResult('personDetail', { personId: Number(btn.dataset.openPerson) }));
    });
    dropdown.querySelectorAll('[data-open-order]').forEach((btn) => {
      btn.addEventListener('click', () => openResult('orderDetail', { orderId: Number(btn.dataset.openOrder) }));
    });
    dropdown.querySelectorAll('[data-open-content]').forEach((btn) => {
      btn.addEventListener('click', () => openResult('contentDetail', { contentItemId: Number(btn.dataset.openContent) }));
    });
    const seeAllBtn = dropdown.querySelector('[data-see-all]');
    if (seeAllBtn) {
      seeAllBtn.addEventListener('click', () => openResult('search', { query }));
    }
  }

  async function runSearch() {
    const query = input.value.trim();
    if (query.length < SIDEBAR_SEARCH_MIN_LENGTH) {
      hideDropdown();
      return;
    }
    const thisRequest = ++requestId;
    const { people, orders, contentItems } = await window.api.search.query(query);
    if (thisRequest !== requestId) return; // superseded by a newer keystroke
    renderResults(query, people, orders, contentItems);
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(runSearch, SIDEBAR_SEARCH_DEBOUNCE_MS);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim().length >= SIDEBAR_SEARCH_MIN_LENGTH && dropdown.innerHTML) showDropdown();
  });

  // Double-clicking the box itself is a shortcut straight to the full
  // Search page (search.js) -- same destination as the dropdown's "See
  // all results" link, just reachable without needing enough matches to
  // get capped first. Whatever's typed so far carries over and
  // auto-runs there (see search.js's initialQuery handling).
  input.addEventListener('dblclick', () => {
    openResult('search', { query: input.value.trim() });
  });

  if (!documentListenersAttached) {
    documentListenersAttached = true;
    document.addEventListener('click', (event) => {
      if (!currentSearchDropdown || !currentSearchDropdown.classList.contains('open')) return;
      const activeWrapper = currentSearchDropdown.closest('.sidebar-search');
      if (activeWrapper && !activeWrapper.contains(event.target)) {
        currentSearchDropdown.classList.remove('open');
        currentSearchDropdown.setAttribute('aria-hidden', 'true');
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && currentSearchDropdown) {
        currentSearchDropdown.classList.remove('open');
        currentSearchDropdown.setAttribute('aria-hidden', 'true');
      }
    });
  }
}
