-- Shared-folder collaborative sync (see src/main/sync/) -- an additive
-- layer on top of the existing cross-instance export/import
-- (0008_data_export.sql), not a replacement. That manual flow stays
-- exactly as it is for one-off handoffs; this is for 2-3 people who want
-- their shared clients kept passively in sync via a folder they already
-- have some other tool (Dropbox/OneDrive/Syncthing/a shared drive)
-- keeping in sync between their machines. This app makes no network
-- calls of its own for this -- it only reads/writes plain local files in
-- a folder the user points it at.

-- Whole clients get marked shared (all their orders included) -- see
-- src/main/db/repositories/person.js's listShared().
ALTER TABLE persons ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0;

-- Tracks the newest export (by its bundle's exportedAt) this instance
-- has already surfaced/resolved from each (remote instance, client)
-- pair, so re-scanning an unchanged file doesn't re-flag it as pending
-- every poll -- only a genuinely newer export does. See
-- src/main/sync/syncScheduler.js.
CREATE TABLE IF NOT EXISTS sync_seen (
    source_instance_id TEXT NOT NULL,
    person_external_id TEXT NOT NULL,
    last_exported_at TEXT NOT NULL,
    PRIMARY KEY (source_instance_id, person_external_id)
);
