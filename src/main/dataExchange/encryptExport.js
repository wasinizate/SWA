'use strict';

// Encrypts an export bundle (a plain JS object, see buildExportBundle.js)
// into the on-disk envelope written by dataExchangeIpc.js's export
// handlers -- AES-256-GCM via Node's built-in crypto, no new dependency.
// The outer envelope (salt/iv/authTag, all base64) is plain readable
// JSON; only the `ciphertext` field is unreadable without the
// passphrase. The sender picks that passphrase at export time and
// shares it with the recipient separately (verbally, a different
// message thread, etc.) -- deliberately not the vault passphrase, so
// nobody has to hand that over just to share one order. Client notes,
// financial amounts, and attachment images all end up in this file, so
// it gets the same "encrypted, not just locally protected" treatment as
// everything else in this app (see 0003_order_attachments.sql's comment
// on why attachments are BLOBs, not plaintext files, for the same
// reasoning).

const crypto = require('crypto');

const ENVELOPE_VERSION = 1;
const KEY_LENGTH = 32; // AES-256
const SALT_LENGTH = 16;
const IV_LENGTH = 12; // recommended length for GCM

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, KEY_LENGTH);
}

function encryptExport(bundle, passphrase) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(passphrase, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(bundle), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return JSON.stringify({
    envelopeVersion: ENVELOPE_VERSION,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
}

module.exports = { encryptExport, deriveKey, ENVELOPE_VERSION };
