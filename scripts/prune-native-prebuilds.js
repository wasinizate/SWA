'use strict';

// electron-builder afterPack hook (see electron-builder.yml): deletes every
// better-sqlite3-multiple-ciphers prebuilt binary except the one for the
// OS/CPU being packaged. The package ships binaries for 8 combinations but
// only ever loads prebuilds/<platform>-<arch>.node at runtime (see its
// lib/binding.js), so the other 7 (~17MB) are dead weight in every install.
//
// Done here rather than with `files` patterns in electron-builder.yml, which
// can't express it safely: ${platform} there means the machine doing the
// build (not the target), and a per-platform `files` list *replaces* the
// top-level one instead of merging with it. This hook is handed the real
// target, and runs before signing, so a signed macOS app never sees the
// deletion.

const fs = require('fs');
const path = require('path');
const { Arch } = require('builder-util');

exports.default = async function pruneNativePrebuilds(context) {
  const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
  const prebuildsDir = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'better-sqlite3-multiple-ciphers', 'prebuilds');
  const keep = `${context.electronPlatformName}-${Arch[context.arch]}.node`;

  // Never ship a build that can't open its own database.
  if (!fs.existsSync(path.join(prebuildsDir, keep))) {
    throw new Error(`prune-native-prebuilds: ${keep} not found in ${prebuildsDir}`);
  }

  for (const name of fs.readdirSync(prebuildsDir)) {
    if (name !== keep) fs.rmSync(path.join(prebuildsDir, name));
  }
};
