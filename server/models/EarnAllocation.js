'use strict';

const mongoose = require('mongoose');

const earnAllocationSchema = new mongoose.Schema({
  positionId: { type: mongoose.Schema.Types.ObjectId, ref: 'StakePosition', required: true },
  protocol: { type: String, enum: ['venus', 'aaveV3'], required: true },
  txHash: { type: String, required: true, unique: true, lowercase: true, match: /^0x[0-9a-f]{64}$/ },
  blockNumber: { type: Number, required: true, min: 0 },
  allocatedAtomic: { type: String, required: true, match: /^[1-9][0-9]{0,77}$/ },
  outstandingPrincipalAtomic: { type: String, required: true, match: /^(0|[1-9][0-9]{0,77})$/ },
  status: { type: String, enum: ['active', 'closed', 'suspended'], default: 'active', index: true },
  activatedBy: { type: String, required: true, maxlength: 254 },
  activationActionId: { type: mongoose.Schema.Types.ObjectId, ref: 'EarnAction', required: true },
}, { timestamps: true });

earnAllocationSchema.index({ positionId: 1 }, { unique: true });
earnAllocationSchema.index({ protocol: 1, status: 1 });

module.exports = mongoose.model('EarnAllocation', earnAllocationSchema);
