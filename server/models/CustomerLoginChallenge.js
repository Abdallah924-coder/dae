'use strict';

const mongoose = require('mongoose');

const customerLoginChallengeSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    purpose: { type: String, enum: ['login', 'password_reset'], default: 'login', index: true },
    challengeHash: { type: String, required: true, unique: true, select: false },
    emailCodeHash: { type: String, required: true, select: false },
    phoneCodeHash: { type: String, select: false },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, expires: 0 },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model('CustomerLoginChallenge', customerLoginChallengeSchema);
