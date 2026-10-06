const mongoose = require('mongoose');

const STATUSES = [
  'created',          // commande créée, en attente du paiement
  'payment_declared', // le client a déclaré avoir payé / envoyé
  'processing',       // vous traitez l'opération
  'completed',
  'cancelled',
  'expired',
  'failed',
];

const orderSchema = new mongoose.Schema(
  {
    ref: { type: String, required: true, unique: true },
    mode: { type: String, enum: ['buy', 'sell'], required: true },
    asset: { type: String, enum: ['USDT', 'BTC', 'POL', 'ETH', 'SOL'], default: 'USDT' },
    amountCrypto: { type: Number, min: 0 },
    unitPriceUsd: { type: Number, min: 0 },
    amountXaf: { type: Number, required: true },
    amountUsdt: { type: Number },
    rateApplied: { type: Number, required: true },
    network: { type: String, required: true },
    networkName: { type: String, maxlength: 80 },
    operator: { type: String, enum: ['mtn', 'airtel'], required: true },
    phone: { type: String, required: true },
    email: { type: String, maxlength: 160 },
    wallet: { type: String },
    proof: { type: String }, // ID de transaction MoMo (achat) ou hash (vente)
    proofImage: { type: String, maxlength: 1600000 },
    status: { type: String, enum: STATUSES, default: 'created', index: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

const Order = mongoose.model('Order', orderSchema);
Order.STATUSES = STATUSES;
module.exports = Order;
