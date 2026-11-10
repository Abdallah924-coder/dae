'use strict';

const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  productId: { type: String, enum: ['flexible', 'bronze', 'silver', 'gold'], required: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
  apyBps: { type: Number, required: true, min: 0, max: 10000, validate: Number.isInteger },
  durationDays: { type: Number, required: true, min: 0, max: 3650, validate: Number.isInteger },
  minimumAmountAtomic: { type: String, required: true, match: /^[1-9][0-9]{0,77}$/ },
  flexible: { type: Boolean, required: true },
  published: { type: Boolean, default: true },
}, { _id: false });

const earnConfigSchema = new mongoose.Schema({
  key: { type: String, enum: ['main'], default: 'main', unique: true },
  configVersion: { type: Number, required: true, min: 1 },
  subscriptionsEnabled: { type: Boolean, default: false },
  allocationsEnabled: { type: Boolean, default: false },
  rewardsEnabled: { type: Boolean, default: false },
  allocationLimitBps: { type: Number, required: true, min: 0, max: 1000, validate: Number.isInteger },
  protocolLimitsBps: {
    venus: { type: Number, required: true, min: 0, max: 1000, validate: Number.isInteger },
    aaveV3: { type: Number, required: true, min: 0, max: 1000, validate: Number.isInteger },
  },
  revenueSplitBps: {
    userRewards: { type: Number, required: true, min: 0, max: 10000, validate: Number.isInteger },
    platform: { type: Number, required: true, min: 0, max: 10000, validate: Number.isInteger },
    safetyReserve: { type: Number, required: true, min: 0, max: 10000, validate: Number.isInteger },
  },
  earlyWithdrawal: {
    unaccruedRewardsPenaltyBps: { type: Number, required: true, min: 0, max: 10000, validate: Number.isInteger },
    creditedRewardsPenaltyBps: { type: Number, required: true, min: 0, max: 10000, validate: Number.isInteger },
  },
  products: {
    type: [productSchema],
    required: true,
    validate: [(products) => products.length === 4, 'DAE Earn doit contenir exactement quatre produits'],
  },
  updatedBy: { type: String, required: true, maxlength: 254 },
}, { timestamps: true });

module.exports = mongoose.model('EarnConfig', earnConfigSchema);
