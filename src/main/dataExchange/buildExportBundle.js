'use strict';

// Builds the pre-encryption export bundle for one person -- either every
// order they have (`orderIds: null`, "Export client") or a specific
// subset (`orderIds: [id]`, "Export order"). See
// src/main/db/migrations/0008_data_export.sql for the external_id
// concept this all depends on.

const personRepo = require('../db/repositories/person');
const orderRepo = require('../db/repositories/order');
const platformAccountRepo = require('../db/repositories/platformAccount');
const orderAttachmentRepo = require('../db/repositories/orderAttachment');

const FORMAT_VERSION = 1;

function buildPersonExport(personId, { orderIds = null } = {}) {
  const person = personRepo.get(personId);
  if (!person) throw new Error(`Person ${personId} not found.`);

  // Lazily mints external ids for anything that doesn't have one yet --
  // most persons/orders never need one, only ones that actually get
  // exported.
  const personExternalId = personRepo.ensureExternalId(personId);

  const platformAccounts = platformAccountRepo.listByPerson(personId).map((a) => ({
    platformName: a.platform_name,
    username: a.username,
    verified: !!a.verified,
  }));

  const allOrders = orderRepo.listByPerson(personId);
  const ordersToExport = orderIds ? allOrders.filter((o) => orderIds.includes(o.id)) : allOrders;

  const orders = ordersToExport.map((order) => {
    const externalId = orderRepo.ensureExternalId(order.id);

    // Attachment bytes are base64-encoded inline -- simplest approach,
    // no new archive/zip dependency, consistent with how this app
    // already moves binary data over IPC. Worth knowing: a lot of
    // large/many attachments makes for a large export file (same 20MB
    // per-file cap as anywhere else in the app, just per attachment).
    const attachments = orderAttachmentRepo.listByOrder(order.id).map((meta) => {
      const full = orderAttachmentRepo.get(meta.id);
      return {
        fileName: full.file_name,
        mimeType: full.mime_type,
        dataBase64: full.data.toString('base64'),
      };
    });

    // Every field that applyImport.js's ORDER_UPDATE_FIELDS knows how to
    // diff/update gets exported -- this is meant to support genuine
    // back-and-forth (assistant quotes and takes payment, model updates
    // status/description as the work progresses, over multiple exports
    // across days or weeks), not just a one-shot handoff.
    return {
      externalId,
      amountCents: order.amount_cents,
      currency: order.currency,
      datePaid: order.date_paid,
      paymentMethod: order.payment_method,
      description: order.description,
      status: order.status,
      deliveryDueDate: order.delivery_due_date,
      deliveryDueTime: order.delivery_due_time,
      feedbackNotes: order.feedback_notes,
      wouldRepeat: order.would_repeat,
      attachments,
    };
  });

  return {
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    person: {
      externalId: personExternalId,
      privateLabel: person.private_label,
      generalNotes: person.general_notes,
      screeningNotes: person.screening_notes,
      platformAccounts,
    },
    orders,
  };
}

module.exports = { buildPersonExport, FORMAT_VERSION };
