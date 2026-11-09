'use strict';

const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  actor: { type: String, required: true, maxlength: 254 },
  fromStatus: { type: String, enum: ['not_started', 'pending', 'approved', 'rejected'], required: true },
  toStatus: { type: String, enum: ['not_started', 'pending', 'approved', 'rejected'], required: true },
  reason: { type: String, required: true, minlength: 8, maxlength: 300 },
  evidenceReference: { type: String, default: null, maxlength: 120 },
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ customerId: 1, createdAt: -1 });
schema.pre('save', function immutableEvent() { if (!this.isNew) throw new Error('KYC audit events are append-only'); });
for (const method of ['update', 'updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany']) {
  schema.pre(method, function immutableQuery() { throw new Error('KYC audit events are append-only'); });
}
module.exports = mongoose.model('CustomerKycAuditEvent', schema);
