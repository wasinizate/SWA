'use strict';

// Media folder scanner for the content library (see
// src/main/db/migrations/0015_content_scanning.sql). Walks a root
// folder the user points at; each immediate subfolder becomes one
// content_items row ("a set"), and every media file found inside it
// (recursively) becomes a content_item_files row. Never reads file
// *contents* -- only names, extensions, sizes, and modified dates.
//
// No new dependency for the walk: Electron ^42 (package.json) bundles
// a Node new enough that fs.promises.readdir's `recursive` option does
// the per-set recursive walk natively. Considered reusing an
// open-source scanner (Kodi/Jellyfin/Plex) instead of writing this --
// declined, since those are whole standalone server apps whose actual
// "scanning" value is metadata *scraping* against a network API, which
// this app must never do (see README's threat model).

const fs = require('fs/promises');
const path = require('path');
const contentItemRepo = require('../db/repositories/contentItem');
const contentItemFileRepo = require('../db/repositories/contentItemFile');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.wmv', '.m4v', '.webm', '.flv']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.tiff', '.tif']);
const OTHER_MEDIA_EXTENSIONS = new Set(['.zip', '.rar', '.7z']);
const MEDIA_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS, ...OTHER_MEDIA_EXTENSIONS]);

// OS-generated cruft that should never become a "file" in a set, at any
// depth inside it.
const IGNORED_NAMES = new Set(['thumbs.db', 'desktop.ini', '.ds_store', '$recycle.bin', 'system volume information']);

// Sanity guard against accidentally pointing the scanner at a huge or
// wrong root (e.g. a whole drive) -- not a hard architectural limit,
// just a safety valve so one bad folder pick can't hang the app.
const MAX_FILES_PER_SET = 5000;

function direntFullPath(entry) {
  // Node >= 20.12 sets parentPath; older releases only exposed the
  // now-deprecated `path` alias -- fall back for safety.
  return path.join(entry.parentPath || entry.path, entry.name);
}

function isIgnored(name) {
  return IGNORED_NAMES.has(name.toLowerCase());
}

// path.resolve() + (win32-only) lowercasing, used solely for the
// in-memory "have we seen this folder before" matching map -- never for
// what's stored or displayed, so the original casing on disk always
// ends up in `location`.
function normalizeForCompare(targetPath) {
  const resolved = path.resolve(targetPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

// Majority-extension guess, used only when *creating* a new item --
// never overwrites a content_type the user (or an earlier scan) already
// set, so a manual edit can't be clobbered by a later rescan.
function guessContentType(files) {
  let videoCount = 0;
  let imageCount = 0;
  for (const file of files) {
    if (VIDEO_EXTENSIONS.has(file.extension)) videoCount += 1;
    else if (IMAGE_EXTENSIONS.has(file.extension)) imageCount += 1;
  }
  if (videoCount === 0 && imageCount === 0) return '';
  return videoCount >= imageCount ? 'Video' : 'Picture set';
}

// Recursively lists media files inside one set folder. Skips ignored
// names at any depth, skips extensions outside MEDIA_EXTENSIONS, and
// stops collecting past MAX_FILES_PER_SET so one oversized folder can't
// balloon a scan.
async function listSetFiles(folderPath) {
  let entries;
  try {
    entries = await fs.readdir(folderPath, { recursive: true, withFileTypes: true });
  } catch (err) {
    // A folder that vanished mid-scan (race with the filesystem, or one
    // this process can't read) -- treat as empty rather than failing
    // the whole scan over one set.
    return [];
  }

  const files = [];
  for (const entry of entries) {
    if (files.length >= MAX_FILES_PER_SET) break;
    if (!entry.isFile()) continue;
    if (isIgnored(entry.name)) continue;

    const extension = path.extname(entry.name).toLowerCase();
    if (!MEDIA_EXTENSIONS.has(extension)) continue;

    const fullPath = direntFullPath(entry);
    const relativePath = path.relative(folderPath, fullPath);
    // Any ancestor segment being ignored (e.g. sitting inside a
    // "$RECYCLE.BIN"-style folder) excludes the file too, not just an
    // exact name match at the top level.
    if (relativePath.split(path.sep).some((segment) => isIgnored(segment))) continue;

    let stats;
    try {
      stats = await fs.stat(fullPath);
    } catch (err) {
      continue; // vanished between readdir and stat -- skip it
    }

    files.push({
      relativePath,
      extension,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    });
  }
  return files;
}

// Scans `rootPath`: every immediate subfolder becomes/updates one
// content_items row, matched to any existing row (scanned OR manually
// typed -- see contentItem.js's listWithLocation()) by exact,
// normalized location. Files sitting loose directly in the root (not
// inside any subfolder) are counted and reported, never turned into an
// item -- a signal for the user to organize them into a set folder, not
// silently dropped.
async function scanLibrary(rootPath) {
  let topEntries;
  try {
    topEntries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Couldn't read "${rootPath}": ${err.message}`);
  }

  const setDirs = topEntries.filter((entry) => entry.isDirectory() && !isIgnored(entry.name));
  const skippedFileCount = topEntries.filter((entry) => entry.isFile()).length;

  const byLocation = new Map(contentItemRepo.listWithLocation().map((item) => [normalizeForCompare(item.location), item]));
  const previouslyScanned = contentItemRepo.listScanned();
  const seenIds = new Set();

  let created = 0;
  let matched = 0;
  let filesIndexed = 0;

  for (const dirEntry of setDirs) {
    const folderPath = path.join(rootPath, dirEntry.name);
    const files = await listSetFiles(folderPath);
    filesIndexed += files.length;

    const key = normalizeForCompare(folderPath);
    const existing = byLocation.get(key);
    let itemId;
    if (existing) {
      // markScanPresent() also flips is_scanned on for a manual item
      // being adopted here for the first time -- see its own comment.
      contentItemRepo.markScanPresent(existing.id);
      itemId = existing.id;
      matched += 1;
    } else {
      const created_ = contentItemRepo.createScanned({
        title: dirEntry.name,
        location: folderPath,
        contentType: guessContentType(files),
      });
      itemId = created_.id;
      created += 1;
    }
    seenIds.add(itemId);
    contentItemFileRepo.replaceAll(itemId, files);
  }

  let missing = 0;
  for (const item of previouslyScanned) {
    if (!seenIds.has(item.id)) {
      contentItemRepo.markScanMissing(item.id);
      missing += 1;
    }
  }

  return { foldersFound: setDirs.length, created, matched, missing, filesIndexed, skippedFileCount };
}

module.exports = { scanLibrary };
