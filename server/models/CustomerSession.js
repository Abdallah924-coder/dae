'use strict';

const mongoose = require('mongoose');

const customerSessionSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true, select: false },
    expiresAt: { type: Date, required: true, expires: 0 },
    revokedAt: { type: Date, default: null },
    userAgentHash: { type: String, maxlength: 64 },
  },
  { timestamps: true },
);

customerSessionSchema.index({ customerId: 1, expiresAt: 1 });

module.exports = mongoose.model('CustomerSession', customerSessionSchema);
