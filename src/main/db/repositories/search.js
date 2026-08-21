'use strict';

// Search across Persons and Orders in one call. First repository in the
// codebase to do LIKE-style text matching -- everything else so far has
// been exact lookups/joins.

const { getDb } = require('../connection');

const MIN_QUERY_LENGTH = 2;

// Escapes SQLite LIKE's special characters (%, _) plus the escape
// character itself, so a query containing a literal "%" or "_" (e.g.
// searching a payment note like "50% deposit") matches that literal text
// instead of acting as a wildcard. Paired with `ESCAPE '\'` on every LIKE
// below.
function escapeLikePattern(text) {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function search(queryText) {
  const trimmed = (queryText || '').trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return { people: [], orders: [] };

  const like = `%${escapeLikePattern(trimmed)}%`;
  const db = getDb();

  // LIKE is already ASCII-case-insensitive by default in SQLite, so no
  // COLLATE NOCASE is needed on the comparisons themselves -- only on
  // ORDER BY, same convention as person.js/platformAccount.js.
  // Also joined against tags/person_tags (see 0009_person_tags.sql) so a
  // tag label (e.g. "regular") surfaces the clients carrying it, same
  // "search across every relevant field" scope as everything else here.
  const people = db
    .prepare(
      `SELECT DISTINCT persons.id, persons.private_label, persons.general_notes, persons.screening_notes
       FROM persons
       LEFT JOIN platform_accounts ON platform_accounts.person_id = persons.id
       LEFT JOIN person_tags ON person_tags.person_id = persons.id
       LEFT JOIN tags ON tags.id = person_tags.tag_id
       WHERE persons.private_label LIKE ? ESCAPE '\\'
          OR persons.general_notes LIKE ? ESCAPE '\\'
          OR persons.screening_notes LIKE ? ESCAPE '\\'
          OR platform_accounts.platform_name LIKE ? ESCAPE '\\'
          OR platform_accounts.username LIKE ? ESCAPE '\\'
          OR tags.label LIKE ? ESCAPE '\\'
       ORDER BY persons.private_label COLLATE NOCASE`
    )
    .all(like, like, like, like, like, like);

  // Same person-join shape as order.js's listAll(), so a matching order
  // is always shown with its client's label without a second lookup.
  // delivery_due_date rides along so search.js's renderer can offer a
  // "view on calendar" shortcut for orders that actually show up there.
  const orders = db
    .prepare(
      `SELECT orders.id, orders.person_id, persons.private_label AS person_label,
              orders.date_paid, orders.amount_cents, orders.currency,
              orders.status, orders.description, orders.delivery_due_date
       FROM orders
       JOIN persons ON persons.id = orders.person_id
       WHERE orders.description LIKE ? ESCAPE '\\'
          OR orders.feedback_notes LIKE ? ESCAPE '\\'
          OR orders.payment_method LIKE ? ESCAPE '\\'
          OR persons.private_label LIKE ? ESCAPE '\\'
       ORDER BY orders.date_paid DESC, orders.created_at DESC`
    )
    .all(like, like, like, like);

  return { people, orders };
}

module.exports = { search, MIN_QUERY_LENGTH };
