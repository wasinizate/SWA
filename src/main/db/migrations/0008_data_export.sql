-- Cross-instance export/import (handing a client/order from one install
-- of this app to another -- e.g. two people sharing a client roster).
-- See src/main/dataExchange/ for the export/import logic that uses
-- these columns.
--
-- external_id is a portable UUID (crypto.randomUUID(), generated lazily
-- the first time a record is exported -- see person.js/order.js's
-- ensureExternalId()) -- separate from the local AUTOINCREMENT id,
-- which only ever means something inside this one database. Nullable:
-- most rows are never exported and never need one.
ALTER TABLE persons ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_persons_external_id ON persons(external_id) WHERE external_id IS NOT NULL;

ALTER TABLE orders ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_external_id ON orders(external_id) WHERE external_id IS NOT NULL;

-- Remembers a manually-confirmed link: "an import claiming this
-- external_id belongs to my local person_id." Filled in once, the first
-- time an import can't resolve who a remote Person is (their
-- external_id doesn't match anything in `persons` directly either --
-- see applyImport.js). Every later import naming that same external_id
-- resolves automatically from here, no repeat prompting -- this is what
-- lets two independently-created "Zach" records (one per instance) stay
-- in sync instead of producing a duplicate every time.
CREATE TABLE IF NOT EXISTS person_external_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL UNIQUE,
    person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
