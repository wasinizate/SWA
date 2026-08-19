'use strict';

// Resolves and applies an import bundle (see buildExportBundle.js for
// the shape). The core problem this solves: a bundle's person has no
// local identity here yet -- resolvePersonId() below is the only place
// that decides "which local client (if any) does this belong to,"
// checked two ways before ever asking a human:
//   1. A direct match: some local person's own external_id is exactly
//      this one (their record WAS created by importing this exact
//      person before, or was later stamped with it -- see
//      applyImport()'s two-way-linking step below).
//   2. A remembered manual link in person_external_links (a human
//      confirmed once, earlier, that this external_id -> that local
//      person -- see 0008_data_export.sql's comment).
// If neither matches, the renderer has to ask (see previewImport()'s
// `resolved: false` case) -- this module never guesses.
//
// Beyond first-time handoff, this also supports genuine back-and-forth:
// re-importing a bundle whose person/orders already exist locally
// surfaces a field-level diff (never applied silently -- see
// previewImport()'s `personChanges`/`updates` and applyImport()'s
// `resolution.applyUpdates`), so e.g. a model updating an order's status
// or a client's notes and exporting back is something the original
// sender can actually pull in, not just a no-op re-import.

const personRepo = require('../db/repositories/person');
const orderRepo = require('../db/repositories/order');
const platformAccountRepo = require('../db/repositories/platformAccount');
const orderAttachmentRepo = require('../db/repositories/orderAttachment');
const personExternalLinkRepo = require('../db/repositories/personExternalLink');

// local: the DB column name (snake_case). incoming: the bundle's key
// for the same field (camelCase, matches what buildExportBundle.js
// writes and what order.js/person.js's update() expect). label: shown
// in the import preview's diff.
const ORDER_UPDATE_FIELDS = [
  { local: 'status', incoming: 'status', label: 'Status' },
  { local: 'amount_cents', incoming: 'amountCents', label: 'Amount' },
  { local: 'currency', incoming: 'currency', label: 'Currency' },
  { local: 'date_paid', incoming: 'datePaid', label: 'Date paid' },
  { local: 'payment_method', incoming: 'paymentMethod', label: 'Payment method' },
  { local: 'description', incoming: 'description', label: 'Description' },
  { local: 'delivery_due_date', incoming: 'deliveryDueDate', label: 'Delivery due date' },
  { local: 'delivery_due_time', incoming: 'deliveryDueTime', label: 'Due time' },
  { local: 'feedback_notes', incoming: 'feedbackNotes', label: 'Feedback notes' },
  { local: 'would_repeat', incoming: 'wouldRepeat', label: 'Would repeat' },
];

const PERSON_UPDATE_FIELDS = [
  { local: 'general_notes', incoming: 'generalNotes', label: 'General notes' },
  { local: 'screening_notes', incoming: 'screeningNotes', label: 'Screening notes' },
];

// Empty-string-normalizes so e.g. a local NULL vs an incoming '' isn't
// flagged as a "change" -- both mean "nothing there." Returns an object
// keyed by each changed field's `incoming` name, only for fields that
// actually differ (so an unchanged order/person diffs to `{}`).
function diffFields(localRow, incomingRow, fieldTable) {
  const normalize = (v) => (v === undefined || v === null ? '' : v);
  const changes = {};
  for (const f of fieldTable) {
    const localValue = localRow[f.local];
    const incomingValue = incomingRow[f.incoming];
    if (normalize(localValue) !== normalize(incomingValue)) {
      changes[f.incoming] = { label: f.label, local: localValue, incoming: incomingValue };
    }
  }
  return changes;
}

function resolvePersonId(personExternalId) {
  const direct = personRepo.getByExternalId(personExternalId);
  if (direct) return direct.id;
  return personExternalLinkRepo.getPersonIdForExternalId(personExternalId);
}

// Given an already-fetched list of existing attachments (so callers that
// need to add them too only fetch once, not once per attachment) and a
// bundle's incoming attachment list, returns the incoming ones not
// already present locally -- matched by (fileName, byteSize), cheap and
// sufficient (never used to remove anything, only to decide whether to
// add). Shared by the read-only preview path and the actual apply path
// below, instead of each re-implementing the same match.
function findNewAttachments(existingAttachments, incomingAttachments) {
  return incomingAttachments.filter((a) => {
    const byteSize = Buffer.from(a.dataBase64, 'base64').length;
    return !existingAttachments.some((e) => e.file_name === a.fileName && e.byte_size === byteSize);
  });
}

function countNewAttachments(localOrderId, incomingAttachments) {
  const existing = orderAttachmentRepo.listByOrder(localOrderId);
  return findNewAttachments(existing, incomingAttachments).length;
}

// Read-only: what would happen if this bundle were imported right now.
// The renderer uses this to build its preview/confirmation UI before
// anything is actually written -- see settings.js's Import card.
function previewImport(bundle) {
  const resolvedPersonId = resolvePersonId(bundle.person.externalId);
  const resolvedPerson = resolvedPersonId ? personRepo.get(resolvedPersonId) : null;

  const newOrderCount = bundle.orders.filter((o) => !orderRepo.getByExternalId(o.externalId)).length;

  const updates = resolvedPerson
    ? bundle.orders
        .map((orderData) => {
          const local = orderRepo.getByExternalId(orderData.externalId);
          if (!local) return null; // brand new, not an "update" -- handled by newOrderCount instead

          const changes = diffFields(local, orderData, ORDER_UPDATE_FIELDS);
          const newAttachmentCount = countNewAttachments(local.id, orderData.attachments);
          if (Object.keys(changes).length === 0 && newAttachmentCount === 0) return null; // nothing to show

          return { externalId: orderData.externalId, localOrderId: local.id, changes, newAttachmentCount };
        })
        .filter(Boolean)
    : [];

  return {
    personLabel: bundle.person.privateLabel,
    resolved: resolvedPersonId !== null,
    resolvedPersonId,
    resolvedPersonLabel: resolvedPerson ? resolvedPerson.private_label : null,
    personChanges: resolvedPerson ? diffFields(resolvedPerson, bundle.person, PERSON_UPDATE_FIELDS) : null,
    orderCount: bundle.orders.length,
    newOrderCount,
    updates,
    // Only actually needed by the renderer when unresolved (to populate
    // the "attach to an existing client" picker) -- omitted otherwise so
    // an already-linked import's preview doesn't carry the whole client
    // list for nothing.
    people: resolvedPersonId === null ? personRepo.listAll() : [],
  };
}

// Performs the import. `resolution`:
//   - `attachToPersonId` / `createNew`: only consulted the first time a
//     bundle's person can't be auto-resolved (see previewImport()) --
//     once resolved, either directly or via a remembered link, these
//     are ignored, since the earlier choice is what's remembered and
//     reused every time after.
//   - `applyUpdates` (boolean, default true): whether to apply the
//     field-level diffs previewImport() surfaced. When false, behavior
//     matches the original one-directional-handoff design: new orders
//     still insert, existing ones are left untouched.
function applyImport(bundle, resolution = {}) {
  let personId = resolvePersonId(bundle.person.externalId);

  if (personId === null) {
    if (resolution.attachToPersonId) {
      personId = resolution.attachToPersonId;
      personExternalLinkRepo.create(bundle.person.externalId, personId);
    } else if (resolution.createNew) {
      const created = personRepo.create({
        privateLabel: bundle.person.privateLabel,
        generalNotes: bundle.person.generalNotes,
        screeningNotes: bundle.person.screeningNotes,
      });
      // Preserves the source's external_id on the new local row (rather
      // than minting a fresh one) -- means a *second* import of this
      // same person later resolves via the "direct match" path above,
      // with no person_external_links row even needed.
      personRepo.setExternalId(created.id, bundle.person.externalId);
      personId = created.id;
    } else {
      throw new Error('This import needs a resolution (attach to an existing client, or create new) before it can be applied.');
    }
  }

  // Two-way linking: if the resolved local person doesn't have their
  // own external_id yet, stamp it with this bundle's -- never
  // overwriting one that's already set (mirrors ensureExternalId()'s
  // guard). Without this, a person resolved via a manual
  // person_external_links link only has the identity remembered on
  // *this* side; their own future exports would mint an unrelated new
  // id and the original sender wouldn't recognize them back
  // automatically. With it, both sides share the same canonical id
  // after the first link, in either direction, from here on.
  const resolvedPerson = personRepo.get(personId);
  if (!resolvedPerson.external_id) {
    personRepo.setExternalId(personId, bundle.person.externalId);
  }

  const applyUpdates = resolution.applyUpdates !== false;

  if (applyUpdates) {
    const personChanges = diffFields(personRepo.get(personId), bundle.person, PERSON_UPDATE_FIELDS);
    if (Object.keys(personChanges).length > 0) {
      personRepo.update(personId, {
        generalNotes: bundle.person.generalNotes,
        screeningNotes: bundle.person.screeningNotes,
      });
    }
  }

  // Platform accounts: a plain case-insensitive (platform, username)
  // text match against whatever this person already has -- no
  // external_id/link machinery, unlike persons. Two people independently
  // typing "OnlyFans" / "zach123" for the same client is a far simpler,
  // lower-stakes problem than "is this the same client" -- worst case
  // here is a harmless duplicate row, not data landing on the wrong
  // person. Always additive, regardless of applyUpdates.
  const existingAccounts = platformAccountRepo.listByPerson(personId);
  for (const account of bundle.person.platformAccounts) {
    const alreadyExists = existingAccounts.some(
      (a) =>
        a.platform_name.toLowerCase() === account.platformName.toLowerCase() &&
        a.username.toLowerCase() === account.username.toLowerCase()
    );
    if (!alreadyExists) {
      platformAccountRepo.create({
        personId,
        platformName: account.platformName,
        username: account.username,
        verified: account.verified,
      });
    }
  }

  let ordersImported = 0;
  let ordersUpdated = 0;
  let ordersSkipped = 0;
  let attachmentsAdded = 0;

  for (const orderData of bundle.orders) {
    const localOrder = orderRepo.getByExternalId(orderData.externalId);

    if (!localOrder) {
      const createdOrder = orderRepo.create({
        personId,
        amountCents: orderData.amountCents,
        currency: orderData.currency,
        datePaid: orderData.datePaid,
        paymentMethod: orderData.paymentMethod,
        description: orderData.description,
        status: orderData.status,
        deliveryDueDate: orderData.deliveryDueDate,
        deliveryDueTime: orderData.deliveryDueTime,
        externalId: orderData.externalId, // preserves the source order's id, same dedupe reasoning as the person above
      });
      // create() doesn't take feedback/would-repeat (those are
      // update()-only fields, see order.js) -- set them right after if
      // the bundle carried any.
      if (orderData.feedbackNotes || orderData.wouldRepeat) {
        orderRepo.update(createdOrder.id, { feedbackNotes: orderData.feedbackNotes, wouldRepeat: orderData.wouldRepeat });
      }

      for (const attachment of orderData.attachments) {
        orderAttachmentRepo.create({
          orderId: createdOrder.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          data: Buffer.from(attachment.dataBase64, 'base64'),
        });
      }

      ordersImported += 1;
      continue;
    }

    // Already exists locally -- apply the diff instead of skipping, if
    // asked to.
    if (applyUpdates) {
      const changes = diffFields(localOrder, orderData, ORDER_UPDATE_FIELDS);
      if (Object.keys(changes).length > 0) {
        orderRepo.update(localOrder.id, {
          amountCents: orderData.amountCents,
          currency: orderData.currency,
          datePaid: orderData.datePaid,
          paymentMethod: orderData.paymentMethod,
          description: orderData.description,
          status: orderData.status,
          deliveryDueDate: orderData.deliveryDueDate,
          deliveryDueTime: orderData.deliveryDueTime,
          feedbackNotes: orderData.feedbackNotes,
          wouldRepeat: orderData.wouldRepeat,
        });
        ordersUpdated += 1;
      } else {
        ordersSkipped += 1;
      }

      const existingAttachments = orderAttachmentRepo.listByOrder(localOrder.id); // fetched once, not once per attachment
      for (const attachment of findNewAttachments(existingAttachments, orderData.attachments)) {
        orderAttachmentRepo.create({
          orderId: localOrder.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          data: Buffer.from(attachment.dataBase64, 'base64'),
        });
        attachmentsAdded += 1;
      }
    } else {
      ordersSkipped += 1;
    }
  }

  return {
    personLabel: bundle.person.privateLabel,
    personId,
    ordersImported,
    ordersUpdated,
    ordersSkipped,
    attachmentsAdded,
  };
}

module.exports = { previewImport, applyImport };
