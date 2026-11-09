'use strict';

const mongoose = require('mongoose');

const ledgerAccountLockSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, maxlength: 180 },
    version: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model('LedgerAccountLock', ledgerAccountLockSchema);
