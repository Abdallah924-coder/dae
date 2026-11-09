'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  kind: { type: String, enum: ['withdrawal', 'sweep'], required: true, index: true },
  status: { type: String, enum: ['queued', 'processing', 'broadcast', 'completed', 'failed'], default: 'queued', index: true },
  idempotencyKey: { type: String, required: true, unique: true, maxlength: 160 },
  sourceAddress: { type: String, required: true, lowercase: true, maxlength: 42 },
  destination: { type: String, required: true, lowercase: true, maxlength: 42 },
  amountAtomic: { type: String, default: null, match: /^(?:0|[1-9][0-9]{0,77})$/ },
  walletId: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', default: null },
  withdrawalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Withdrawal', default: null },
  collectionRunId: { type: mongoose.Schema.Types.ObjectId, default: null },
  txHash: { type: String, default: null, maxlength: 80 },
  errorCode: { type: String, default: null, maxlength: 80 },
  attempts: { type: Number, default: 0, min: 0 },
  processedAt: { type: Date, default: null },
}, { timestamps: true });

schema.index({ status: 1, createdAt: 1 });
module.exports = mongoose.model('BscTransferJob', schema);
