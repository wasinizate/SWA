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
import { renderFollowUpsView } from './followUps.js';
import { renderCalendarView } from './calendar.js';
import { renderSearchView } from './search.js';
import { renderExpensesView } from './expenses.js';
import { renderSettingsView } from './settings.js';
import { maybeShowDueDateSummary } from '../dueDateSummary.js';
import { escapeHtml, previewText, SEARCH_MIN_QUERY_LENGTH } from '../helpers.js';
import { applyTheme } from '../theme.js';
import { matchCommands } from '../commands.js';

const SIDEBAR_SEARCH_DEBOUNCE_MS = 200;
const SIDEBAR_SEARCH_MIN_LENGTH = SEARCH_MIN_QUERY_LENGTH;
const SIDEBAR_SEARCH_PREVIEW_LIMIT = 5;

// Readable names for the Back button ("← Back to Follow-ups"). Detail
// pages aren't listed here -- they name themselves once their data loads
// (see navigate.titleSetter() below), e.g. a client's own label.
const VIEW_LABELS = {
  dashboard: 'Dashboard',
  people: 'Clients',
  orders: 'Orders',
  followUps: 'Follow-ups',
  contentLibrary: 'Content library',
  analytics: 'Analytics',
  calendar: 'Calendar',
  search: 'Search',
  expenses: 'Expenses',
  settings: 'Settings',
};

// Which sidebar item stays lit while on a page that has no sidebar entry
// of its own, so you never lose your place.
const NAV_PARENT = {
  personDetail: 'people',
  orderDetail: 'orders',
  contentDetail: 'contentLibrary',
};

const MAX_HISTORY = 50;

// One-time instructions to a page ("open a new event", "focus the add
// field") that shouldn't fire again when Back returns to that page.
const ONE_SHOT_PARAMS = ['openNewEventToday', 'focusAddForm'];

function withoutOneShotParams(params) {
  const kept = { ...params };
  for (const key of ONE_SHOT_PARAMS) delete kept[key];
  return kept;
}

// Module-scoped (not per-call) so the single pair of document-level
// listeners set up below survives across multiple renderShell() calls in
// one session (once per unlock -- see the comment at the bottom of this
// file) without piling up a new pair of listeners on every unlock.
// currentSearchDropdown/currentSearchInput always point at whichever
// dropdown/input element is live right now.
let documentListenersAttached = false;
let currentSearchDropdown = null;
let currentSearchInput = null;
let currentRecentContainer = null;
let currentNavigate = null;

export function renderShell(root, { onLocked }) {
  root.innerHTML = `
    <div class="shell">
      <nav class="sidebar">
        <div class="brand">SWA</div>
        <div class="sidebar-search">
          <input type="search" id="sidebar-search-input" placeholder="Search… or /command  (Ctrl+K)" autocomplete="off" />
          <div class="sidebar-search-dropdown" id="sidebar-search-dropdown" aria-hidden="true"></div>
        </div>
        <ul class="nav-list">
          <li><button class="nav-link" data-view="dashboard">Dashboard</button></li>
          <li><button class="nav-link" data-view="people">Clients</button></li>
          <li><button class="nav-link" data-view="orders">Orders</button></li>
          <li><button class="nav-link" data-view="followUps">Follow-ups</button></li>
          <li><button class="nav-link" data-view="contentLibrary">Content</button></li>
          <li><button class="nav-link" data-view="analytics">Analytics</button></li>
          <li><button class="nav-link" data-view="calendar">Calendar</button></li>
          <li><button class="nav-link" data-view="expenses">Expenses</button></li>
          <li><button class="nav-link" data-view="settings">Settings</button></li>
        </ul>
        <div class="sidebar-recent" id="sidebar-recent"></div>
        <button id="lock-now" class="lock-button" type="button">Lock now</button>
      </nav>
      <main class="content" id="content"></main>
    </div>
  `;

  const content = root.querySelector('#content');

  // Browser-style back history, reset on every unlock (renderShell runs
  // once per unlock). Each entry is { viewName, params, title }.
  const backStack = [];
  let current = null;

  function isSameEntry(entry, viewName, params) {
    return entry.viewName === viewName && JSON.stringify(entry.params) === JSON.stringify(params);
  }

  // `replace` swaps the current page out of history instead of stacking
  // on top of it -- for transient pages (e.g. the Clients list in "pick
  // someone to link" mode) that Back shouldn't land on again.
  function navigate(viewName, params = {}, { replace = false } = {}) {
    const entryParams = withoutOneShotParams(params);
    if (current && !replace && !isSameEntry(current, viewName, entryParams)) {
      backStack.push(current);
      if (backStack.length > MAX_HISTORY) backStack.shift();
    }
    // A -> (replaced page) -> A shouldn't leave two A's stacked up.
    while (backStack.length && isSameEntry(backStack[backStack.length - 1], viewName, entryParams)) backStack.pop();
    current = { viewName, params: entryParams, title: VIEW_LABELS[viewName] || null };
    show(viewName, params);
  }

  // Returns to the previous page, or to the fallback if there's no
  // history yet (e.g. the very first page after unlocking).
  navigate.back = (fallbackView = 'people', fallbackParams = {}) => {
    const previous = backStack.pop();
    if (previous) {
      current = previous;
      show(previous.viewName, previous.params);
    } else {
      navigate(fallbackView, fallbackParams, { replace: true });
    }
  };

  navigate.backLabel = (fallbackLabel = 'Clients') => {
    const previous = backStack[backStack.length - 1];
    return previous ? previous.title || 'previous page' : fallbackLabel;
  };

  // Grabbed synchronously when a detail page starts rendering, so a title
  // set after an async load always lands on that page's own history
  // entry, even if the user has already navigated somewhere else.
  navigate.titleSetter = () => {
    const entry = current;
    return (title) => {
      if (entry) entry.title = title;
    };
  };

  currentNavigate = navigate;

  function show(viewName, params) {
    const navView = NAV_PARENT[viewName] || viewName;
    root.querySelectorAll('.nav-link[data-view]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === navView);
    });
    // Picks up clients deleted or merged away since the last redraw.
    if (currentRecentContainer) renderRecentClients(currentRecentContainer, navigate);
    content.innerHTML = '';

    if (viewName === 'dashboard') renderDashboardView(content, { navigate });
    else if (viewName === 'people') renderPeopleView(content, { navigate, ...params });
    else if (viewName === 'personDetail') renderPersonDetailView(content, { navigate, personId: params.personId });
    else if (viewName === 'orderDetail') renderOrderDetailView(content, { navigate, orderId: params.orderId });
    else if (viewName === 'orders') renderOrdersView(content, { navigate });
    else if (viewName === 'followUps') renderFollowUpsView(content, { navigate });
    else if (viewName === 'contentLibrary') renderContentLibraryView(content, { navigate });
    else if (viewName === 'contentDetail') renderContentDetailView(content, { navigate, contentItemId: params.contentItemId });
    else if (viewName === 'analytics') renderAnalyticsView(content, { navigate });
    else if (viewName === 'calendar')
      renderCalendarView(content, { navigate, focusOrderId: params.focusOrderId, openNewEventToday: params.openNewEventToday });
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
  setUpRecentClients(root, navigate);

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
  currentSearchInput = input;

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

  // "/" command palette (see commands.js) -- a separate render path from
  // renderResults() above rather than folding commands into that same
  // query, since a command list isn't sectioned by data type the way
  // search results are, and running one has side effects (navigating,
  // opening a modal) instead of just linking somewhere.
  function renderCommandResults(query) {
    const commands = matchCommands(query);
    if (commands.length === 0) {
      dropdown.innerHTML = '<p class="muted">No matching commands.</p>';
      showDropdown();
      return;
    }

    dropdown.innerHTML = `
      <div class="sidebar-search-section-title">Commands</div>
      ${commands
        .map(
          (c, i) => `
        <button type="button" class="sidebar-search-result sidebar-command-result" data-run-command="${i}">
          <span class="sidebar-command-name">/${escapeHtml(c.name)}</span>
          <span class="hint">${escapeHtml(c.description)}</span>
        </button>`
        )
        .join('')}
    `;
    showDropdown();

    dropdown.querySelectorAll('[data-run-command]').forEach((btn) => {
      btn.addEventListener('click', () => runCommand(commands[Number(btn.dataset.runCommand)]));
    });
  }

  function runCommand(command) {
    hideDropdown();
    input.value = '';
    command.run({ navigate });
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
    // "/" as the very first character switches into command mode --
    // no debounce needed, matching a command is cheap (a plain array
    // filter, not an IPC round trip the way runSearch() is).
    if (input.value.startsWith('/')) {
      renderCommandResults(input.value.slice(1));
      return;
    }
    debounceHandle = setTimeout(runSearch, SIDEBAR_SEARCH_DEBOUNCE_MS);
  });

  // Enter in command mode runs the top match -- typical command-palette
  // behavior (Slack/Discord/Linear all do this), so a command can be
  // reached without ever touching the mouse: Ctrl+K, type "/reminder",
  // Enter.
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !input.value.startsWith('/')) return;
    event.preventDefault();
    const commands = matchCommands(input.value.slice(1));
    if (commands.length > 0) runCommand(commands[0]);
  });

  input.addEventListener('focus', () => {
    if (!dropdown.innerHTML) return;
    if (input.value.startsWith('/') || input.value.trim().length >= SIDEBAR_SEARCH_MIN_LENGTH) showDropdown();
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

      // Global "focus search" shortcut (Ctrl+K, Cmd+K on macOS) -- works
      // from anywhere in the app, not just when a nav element already has
      // focus, same as the equivalent shortcut in Slack/Discord/Linear.
      // Typing "/" once focused switches into the command palette (see
      // the "input" listener above) -- this is just the "get there
      // without touching the mouse" half of that.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && currentSearchInput) {
        event.preventDefault();
        currentSearchInput.focus();
        currentSearchInput.select();
      }

      // Alt+Left (Cmd+[ on macOS) goes back, same as a browser. Not while
      // typing: on macOS Alt+Left moves the cursor by a word.
      const isBackShortcut = (event.altKey && event.key === 'ArrowLeft') || (event.metaKey && event.key === '[');
      if (isBackShortcut && !isEditableTarget(event.target) && canGoBack()) {
        event.preventDefault();
        currentNavigate.back();
      }
    });

    // The mouse's side "back" button.
    document.addEventListener('mouseup', (event) => {
      if (event.button === 3 && canGoBack()) {
        event.preventDefault();
        currentNavigate.back();
      }
    });

    // Fired by personDetail.js once its recordPersonView() write actually
    // lands (not on every navigate() call, which would fire before that
    // write completes and show stale data -- see its own comment).
    document.addEventListener('swa:person-viewed', () => {
      if (currentRecentContainer && currentNavigate) renderRecentClients(currentRecentContainer, currentNavigate);
    });
  }
}

// Going back underneath an open modal would leave the modal floating over
// a different page than the one it belongs to.
function canGoBack() {
  return Boolean(currentNavigate) && !document.querySelector('.modal-overlay');
}

function isEditableTarget(target) {
  return Boolean(target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)));
}

// Sidebar's "Recently viewed" list (see settings.js's recordPersonView()/
// getRecentlyViewedPersons()) -- a quick way back to whoever you were
// just looking at without a re-search, visible on every page since it
// lives in the sidebar rather than e.g. the Dashboard only.
// First drawn by the navigate('people') call right after this runs.
function setUpRecentClients(root, navigate) {
  currentRecentContainer = root.querySelector('#sidebar-recent');
  currentNavigate = navigate;
}

async function renderRecentClients(container, navigate) {
  const recent = await window.api.settings.getRecentlyViewedPersons();
  if (container !== currentRecentContainer) return; // superseded by a newer renderShell() call

  if (recent.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="sidebar-recent-title">Recently viewed</div>
    ${recent
      .map((p) => `<button type="button" class="sidebar-recent-link" data-open-recent="${p.id}">${escapeHtml(p.private_label)}</button>`)
      .join('')}
  `;
  container.querySelectorAll('[data-open-recent]').forEach((btn) => {
    btn.addEventListener('click', () => navigate('personDetail', { personId: Number(btn.dataset.openRecent) }));
  });
}
