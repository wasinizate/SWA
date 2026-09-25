// The "/" command palette's registry -- typing "/" as the first
// character in the sidebar search box (see shell.js's
// setUpSidebarSearch()) switches it from a search into this list. Two
// shapes: most commands just navigate somewhere (same as clicking a
// sidebar nav item, just reachable without a mouse trip there first); a
// couple do something more -- /reminder fires off a reminder without
// navigating anywhere at all, /add-event opens the Calendar with its
// real event form already open on today's date.
//
// ctx: { navigate } -- the same navigate() shell.js already threads
// through every view.

import { openQuickReminderModal } from './quickReminderModal.js';

export const COMMANDS = [
  {
    name: 'reminder',
    description: 'Log a quick reminder (text + when), without leaving this page',
    run: () => openQuickReminderModal(),
  },
  {
    name: 'add-event',
    description: "Open the Calendar with a new event ready to edit, today's date",
    run: (ctx) => ctx.navigate('calendar', { openNewEventToday: true }),
  },
  {
    name: 'new-client',
    description: 'Jump to Clients with the add-client field ready to type into',
    run: (ctx) => ctx.navigate('people', { focusAddForm: true }),
  },
  { name: 'dashboard', description: 'Open the Dashboard', run: (ctx) => ctx.navigate('dashboard') },
  { name: 'clients', description: 'Open the Clients list', run: (ctx) => ctx.navigate('people') },
  { name: 'orders', description: 'Open the Orders list', run: (ctx) => ctx.navigate('orders') },
  { name: 'followups', description: 'Open the Follow-ups queue', run: (ctx) => ctx.navigate('followUps') },
  { name: 'content', description: 'Open the Content library', run: (ctx) => ctx.navigate('contentLibrary') },
  { name: 'analytics', description: 'Open Analytics', run: (ctx) => ctx.navigate('analytics') },
  { name: 'calendar', description: 'Open the Calendar', run: (ctx) => ctx.navigate('calendar') },
  { name: 'expenses', description: 'Open Expenses', run: (ctx) => ctx.navigate('expenses') },
  { name: 'settings', description: 'Open Settings', run: (ctx) => ctx.navigate('settings') },
];

// Matches whatever follows the leading "/" (already lower-cased) against
// each command's name -- a prefix match ranks first (so "/rem" puts
// "reminder" ahead of anything that merely contains "rem"), then falls
// back to a substring match anywhere in the name or description.
export function matchCommands(query) {
  if (!query) return COMMANDS;
  const q = query.toLowerCase();
  const startsWith = COMMANDS.filter((c) => c.name.startsWith(q));
  const contains = COMMANDS.filter((c) => !c.name.startsWith(q) && (c.name.includes(q) || c.description.toLowerCase().includes(q)));
  return [...startsWith, ...contains];
}
