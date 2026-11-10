'use strict';

const mongoose = require('mongoose');

const postingSchema = new mongoose.Schema(
  {
    accountRef: { type: String, required: true, maxlength: 100 },
    asset: { type: String, required: true, maxlength: 12 },
    network: { type: String, required: true, maxlength: 40 },
    decimals: {
      type: Number,
      required: true,
      min: 0,
      max: 36,
      validate: { validator: Number.isInteger, message: 'decimals doit être un entier' },
    },
    side: { type: String, enum: ['debit', 'credit'], required: true },
    amountAtomic: {
      type: String,
      required: true,
      match: /^[1-9][0-9]{0,77}$/,
    },
  },
  { _id: false },
);

const ledgerTransactionSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    idempotencyKey: { type: String, required: true, unique: true, maxlength: 160 },
    requestHash: { type: String, required: true, immutable: true, minlength: 64, maxlength: 64 },
    type: {
      type: String,
      enum: ['deposit', 'withdrawal', 'exchange', 'p2p_transfer', 'staking_lock', 'staking_release', 'adjustment'],
      required: true,
      index: true,
    },
    status: { type: String, enum: ['posted'], default: 'posted', immutable: true },
    postings: {
      type: [postingSchema],
      required: true,
      validate: [(v) => v.length >= 2, 'At least two balanced postings are required'],
    },
    sourceRef: { type: String, default: null, maxlength: 160, index: true },
    createdBy: { type: String, required: true, maxlength: 100 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

ledgerTransactionSchema.index({
  'postings.accountRef': 1,
  'postings.asset': 1,
  'postings.network': 1,
});

ledgerTransactionSchema.pre('validate', function validateBalancedPostings() {
  const totals = new Map();
  for (const posting of this.postings) {
    const key = `${posting.asset}:${posting.network}`;
    const total = totals.get(key) || { debit: 0n, credit: 0n };
    if (total.decimals !== undefined && total.decimals !== posting.decimals) {
      throw new Error('Ledger postings for the same asset/network must use identical decimals');
    }
    total.decimals = posting.decimals;
    total[posting.side] += BigInt(posting.amountAtomic);
    totals.set(key, total);
  }
  if ([...totals.values()].some((total) => total.debit !== total.credit)) {
    throw new Error('Ledger transaction postings must balance per asset and network');
  }
});

ledgerTransactionSchema.pre('save', function preventPostedSave() {
  if (!this.isNew) {
    throw new Error('Posted ledger transactions are immutable; use a compensating transaction');
  }
});

for (const operation of [
  'update',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
]) {
  ledgerTransactionSchema.pre(operation, function preventLedgerMutation() {
    throw new Error('Posted ledger transactions are immutable; use a compensating transaction');
  });
}

ledgerTransactionSchema.pre(
  'deleteOne',
  { document: true, query: false },
  function preventDocumentDelete() {
    throw new Error('Posted ledger transactions are immutable; use a compensating transaction');
  },
);

module.exports = mongoose.model('LedgerTransaction', ledgerTransactionSchema);
