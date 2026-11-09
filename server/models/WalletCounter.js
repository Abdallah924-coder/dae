'use strict';

const mongoose = require('mongoose');

const walletCounterSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  value: {
    type: Number,
    required: true,
    min: 0,
    max: 0x7fffffff,
    validate: Number.isSafeInteger,
    default: 0,
  },
});

module.exports = mongoose.model('WalletCounter', walletCounterSchema);
