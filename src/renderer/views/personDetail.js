// Person detail view: notes, platform accounts, purchase totals, and a
// condensed list of orders. Full order editing (status, amount,
// description, calculator, feedback, attachments) lives on each order's
// own page -- see orderDetail.js -- reached by clicking a row here or by
// creating a new order, which drops you straight onto its page (the same
// "click New Ticket, land on the ticket" flow as a ticketing system).
//
// Layout: a compact "id-card" at the top (name, priority/follow-up
// flags, platforms, revenue, preference tags) for the at-a-glance view,
// with everything else -- Orders, Activity, Notes, Platform accounts,
// Priority & sharing, Linked clients, Content matches -- as collapsible
// <details> sections below it instead of a long stack of always-expanded
// cards. Nothing was removed in that reshuffle, only reprioritized:
// Orders starts open since that's usually what you came for.

import {
  escapeHtml,
  formatMoney,
  buildStatusOptions,
  loadingHtml,
  PRIORITY_OPTIONS,
  priorityBadgeHtml,
  daysSince,
  formatDaysSince,
  formatDateTime,
  toDateInputValue,
  hashHue,
  INTERACTION_TYPE_OPTIONS,
  interactionTypeLabel,
  needsPaymentDateBeforeClosing,
} from '../helpers.js';
import { promptForPassphrase } from '../exportPassphrasePrompt.js';
import { showToast } from '../toast.js';
import { attachTagAutocomplete } from '../tagAutocomplete.js';
import { openPersonLinkModal } from '../personLinkModal.js';
import { openCloseOrderModal } from '../closeOrderModal.js';

// "Jordan M." -> "JM", "Cher" -> "CH" -- id-card avatar initials.
function getInitials(label) {
  const parts = (label || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function renderPersonDetailView(container, { navigate, personId }) {
  container.innerHTML = loadingHtml();
  load();

  async function load() {
    const person = await window.api.person.get(personId);
    if (!person) {
      container.innerHTML = '<p>Client not found.</p><button id="back" type="button">Back to Clients</button>';
      container.querySelector('#back').addEventListener('click', () => navigate('people'));
      return;
    }

    // Feeds the sidebar's "Recently viewed" list (see shell.js). Not
    // awaited by load() itself -- this page's own render never waits on
    // it -- but the event fires only once the write actually lands, so
    // shell.js's listener never refreshes early and shows stale data
    // (a real risk here: navigate() returns long before this resolves).
    window.api.settings.recordPersonView(personId).then(() => {
      document.dispatchEvent(new CustomEvent('swa:person-viewed'));
    });

    let currentPriority = person.priority || 'normal';
    let earliestOpenFollowUp = null;
    let currentTags = [];
    let allTagLabels = [];

    container.innerHTML = `
      <button class="link-button" id="back" type="button">&larr; Back to Clients</button>

      <div class="id-card">
        <div class="id-top">
          <div class="id-avatar">${escapeHtml(getInitials(person.private_label))}</div>
          <div class="id-name-block">
            <div class="id-name">
              <span>${escapeHtml(person.private_label)}</span>
              <span id="id-flags"></span>
              <button type="button" class="icon-button" id="link-client-btn" title="Link or merge with another client">🔗</button>
            </div>
            <div class="id-platforms" id="platform-badges">${loadingHtml()}</div>
          </div>
        </div>

        <div class="stat-row">
          <div class="stat">
            <div class="stat-label">Total revenue</div>
            <div class="stat-value" id="id-total-revenue">${loadingHtml()}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Orders pending</div>
            <div class="stat-value" id="id-orders-pending">${loadingHtml()}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Last purchase</div>
            <div class="stat-value" id="id-last-purchase">${loadingHtml()}</div>
          </div>
        </div>

        <div class="section-label">${new Date().getFullYear()} revenue by platform</div>
        <div class="platform-revenue" id="revenue-chips">${loadingHtml()}</div>

        <div class="tag-row tag-row-spaced" id="tag-row">${loadingHtml()}</div>

        <div class="id-actions">
          <button type="button" id="new-order">+ New order</button>
          <div id="follow-up-toggle-wrap"></div>
        </div>
      </div>

      <div class="scroll-cue">Scroll for full details</div>

      <details class="detail" open>
        <summary class="detail-head">
          <h2>Orders</h2>
          <span class="detail-meta"><span id="orders-meta"></span><span class="detail-chevron">&#9656;</span></span>
        </summary>
        <div class="detail-body">
          <div class="income-summary-grid" id="client-value-body">${loadingHtml()}</div>
          <p class="hint">Excludes cancelled orders and orders without a recorded payment date -- same rule as the totals below.</p>

          <div class="section-header">
            <h3>Order history</h3>
            <div class="row-actions">
              <button type="button" class="btn-secondary" id="export-client">Export client</button>
            </div>
          </div>

          <div class="totals-card">
            <div class="totals-header">
              <h3>Client totals</h3>
              <div class="totals-toggle">
                <button type="button" class="totals-tab active" data-period="all">All time</button>
                <button type="button" class="totals-tab" data-period="year">By year</button>
                <button type="button" class="totals-tab" data-period="month">By month</button>
              </div>
            </div>
            <div id="totals-body">${loadingHtml()}</div>
            <p class="hint">Excludes cancelled orders and orders without a recorded payment date.</p>
          </div>

          <table class="data-table">
            <thead><tr><th>#</th><th>Date paid</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody id="order-rows"><tr><td colspan="4" class="loading-state">Loading…</td></tr></tbody>
          </table>
        </div>
      </details>

      <details class="detail">
        <summary class="detail-head">
          <h2>Activity</h2>
          <span class="detail-meta"><span id="activity-meta"></span><span class="detail-chevron">&#9656;</span></span>
        </summary>
        <div class="detail-body">
          <p class="hint">
            A quick, timestamped log -- what was asked for, what was promised, anything worth
            remembering next time you're chatting. Add a follow-up date to also put it in the
            <button type="button" class="link-button" id="followups-link">Follow-ups queue</button> until you mark it done.
          </p>
          <form id="interaction-form" class="inline-form">
            <select id="interaction-type">
              ${INTERACTION_TYPE_OPTIONS.map((t) => `<option value="${t.value}">${escapeHtml(t.label)}</option>`).join('')}
            </select>
            <input type="text" id="interaction-text" placeholder="What happened?" required />
            <input type="date" id="interaction-follow-up-date" title="Follow up on (optional)" />
            <button type="submit" class="btn-secondary">Log</button>
          </form>
          <div id="interaction-list"></div>
        </div>
      </details>

      <details class="detail">
        <summary class="detail-head">
          <h2>Notes</h2>
          <span class="detail-meta"><span class="detail-chevron">&#9656;</span></span>
        </summary>
        <div class="detail-body">
          <form id="notes-form">
            <label>General notes<textarea id="general-notes" rows="3">${escapeHtml(person.general_notes)}</textarea></label>
            <label>Screening notes<textarea id="screening-notes" rows="3">${escapeHtml(person.screening_notes)}</textarea></label>
            <button type="submit">Save notes</button>
          </form>
        </div>
      </details>

      <details class="detail">
        <summary class="detail-head">
          <h2>Platform accounts</h2>
          <span class="detail-meta"><span id="accounts-meta"></span><span class="detail-chevron">&#9656;</span></span>
        </summary>
        <div class="detail-body">
          <form id="account-form" class="inline-form">
            <input type="text" id="platform-name" placeholder="Platform (e.g. OnlyFans)" required />
            <input type="text" id="username" placeholder="Username / handle" required />
            <label class="checkbox-label"><input type="checkbox" id="verified" /> Verified</label>
            <button type="submit">Add account</button>
          </form>
          <table class="data-table">
            <thead><tr><th>Platform</th><th>Username</th><th>Verified</th><th></th></tr></thead>
            <tbody id="account-rows"><tr><td colspan="4" class="loading-state">Loading…</td></tr></tbody>
          </table>
        </div>
      </details>

      <details class="detail">
        <summary class="detail-head">
          <h2>Priority &amp; sharing</h2>
          <span class="detail-meta"><span class="detail-chevron">&#9656;</span></span>
        </summary>
        <div class="detail-body">
          <label>
            Priority
            <select id="person-priority">
              ${PRIORITY_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}
            </select>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="person-shared" ${person.is_shared ? 'checked' : ''} />
            Shared with collaborators -- syncs (all of their orders) via the shared folder configured in Settings
          </label>
        </div>
      </details>

      <details class="detail">
        <summary class="detail-head">
          <h2>Linked clients</h2>
          <span class="detail-meta"><span id="links-meta"></span><span class="detail-chevron">&#9656;</span></span>
        </summary>
        <div class="detail-body">
          <p class="hint">
            Clients you've noted as possibly connected -- via the 🔗 icon above, or Settings' "Possible
            duplicate clients" check. Linking doesn't move or change anything; it's just a reminder.
          </p>
          <div id="person-links-body"></div>
        </div>
      </details>

      <details class="detail">
        <summary class="detail-head">
          <h2>Content matches</h2>
          <span class="detail-meta"><span id="matches-meta"></span><span class="detail-chevron">&#9656;</span></span>
        </summary>
        <div class="detail-body">
          <p class="hint">Content library items sharing a tag with this client, that they haven't already been sold -- a quick upsell prompt built off the same tags above.</p>
          <div id="content-matches-body">${loadingHtml()}</div>
        </div>
      </details>
    `;

    container.querySelector('#back').addEventListener('click', () => navigate('people'));

    // ---- id-card flags (priority badge + open-follow-up flag) -----------

    function renderIdFlags() {
      const followUpHtml = earliestOpenFollowUp
        ? `<span class="flag-followup">Follow up ${escapeHtml(earliestOpenFollowUp)}</span>`
        : '';
      container.querySelector('#id-flags').innerHTML = `${priorityBadgeHtml(currentPriority)}${followUpHtml}`;
    }
    renderIdFlags();

    container.querySelector('#person-priority').value = currentPriority;
    container.querySelector('#person-priority').addEventListener('change', async (event) => {
      const updated = await window.api.person.update(personId, { priority: event.target.value });
      currentPriority = updated.priority;
      renderIdFlags();
      showToast('Priority updated.');
    });

    container.querySelector('#person-shared').addEventListener('change', async (event) => {
      await window.api.person.update(personId, { isShared: event.target.checked });
      showToast(event.target.checked ? 'Now syncing with collaborators.' : 'No longer shared.');
    });

    // ---- Link or merge with another client -------------------------------
    // Settings' "Possible duplicate clients" check finds these
    // automatically via a few heuristics; the 🔗 icon is the manual path
    // for when a connection is obvious just from looking at this page,
    // without waiting on (or trusting) a heuristic to catch it. Hands off
    // to the Clients list in "linking mode" (see people.js) rather than a
    // dropdown here -- searching the real list scales to however many
    // clients exist, a <select> with hundreds of names doesn't.
    container.querySelector('#link-client-btn').addEventListener('click', () => {
      navigate('people', { linkingWithPersonId: personId });
    });

    async function refreshPersonLinks() {
      const links = await window.api.personLink.listForPerson(personId);
      const body = container.querySelector('#person-links-body');
      container.querySelector('#links-meta').textContent = links.length ? `${links.length} linked` : '';

      body.innerHTML = links.length
        ? links
            .map(
              (l) => `
            <div class="interaction-row">
              <div>
                <button type="button" class="link-button" data-open-linked="${l.other_person_id}">${escapeHtml(l.other_person_label)}</button>
                ${l.note ? `<div class="hint">${escapeHtml(l.note)}</div>` : ''}
              </div>
              <div class="row-actions">
                <button type="button" class="btn-secondary btn-sm" data-merge-linked="${l.other_person_id}">Merge now…</button>
                <button type="button" class="danger btn-sm" data-unlink="${l.id}">Unlink</button>
              </div>
            </div>`
            )
            .join('')
        : '<p class="muted">No linked clients.</p>';

      body.querySelectorAll('[data-open-linked]').forEach((btn) => {
        btn.addEventListener('click', () => navigate('personDetail', { personId: Number(btn.dataset.openLinked) }));
      });
      body.querySelectorAll('[data-merge-linked]').forEach((btn) => {
        btn.addEventListener('click', () => {
          openPersonLinkModal({
            personAId: personId,
            personBId: Number(btn.dataset.mergeLinked),
            onResolved: (survivorId) => navigate('personDetail', { personId: survivorId || personId }),
          });
        });
      });
      body.querySelectorAll('[data-unlink]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await window.api.personLink.remove(Number(btn.dataset.unlink));
          await refreshPersonLinks();
        });
      });
    }

    container.querySelector('#notes-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      await window.api.person.update(personId, {
        generalNotes: container.querySelector('#general-notes').value,
        screeningNotes: container.querySelector('#screening-notes').value,
      });
      showToast('Notes saved.');
    });

    // ---- id-card's interactive tag chip row ------------------------------
    // Reuses the same tag system as everywhere else in the app (Content
    // matches below is driven by these same tags). Remove/rename here are
    // scoped to *this client's* association only: rename swaps this
    // person's tag for a new (or reused) one via remove+add, it never
    // calls tag.rename() (which renames the shared tag row everywhere
    // it's used -- that stays a deliberate action in Settings, not
    // something a stray double-click here should trigger).

    function renderTagRow() {
      const row = container.querySelector('#tag-row');
      row.innerHTML =
        currentTags
          .map(
            (t) => `
        <span class="pref-chip chip-color" style="--hue: ${hashHue(t.label)}" data-tag-id="${t.id}">
          <button type="button" class="chip-label">${escapeHtml(t.label)}</button>
          <button type="button" class="chip-remove" aria-label="Remove ${escapeHtml(t.label)}">&times;</button>
        </span>`
          )
          .join('') + `<button type="button" class="chip-add" id="chip-add-btn">+ Add</button>`;

      row.querySelectorAll('.pref-chip').forEach((chipEl) => {
        const tagId = Number(chipEl.dataset.tagId);
        const tag = currentTags.find((t) => t.id === tagId);
        const labelBtn = chipEl.querySelector('.chip-label');

        chipEl.querySelector('.chip-remove').addEventListener('click', async (event) => {
          event.stopPropagation();
          await window.api.tag.removeFromPerson(personId, tagId);
          await refreshTags();
        });

        const startEdit = () => {
          let committed = false;
          chipEl.innerHTML = `<input type="text" class="chip-edit-input" value="${escapeHtml(tag.label)}" />`;
          const input = chipEl.querySelector('input');
          input.focus();
          input.select();

          const commit = async () => {
            if (committed) return;
            committed = true;
            const value = input.value.trim();
            if (value && value.toLowerCase() !== tag.label.toLowerCase()) {
              await window.api.tag.removeFromPerson(personId, tagId);
              await window.api.tag.addToPerson(personId, value);
            }
            await refreshTags();
          };
          input.addEventListener('blur', commit);
          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') input.blur();
            if (event.key === 'Escape') { committed = true; refreshTags(); }
          });
        };

        labelBtn.addEventListener('dblclick', startEdit);
        labelBtn.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') startEdit();
        });
      });

      container.querySelector('#chip-add-btn').addEventListener('click', () => {
        const addBtn = container.querySelector('#chip-add-btn');
        addBtn.outerHTML = `<span class="pref-chip" style="border: 1px dashed var(--border)"><input type="text" class="chip-edit-input" id="tag-add-input" placeholder="New tag" autocomplete="off" /></span>`;
        const input = container.querySelector('#tag-add-input');
        input.focus();

        let committed = false;
        const commitValue = async (value) => {
          if (committed) return;
          committed = true;
          const trimmed = value.trim();
          if (trimmed) await window.api.tag.addToPerson(personId, trimmed);
          await refreshTags();
        };

        attachTagAutocomplete({
          input,
          getOptions: () => allTagLabels,
          onSelect: (label) => commitValue(label),
        });

        input.addEventListener('blur', () => commitValue(input.value));
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') input.blur();
          if (event.key === 'Escape') { committed = true; refreshTags(); }
        });
      });
    }

    async function refreshTags() {
      const [tags, allTags] = await Promise.all([window.api.tag.listForPerson(personId), window.api.tag.listAll()]);
      currentTags = tags;
      allTagLabels = allTags.map((t) => t.label);
      renderTagRow();
      await refreshContentMatches();
    }

    async function refreshContentMatches() {
      const matches = await window.api.contentItem.listMatchingPersonInterests(personId);
      const body = container.querySelector('#content-matches-body');
      container.querySelector('#matches-meta').textContent = matches.length ? `${matches.length} matches` : '';

      body.innerHTML = matches.length
        ? `<table class="data-table">
            <thead><tr><th>Title</th><th>Matched on</th><th>Price</th></tr></thead>
            <tbody>
              ${matches
                .map(
                  (m) => `
                <tr>
                  <td><button class="link-button" data-open-content="${m.id}">${escapeHtml(m.title)}</button></td>
                  <td><div class="tag-list">${(m.matched_tags || '')
                    .split(', ')
                    .filter(Boolean)
                    .map((label) => `<span class="tag-chip">${escapeHtml(label)}</span>`)
                    .join('')}</div></td>
                  <td>${formatMoney(m.price_cents)}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>`
        : '<p class="muted">No matches yet -- add shared tags on this client and in the Content library to surface upsell ideas here.</p>';

      body.querySelectorAll('[data-open-content]').forEach((btn) => {
        btn.addEventListener('click', () => navigate('contentDetail', { contentItemId: Number(btn.dataset.openContent) }));
      });
    }

    // ---- Platform accounts (also feeds the id-card's platform badges) ---

    container.querySelector('#account-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const platformName = container.querySelector('#platform-name').value;
      const username = container.querySelector('#username').value;

      // Catch-at-entry duplicate check (see platformAccount.js's
      // findByPlatformAndUsername()) -- the same handle already linked
      // to a *different* client is almost always a mistake or a genuine
      // duplicate client, so this asks before creating a second link to
      // it rather than silently allowing it (which the merge tooling in
      // Settings would otherwise have to catch after the fact).
      const existingElsewhere = await window.api.platformAccount.findByPlatformAndUsername(platformName, username, {
        excludePersonId: personId,
      });
      if (existingElsewhere.length > 0) {
        const already = existingElsewhere[0];
        const proceed = confirm(
          `"${username}" on ${platformName} is already linked to "${already.person_label}". Add it here too anyway?`
        );
        if (!proceed) return;
      }

      await window.api.platformAccount.create({
        personId,
        platformName,
        username,
        verified: container.querySelector('#verified').checked,
      });
      container.querySelector('#account-form').reset();
      await refreshAccounts();
    });

    async function refreshAccounts() {
      const accounts = await window.api.platformAccount.listByPerson(personId);
      const rows = container.querySelector('#account-rows');
      container.querySelector('#accounts-meta').textContent = accounts.length ? `${accounts.length} linked` : '';

      rows.innerHTML =
        accounts.length === 0
          ? '<tr><td colspan="4" class="muted">No platform accounts yet.</td></tr>'
          : accounts
              .map(
                (a) => `
              <tr>
                <td>${escapeHtml(a.platform_name)}</td>
                <td>${escapeHtml(a.username)}</td>
                <td>${a.verified ? 'Yes' : 'No'}</td>
                <td><button class="danger btn-sm" data-delete-account="${a.id}">Delete</button></td>
              </tr>`
              )
              .join('');

      rows.querySelectorAll('[data-delete-account]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this platform account? Linked orders are kept but unlinked.')) return;
          await window.api.platformAccount.delete(Number(btn.dataset.deleteAccount));
          await refreshAccounts();
          await refreshOrders();
        });
      });

      // id-card platform badges -- deduped by name (a client can have two
      // accounts on the same platform), colored the same way the revenue
      // chips below are so "OnlyFans" reads as one consistent color
      // across the card. Read-only here on purpose -- deleting a platform
      // account unlinks its orders, a bigger consequence than a stray
      // click on this card should trigger; the real delete stays in the
      // table just above.
      const uniquePlatforms = [...new Set(accounts.map((a) => a.platform_name))];
      container.querySelector('#platform-badges').innerHTML = uniquePlatforms.length
        ? uniquePlatforms
            .map((name) => `<span class="platform-badge chip-color" style="--hue: ${hashHue(name)}">${escapeHtml(name)}</span>`)
            .join('')
        : '<span class="muted">No platforms yet</span>';
    }

    // "New order" creates a blank order immediately and drops you onto
    // its own page to fill in the rest -- like clicking "New Ticket" in a
    // ticketing system. An empty $0 order left behind if you back out
    // without saving anything is one click to delete from that page.
    container.querySelector('#new-order').addEventListener('click', async () => {
      const order = await window.api.order.create({ personId, status: 'pending', amountCents: 0 });
      navigate('orderDetail', { orderId: order.id });
    });

    // Exports this client + every one of their orders (attachments
    // included) to a passphrase-encrypted file -- see settings.js's
    // "Import" card for the other half of this. Meant for handing a
    // shared client off to someone else running their own instance of
    // this app, not as a general backup mechanism.
    container.querySelector('#export-client').addEventListener('click', async () => {
      const passphrase = await promptForPassphrase({
        title: 'Export client',
        helpText:
          "Choose a passphrase to protect this file, then share it with the recipient a different way than the file itself (e.g. tell them in person or a separate message) -- not your vault passphrase.",
      });
      if (!passphrase) return;

      try {
        const savedPath = await window.api.dataExchange.exportPerson(personId, passphrase);
        if (savedPath) showToast(`Saved to: ${savedPath}`);
      } catch (err) {
        alert(`Failed to export: ${err.message}`);
      }
    });

    // ---- Client value (see order.js's getClientValueSummary()) -------
    // "Decide in a few seconds how much attention this client deserves"
    // -- lifetime spend, two rolling windows, order count, average order
    // value, and last purchase date. Also feeds the id-card's "Total
    // revenue"/"Last purchase" stats up top from this same fetch.

    async function refreshClientValue() {
      const summary = await window.api.order.getClientValueSummary(personId);
      const body = container.querySelector('#client-value-body');
      const days = daysSince(summary.lastPurchaseDate);

      container.querySelector('#id-total-revenue').textContent = formatMoney(summary.lifetimeCents);
      container.querySelector('#id-last-purchase').textContent = summary.lastPurchaseDate ? formatDaysSince(days) : 'Never';

      body.innerHTML = `
        <div class="income-stat">
          <div class="income-stat-label">Lifetime spend</div>
          <div class="income-stat-value">${formatMoney(summary.lifetimeCents)}</div>
        </div>
        <div class="income-stat">
          <div class="income-stat-label">Last 30 days</div>
          <div class="income-stat-value">${formatMoney(summary.last30Cents)}</div>
        </div>
        <div class="income-stat">
          <div class="income-stat-label">Last 90 days</div>
          <div class="income-stat-value">${formatMoney(summary.last90Cents)}</div>
        </div>
        <div class="income-stat">
          <div class="income-stat-label">Orders</div>
          <div class="income-stat-value">${summary.orderCount}</div>
        </div>
        <div class="income-stat">
          <div class="income-stat-label">Average order</div>
          <div class="income-stat-value">${formatMoney(summary.averageOrderCents)}</div>
        </div>
        <div class="income-stat">
          <div class="income-stat-label">Last purchase</div>
          <div class="income-stat-value">${summary.lastPurchaseDate ? formatDaysSince(days) : 'Never'}</div>
        </div>
      `;
    }

    // id-card's per-platform breakdown, current calendar year only -- see
    // order.js's getRevenueByPlatformForPerson(). A separate, smaller
    // query than Client value above (which is lifetime/rolling-window,
    // not split by platform), so it's its own fetch.
    async function refreshPlatformRevenue() {
      const rows = await window.api.order.getRevenueByPlatformForPerson(personId);
      const listEl = container.querySelector('#revenue-chips');
      listEl.innerHTML = rows.length
        ? rows
            .map(
              (r) =>
                `<div class="prev-chip chip-color" style="--hue: ${hashHue(r.platform_name)}">${escapeHtml(r.platform_name)} <span class="amt">${formatMoney(r.total_cents)}</span></div>`
            )
            .join('')
        : '<span class="muted">No paid orders this year</span>';
    }

    // ---- Totals ---------------------------------------------------------

    let totalsPeriod = 'all';

    async function refreshTotals() {
      const totals = await window.api.order.getTotalsByPerson(personId);
      const body = container.querySelector('#totals-body');

      if (totalsPeriod === 'all') {
        body.innerHTML = `<p class="totals-all-time">${formatMoney(totals.allTimeCents)}</p>`;
        return;
      }

      const rows = totalsPeriod === 'year' ? totals.byYear : totals.byMonth;
      const columnLabel = totalsPeriod === 'year' ? 'Year' : 'Month';
      body.innerHTML = rows.length
        ? `<table class="data-table"><thead><tr><th>${columnLabel}</th><th>Total</th></tr></thead><tbody>${rows
            .map((row) => `<tr><td>${escapeHtml(row.period)}</td><td>${formatMoney(row.total_cents)}</td></tr>`)
            .join('')}</tbody></table>`
        : '<p class="muted">No paid orders yet.</p>';
    }

    container.querySelectorAll('.totals-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        totalsPeriod = tab.dataset.period;
        container.querySelectorAll('.totals-tab').forEach((t) => t.classList.toggle('active', t === tab));
        refreshTotals();
      });
    });

    // ---- Activity (see personInteraction.js) -----------------------------
    // A quick-logged, append-only timeline -- distinct from the
    // general/screening notes above, which are single fields overwritten
    // in place. An entry with a follow-up date also shows up in the
    // cross-client Follow-ups queue until marked done (same row, not a
    // separate concept -- see 0018_person_interactions.sql's comment),
    // and also drives the id-card's "Follow up <date>" flag up top.

    container.querySelector('#followups-link').addEventListener('click', () => navigate('followUps'));

    // id-card's fast path onto the same Activity log/Follow-ups queue as
    // the full form below -- a day-count preset instead of a date picker,
    // and no interaction "type" to choose (always logged as a plain
    // Note). Writes through the exact same
    // window.api.personInteraction.create() call, so it shows up in the
    // Activity list and the cross-client Follow-ups queue identically to
    // one logged the long way.
    //
    // Collapsed to a single button by default -- the day-preset/note
    // fields only exist in the DOM while actively flagging one, instead
    // of sitting there permanently as three always-visible controls.
    // Click to open, click Flag/press Escape/click the x to close again.
    const followUpWrap = container.querySelector('#follow-up-toggle-wrap');

    function collapseFollowUp() {
      followUpWrap.innerHTML = `<button type="button" class="btn-secondary" id="follow-up-open">Flag follow-up</button>`;
      followUpWrap.querySelector('#follow-up-open').addEventListener('click', expandFollowUp);
    }

    function expandFollowUp() {
      followUpWrap.innerHTML = `
        <form id="quick-follow-up-form" class="inline-form">
          <select id="quick-follow-up-preset">
            <option value="1">1 day</option>
            <option value="3">3 days</option>
            <option value="7">1 week</option>
          </select>
          <input type="text" id="quick-follow-up-note" placeholder="Quick note (optional)" />
          <button type="submit" class="btn-secondary">Flag</button>
          <button type="button" class="icon-button" id="follow-up-cancel" aria-label="Cancel">&times;</button>
        </form>
      `;
      const noteInput = followUpWrap.querySelector('#quick-follow-up-note');
      noteInput.focus();

      followUpWrap.querySelector('#follow-up-cancel').addEventListener('click', collapseFollowUp);
      noteInput.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') collapseFollowUp();
      });

      followUpWrap.querySelector('#quick-follow-up-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const presetDays = Number(followUpWrap.querySelector('#quick-follow-up-preset').value);
        const target = new Date();
        target.setDate(target.getDate() + presetDays);

        await window.api.personInteraction.create(personId, {
          type: 'note',
          text: noteInput.value.trim() || 'Follow up',
          followUpDate: toDateInputValue(target.toISOString()),
        });
        await refreshInteractions();
        showToast('Follow-up flagged.');
        collapseFollowUp();
      });
    }

    collapseFollowUp();

    container.querySelector('#interaction-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const textInput = container.querySelector('#interaction-text');
      const followUpInput = container.querySelector('#interaction-follow-up-date');
      await window.api.personInteraction.create(personId, {
        type: container.querySelector('#interaction-type').value,
        text: textInput.value,
        followUpDate: followUpInput.value || null,
      });
      textInput.value = '';
      followUpInput.value = '';
      await refreshInteractions();
    });

    async function refreshInteractions() {
      const interactions = await window.api.personInteraction.listForPerson(personId);
      const listEl = container.querySelector('#interaction-list');
      container.querySelector('#activity-meta').textContent = interactions.length ? `${interactions.length} logged` : '';

      const openFollowUpDates = interactions
        .filter((i) => i.follow_up_date && !i.follow_up_resolved_at)
        .map((i) => i.follow_up_date)
        .sort();
      earliestOpenFollowUp = openFollowUpDates[0] || null;
      renderIdFlags();

      listEl.innerHTML = interactions.length
        ? interactions
            .map((i) => {
              const isOpenFollowUp = i.follow_up_date && !i.follow_up_resolved_at;
              return `
              <div class="interaction-row">
                <div>
                  <span class="tag-chip${i.type === 'risk_flag' ? ' tag-chip-danger' : ''}">${escapeHtml(interactionTypeLabel(i.type))}</span>
                  ${escapeHtml(i.text)}
                  <div class="hint">
                    ${formatDateTime(i.created_at)}
                    ${isOpenFollowUp ? ` -- follow up ${escapeHtml(i.follow_up_date)}` : ''}
                    ${i.follow_up_date && i.follow_up_resolved_at ? ` -- follow-up done` : ''}
                  </div>
                </div>
                <div class="row-actions">
                  ${isOpenFollowUp ? `<button type="button" class="btn-secondary btn-sm" data-resolve-interaction="${i.id}">Mark done</button>` : ''}
                  <button type="button" class="danger btn-sm" data-remove-interaction="${i.id}">Delete</button>
                </div>
              </div>`;
            })
            .join('')
        : '<p class="muted">Nothing logged yet.</p>';

      listEl.querySelectorAll('[data-resolve-interaction]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await window.api.personInteraction.resolveFollowUp(Number(btn.dataset.resolveInteraction));
          await refreshInteractions();
        });
      });
      listEl.querySelectorAll('[data-remove-interaction]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this log entry?')) return;
          await window.api.personInteraction.remove(Number(btn.dataset.removeInteraction));
          await refreshInteractions();
        });
      });
    }

    async function refreshOrders() {
      const orders = await window.api.order.listByPerson(personId);
      // "Placed" order, newest first -- date_paid is NULL for anything
      // not yet paid, which would otherwise bury pending orders.
      orders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const pendingCount = orders.filter((o) => o.status !== 'completed' && o.status !== 'cancelled').length;
      container.querySelector('#id-orders-pending').textContent = String(pendingCount);
      container.querySelector('#id-orders-pending').classList.toggle('danger', pendingCount > 0);
      container.querySelector('#orders-meta').textContent = `${orders.length} total · ${pendingCount} pending`;

      const rows = container.querySelector('#order-rows');

      rows.innerHTML =
        orders.length === 0
          ? '<tr><td colspan="4" class="muted">No orders yet.</td></tr>'
          : orders
              .map(
                (o) => `
              <tr>
                <td><button class="link-button" data-open-order="${o.id}">#${o.id}</button></td>
                <td>${o.date_paid ?? ''}</td>
                <td>${formatMoney(o.amount_cents, o.currency)}</td>
                <td><select class="quick-status" data-quick-status="${o.id}">${buildStatusOptions(o.status)}</select></td>
              </tr>`
              )
              .join('');

      rows.querySelectorAll('[data-open-order]').forEach((btn) => {
        btn.addEventListener('click', () => navigate('orderDetail', { orderId: Number(btn.dataset.openOrder) }));
      });

      rows.querySelectorAll('.quick-status').forEach((select) => {
        const order = orders.find((o) => o.id === Number(select.dataset.quickStatus));
        select.value = order.status;
        select.addEventListener('change', async () => {
          const newStatus = select.value;

          if (needsPaymentDateBeforeClosing(order, newStatus)) {
            select.value = order.status; // only re-applied if the close-out modal is actually submitted
            openCloseOrderModal({
              order,
              onClose: async (datePaid) => {
                await window.api.order.update(order.id, { status: 'completed', datePaid });
                await refreshOrders();
                await refreshTotals();
                await refreshClientValue();
                await refreshPlatformRevenue();
              },
            });
            return;
          }

          await window.api.order.update(order.id, { status: newStatus });
          await refreshOrders();
          await refreshTotals();
          await refreshClientValue();
          await refreshPlatformRevenue();
        });
      });
    }

    // ---- Initial data load ------------------------------------------------

    await refreshTags();
    await refreshAccounts();
    await refreshOrders();
    await refreshTotals();
    await refreshClientValue();
    await refreshPlatformRevenue();
    await refreshInteractions();
    await refreshPersonLinks();
  }
}
