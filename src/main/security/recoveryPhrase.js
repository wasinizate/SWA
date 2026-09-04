'use strict';

// Pure crypto for the opt-in "recovery phrase" feature -- no file I/O
// here (that's vaultMeta.js's job, same separation passphrase.js/
// restoreBackup.js already use). Six random words from the standard
// BIP-39 English word list (bundled locally, see bip39-wordlist.json --
// vendored once at authoring time, never fetched by the app itself)
// wrap the vault's actual passphrase, the same "wrap a secret with a
// derived key" shape quick-unlock already uses for the OS keychain.
//
// This is NOT full BIP-39 (no checksum word, no wallet-standard
// derivation) -- just reusing its well-vetted word list (no confusable
// entries, unique prefixes) for a random, memorable, on-paper secret.
// 6 words from 2048 is ~66 bits of entropy, plenty for something
// written down rather than brute-forced remotely.

const crypto = require('crypto');
const WORDLIST = require('./bip39-wordlist.json');

const WORD_COUNT = 6;
const SCRYPT_KEY_LENGTH = 32; // AES-256
const GCM_IV_LENGTH = 12;
const GCM_AUTH_TAG_LENGTH = 16;

function generatePhrase() {
  const words = [];
  for (let i = 0; i < WORD_COUNT; i += 1) {
    words.push(WORDLIST[crypto.randomInt(0, WORDLIST.length)]);
  }
  return words;
}

// Case/whitespace shouldn't matter when typing the phrase back in --
// normalize the same way on both wrap and unwrap.
function normalizePhrase(words) {
  return words
    .map((word) => String(word).trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function deriveKey(words, salt) {
  return crypto.scryptSync(normalizePhrase(words), salt, SCRYPT_KEY_LENGTH);
}

// Encrypts `passphrase` with a key derived from `words`. Returns a fresh
// random salt alongside the ciphertext -- both are non-secret (needed to
// re-derive the same key later) and safe to store in vault.json, same as
// quick-unlock's blob.
function wrapPassphrase(words, passphrase) {
  const salt = crypto.randomBytes(16);
  const key = deriveKey(words, salt);
  const iv = crypto.randomBytes(GCM_IV_LENGTH);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(passphrase), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    salt: salt.toString('base64'),
    blob: Buffer.concat([iv, authTag, ciphertext]).toString('base64'),
  };
}

// Reverses wrapPassphrase(). Throws a clear, generic error on wrong
// words/corrupted blob rather than leaking why (GCM's auth tag check
// fails the same way for either case).
function unwrapPassphrase(words, salt, blob) {
  try {
    const saltBuf = Buffer.from(salt, 'base64');
    const key = deriveKey(words, saltBuf);
    const raw = Buffer.from(blob, 'base64');

    const iv = raw.subarray(0, GCM_IV_LENGTH);
    const authTag = raw.subarray(GCM_IV_LENGTH, GCM_IV_LENGTH + GCM_AUTH_TAG_LENGTH);
    const ciphertext = raw.subarray(GCM_IV_LENGTH + GCM_AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (err) {
    throw new Error('Incorrect recovery phrase.');
  }
}

module.exports = { WORD_COUNT, generatePhrase, normalizePhrase, wrapPassphrase, unwrapPassphrase };
