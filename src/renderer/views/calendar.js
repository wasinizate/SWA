// Calendar view: a FullCalendar month/week/list grid. Two things show up
// on it, merged together:
//  1. calendar_events rows -- general-purpose, freeform (personal
//     reminders, calls, anything), created/edited/deleted through a
//     small modal (similar overlay pattern to the attachment lightbox in
//     orderDetail.js).
//  2. Every order that has a delivery due date set -- shown
//     automatically, live from the orders table itself (not copied into
//     calendar_events), so there's nothing to keep in sync: set/change/
//     clear an order's due date on its own page and the calendar
//     reflects it immediately. These are shown in a different color and
//     clicking one goes straight to that order's page instead of the
//     generic event modal, since the due date is only ever editable
//     there.
//
// There's deliberately no "pick a person/order" field inside the event
// modal -- with potentially hundreds of orders, a usable picker needs
// search, which is its own later round.

import {
  escapeHtml,
  toDatetimeLocalValue,
  fromDatetimeLocalValue,
  toDateInputValue,
  fromDateInputValue,
  loadingHtml,
} from '../helpers.js';
import { isLightTheme } from '../theme.js';
import { showToast } from '../toast.js';

const EVENT_TYPE_PRESETS = ['Delivery deadline', 'Custom shoot', 'Screening call', 'Follow-up', 'Personal reminder', 'Other'];

// Values are minutes-before-start, matching the reminder_minutes_before
// column directly -- '' means no reminder (stored as NULL).
const REMINDER_OPTIONS = [
  { value: '', label: 'No reminder' },
  { value: '0', label: 'At time of event' },
  { value: '15', label: '15 minutes before' },
  { value: '30', label: '30 minutes before' },
  { value: '60', label: '1 hour before' },
  { value: '1440', label: '1 day before' },
  { value: '2880', label: '2 days before' },
];

// FullCalendar event ids from the two merged sources could otherwise
// collide (both are small integers) -- this keeps them unambiguous.
function orderDueEventId(orderId) {
  return `order-due-${orderId}`;
}

export function renderCalendarView(container, { navigate }) {
  // FullCalendar's built-in dark palette is only appropriate for this
  // app's dark themes -- Sakura is light, so let FullCalendar fall back
  // to its own light default there instead of forcing dark-on-light.
  const colorSchemeAttr = isLightTheme() ? '' : ' data-color-scheme="dark"';

  container.innerHTML = `
    <div class="section-header">
      <h1>Calendar</h1>
      <div class="row-actions">
        <button type="button" class="btn-secondary" id="export-all-ics">Export calendar to .ics</button>
        <button type="button" id="new-event">+ New event</button>
      </div>
    </div>
    <div id="calendar-mount"${colorSchemeAttr}>${loadingHtml()}</div>
  `;

  container.querySelector('#export-all-ics').addEventListener('click', async () => {
    try {
      const savedPath = await window.api.calendarEvent.exportAllIcs();
      if (savedPath) showToast(`Saved to: ${savedPath}`);
    } catch (err) {
      alert(`Failed to export: ${err.message}`);
    }
  });

  let calendar = null;
  let eventsById = new Map(); // real calendar_events, keyed by numeric id

  // Fetches both event sources fresh from the database and returns them
  // merged into the shape FullCalendar's `events` option expects.
  // eventsById is kept in sync so eventClick can look up a real event's
  // full record; order-due entries carry everything eventClick needs
  // (the order id) right in their FullCalendar event id, so no separate
  // lookup map is needed for those.
  async function loadEvents() {
    const [events, orderDueDates] = await Promise.all([
      window.api.calendarEvent.listAll(),
      window.api.order.listWithDeliveryDueDates(),
    ]);

    eventsById = new Map(events.map((e) => [e.id, e]));

    const calendarEventObjects = events.map((e) => ({
      id: String(e.id),
      title: e.title,
      start: e.start_datetime,
      end: e.end_datetime || undefined,
      allDay: !!e.all_day,
    }));

    // Amber/orange, distinct from the theme's default event color, so
    // "an order is due" reads differently at a glance from "you have a
    // reminder/call". Becomes a timed (not all-day) entry once the order
    // has a specific due time set -- see orderDetail.js's "Due time"
    // field.
    const orderDueEventObjects = orderDueDates.map((o) => ({
      id: orderDueEventId(o.id),
      title: `📦 Order #${o.id} due — ${o.person_label}`,
      start: o.delivery_due_time
        ? fromDatetimeLocalValue(`${o.delivery_due_date}T${o.delivery_due_time}`)
        : o.delivery_due_date,
      allDay: !o.delivery_due_time,
      color: '#f59e0b',
    }));

    return [...calendarEventObjects, ...orderDueEventObjects];
  }

  async function refreshCalendar() {
    const events = await loadEvents();
    calendar.removeAllEventSources();
    calendar.addEventSource(events);
  }

  function initCalendar(initialEvents) {
    const mount = container.querySelector('#calendar-mount');
    calendar = new FullCalendar.Calendar(mount, {
      initialView: 'dayGridMonth',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,listMonth',
      },
      height: 'auto',
      events: initialEvents,
      // Clicking a day cell in month view always reports allDay: true
      // (a day cell has no time granularity) -- but defaulting new
      // events to timed, not all-day, makes it obvious at a glance that
      // a specific time can be set, rather than requiring the user to
      // notice and uncheck "All day" first. 9am is just a sensible
      // starting point, easy to change in the form.
      dateClick: (info) => {
        const start = new Date(info.date);
        start.setHours(9, 0, 0, 0);
        openEventModal({ startDatetime: start.toISOString(), allDay: false });
      },
      eventClick: (info) => {
        if (info.event.id.startsWith('order-due-')) {
          const orderId = Number(info.event.id.slice('order-due-'.length));
          navigate('orderDetail', { orderId });
          return;
        }
        const event = eventsById.get(Number(info.event.id));
        if (event) openEventModal(event);
      },
    });
    calendar.render();
  }

  container.querySelector('#new-event').addEventListener('click', () => openEventModal(null));

  // `source` is either: null (brand new, "+ New event"), a prefill object
  // from clicking a date ({ startDatetime, allDay }), or a full
  // calendar_events row from clicking an existing event (has `.id`).
  function openEventModal(source) {
    const isEditing = Boolean(source && source.id);
    const data = isEditing
      ? {
          id: source.id,
          title: source.title,
          startDatetime: source.start_datetime,
          endDatetime: source.end_datetime,
          allDay: !!source.all_day,
          type: source.type,
          notes: source.notes,
          linkedOrderId: source.linked_order_id,
          reminderMinutesBefore: source.reminder_minutes_before,
        }
      : {
          id: null,
          title: '',
          startDatetime: (source && source.startDatetime) || new Date().toISOString(),
          endDatetime: null,
          allDay: Boolean(source && source.allDay),
          type: '',
          notes: '',
          linkedOrderId: null,
          reminderMinutesBefore: null,
        };

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2>${isEditing ? `Edit event` : 'New event'}</h2>
        <form id="event-form">
          <label>Title <input type="text" id="event-title" required /></label>
          <label class="checkbox-label"><input type="checkbox" id="event-all-day" /> All day</label>
          <label>Start <input type="datetime-local" id="event-start" required /></label>
          <label>End (optional) <input type="datetime-local" id="event-end" /></label>
          <label>
            Type
            <input type="text" id="event-type" list="event-type-options" />
            <datalist id="event-type-options">
              ${EVENT_TYPE_PRESETS.map((t) => `<option value="${escapeHtml(t)}"></option>`).join('')}
            </datalist>
          </label>
          <label>Notes <textarea id="event-notes" rows="4"></textarea></label>
          <label>
            Remind me
            <select id="event-reminder">
              ${REMINDER_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}
            </select>
          </label>
          ${
            data.linkedOrderId
              ? `<p><button type="button" class="link-button" id="view-linked-order">View Order #${data.linkedOrderId}</button></p>`
              : ''
          }
          <div class="form-actions">
            <button type="submit">Save</button>
            <button type="button" class="btn-secondary" id="event-cancel">Cancel</button>
            ${isEditing ? '<button type="button" class="btn-secondary" id="event-export-ics">Export .ics</button>' : ''}
            ${isEditing ? '<button type="button" class="danger" id="event-delete">Delete</button>' : ''}
          </div>
        </form>
      </div>
    `;

    const startInput = overlay.querySelector('#event-start');
    const endInput = overlay.querySelector('#event-end');
    const allDayCheckbox = overlay.querySelector('#event-all-day');

    // The Start/End inputs' *type* itself switches between "date" and
    // "datetime-local" depending on All day -- not just their value --
    // so it's visually unmistakable whether a specific time is being
    // captured, rather than relying on someone noticing a checkbox.
    function applyAllDayInputType(isAllDay) {
      startInput.type = isAllDay ? 'date' : 'datetime-local';
      endInput.type = isAllDay ? 'date' : 'datetime-local';
    }

    function setDateTimeInputValue(input, isoValue) {
      if (!isoValue) {
        input.value = '';
        return;
      }
      input.value = input.type === 'date' ? toDateInputValue(isoValue) : toDatetimeLocalValue(isoValue);
    }

    overlay.querySelector('#event-title').value = data.title;
    allDayCheckbox.checked = data.allDay;
    applyAllDayInputType(data.allDay);
    setDateTimeInputValue(startInput, data.startDatetime);
    setDateTimeInputValue(endInput, data.endDatetime);
    overlay.querySelector('#event-type').value = data.type || '';
    overlay.querySelector('#event-notes').value = data.notes || '';
    overlay.querySelector('#event-reminder').value =
      data.reminderMinutesBefore === null || data.reminderMinutesBefore === undefined
        ? ''
        : String(data.reminderMinutesBefore);

    function closeModal() {
      overlay.remove();
      document.removeEventListener('keydown', onKeydown);
    }
    function onKeydown(event) {
      if (event.key === 'Escape') closeModal();
    }
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeModal();
    });
    document.addEventListener('keydown', onKeydown);

    overlay.querySelector('#event-cancel').addEventListener('click', closeModal);

    allDayCheckbox.addEventListener('change', () => {
      // Keep the date portion across the switch so toggling doesn't
      // discard what's already been entered -- unchecking gets a
      // sensible default time (9am) rather than an empty time field.
      const previousStart = startInput.value;
      const previousEnd = endInput.value;
      applyAllDayInputType(allDayCheckbox.checked);
      const datePart = (value) => (value ? value.slice(0, 10) : '');
      startInput.value = allDayCheckbox.checked ? datePart(previousStart) : previousStart ? `${datePart(previousStart)}T09:00` : '';
      endInput.value = allDayCheckbox.checked ? datePart(previousEnd) : previousEnd ? `${datePart(previousEnd)}T09:00` : '';
    });

    overlay.querySelector('#event-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const reminderValue = overlay.querySelector('#event-reminder').value;
      const isAllDay = allDayCheckbox.checked;
      const payload = {
        title: overlay.querySelector('#event-title').value,
        startDatetime: isAllDay ? fromDateInputValue(startInput.value) : fromDatetimeLocalValue(startInput.value),
        endDatetime: isAllDay ? fromDateInputValue(endInput.value) : fromDatetimeLocalValue(endInput.value),
        allDay: isAllDay,
        type: overlay.querySelector('#event-type').value,
        notes: overlay.querySelector('#event-notes').value,
        reminderMinutesBefore: reminderValue === '' ? null : Number(reminderValue),
      };

      if (isEditing) {
        await window.api.calendarEvent.update(data.id, payload);
      } else {
        await window.api.calendarEvent.create(payload);
      }
      closeModal();
      await refreshCalendar();
    });

    if (isEditing) {
      overlay.querySelector('#event-export-ics').addEventListener('click', async () => {
        try {
          const savedPath = await window.api.calendarEvent.exportIcs(data.id);
          if (savedPath) showToast(`Saved to: ${savedPath}`);
        } catch (err) {
          alert(`Failed to export: ${err.message}`);
        }
      });

      overlay.querySelector('#event-delete').addEventListener('click', async () => {
        if (!confirm('Delete this event?')) return;
        await window.api.calendarEvent.delete(data.id);
        closeModal();
        await refreshCalendar();
      });
    }

    const viewOrderBtn = overlay.querySelector('#view-linked-order');
    if (viewOrderBtn) {
      viewOrderBtn.addEventListener('click', () => {
        closeModal();
        navigate('orderDetail', { orderId: data.linkedOrderId });
      });
    }

    container.appendChild(overlay);
    overlay.querySelector('#event-title').focus();
  }

  (async () => {
    const initialEvents = await loadEvents();
    initCalendar(initialEvents);
  })();
}
