'use strict';

const path = require('path');
const { app } = require('electron');
const Database = require('better-sqlite3-multiple-ciphers');

// The single shared database connection for the whole app. It only exists
// while the vault is unlocked -- see ../security/passphrase.js, which is
// the only module that should call open()/close() directly.
let db = null;

function getDbPath() {
  // app.getPath('userData') is the OS-appropriate per-user app data folder,
  // e.g. %APPDATA%\SWA on Windows, ~/Library/Application Support/SWA on
  // macOS, ~/.config/SWA on Linux (matches package.json's "productName").
  // Nothing in this repo ever writes application data outside of that
  // folder.
  return path.join(app.getPath('userData'), 'data.db');
}

function isOpen() {
  return db !== null;
}

// Opens (creating if necessary) the encrypted database file using
// `passphrase` as the encryption key. Throws if an existing file's
// passphrase doesn't match.
function open(passphrase) {
  if (db) return db; // already open, nothing to do

  const instance = new Database(getDbPath());

  // This sets the encryption key on the connection. If the file already
  // existed and the key is wrong, SQLite does NOT throw here -- the file
  // header can't be validated until we actually try to read from it,
  // which is why the verification query below is required.
  instance.pragma(`key='${escapeForPragma(passphrase)}'`);

  try {
    // Cheapest possible query that forces SQLite to read the real file
    // structure. Wrong passphrase -> "file is not a database".
    instance.prepare('SELECT count(*) FROM sqlite_master').get();
  } catch (err) {
    instance.close();
    throw new Error('Incorrect passphrase, or the database file is corrupted.');
  }

  // SQLite disables foreign key enforcement by default on every new
  // connection -- without this, ON DELETE CASCADE/SET NULL in the schema
  // would silently do nothing.
  instance.pragma('foreign_keys = ON');

  db = instance;
  return db;
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

function getDb() {
  if (!db) throw new Error('Database is locked.');
  return db;
}

// PRAGMA statements don't support bound parameters (`?` placeholders), so
// passphrases have to be interpolated directly into the SQL string. This
// escapes single quotes the standard SQL way (doubling them) so a
// passphrase containing a quote can't break out of the string literal.
function escapeForPragma(value) {
  return String(value).replace(/'/g, "''");
}

module.exports = { open, close, getDb, isOpen, escapeForPragma };
