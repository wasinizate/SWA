// Cross-client follow-up queue -- every open follow-up logged from a
// client's own "Activity" card (see personDetail.js and
// personInteraction.js's getFollowUpSummary()), soonest due first. A
// follow-up is just a person_interactions row with a follow_up_date set
// -- see 0018_person_interactions.sql's comment for why that's the same
// row as the note that prompted it, not a separate concept. Deliberately
// its own page rather than folded into the Calendar: a due-date-sorted
// queue you work through top-to-bottom is a different shape than a
// month grid, and this app's calendar_events table has no concept of a
// person-level (order-independent) reminder anyway.

import { escapeHtml, interactionTypeLabel, formatDateTime, loadingHtml } from '../helpers.js';
import { showToast } from '../toast.js';

export function renderFollowUpsView(container, { navigate }) {
  container.innerHTML = `
    <h1>Follow-ups</h1>
    <div id="followups-body">${loadingHtml()}</div>
  `;

  refresh();

  async function refresh() {
    const { overdue, dueToday, upcoming } = await window.api.personInteraction.getFollowUpSummary();
    const body = container.querySelector('#followups-body');

    if (overdue.length === 0 && dueToday.length === 0 && upcoming.length === 0) {
      body.innerHTML = '<p class="muted">Nothing to follow up on right now.</p>';
      return;
    }

    body.innerHTML = `
      ${renderBucket('Overdue', overdue, 'danger')}
      ${renderBucket('Due today', dueToday, 'amber')}
      ${renderBucket('Upcoming', upcoming, 'muted')}
    `;

    body.querySelectorAll('[data-open-person]').forEach((btn) => {
      btn.addEventListener('click', () => navigate('personDetail', { personId: Number(btn.dataset.openPerson) }));
    });
    body.querySelectorAll('[data-resolve]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await window.api.personInteraction.resolveFollowUp(Number(btn.dataset.resolve));
        showToast('Marked done.');
        await refresh();
      });
    });
  }

  function renderBucket(title, items, severity) {
    if (items.length === 0) return '';
    return `
      <div class="due-summary-bucket due-summary-${severity}">
        <h3>${escapeHtml(title)} (${items.length})</h3>
        <ul class="due-summary-list">
          ${items
            .map(
              (item) => `
            <li class="followup-row">
              <div>
                <button type="button" class="link-button" data-open-person="${item.person_id}">${escapeHtml(item.person_label)}</button>
                <span class="tag-chip${item.type === 'risk_flag' ? ' tag-chip-danger' : ''}">${escapeHtml(interactionTypeLabel(item.type))}</span>
                <div>${escapeHtml(item.text)}</div>
                <div class="hint">Due ${escapeHtml(item.follow_up_date)} -- logged ${formatDateTime(item.created_at)}</div>
              </div>
              <button type="button" class="btn-secondary btn-sm" data-resolve="${item.id}">Mark done</button>
            </li>`
            )
            .join('')}
        </ul>
      </div>
    `;
  }
}
