'use strict';

const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  lastSeenAt: { type: Date, required: true },
  chainId: { type: Number, required: true },
  masterAddress: { type: String, required: true, lowercase: true },
  gasAddress: { type: String, required: true, lowercase: true },
}, { timestamps: true });
module.exports = mongoose.model('BscSignerHeartbeat', schema);
