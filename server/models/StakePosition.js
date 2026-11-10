'use strict';

const mongoose = require('mongoose');

const stakePositionSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    productId: { type: String, required: true, maxlength: 80 },
    asset: { type: String, required: true, maxlength: 12 },
    network: { type: String, required: true, maxlength: 40 },
    amountAtomic: { type: String, required: true, match: /^[1-9][0-9]{0,77}$/ },
    idempotencyKey: { type: String, default: null, maxlength: 160 },
    requestHash: { type: String, default: null, match: /^[a-f0-9]{64}$/ },
    configVersion: { type: Number, default: 0, min: 0 },
    termsAcceptedAt: { type: Date, default: null },
    termsVersion: { type: String, default: null, maxlength: 40 },
    totalRewardsPaidAtomic: { type: String, default: '0', match: /^(0|[1-9][0-9]{0,77})$/ },
    creditedRewardsPenaltyBps: { type: Number, default: 0, min: 0, max: 10000 },
    withdrawalPenaltyAtomic: { type: String, default: '0', match: /^(0|[1-9][0-9]{0,77})$/ },
    withdrawalRequestedAt: { type: Date, default: null },
    decimals: {
      type: Number,
      required: true,
      min: 0,
      max: 36,
      validate: { validator: Number.isInteger, message: 'decimals doit être un entier' },
    },
    rewardRateBps: { type: Number, required: true, min: 0, max: 100000 },
    lockDays: { type: Number, required: true, min: 0, max: 3650 },
    status: {
      type: String,
      enum: [
        'pending',
        'active',
        'unbonding',
        'completed',
        'cancelled',
        'PENDING_ALLOCATION',
        'ACTIVE',
        'MATURED',
        'WITHDRAWAL_PENDING',
        'WITHDRAWING',
        'COMPLETED',
        'CANCELLED',
        'SUSPENDED',
      ],
      default: 'pending',
      index: true,
    },
    startsAt: { type: Date, default: null },
    maturesAt: { type: Date, default: null },
    ledgerReference: { type: String, default: null, maxlength: 100 },
  },
  { timestamps: true },
);

stakePositionSchema.index({ customerId: 1, createdAt: -1 });
stakePositionSchema.index(
  { ledgerReference: 1 },
  { unique: true, partialFilterExpression: { ledgerReference: { $type: 'string' } } },
);
stakePositionSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

module.exports = mongoose.model('StakePosition', stakePositionSchema);
