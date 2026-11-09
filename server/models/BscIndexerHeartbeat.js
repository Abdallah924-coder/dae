'use strict';

const mongoose = require('mongoose');
const schema = new mongoose.Schema({ name: { type: String, required: true, unique: true }, lastSeenAt: { type: Date, required: true }, indexedThrough: { type: Number, required: true, min: 0 } }, { timestamps: true });
module.exports = mongoose.model('BscIndexerHeartbeat', schema);
