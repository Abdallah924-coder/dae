'use strict';

const mongoose = require('mongoose');
const marketAssets = require('../config/marketAssets');

const challengeSchema = new mongoose.Schema(
  {
    hash: { type: String, select: false },
    expiresAt: { type: Date, select: false },
    sentAt: { type: Date, select: false },
    attempts: { type: Number, default: 0, select: false },
  },
  { _id: false },
);

const customerSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 80 },
    lastName: { type: String, required: true, trim: true, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    phone: { type: String, required: true, unique: true, trim: true, maxlength: 16 },
    passwordHash: { type: String, required: true, select: false },
    passwordSalt: { type: String, required: true, select: false },
    emailVerifiedAt: { type: Date, default: null },
    phoneVerifiedAt: { type: Date, default: null },
    emailChallenge: { type: challengeSchema, default: () => ({}) },
    phoneChallenge: { type: challengeSchema, default: () => ({}) },
    status: {
      type: String,
      enum: ['pending_verification', 'active', 'locked', 'closed'],
      default: 'pending_verification',
      index: true,
    },
    kycStatus: {
      type: String,
      enum: ['not_started', 'pending', 'approved', 'rejected'],
      default: 'not_started',
      index: true,
    },
    kycReviewNote: { type: String, maxlength: 500, select: false },
    walletAccountIndex: {
      type: Number,
      min: 1,
      max: 0x7fffffff,
      validate: Number.isSafeInteger,
      unique: true,
      sparse: true,
    },
    watchlist: {
      type: [{ type: String, enum: marketAssets.map((asset) => asset.id) }],
      default: [],
      validate: (items) => items.length <= 5 && new Set(items).size === items.length,
    },
    termsAcceptedAt: { type: Date, required: true },
    privacyAcceptedAt: { type: Date, required: true },
    termsVersion: { type: String, default: null, maxlength: 40 },
    privacyVersion: { type: String, default: null, maxlength: 40 },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);

module.exports = mongoose.model('Customer', customerSchema);
