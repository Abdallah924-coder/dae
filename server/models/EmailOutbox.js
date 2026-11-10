'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  dedupeKey: { type: String, required: true, unique: true, maxlength: 180 },
  to: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  subject: { type: String, required: true, maxlength: 180 },
  text: { type: String, required: true, maxlength: 12000 },
  html: { type: String, required: true, maxlength: 24000 },
  status: { type: String, enum: ['pending', 'sending', 'sent'], default: 'pending', index: true },
  attempts: { type: Number, default: 0, min: 0 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  lockedAt: { type: Date, default: null },
  sentAt: { type: Date, default: null },
  lastError: { type: String, default: null, maxlength: 500 },
}, { timestamps: true });

schema.index({ status: 1, nextAttemptAt: 1 });

module.exports = mongoose.model('EmailOutbox', schema);
