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
// The event modal's client->order cascade (pick a client, then one of
// their orders) is how a freeform event actually gets linked to an
// order -- a plain "every order in one <select>" wouldn't scale with
// potentially hundreds of orders, so it's scoped down to a client first.

import {
  escapeHtml,
  toDatetimeLocalValue,
  fromDatetimeLocalValue,
  toDateInputValue,
  fromDateInputValue,
  loadingHtml,
  previewText,
} from '../helpers.js';
import { isLightTheme } from '../theme.js';
import { showToast } from '../toast.js';
import { openModal } from '../modal.js';

const EVENT_TYPE_PRESETS = ['Delivery deadline', 'Custom shoot', 'Screening call', 'Follow-up', 'Personal reminder', 'Other'];

const PRIORITY_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

// FullCalendar accepts a CSS custom property string directly as an
// event's `color` -- resolved by the browser same as any inline style --
// so these stay theme-aware without needing per-theme hex values here.
// 'normal' returns undefined, falling back to the theme's own default
// event color; kept visually distinct from the existing amber "order
// due" color (#f59e0b, see loadEvents() below).
function priorityColor(priority) {
  if (priority === 'urgent') return 'var(--danger)';
  if (priority === 'high') return 'var(--warning)';
  return undefined;
}

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

// Local (not UTC) YYYY-MM-DD formatting for a FullCalendar day-cell Date
// -- matching it against delivery_due_date via toISOString() would risk
// an off-by-one day depending on the machine's UTC offset (the exact
// class of date/timezone bug this codebase has been bitten by before).
function toDateKey(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function renderCalendarView(container, { navigate, focusOrderId }) {
  // FullCalendar's built-in dark palette is only appropriate for this
  // app's dark themes -- Sakura is light, so let FullCalendar fall back
  // to its own light default there instead of forcing dark-on-light.
  const colorSchemeAttr = isLightTheme() ? '' : ' data-color-scheme="dark"';

  // Wrapped in one element (rather than two siblings) so main.css's
  // "cap every view to a 900px reading width" rule -- right for
  // text-heavy pages, wrong for a data grid -- can be exempted for the
  // whole calendar view in a single selector (see .calendar-page there).
  container.innerHTML = `
    <div class="calendar-page">
      <div class="section-header">
        <h1>Calendar</h1>
        <div class="row-actions">
          <button type="button" class="btn-secondary" id="import-ics">Import .ics</button>
          <button type="button" class="btn-secondary" id="export-all-ics">Export calendar to .ics</button>
          <button type="button" id="new-event">+ New event</button>
        </div>
      </div>
      <div id="calendar-mount"${colorSchemeAttr}>${loadingHtml()}</div>
    </div>
  `;

  container.querySelector('#export-all-ics').addEventListener('click', async () => {
    try {
      const savedPath = await window.api.calendarEvent.exportAllIcs();
      if (savedPath) showToast(`Saved to: ${savedPath}`);
    } catch (err) {
      alert(`Failed to export: ${err.message}`);
    }
  });

  // Every event in the chosen file is added as a new entry here -- never
  // matched/merged against what's already on the calendar (see
  // icsImport.js). Order-linking can't be inferred from an external
  // file, so imported events always land unlinked.
  container.querySelector('#import-ics').addEventListener('click', async () => {
    try {
      const result = await window.api.calendarEvent.importIcs();
      if (!result) return; // dialog cancelled
      const parts = [`Imported ${result.imported} event(s)`];
      if (result.skipped > 0) parts.push(`skipped ${result.skipped} that couldn't be read`);
      showToast(parts.join(', ') + '.');
      await refreshCalendar();
    } catch (err) {
      alert(`Failed to import: ${err.message}`);
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
      color: priorityColor(e.priority),
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

  function initCalendar(initialEvents, targetDateStr) {
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
      // Highlights the day a Search-result deep link (search.js) landed
      // on, so it's visually obvious in month view rather than just
      // scrolled-to -- see .calendar-target-day in main.css.
      dayCellClassNames: (arg) => (targetDateStr && toDateKey(arg.date) === targetDateStr ? ['calendar-target-day'] : []),
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
          openOrderDueModal(orderId);
          return;
        }
        const event = eventsById.get(Number(info.event.id));
        if (event) openEventModal(event);
      },
    });
    calendar.render();
  }

  container.querySelector('#new-event').addEventListener('click', () => openEventModal(null));

  // Order-due entries (the amber 📦 ones) aren't real calendar_events
  // rows -- they're synthesized live from the order's own due date (see
  // loadEvents() above) -- so there's no "Edit event" modal for them.
  // This is their equivalent of that modal's "View"/"Export .ics" pair,
  // just scoped to the two things that make sense for a derived entry.
  function openOrderDueModal(orderId) {
    openModal({
      title: `Order #${orderId} due date`,
      render: (body, close) => {
        body.innerHTML = `
          <p class="hint">This date comes from the order's own delivery due date -- editable there.</p>
          <div class="form-actions">
            <button type="button" id="order-due-view">View order</button>
            <button type="button" class="btn-secondary" id="order-due-export">Export .ics</button>
          </div>
        `;

        body.querySelector('#order-due-view').addEventListener('click', () => {
          close();
          navigate('orderDetail', { orderId });
        });

        body.querySelector('#order-due-export').addEventListener('click', async () => {
          try {
            const savedPath = await window.api.calendarEvent.exportOrderDueIcs(orderId);
            if (savedPath) showToast(`Saved to: ${savedPath}`);
          } catch (err) {
            alert(`Failed to export: ${err.message}`);
          }
        });
      },
    });
  }

  // `source` is either: null (brand new, "+ New event"), a prefill object
  // from clicking a date ({ startDatetime, allDay }), or a full
  // calendar_events row from clicking an existing event (has `.id`).
  async function openEventModal(source) {
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
          priority: source.priority,
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
          priority: 'normal',
        };

    // Pre-fills for the client->order cascade: every client (for the
    // Client <select>), and -- if this event is already linked -- which
    // client owns that order plus that client's own order list, so both
    // <select>s can already show the right selection before anything's
    // touched.
    const allClients = await window.api.person.listAll();
    let initialClientId = null;
    let initialOrders = [];
    if (data.linkedOrderId) {
      const linkedOrder = await window.api.order.get(data.linkedOrderId);
      if (linkedOrder) {
        initialClientId = linkedOrder.person_id;
        initialOrders = await window.api.order.listByPerson(initialClientId);
      }
    }

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
          <label>
            Priority
            <select id="event-priority">
              ${PRIORITY_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}
            </select>
          </label>
          <label>Notes <textarea id="event-notes" rows="4"></textarea></label>
          <label>
            Remind me
            <select id="event-reminder">
              ${REMINDER_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}
            </select>
          </label>
          <label>
            Link to client
            <select id="event-client">
              <option value="">-- none --</option>
              ${allClients
                .map(
                  (c) =>
                    `<option value="${c.id}" ${c.id === initialClientId ? 'selected' : ''}>${escapeHtml(c.private_label)}</option>`
                )
                .join('')}
            </select>
          </label>
          <label>
            Link to order
            <select id="event-order">
              <option value="">-- none --</option>
              ${initialOrders
                .map(
                  (o) =>
                    `<option value="${o.id}" ${o.id === data.linkedOrderId ? 'selected' : ''}>#${o.id} — ${escapeHtml(previewText(o.description, 40))}</option>`
                )
                .join('')}
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
    overlay.querySelector('#event-priority').value = data.priority || 'normal';
    overlay.querySelector('#event-reminder').value =
      data.reminderMinutesBefore === null || data.reminderMinutesBefore === undefined
        ? ''
        : String(data.reminderMinutesBefore);

    // ---- Client -> order cascade ----------------------------------------

    const clientSelect = overlay.querySelector('#event-client');
    const orderSelect = overlay.querySelector('#event-order');

    async function refreshOrderOptions(personId, selectedOrderId) {
      if (!personId) {
        orderSelect.innerHTML = '<option value="">-- none --</option>';
        return;
      }
      const orders = await window.api.order.listByPerson(personId);
      orderSelect.innerHTML = `
        <option value="">-- none --</option>
        ${orders
          .map(
            (o) =>
              `<option value="${o.id}" ${o.id === selectedOrderId ? 'selected' : ''}>#${o.id} — ${escapeHtml(previewText(o.description, 40))}</option>`
          )
          .join('')}
      `;
    }

    // Switching clients means whatever was picked in Order no longer
    // applies -- resets to "-- none --" rather than trying to guess a
    // new selection.
    clientSelect.addEventListener('change', () => {
      refreshOrderOptions(clientSelect.value ? Number(clientSelect.value) : null, null);
    });

    // A one-time convenience nudge for the *first* time an order gets
    // linked on this event (never on an event that arrived already
    // linked, and only once per modal session) -- auto-fills the title
    // (only if still empty, never clobbering something already typed)
    // and defaults All day on, matching how order-due-date entries
    // elsewhere in this app already default to all-day. Both stay fully
    // editable afterward.
    const wasLinked = Boolean(data.linkedOrderId);
    let hasAppliedOrderNudge = false;

    orderSelect.addEventListener('change', () => {
      if (wasLinked || hasAppliedOrderNudge || !orderSelect.value) return;
      hasAppliedOrderNudge = true;

      const titleInput = overlay.querySelector('#event-title');
      const client = allClients.find((c) => c.id === Number(clientSelect.value));
      if (!titleInput.value.trim() && client) {
        titleInput.value = `Order #${orderSelect.value} for ${client.private_label}`;
      }

      if (!allDayCheckbox.checked) {
        allDayCheckbox.checked = true;
        allDayCheckbox.dispatchEvent(new Event('change'));
      }
    });

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
        priority: overlay.querySelector('#event-priority').value,
        linkedOrderId: orderSelect.value ? Number(orderSelect.value) : null,
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

    // A Search result for an order with a due date (search.js) can pass
    // focusOrderId to land here already centered on that date -- resolved
    // up front so the very first render already knows which day to
    // highlight, rather than highlighting late after a second render pass.
    let targetDateStr = null;
    if (focusOrderId) {
      const order = await window.api.order.get(focusOrderId);
      if (order && order.delivery_due_date) targetDateStr = order.delivery_due_date;
    }

    initCalendar(initialEvents, targetDateStr);
    if (targetDateStr) calendar.gotoDate(targetDateStr);
  })();
}
