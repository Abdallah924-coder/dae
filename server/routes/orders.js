const express = require('express');
const crypto = require('crypto');
const Rate = require('../models/Rate');
const Order = require('../models/Order');
const OrderEvent = require('../models/OrderEvent');
const SiteConfig = require('../models/SiteConfig');
const assets = require('../config/cryptoAssets');
const { getMarketPrices } = require('../services/marketData');
const { orderSubmitted } = require('../services/email');

const router = express.Router();
const HOLD_MINUTES = 15;
const PHONE_RE = /^\+?\d{8,15}$/;
const NETWORK_NOT_CONFIGURED = 'Ce réseau n’est pas encore configuré pour cette crypto';

function publicView(o) {
  return {
    ref: o.ref,
    mode: o.mode,
    asset: o.asset || 'USDT',
    amountCrypto: o.amountCrypto ?? o.amountUsdt,
    unitPriceUsd: o.unitPriceUsd ?? 1,
    amountXaf: o.amountXaf,
    amountUsdt: o.amountUsdt ?? o.amountCrypto ?? o.amountXaf / (o.rateApplied || 640),
    rateApplied: o.rateApplied,
    network: o.network,
    networkName: o.networkName || o.network,
    operator: o.operator,
    status: o.status,
    expiresAt: o.expiresAt,
    createdAt: o.createdAt,
  };
}

async function expireIfNeeded(order) {
  if (order.status === 'created' && order.expiresAt < new Date()) {
    order.status = 'expired';
    await order.save();
    await OrderEvent.create({ orderRef: order.ref, from: 'created', to: 'expired' });
  }
  return order;
}

// Achat : amount est une valeur en USDT. Vente : amount est une quantité de crypto.
router.post('/', async (req, res, next) => {
  try {
    const { mode, asset: assetId, amount, network, operator, phone, wallet, email, proof, proofImage } = req.body || {};
    const value = Number(amount);
    const asset = assets.find((item) => item.id === assetId);

    if (!['buy', 'sell'].includes(mode)) return res.status(400).json({ error: 'Mode invalide' });
    if (!asset) return res.status(400).json({ error: 'Crypto invalide' });
    if (!Number.isFinite(value) || value <= 0) return res.status(400).json({ error: 'Montant invalide' });
    if (typeof network !== 'string' || network.length < 1 || network.length > 40) {
      return res.status(400).json({ error: 'Réseau invalide' });
    }
    if (!['mtn', 'airtel'].includes(operator)) return res.status(400).json({ error: 'Opérateur invalide' });
    const cleanEmail = String(email || '').trim();
    if (cleanEmail.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Adresse e-mail invalide' });
    }

    const cleanPhone = String(phone || '').replace(/\s/g, '');
    if (!PHONE_RE.test(cleanPhone)) return res.status(400).json({ error: 'Numéro de téléphone invalide' });

    const config = await SiteConfig.findOne({ key: 'main' }).lean();
    const configuredNetwork = config?.receivingAddresses?.[asset.id]?.[network];
    const depositAddress = typeof configuredNetwork === 'string'
      ? configuredNetwork
      : configuredNetwork?.address;
    if (!depositAddress?.trim()) {
      return res.status(503).json({ error: NETWORK_NOT_CONFIGURED });
    }
    let cleanWallet;
    if (mode === 'buy') {
      cleanWallet = String(wallet || '').trim();
      const networkName = typeof configuredNetwork === 'string' ? network : configuredNetwork?.name || network;
      const maxWalletLength = networkName.toLowerCase().includes('lightning') ? 7100 : 2000;
      if (cleanWallet.length < 20 || cleanWallet.length > maxWalletLength) {
        return res.status(400).json({ error: 'Adresse de portefeuille invalide' });
      }
    }
    if (mode === 'buy' && !config?.paymentNumbers?.[operator]) {
      return res.status(503).json({ error: 'Le numéro de paiement de cet opérateur n’est pas encore configuré' });
    }

    const rate = await Rate.findOne({
      $or: [{ asset: 'USDT' }, { asset: { $exists: false } }],
    }).sort({ createdAt: -1 });
    const unit = rate?.buyRate ?? 640;
    const minXaf = mode === 'buy'
      ? rate?.buyMinXaf ?? rate?.minXaf ?? 10000
      : rate?.sellMinXaf ?? rate?.minXaf ?? 10000;
    const maxXaf = mode === 'buy'
      ? rate?.buyMaxXaf ?? rate?.maxXaf ?? 500000
      : rate?.sellMaxXaf ?? rate?.maxXaf ?? 500000;
    const { markets } = await getMarketPrices({ allowStale: false });
    const livePriceUsd = markets.find((market) => market.asset === asset.id)?.priceUsd;
    const unitPriceUsd = asset.id === 'USDT' ? 1 : livePriceUsd;
    if (!Number.isFinite(unitPriceUsd) || unitPriceUsd <= 0) {
      return res.status(503).json({ error: 'Cours crypto indisponible, réessayez dans quelques instants' });
    }
    const amountUsdt = mode === 'buy'
      ? Math.floor(value * 1e8) / 1e8
      : Math.floor(value * unitPriceUsd * 1e8) / 1e8;
    const amountCrypto = mode === 'buy'
      ? Math.floor((amountUsdt / unitPriceUsd) * 1e8) / 1e8
      : Math.floor(value * 1e8) / 1e8;
    const amountXaf = mode === 'buy'
      ? Math.ceil(amountUsdt * unit)
      : Math.floor(amountUsdt * unit);

    if (amountXaf < minXaf || amountXaf > maxXaf) {
      return res.status(400).json({
        error: 'Montant hors limites (' + minXaf + ' à ' + maxXaf + ' FCFA)',
      });
    }

    const cleanProof = String(proof || '').trim();
    const cleanProofImage = String(proofImage || '');
    if (cleanProof && (cleanProof.length < 6 || cleanProof.length > 200)) {
      return res.status(400).json({ error: 'Référence de paiement invalide' });
    }
    if (cleanProofImage && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(cleanProofImage)) {
      return res.status(400).json({ error: 'La capture doit être une image JPEG, PNG ou WebP valide' });
    }
    if (cleanProofImage.length > 1600000) {
      return res.status(413).json({ error: 'La capture dépasse la taille maximale autorisée' });
    }
    if (Boolean(cleanProof) !== Boolean(cleanProofImage)) {
      return res.status(400).json({ error: 'Ajoutez la référence et la capture du paiement' });
    }

    const order = await Order.create({
      ref: 'CMD-' + crypto.randomBytes(9).toString('base64url'),
      mode,
      asset: asset.id,
      amountCrypto,
      unitPriceUsd,
      amountXaf,
      amountUsdt,
      rateApplied: unit,
      network,
      networkName: typeof configuredNetwork === 'string' ? network : configuredNetwork?.name || network,
      operator,
      phone: cleanPhone,
      email: cleanEmail,
      wallet: cleanWallet,
      proof: cleanProof || undefined,
      proofImage: cleanProofImage || undefined,
      status: cleanProof ? 'payment_declared' : 'created',
      expiresAt: new Date(Date.now() + HOLD_MINUTES * 60 * 1000),
    });
    await OrderEvent.create({
      orderRef: order.ref,
      from: cleanProof ? 'created' : undefined,
      to: cleanProof ? 'payment_declared' : 'created',
    });

    let notificationSent = true;
    try {
      await orderSubmitted(order);
    } catch (error) {
      notificationSent = false;
      console.error(`Échec de l’e-mail de réception de la commande ${order.ref}:`, error.message);
    }
    res.status(201).json({ ...publicView(order), notificationSent });
  } catch (err) {
    next(err);
  }
});

// Suivi par référence
router.get('/:ref', async (req, res, next) => {
  try {
    const order = await Order.findOne({ ref: String(req.params.ref) });
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    await expireIfNeeded(order);
    res.json(publicView(order));
  } catch (err) {
    next(err);
  }
});

// Le client déclare son paiement (ID de transaction ou hash)
router.patch('/:ref/proof', async (req, res, next) => {
  try {
    const proof = String((req.body || {}).proof || '').trim();
    if (proof.length < 6 || proof.length > 200) {
      return res.status(400).json({ error: 'Preuve de paiement invalide' });
    }
    const proofImage = String((req.body || {}).proofImage || '');
    if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(proofImage) || proofImage.length > 1600000) {
      return res.status(400).json({ error: 'Capture de paiement invalide' });
    }
    const order = await Order.findOne({ ref: String(req.params.ref) });
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    await expireIfNeeded(order);
    if (order.status !== 'created') {
      return res.status(409).json({ error: 'Cette commande ne peut plus être modifiée' });
    }
    order.proof = proof;
    order.proofImage = proofImage;
    order.status = 'payment_declared';
    await order.save();
    await OrderEvent.create({ orderRef: order.ref, from: 'created', to: 'payment_declared' });
    res.json(publicView(order));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
