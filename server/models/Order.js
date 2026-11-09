const mongoose = require('mongoose');
const STATUSES = require('../config/orderStatuses');

const orderSchema = new mongoose.Schema(
  {
    ref: { type: String, required: true, unique: true },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
      index: true,
    },
    idempotencyKey: {
      type: String,
      required: function requireNewOrderIdempotencyKey() {
        return this.isNew;
      },
      match: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      maxlength: 64,
      immutable: true,
    },
    requestHash: {
      type: String,
      required: function requireNewOrderRequestHash() {
        return this.isNew;
      },
      match: /^[a-f\d]{64}$/i,
      minlength: 64,
      maxlength: 64,
      immutable: true,
    },
    idempotencyHash: {
      type: String,
      required: function requireNewOrderIdempotencyHash() {
        return this.isNew;
      },
      match: /^[a-f\d]{64}$/i,
      minlength: 64,
      maxlength: 64,
      immutable: true,
    },
    mode: { type: String, enum: ['buy', 'sell'], required: true },
    asset: { type: String, enum: ['USDT', 'BTC', 'POL', 'ETH', 'SOL'], default: 'USDT' },
    fulfillment: {
      type: String,
      enum: ['external_wallet', 'internal_balance'],
      default: 'external_wallet',
    },
    amountCrypto: { type: mongoose.Schema.Types.Decimal128, required: true },
    unitPriceUsd: { type: mongoose.Schema.Types.Decimal128, required: true },
    amountXaf: { type: Number, required: true },
    amountUsdt: { type: mongoose.Schema.Types.Decimal128, required: true },
    rateApplied: { type: Number, required: true },
    network: { type: String, required: true },
    networkName: { type: String, maxlength: 80 },
    cryptoTransferMethod: {
      type: String,
      enum: ['network', 'binance_pay'],
      default: 'network',
    },
    binancePayId: { type: String, maxlength: 32 },
    receivingAddress: { type: String, maxlength: 2000 },
    operator: { type: String, enum: ['mtn', 'airtel'], required: true },
    phone: { type: String, required: true },
    recipientName: { type: String, maxlength: 100 },
    email: { type: String, maxlength: 160 },
    wallet: { type: String },
    proof: { type: String }, // ID de transaction MoMo (achat) ou hash (vente)
    proofImage: { type: String, maxlength: 1600000 },
    smsStatus: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending',
      index: true,
    },
    smsMessageId: { type: String },
    smsError: { type: String, maxlength: 500 },
    status: { type: String, enum: STATUSES, default: 'created', index: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

orderSchema.index({ status: 1, expiresAt: 1, _id: 1 });
orderSchema.index({ customerId: 1, createdAt: -1, _id: -1 });
orderSchema.index(
  { customerId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);
const Order = mongoose.model('Order', orderSchema);
Order.STATUSES = STATUSES;
module.exports = Order;
