// The "/reminder" slash command's target -- a fast, in-place capture
// (text + when) that fires off a reminder without navigating anywhere,
// unlike "/add-event" which opens the full Calendar authoring flow. Just
// creates a calendar_event with a reminder attached (type: 'Personal
// reminder', one of calendar.js's own EVENT_TYPE_PRESETS, so it shows up
// consistent with anything created by hand there) -- reuses the existing
// reminder popup machinery (reminderScheduler.js/dueDateSummary.js)
// entirely as-is, nothing new needed on the backend for this to work.

import { toDatetimeLocalValue, fromDatetimeLocalValue } from './helpers.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';

export function openQuickReminderModal() {
  // Defaults to tomorrow at 9am -- same "sensible starting point, easy
  // to change" reasoning as calendar.js's own dateClick default.
  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 1);
  defaultDate.setHours(9, 0, 0, 0);

  openModal({
    title: 'Quick reminder',
    render: (body, close) => {
      body.innerHTML = `
        <form id="quick-reminder-form">
          <label>Remind me to <input type="text" id="qr-text" placeholder="e.g. Follow up with Jordan about the custom" required /></label>
          <label>When <input type="datetime-local" id="qr-when" value="${toDatetimeLocalValue(defaultDate.toISOString())}" required /></label>
          <div class="form-actions">
            <button type="submit">Set reminder</button>
          </div>
        </form>
      `;
      body.querySelector('#qr-text').focus();

      body.querySelector('#quick-reminder-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = body.querySelector('#qr-text').value.trim();
        const whenLocal = body.querySelector('#qr-when').value;
        const startDatetime = fromDatetimeLocalValue(whenLocal);
        if (!text || !startDatetime) return;

        await window.api.calendarEvent.create({
          title: text,
          startDatetime,
          type: 'Personal reminder',
          reminderMinutesBefore: 0,
        });
        close();
        showToast('Reminder set.');
      });
    },
  });
}
