-- Client tags: a freeform-but-reusable label a client can be given (e.g.
-- "regular", "verified", "do-not-book"). Unlike platform_name/payment_
-- method/expense category elsewhere in this schema (free TEXT per row,
-- no lookup table), a tag genuinely needs to be the *same* value reused
-- across many clients for filtering/autocomplete to be useful, so it
-- gets its own normalized table plus a join table -- same "dedicated
-- table per relationship" shape as platform_accounts/order_attachments.

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS person_tags (
    person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_person_tags_tag_id ON person_tags(tag_id);
