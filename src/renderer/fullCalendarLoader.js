// Loads FullCalendar's ~760KB "global" bundle (plus the classic theme
// plugin) the first time the Calendar page opens, instead of on every app
// launch -- nothing else uses it, and parsing it up front delayed even the
// lock screen. Same vendored local files as before (see
// scripts/copy-vendor-assets.js), so this is still fully offline and
// within the CSP's script-src 'self'. The CSS stays linked in index.html:
// it's small and only matches FullCalendar's own elements.

let loading = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Couldn't load ${src}`));
    document.head.appendChild(script);
  });
}

// The theme plugin registers itself onto the global bundle, so it has to
// load second.
export function loadFullCalendar() {
  if (!loading) {
    loading = loadScript('vendor/fullcalendar/global.js')
      .then(() => loadScript('vendor/fullcalendar/theme-classic.js'))
      .catch((err) => {
        loading = null;
        throw err;
      });
  }
  return loading;
}
