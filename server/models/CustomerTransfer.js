'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  feeRecipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  senderEmail: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  recipientEmail: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  feeRecipientEmail: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  asset: { type: String, enum: ['USDT'], default: 'USDT', required: true },
  network: { type: String, enum: ['BEP20'], default: 'BEP20', required: true },
  decimals: { type: Number, default: 18, required: true },
  amountAtomic: { type: String, required: true, match: /^[1-9][0-9]{0,77}$/ },
  feeAtomic: { type: String, required: true, match: /^[1-9][0-9]{0,77}$/ },
  recipientAmountAtomic: { type: String, required: true, match: /^[1-9][0-9]{0,77}$/ },
  challengeHash: { type: String, required: true, unique: true, select: false, maxlength: 64 },
  codeHash: { type: String, required: true, select: false, maxlength: 64 },
  attempts: { type: Number, default: 0, min: 0 },
  expiresAt: { type: Date, required: true, index: true },
  status: { type: String, enum: ['pending', 'completed', 'expired'], default: 'pending', index: true },
  ledgerReference: { type: String, default: null, unique: true, sparse: true, maxlength: 100 },
}, { timestamps: true });

schema.index({ senderId:  1, createdAt: -1 });
schema.index({ recipientId: 1, createdAt: -1 });

module.exports = mongoose.model('CustomerTransfer', schema);
