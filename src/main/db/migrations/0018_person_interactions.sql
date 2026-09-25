-- A manually-logged interaction/conversation history per client,
-- distinct from persons.general_notes/screening_notes (single free-text
-- fields, overwritten in place each edit) -- this is an append-only
-- timeline: "asked for a custom," "promised to pay Friday," "chargeback
-- risk." Free-text `type` rather than a hardcoded enum, same "free text
-- with a small fixed set" convention as orders.status/
-- platform_accounts.platform_name -- the renderer offers a small preset
-- list (see INTERACTION_TYPE_OPTIONS in helpers.js) without the schema
-- enforcing it.
--
-- An entry can optionally carry a follow-up due date. This is
-- deliberately the SAME row, not a separate follow-ups table: "promised
-- to pay Friday" IS both the note and the reason to follow up Friday --
-- one fact, not two things to enter separately. When follow_up_date is
-- set and follow_up_resolved_at isn't, the entry also shows up in the
-- cross-client Follow-ups queue (see personInteraction.js's
-- getFollowUpSummary()) until marked done.
CREATE TABLE IF NOT EXISTS person_interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'note',
    text TEXT NOT NULL,
    follow_up_date TEXT,
    follow_up_resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_person_interactions_person_id ON person_interactions(person_id);
CREATE INDEX IF NOT EXISTS idx_person_interactions_follow_up_date ON person_interactions(follow_up_date);
