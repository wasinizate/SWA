'use strict';

// Works out a platform account's profile page, so a platform badge on a
// client's card can open it in the user's own browser (see
// platformAccountIpc.js's "platformAccount:openProfile"). SWA itself makes
// no network request here -- it hands one https:// URL to the OS, same as
// the update checker's "open release page" button.
//
// Only ever produces https:// URLs built from a fixed template or a link
// the user typed and platformAccount.js already validated -- never an
// arbitrary string from the renderer, since shell.openExternal() will
// happily launch other kinds of URL too.
//
// Chat threads aren't linkable: platforms address those by internal
// numeric ids, not usernames, so the profile page is the reliable target.

const PROFILE_URL_TEMPLATES = [
  { names: ['onlyfans'], url: (u) => `https://onlyfans.com/${u}` },
  { names: ['fansly'], url: (u) => `https://fansly.com/${u}` },
  { names: ['x', 'twitter', 'twitterx', 'xtwitter'], url: (u) => `https://x.com/${u}` },
  { names: ['instagram', 'insta', 'ig'], url: (u) => `https://www.instagram.com/${u}/` },
  { names: ['reddit'], url: (u) => `https://www.reddit.com/user/${u}/` },
  { names: ['tiktok'], url: (u) => `https://www.tiktok.com/@${u}` },
  { names: ['telegram'], url: (u) => `https://t.me/${u}` },
  { names: ['snapchat', 'snap'], url: (u) => `https://www.snapchat.com/add/${u}` },
  { names: ['chaturbate'], url: (u) => `https://chaturbate.com/${u}/` },
  { names: ['stripchat'], url: (u) => `https://stripchat.com/${u}` },
  { names: ['justforfans', 'justfor', 'jff'], url: (u) => `https://justfor.fans/${u}` },
  { names: ['fanvue'], url: (u) => `https://www.fanvue.com/${u}` },
  { names: ['loyalfans'], url: (u) => `https://www.loyalfans.com/${u}` },
  { names: ['patreon'], url: (u) => `https://www.patreon.com/${u}` },
  { names: ['twitch'], url: (u) => `https://www.twitch.tv/${u}` },
  { names: ['bluesky', 'bsky'], url: (u) => `https://bsky.app/profile/${u}` },
];

// "Only Fans", "onlyfans.com", "OnlyFans " -> "onlyfans"
function normalizePlatformName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\.(com|net|tv|me|app|fans)$/, '')
    .replace(/[^a-z0-9]/g, '');
}

function findTemplate(platformName) {
  const key = normalizePlatformName(platformName);
  return PROFILE_URL_TEMPLATES.find((t) => t.names.includes(key)) || null;
}

function isKnownPlatform(platformName) {
  return findTemplate(platformName) !== null;
}

// Accepts "https://site/x", "http://site/x" (upgraded), or a bare
// "site.com/x"; returns a normalized https:// URL string, or null.
function normalizeProfileUrl(raw) {
  let value = String(raw || '').trim();
  // Backslashes/spaces mean a file path or typo, never a web address.
  if (!value || /[\\\s]/.test(value)) return null;
  if (/^http:\/\//i.test(value)) value = value.replace(/^http:/i, 'https:');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !url.hostname.includes('.')) return null;
  return url.toString();
}

// The account's own saved link wins; otherwise a known platform's
// template, when the username is a plain handle (an "@" prefix is fine).
function profileUrlFor(account) {
  if (account.profile_url) return normalizeProfileUrl(account.profile_url);
  const template = findTemplate(account.platform_name);
  if (!template) return null;
  const handle = String(account.username || '').trim().replace(/^@/, '');
  if (!handle || /[\s/?#]/.test(handle)) return null;
  return template.url(encodeURIComponent(handle));
}

module.exports = { profileUrlFor, normalizeProfileUrl, isKnownPlatform, normalizePlatformName };
