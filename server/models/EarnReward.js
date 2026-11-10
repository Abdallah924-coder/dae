'use strict';

const mongoose = require('mongoose');

const earnRewardSchema = new mongoose.Schema({
  positionId: { type: mongoose.Schema.Types.ObjectId, ref: 'StakePosition', required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  rewardDateUTC: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  apyBps: { type: Number, required: true, min: 0, max: 10_000 },
  principalAtomic: { type: String, required: true, match: /^[1-9][0-9]{0,77}$/ },
  requestedAtomic: { type: String, required: true, match: /^(0|[1-9][0-9]{0,77})$/ },
  paidAtomic: { type: String, required: true, match: /^(0|[1-9][0-9]{0,77})$/ },
  status: { type: String, enum: ['unfunded', 'scaled', 'paid'], required: true },
  ledgerReference: { type: String, default: null, maxlength: 100 },
}, { timestamps: { createdAt: true, updatedAt: false } });

earnRewardSchema.index({ positionId: 1, rewardDateUTC: 1 }, { unique: true });
earnRewardSchema.index({ customerId: 1, rewardDateUTC: -1 });
earnRewardSchema.index({ status: 1, rewardDateUTC: 1 });

module.exports = mongoose.model('EarnReward', earnRewardSchema);
