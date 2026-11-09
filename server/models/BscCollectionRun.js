'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  actor: { type: String, required: true, maxlength: 254 },
  idempotencyKey: { type: String, required: true, unique: true, maxlength: 160 },
  status: { type: String, enum: ['queued', 'processing', 'completed', 'partial', 'failed'], default: 'queued', index: true },
  walletCount: { type: Number, required: true, min: 0 },
  reason: { type: String, required: true, minlength: 8, maxlength: 300 },
}, { timestamps: true });

module.exports = mongoose.model('BscCollectionRun', schema);
