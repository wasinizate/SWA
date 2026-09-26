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

// The reverse direction: a pasted profile link -> platform + handle, for
// adding a client (or an account) by pasting a link instead of typing.
// `handle` pulls the username out of the path segments, or returns null
// when the path isn't a profile.
const PROFILE_HOSTS = [
  { hosts: ['onlyfans.com'], platform: 'OnlyFans', handle: (p) => p[0] },
  { hosts: ['fansly.com'], platform: 'Fansly', handle: (p) => p[0] },
  { hosts: ['x.com', 'twitter.com'], platform: 'X', handle: (p) => p[0] },
  { hosts: ['instagram.com'], platform: 'Instagram', handle: (p) => p[0] },
  { hosts: ['reddit.com', 'old.reddit.com'], platform: 'Reddit', handle: (p) => (p[0] === 'user' || p[0] === 'u' ? p[1] : null) },
  { hosts: ['tiktok.com'], platform: 'TikTok', handle: (p) => (p[0] && p[0].startsWith('@') ? p[0].slice(1) : null) },
  { hosts: ['t.me', 'telegram.me'], platform: 'Telegram', handle: (p) => p[0] },
  { hosts: ['snapchat.com'], platform: 'Snapchat', handle: (p) => (p[0] === 'add' ? p[1] : null) },
  { hosts: ['chaturbate.com'], platform: 'Chaturbate', handle: (p) => p[0] },
  { hosts: ['stripchat.com'], platform: 'Stripchat', handle: (p) => p[0] },
  { hosts: ['justfor.fans'], platform: 'JustFor.Fans', handle: (p) => p[0] },
  { hosts: ['fanvue.com'], platform: 'Fanvue', handle: (p) => p[0] },
  { hosts: ['loyalfans.com'], platform: 'LoyalFans', handle: (p) => p[0] },
  { hosts: ['patreon.com'], platform: 'Patreon', handle: (p) => p[0] },
  { hosts: ['twitch.tv'], platform: 'Twitch', handle: (p) => p[0] },
  { hosts: ['bsky.app'], platform: 'Bluesky', handle: (p) => (p[0] === 'profile' ? p[1] : null) },
];

// First path segments on those sites that are app pages, not profiles.
const NOT_PROFILES = new Set([
  'my', 'home', 'explore', 'settings', 'login', 'signup', 'search', 'messages', 'notifications', 'i', 'intent',
  'share', 'p', 'reel', 'reels', 'stories', 'about', 'help', 'terms', 'privacy', 'posts', 'media', 'hashtag',
]);
const HANDLE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

// Returns { platformName, username, profileUrl } or null if `text` isn't a
// profile link. profileUrl is '' for known platforms (the app rebuilds
// those itself) and the pasted https link for any other site.
function parseProfileLink(text) {
  const raw = String(text || '').trim();
  // A plain name ("Jordan M.", "jordan") is never a link: no dot, or a
  // space (normalizeProfileUrl refuses those), or no path after the host.
  if (!raw.includes('.')) return null;
  const normalized = normalizeProfileUrl(raw);
  if (!normalized) return null;
  const url = new URL(normalized);
  const host = url.hostname.replace(/^(www|m|mobile)\./, '').toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (segments.length === 0) return null;

  const known = PROFILE_HOSTS.find((entry) => entry.hosts.includes(host));
  if (known) {
    const handle = known.handle(segments);
    if (!handle || NOT_PROFILES.has(handle.toLowerCase()) || !HANDLE_PATTERN.test(handle)) return null;
    return { platformName: known.platform, username: handle, profileUrl: '' };
  }

  const handle = segments[segments.length - 1];
  if (!HANDLE_PATTERN.test(handle.replace(/^@/, ''))) return null;
  return { platformName: host, username: handle.replace(/^@/, ''), profileUrl: normalized };
}

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

module.exports = { profileUrlFor, normalizeProfileUrl, isKnownPlatform, normalizePlatformName, parseProfileLink };
