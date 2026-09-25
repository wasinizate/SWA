'use strict';

// Cross-person "might be the same client" detection -- no table of its
// own, same shape as search.js/analytics.js (composes queries across
// persons/platform_accounts without owning either). Never merges or
// changes anything -- see person.js's mergeInto() for the actual fix
// once a human confirms a real duplicate; this module only *suggests*.
//
// Three signal tiers, most to least reliable:
//   1. exact_account -- the exact same (platform, username) pair is
//      typed under two different Persons. platformAccount.js's
//      findByPlatformAndUsername() catches this at entry time going
//      forward; this tier is what catches it for data that already
//      existed before that check did, or slipped through some other way.
//   2. cross_platform_username -- the same username shows up under two
//      different Persons on *different* platforms. Weaker (usernames
//      aren't globally unique) but a common real pattern -- people reuse
//      handles across platforms.
//   3. similar_label -- two Persons' private_label normalize (trimmed,
//      collapsed whitespace, case-insensitive) to the exact same string.
//      The weakest signal included -- included anyway since typing the
//      same nickname twice by mistake is also a common way a duplicate
//      happens.

const { getDb } = require('../connection');

function findDuplicateCandidates() {
  const db = getDb();
  const candidates = [];

  // ---- Tier 1: exact (platform, username) reused across two Persons ---
  const exactRows = db
    .prepare(
      `SELECT a.person_id AS person_a_id, b.person_id AS person_b_id,
              a.platform_name, a.username
       FROM platform_accounts a
       JOIN platform_accounts b
         ON a.platform_name = b.platform_name COLLATE NOCASE
        AND a.username = b.username COLLATE NOCASE
        AND a.person_id < b.person_id`
    )
    .all();
  for (const row of exactRows) {
    candidates.push({
      tier: 'exact_account',
      personAId: row.person_a_id,
      personBId: row.person_b_id,
      detail: `${row.platform_name}: ${row.username}`,
    });
  }

  // ---- Tier 2: same username, different platform, different Person ----
  const crossRows = db
    .prepare(
      `SELECT a.person_id AS person_a_id, b.person_id AS person_b_id,
              a.platform_name AS platform_a, b.platform_name AS platform_b, a.username
       FROM platform_accounts a
       JOIN platform_accounts b
         ON a.username = b.username COLLATE NOCASE
        AND a.platform_name != b.platform_name COLLATE NOCASE
        AND a.person_id < b.person_id`
    )
    .all();
  for (const row of crossRows) {
    candidates.push({
      tier: 'cross_platform_username',
      personAId: row.person_a_id,
      personBId: row.person_b_id,
      detail: `"${row.username}" on both ${row.platform_a} and ${row.platform_b}`,
    });
  }

  // ---- Tier 3: near-identical private_label -----------------------------
  // Done in JS, not SQL -- a plain normalized-string equality check
  // across however many clients exist (a personal client list, not a
  // database of thousands), not worth a SQL trick for.
  const persons = db.prepare('SELECT id, private_label FROM persons').all();
  const normalize = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  for (let i = 0; i < persons.length; i++) {
    for (let j = i + 1; j < persons.length; j++) {
      if (normalize(persons[i].private_label) === normalize(persons[j].private_label)) {
        candidates.push({
          tier: 'similar_label',
          personAId: persons[i].id,
          personBId: persons[j].id,
          detail: `Both labeled "${persons[i].private_label}"`,
        });
      }
    }
  }

  // A pair can trip more than one tier at once (e.g. tier 1 and tier 3
  // for the same two people) -- keep only the first (strongest, since
  // tiers are pushed in strongest-first order above) match per pair so
  // the UI shows one suggestion, not up to three for the same pair.
  const seenPairs = new Set();
  const deduped = [];
  for (const c of candidates) {
    const key = `${c.personAId}:${c.personBId}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    deduped.push(c);
  }

  // Attach labels last, reusing the `persons` list already fetched for
  // tier 3 above rather than joining persons three separate times just
  // for a field only tiers 1/2 are missing.
  const labelById = new Map(persons.map((p) => [p.id, p.private_label]));
  return deduped.map((c) => ({
    ...c,
    personALabel: labelById.get(c.personAId),
    personBLabel: labelById.get(c.personBId),
  }));
}

module.exports = { findDuplicateCandidates };
