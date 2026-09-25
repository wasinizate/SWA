-- A lightweight, non-destructive relationship between two clients who
-- might be connected -- the same real person under a second account, a
-- couple who both message the same creator, someone's known "backup"
-- account -- without committing to a full merge (person.js's
-- mergeInto(), which deletes one side and can't be undone). Either side
-- of a link can be "promoted" to a merge later, or unlinked if the
-- connection turns out not to matter.
--
-- Always symmetric -- person_a_id/person_b_id are stored with the
-- smaller id first (enforced in personLink.js, not here) so the same
-- pair can never end up linked twice under swapped ids, and the UNIQUE
-- constraint below actually catches a duplicate rather than silently
-- allowing one.
CREATE TABLE IF NOT EXISTS person_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_a_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    person_b_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(person_a_id, person_b_id)
);
CREATE INDEX IF NOT EXISTS idx_person_links_person_b_id ON person_links(person_b_id);
