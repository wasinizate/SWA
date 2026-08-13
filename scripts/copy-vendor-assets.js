'use strict';

// This app deliberately has no bundler -- the renderer loads plain
// <script>/<link> tags straight from disk (see README.md). Most npm
// packages assume a bundler, but FullCalendar publishes a self-contained
// "global" build meant exactly for script-tag use (see
// src/renderer/index.html).
//
// FullCalendar v7 split styling into: skeleton.css (structural layout,
// theme-agnostic) + a chosen theme's theme.css (also structural) +
// palette.css (the actual colors, as CSS custom properties -- including
// a built-in dark palette via [data-color-scheme=dark], which
// calendar.js opts into). Unlike v6, none of this is auto-injected by
// the JS bundle -- it has to be linked explicitly. This app uses the
// "classic" theme (FullCalendar's traditional look).
//
// The strict CSP in index.html (script-src 'self') needs these files to
// live unambiguously inside the renderer's own folder -- not off in
// node_modules, whose exact layout isn't something to depend on, and
// which behaves oddly once packaged into an asar archive. So this copies
// what we need out of node_modules and into a small vendor/ folder
// inside src/renderer/. It runs automatically after every `npm install`
// (see package.json's "postinstall" script) -- the output is
// regenerated every time, never committed to git (see .gitignore).

const fs = require('fs');
const path = require('path');

const PACKAGE_ROOT = path.join(__dirname, '..', 'node_modules', 'fullcalendar');
const DEST_DIR = path.join(__dirname, '..', 'src', 'renderer', 'vendor', 'fullcalendar');

// [source path within the fullcalendar package, destination filename]
const FILES_TO_COPY = [
  ['all/global.js', 'global.js'],
  ['skeleton.css', 'skeleton.css'],
  ['themes/classic/global.js', 'theme-classic.js'],
  ['themes/classic/theme.css', 'theme-classic.css'],
  ['themes/classic/palette.css', 'theme-classic-palette.css'],
];

function copyVendorAssets() {
  if (!fs.existsSync(PACKAGE_ROOT)) {
    // Don't fail `npm install` over this -- just warn. (Most likely
    // cause: fullcalendar isn't installed yet, e.g. a partial install.)
    console.warn(`[copy-vendor-assets] Skipped: ${PACKAGE_ROOT} not found.`);
    return;
  }

  fs.mkdirSync(DEST_DIR, { recursive: true });

  for (const [sourceRelative, destName] of FILES_TO_COPY) {
    const source = path.join(PACKAGE_ROOT, sourceRelative);
    const dest = path.join(DEST_DIR, destName);
    if (!fs.existsSync(source)) {
      console.warn(`[copy-vendor-assets] Skipped: ${source} not found.`);
      continue;
    }
    fs.copyFileSync(source, dest);
  }

  console.log(`[copy-vendor-assets] Copied FullCalendar's global bundle + classic theme to ${path.relative(process.cwd(), DEST_DIR)}`);
}

copyVendorAssets();
