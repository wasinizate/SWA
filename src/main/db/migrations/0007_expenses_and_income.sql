-- Expense ledger and manual income-statement tracking (the "Expenses"
-- tab). Kept as three separate tables rather than folding into `orders`
-- -- these track the business's own costs and platform payouts, not
-- client-facing transactions.

-- A flat list of costs (supplies, subscriptions, platform fees,
-- marketing, etc.). `category` is free text with UI-suggested presets
-- (see EXPENSE_CATEGORY_PRESETS in helpers.js) -- same "free text over
-- enum" choice already made for platform_name/payment_method, since
-- costs vary a lot from person to person.
CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    category TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

-- Manually-entered totals from a platform's periodic pay statement (e.g.
-- an OnlyFans payout summary), for approximating income across a period
-- without adding every individual order/tip. Deliberately a coarse
-- period total, not parsed automatically from an uploaded PDF -- see the
-- chat history around this migration's commit for why (platform
-- statement formats aren't a stable, documented target, and a bad parse
-- could silently produce a wrong number).
CREATE TABLE IF NOT EXISTS income_statements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'USD',
    gross_cents INTEGER NOT NULL DEFAULT 0,
    fees_cents INTEGER NOT NULL DEFAULT 0,
    net_cents INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_income_statements_period_start ON income_statements(period_start);

-- Same shape and reasoning as order_attachments (see
-- 0003_order_attachments.sql's comment): the source statement PDF is
-- sensitive financial data, so it's kept as an encrypted BLOB inside
-- this same encrypted database rather than a plaintext file on disk. A
-- dedicated table per entity (not a shared polymorphic one) matches this
-- codebase's existing style.
CREATE TABLE IF NOT EXISTS income_statement_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    income_statement_id INTEGER NOT NULL REFERENCES income_statements(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    byte_size INTEGER NOT NULL,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_income_statement_attachments_statement_id ON income_statement_attachments(income_statement_id);
