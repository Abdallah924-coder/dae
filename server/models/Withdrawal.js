'use strict';

const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    asset: { type: String, required: true, maxlength: 12 },
    network: { type: String, required: true, maxlength: 40 },
    destination: { type: String, required: true, maxlength: 200 },
    amountAtomic: { type: String, required: true, match: /^[1-9][0-9]{0,77}$/ },
    decimals: {
      type: Number,
      required: true,
      min: 0,
      max: 36,
      validate: { validator: Number.isInteger, message: 'decimals doit être un entier' },
    },
    feeAtomic: { type: String, required: true, match: /^(0|[1-9][0-9]{0,77})$/ },
    idempotencyKey: { type: String, required: true, unique: true, maxlength: 160 },
    requestHash: { type: String, required: true, immutable: true, minlength: 64, maxlength: 64 },
    status: {
      type: String,
      enum: [
        'requested',
        'compliance_review',
        'approved',
        'queued',
        'broadcast',
        'completed',
        'failed',
        'rejected',
        'cancelled',
      ],
      default: 'requested',
      index: true,
    },
    txHash: { type: String, default: null, maxlength: 160 },
    ledgerReference: { type: String, default: null, maxlength: 100 },
    reviewedBy: { type: String, default: null, maxlength: 100 },
    reviewNote: { type: String, default: null, maxlength: 500 },
    reviewAt: { type: Date, default: null },
  },
  { timestamps: true },
);

withdrawalSchema.index({ customerId: 1, createdAt: -1 });
withdrawalSchema.index(
  { ledgerReference: 1 },
  { unique: true, partialFilterExpression: { ledgerReference: { $type: 'string' } } },
);

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
