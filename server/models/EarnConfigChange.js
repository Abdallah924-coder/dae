'use strict';

const mongoose = require('mongoose');

const earnConfigChangeSchema = new mongoose.Schema({
  proposerEmail: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  approverEmail: { type: String, default: null, lowercase: true, trim: true, maxlength: 254 },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'expired'], default: 'pending', index: true },
  expectedVersion: { type: Number, required: true, min: 0 },
  reason: { type: String, required: true, minlength: 8, maxlength: 300 },
  config: { type: mongoose.Schema.Types.Mixed, required: true },
  expiresAt: { type: Date, required: true, index: true },
  resolvedAt: { type: Date, default: null },
  resolutionReason: { type: String, default: null, maxlength: 300 },
}, { timestamps: true });

earnConfigChangeSchema.index({ status: 1, createdAt: -1 });
earnConfigChangeSchema.index({ proposerEmail: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('EarnConfigChange', earnConfigChangeSchema);
