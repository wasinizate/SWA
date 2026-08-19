'use strict';

// Reverses encryptExport.js. Throws a clear, user-facing error on a
// wrong passphrase or a corrupted/tampered file -- GCM's built-in auth
// tag check fails loudly (an exception, caught below) rather than
// silently producing garbage plaintext, so this is a reliable check,
// not a guess -- same idea as connection.js's own passphrase check on
// vault unlock. Also validates both version numbers written into every
// export (see encryptExport.js/buildExportBundle.js) -- otherwise
// they're written but never actually checked, which defeats the point
// of having them at all once a future format change happens.

const crypto = require('crypto');
const { deriveKey, ENVELOPE_VERSION } = require('./encryptExport');
const { FORMAT_VERSION } = require('./buildExportBundle');

function decryptExport(fileContents, passphrase) {
  let envelope;
  try {
    envelope = JSON.parse(fileContents);
  } catch (err) {
    throw new Error('This file is not a valid SWA export.');
  }

  if (envelope.envelopeVersion !== ENVELOPE_VERSION) {
    throw new Error('This file was made by an incompatible version of SWA and cannot be imported.');
  }

  let bundle;
  try {
    const salt = Buffer.from(envelope.salt, 'base64');
    const iv = Buffer.from(envelope.iv, 'base64');
    const authTag = Buffer.from(envelope.authTag, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    const key = deriveKey(passphrase, salt);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    bundle = JSON.parse(plaintext.toString('utf8'));
  } catch (err) {
    throw new Error('Incorrect passphrase, or this file is corrupted.');
  }

  if (bundle.formatVersion !== FORMAT_VERSION) {
    throw new Error('This file was exported by an incompatible version of SWA and cannot be imported.');
  }

  return bundle;
}

module.exports = { decryptExport };
