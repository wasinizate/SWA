'use strict';

// The only network request this app ever makes -- manually triggered
// from the Settings page, never automatic or run in the background (see
// README.md's threat model). A single GET to GitHub's public releases
// API; nothing is sent except the request itself, no telemetry payload,
// no identifying data.
//
// Requires the GitHub repo to be public -- GitHub's API won't reveal a
// private repo's releases to an unauthenticated request, so this fails
// with a clear error (not a crash) until/unless the repo is made public.

const REPO = 'wasinizate/SWA';
const RELEASES_API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

// Plain major.minor.patch comparison -- deliberately not pulling in the
// "semver" package for something this small.
function isNewerVersion(latest, current) {
  const parse = (v) =>
    String(v)
      .replace(/^v/, '')
      .split('.')
      .map((n) => Number(n) || 0);
  const [latestMajor, latestMinor, latestPatch] = parse(latest);
  const [currentMajor, currentMinor, currentPatch] = parse(current);

  if (latestMajor !== currentMajor) return latestMajor > currentMajor;
  if (latestMinor !== currentMinor) return latestMinor > currentMinor;
  return latestPatch > currentPatch;
}

async function checkForUpdates(currentVersion) {
  const response = await fetch(RELEASES_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      // GitHub's API rejects requests with no User-Agent.
      'User-Agent': 'SWA-update-check',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('No release found -- the repository may still be private.');
    }
    throw new Error(`GitHub returned an unexpected response (${response.status}).`);
  }

  const release = await response.json();
  const latestVersion = String(release.tag_name || '').replace(/^v/, '');

  return {
    currentVersion,
    latestVersion,
    isNewer: latestVersion ? isNewerVersion(latestVersion, currentVersion) : false,
    releaseUrl: release.html_url || `https://github.com/${REPO}/releases`,
  };
}

module.exports = { checkForUpdates, REPO };
