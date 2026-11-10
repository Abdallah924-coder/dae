'use strict';

const mongoose = require('mongoose');

const earnConfigAuditLogSchema = new mongoose.Schema({
  actor: { type: String, required: true, maxlength: 254 },
  action: {
    type: String,
    enum: ['configuration_proposed', 'configuration_approved', 'configuration_rejected'],
    required: true,
  },
  configVersion: { type: Number, required: true, min: 0 },
  reason: { type: String, required: true, minlength: 8, maxlength: 300 },
  changeId: { type: mongoose.Schema.Types.ObjectId, ref: 'EarnConfigChange', required: true },
  previousConfig: { type: mongoose.Schema.Types.Mixed, default: null },
  nextConfig: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

earnConfigAuditLogSchema.index({ createdAt: -1, _id: -1 });
earnConfigAuditLogSchema.pre('save', function preventEventMutation() {
  if (!this.isNew) throw new Error('DAE Earn audit events are append-only');
});
earnConfigAuditLogSchema.pre(
  'deleteOne',
  { document: true, query: false },
  function preventDocumentDeletion() {
    throw new Error('DAE Earn audit events are append-only');
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
  earnConfigAuditLogSchema.pre(operation, function preventEventMutation() {
    throw new Error('DAE Earn audit events are append-only');
  });
}

module.exports = mongoose.model('EarnConfigAuditLog', earnConfigAuditLogSchema);
