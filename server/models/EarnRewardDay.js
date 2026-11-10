'use strict';

const mongoose = require('mongoose');

const earnRewardDaySchema = new mongoose.Schema({
  rewardDateUTC: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  positionsCount: { type: Number, required: true, min: 0 },
  requestedAtomic: { type: String, required: true, match: /^(0|[1-9][0-9]{0,77})$/ },
  paidAtomic: { type: String, required: true, match: /^(0|[1-9][0-9]{0,77})$/ },
  completedAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = mongoose.model('EarnRewardDay', earnRewardDaySchema);
