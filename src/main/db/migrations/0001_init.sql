-- Initial schema for SWA (Sex Worker Assistant).
--
-- Dates/times are stored as ISO-8601 TEXT (e.g. '2026-08-12T14:30:00.000Z'
-- for timestamps, 'YYYY-MM-DD' for date-only fields). ISO-8601 strings sort
-- correctly as plain text and are easy to read directly in a SQLite
-- browser, so there's no need for a separate integer/epoch representation.

CREATE TABLE IF NOT EXISTS persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- The name/nickname *you* use to recognize this person -- not
    -- necessarily their legal name or platform username.
    private_label TEXT NOT NULL,
    general_notes TEXT NOT NULL DEFAULT '',
    screening_notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS platform_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    -- Free text rather than an enum/lookup table -- "generalized to any
    -- platform" means we shouldn't hardcode a platform list.
    platform_name TEXT NOT NULL,
    username TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0, -- 0/1; SQLite has no native boolean type
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_platform_accounts_person_id ON platform_accounts(person_id);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    -- Deleting the linked account keeps the order but unlinks it, rather
    -- than deleting financial history.
    platform_account_id INTEGER REFERENCES platform_accounts(id) ON DELETE SET NULL,
    -- Money is stored as an integer number of cents (not a REAL dollar
    -- amount) to avoid floating-point rounding errors. The renderer
    -- converts to/from human-friendly dollars -- see src/renderer/helpers.js.
    amount_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    date_paid TEXT,
    payment_method TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    -- Free text (e.g. pending/paid/delivered/cancelled) rather than an
    -- enum, so workflows can differ per user without a schema change.
    status TEXT NOT NULL DEFAULT 'pending',
    delivery_due_date TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_person_id ON orders(person_id);
CREATE INDEX IF NOT EXISTS idx_orders_platform_account_id ON orders(platform_account_id);

-- Generic key/value store for small pieces of app configuration (e.g. the
-- auto-lock idle timeout). Keeping this in the encrypted DB -- rather than
-- a plain file -- means settings never leak outside the vault either.
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('idle_timeout_seconds', '600');
