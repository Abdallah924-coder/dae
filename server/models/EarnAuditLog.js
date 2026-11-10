'use strict';

const mongoose = require('mongoose');

const earnAuditLogSchema = new mongoose.Schema({
  actor: { type: String, required: true, maxlength: 254 },
  action: { type: String, required: true, maxlength: 80 },
  actionId: { type: mongoose.Schema.Types.ObjectId, ref: 'EarnAction', default: null },
  positionId: { type: mongoose.Schema.Types.ObjectId, ref: 'StakePosition', default: null },
  allocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'EarnAllocation', default: null },
  txHash: { type: String, default: null, maxlength: 66 },
  amountAtomic: { type: String, default: null, match: /^(0|[1-9][0-9]{0,77})$/ },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: { createdAt: true, updatedAt: false } });

earnAuditLogSchema.index({ createdAt: -1, _id: -1 });
earnAuditLogSchema.pre('save', function preventEventMutation() {
  if (!this.isNew) throw new Error('DAE Earn audit events are append-only');
});
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
  earnAuditLogSchema.pre(operation, function preventEventMutation() {
    throw new Error('DAE Earn audit events are append-only');
  });
}

module.exports = mongoose.model('EarnAuditLog', earnAuditLogSchema);
