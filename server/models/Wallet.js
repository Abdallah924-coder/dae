'use strict';

const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    chain: { type: String, required: true, maxlength: 40 },
    network: { type: String, required: true, maxlength: 40 },
    address: {
      type: String,
      trim: true,
      default: undefined,
      maxlength: 200,
      validate: { validator: (value) => value === undefined || value.length > 0 },
    },
    derivationPath: { type: String, default: null, maxlength: 120 },
    accountIndex: {
      type: Number,
      required: true,
      min: 1,
      max: 0x7fffffff,
      validate: Number.isSafeInteger,
    },
    keyVersion: { type: Number, default: null, min: 1 },
    status: {
      type: String,
      enum: ['awaiting_signer', 'active', 'suspended'],
      default: 'awaiting_signer',
      index: true,
    },
  },
  { timestamps: true },
);

walletSchema.index({ customerId: 1, network: 1 }, { unique: true });
module.exports = mongoose.model('Wallet', walletSchema);
