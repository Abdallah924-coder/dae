'use strict';

const mongoose = require('mongoose');

const customerAuditEventSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    actor: { type: String, required: true, maxlength: 254 },
    action: { type: String, enum: ['account_locked', 'account_unlocked'], required: true },
    fromStatus: { type: String, enum: ['active', 'locked'], required: true },
    toStatus: { type: String, enum: ['active', 'locked'], required: true },
    reason: { type: String, required: true, minlength: 8, maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

customerAuditEventSchema.index({ customerId: 1, createdAt: -1 });
customerAuditEventSchema.pre('save', function preventEventMutation() {
  if (!this.isNew) throw new Error('Customer audit events are append-only');
});
customerAuditEventSchema.pre(
  'deleteOne',
  { document: true, query: false },
  function preventDocumentEventDeletion() {
    throw new Error('Customer audit events are append-only');
  },
);

for (const operation of [
  'update',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
]) {
  customerAuditEventSchema.pre(operation, function preventEventMutation() {
    throw new Error('Customer audit events are append-only');
  });
}

module.exports = mongoose.model('CustomerAuditEvent', customerAuditEventSchema);
