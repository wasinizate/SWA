// Central place for applying the active color theme. Both app boot
// (shell.js, right after unlock) and the live picker in settings.js call
// applyTheme() so there's exactly one code path that sets the
// data-theme attribute and manages Sakura's decorative petals, instead
// of duplicating that logic in two views.
//
// Colors themselves live in src/renderer/styles/main.css as
// :root[data-theme="..."] blocks -- this file only knows theme ids,
// display labels, and small preview swatch colors for the Settings UI.

export const THEMES = [
  { id: 'default', label: 'Default', swatch: ['#0f1115', '#5b8def'] },
  { id: 'onlyfans', label: 'OnlyFans', swatch: ['#27272b', '#00aff0'] },
  { id: 'fansly', label: 'Fansly', swatch: ['#0d1117', '#2799f6'] },
  { id: 'sakura', label: 'Sakura 🌸', swatch: ['#fff6f8', '#e85d8a'] },
];

// The one theme with a light background -- used to decide whether the
// Calendar view should force FullCalendar's dark palette (see
// calendar.js) or let it fall back to its light default.
const LIGHT_THEME_IDS = new Set(['sakura']);

export function getCurrentTheme() {
  return document.documentElement.dataset.theme || 'default';
}

export function isLightTheme(themeId = getCurrentTheme()) {
  return LIGHT_THEME_IDS.has(themeId);
}

export function applyTheme(themeId) {
  // Falls back to 'default' for anything unrecognized (e.g. a future
  // downgrade reading a theme id that no longer exists) rather than
  // leaving the app in a half-styled state.
  const id = THEMES.some((t) => t.id === themeId) ? themeId : 'default';
  document.documentElement.dataset.theme = id;

  if (id === 'sakura') startPetals();
  else stopPetals();
}

// --- Sakura decorative petals --------------------------------------------
// Purely cosmetic and CSS-driven (see main.css's .sakura-petal rules /
// @keyframes) -- this only mounts/unmounts a handful of elements for
// that CSS to animate. pointer-events: none (set in CSS) keeps them from
// ever intercepting clicks, and the container sits below modals/dropdowns
// in z-index.
const PETAL_COUNT = 8;
let petalContainer = null;

function startPetals() {
  if (petalContainer) return; // already running -- avoid piling up duplicates
  petalContainer = document.createElement('div');
  petalContainer.className = 'sakura-petals';
  petalContainer.setAttribute('aria-hidden', 'true');

  for (let i = 0; i < PETAL_COUNT; i += 1) {
    const petal = document.createElement('div');
    petal.className = 'sakura-petal';
    // Randomized per petal (read by main.css's @keyframes via these
    // custom properties) so they don't all fall in lockstep.
    petal.style.setProperty('--petal-left', `${Math.random() * 100}%`);
    petal.style.setProperty('--petal-delay', `${(Math.random() * 12).toFixed(2)}s`);
    petal.style.setProperty('--petal-duration', `${(10 + Math.random() * 8).toFixed(2)}s`);
    petalContainer.appendChild(petal);
  }

  document.body.appendChild(petalContainer);
}

function stopPetals() {
  if (petalContainer) {
    petalContainer.remove();
    petalContainer = null;
  }
}
