'use strict';

const fs = require('fs');
const path = require('path');

// Runs any .sql files in ./migrations/ that haven't been applied to this
// database yet, in filename order -- hence the 0001_, 0002_, ... prefix
// convention. Safe to call every time the app unlocks: already-applied
// migrations are skipped.
function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const alreadyApplied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map((row) => row.name)
  );

  // Wrap each migration in its own transaction so a failure partway
  // through a file can't leave the schema half-updated.
  const applyMigration = db.transaction((name, sql) => {
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(name);
  });

  for (const file of files) {
    if (alreadyApplied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    applyMigration(file, sql);
    console.log(`Applied migration: ${file}`);
  }
}

module.exports = { runMigrations };
