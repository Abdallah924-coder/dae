'use strict';

const mongoose = require('mongoose');

const earnActionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['seed_treasury', 'fund_treasury', 'allocate_position', 'redeem_allocation', 'settle_withdrawal'],
    required: true,
    index: true,
  },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'expired'], default: 'pending', index: true },
  proposerEmail: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  approverEmail: { type: String, default: null, lowercase: true, trim: true, maxlength: 254 },
  reason: { type: String, required: true, minlength: 8, maxlength: 300 },
  resolutionReason: { type: String, default: null, maxlength: 300 },
  positionId: { type: mongoose.Schema.Types.ObjectId, ref: 'StakePosition', default: null },
  allocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'EarnAllocation', default: null },
  protocol: { type: String, enum: ['venus', 'aaveV3', null], default: null },
  txHash: { type: String, default: null, lowercase: true, match: /^0x[0-9a-f]{64}$/ },
  blockNumber: { type: Number, default: 0, min: 0 },
  grossAmountAtomic: { type: String, default: '0', match: /^(0|[1-9][0-9]{0,77})$/ },
  principalAmountAtomic: { type: String, default: '0', match: /^(0|[1-9][0-9]{0,77})$/ },
  expiresAt: { type: Date, required: true, index: true },
  resolvedAt: { type: Date, default: null },
  ledgerReference: { type: String, default: null, maxlength: 100 },
}, { timestamps: true });

earnActionSchema.index(
  { type: 1, txHash: 1 },
  { unique: true, partialFilterExpression: { txHash: { $type: 'string' } } },
);
earnActionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('EarnAction', earnActionSchema);
