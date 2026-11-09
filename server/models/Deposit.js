'use strict';

const mongoose = require('mongoose');

const depositSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    walletId: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true },
    asset: { type: String, required: true, maxlength: 12 },
    network: { type: String, required: true, maxlength: 40 },
    txHash: { type: String, required: true, maxlength: 160 },
    eventIndex: {
      type: Number,
      required: true,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
      validate: { validator: Number.isSafeInteger, message: 'eventIndex doit être un entier sûr' },
    },
    amountAtomic: { type: String, required: true, match: /^[1-9][0-9]{0,77}$/ },
    decimals: {
      type: Number,
      required: true,
      min: 0,
      max: 36,
      validate: { validator: Number.isInteger, message: 'decimals doit être un entier' },
    },
    confirmations: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['detected', 'confirming', 'credited', 'rejected'],
      default: 'detected',
      index: true,
    },
    ledgerReference: { type: String, default: null, maxlength: 100 },
  },
  { timestamps: true },
);

depositSchema.index({ network: 1, txHash: 1, eventIndex: 1 }, { unique: true });
depositSchema.index(
  { ledgerReference: 1 },
  { unique: true, partialFilterExpression: { ledgerReference: { $type: 'string' } } },
);
depositSchema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.model('Deposit', depositSchema);
