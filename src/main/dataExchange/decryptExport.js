'use strict';

// Reverses encryptExport.js. Throws a clear, user-facing error on a
// wrong passphrase or a corrupted/tampered file -- GCM's built-in auth
// tag check fails loudly (an exception, caught below) rather than
// silently producing garbage plaintext, so this is a reliable check,
// not a guess -- same idea as connection.js's own passphrase check on
// vault unlock.

const crypto = require('crypto');
const { deriveKey } = require('./encryptExport');

function decryptExport(fileContents, passphrase) {
  let envelope;
  try {
    envelope = JSON.parse(fileContents);
  } catch (err) {
    throw new Error('This file is not a valid SWA export.');
  }

  try {
    const salt = Buffer.from(envelope.salt, 'base64');
    const iv = Buffer.from(envelope.iv, 'base64');
    const authTag = Buffer.from(envelope.authTag, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    const key = deriveKey(passphrase, salt);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch (err) {
    throw new Error('Incorrect passphrase, or this file is corrupted.');
  }
}

module.exports = { decryptExport };
