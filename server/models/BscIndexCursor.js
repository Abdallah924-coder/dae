'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  blockNumber: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
}, { timestamps: true });

module.exports = mongoose.model('BscIndexCursor', schema);
