// The main app shell shown once the vault is unlocked: a sidebar for
// navigation plus a content area that the active view renders into.
// Expenses is still a disabled nav item -- deferred to a later phase.

import { renderPeopleView } from './people.js';
import { renderPersonDetailView } from './personDetail.js';
import { renderOrderDetailView } from './orderDetail.js';
import { renderOrdersView } from './orders.js';
import { renderCalendarView } from './calendar.js';
import { renderSettingsView } from './settings.js';
import { maybeShowDueDateSummary } from '../dueDateSummary.js';

export function renderShell(root, { onLocked }) {
  root.innerHTML = `
    <div class="shell">
      <nav class="sidebar">
        <div class="brand">SWA</div>
        <ul class="nav-list">
          <li><button class="nav-link" data-view="people">Clients</button></li>
          <li><button class="nav-link" data-view="orders">Orders</button></li>
          <li><button class="nav-link" data-view="calendar">Calendar</button></li>
          <li><button class="nav-link" disabled title="Coming in a later phase">Expenses</button></li>
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

    if (viewName === 'people') renderPeopleView(content, { navigate });
    else if (viewName === 'personDetail') renderPersonDetailView(content, { navigate, personId: params.personId });
    else if (viewName === 'orderDetail') renderOrderDetailView(content, { navigate, orderId: params.orderId });
    else if (viewName === 'orders') renderOrdersView(content, { navigate });
    else if (viewName === 'calendar') renderCalendarView(content, { navigate });
    else if (viewName === 'settings') renderSettingsView(content, { navigate });
  }

  root.querySelectorAll('.nav-link[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.view));
  });

  root.querySelector('#lock-now').addEventListener('click', async () => {
    await window.api.vault.lock();
    onLocked();
  });

  navigate('people');

  // Once per unlock (renderShell runs exactly once each time the vault
  // unlocks -- see app.js), not on every click around the app.
  maybeShowDueDateSummary(navigate);
}
