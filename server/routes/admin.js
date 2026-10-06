const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const Rate = require('../models/Rate');
const Order = require('../models/Order');
const OrderEvent = require('../models/OrderEvent');
const SiteConfig = require('../models/SiteConfig');
const assets = require('../config/cryptoAssets');
const { orderStatusChanged } = require('../services/email');

const router = express.Router();
router.post('/auth/login', adminAuth.login);
router.use(adminAuth);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const MAX_NETWORKS_PER_ASSET = 12;
const allowedTransitions = {
  created: ['processing', 'cancelled', 'failed'],
  payment_declared: ['processing', 'completed', 'cancelled', 'failed'],
  processing: ['completed', 'cancelled', 'failed'],
  completed: [],
  cancelled: [],
  expired: [],
  failed: [],
};

function configuredNetworks(config, asset) {
  const current = config?.receivingAddresses?.[asset.id] || {};
  if (Object.keys(current).length) {
    return Object.entries(current).map(([id, value]) => ({
      id,
      name: typeof value === 'string' ? asset.networks.find((network) => network.id === id)?.name || id : value.name || id,
      address: typeof value === 'string' ? value : value.address || '',
    }));
  }
  return asset.networks.map((network) => ({ ...network, address: '' }));
}

// Liste des commandes (filtre ?status=...)
router.get('/orders', async (req, res, next) => {
  try {
    const filter = {};
    if (Order.STATUSES.includes(req.query.status)) filter.status = req.query.status;
    const orders = await Order.find(filter).select('-proofImage').sort({ createdAt: -1 }).limit(200);
    res.json(orders);
  } catch (err) {
    next(err);
  }
});

router.get('/orders/:ref/proof', async (req, res, next) => {
  try {
    const order = await Order.findOne({ ref: String(req.params.ref) }).select('proof proofImage');
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    res.json({ proof: order.proof || '', image: order.proofImage || '' });
  } catch (err) {
    next(err);
  }
});

router.get('/orders/:ref/events', async (req, res, next) => {
  try {
    const events = await OrderEvent.find({ orderRef: String(req.params.ref) }).sort({ createdAt: 1 }).lean();
    res.json(events);
  } catch (err) {
    next(err);
  }
});

// Changer le statut d'une commande
router.patch('/orders/:ref', async (req, res, next) => {
  try {
    const { status, note } = req.body || {};
    if (!Order.STATUSES.includes(status)) return res.status(400).json({ error: 'Statut invalide' });
    const order = await Order.findOne({ ref: String(req.params.ref) });
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    const from = order.status;
    if (!allowedTransitions[from]?.includes(status)) {
      return res.status(409).json({ error: `Transition impossible : ${from} → ${status}` });
    }
    order.status = status;
    await order.save();
    await OrderEvent.create({
      orderRef: order.ref,
      from,
      to: status,
      note: note ? String(note).slice(0, 300) : undefined,
    });
    let notificationSent = true;
    if (['processing', 'completed', 'cancelled', 'failed'].includes(status)) {
      try {
        await orderStatusChanged(order, status);
      } catch (error) {
        notificationSent = false;
        console.error(`Échec de l’e-mail de mise à jour de la commande ${order.ref}:`, error.message);
      }
    }
    res.json({ ref: order.ref, status: order.status, notificationSent });
  } catch (err) {
    next(err);
  }
});

// Historique des taux
router.get('/rates', async (req, res, next) => {
  try {
    res.json(await Rate.find().sort({ createdAt: -1 }).limit(20));
  } catch (err) {
    next(err);
  }
});

router.get('/settings', async (req, res, next) => {
  try {
    const config = await SiteConfig.findOne({ key: 'main' }).lean();
    res.json({
      paymentNumbers: config?.paymentNumbers || { mtn: '', airtel: '' },
      paymentInstructions: config?.paymentInstructions || '',
      receivingAddresses: config?.receivingAddresses || {},
      contactWhatsApp: config?.contactWhatsApp || '',
      contactEmail: config?.contactEmail || '',
      assets: assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        networks: configuredNetworks(config, asset),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.put('/settings', async (req, res, next) => {
  try {
    const input = req.body || {};
    const paymentNumbers = {};
    for (const operator of ['mtn', 'airtel']) {
      const phone = String(input.paymentNumbers?.[operator] || '').replace(/\s/g, '');
      if (phone && !/^\+?\d{8,15}$/.test(phone)) {
        return res.status(400).json({ error: `Numéro ${operator.toUpperCase()} invalide` });
      }
      paymentNumbers[operator] = phone;
    }

    const receivingAddresses = {};
    for (const asset of assets) {
      const networks = input.networks?.[asset.id];
      if (!Array.isArray(networks) || networks.length < 3 || networks.length > MAX_NETWORKS_PER_ASSET) {
        return res.status(400).json({ error: `${asset.id} doit avoir entre 3 et ${MAX_NETWORKS_PER_ASSET} réseaux configurés` });
      }
      receivingAddresses[asset.id] = {};
      const ids = new Set();
      for (const network of networks) {
        if (!network || typeof network !== 'object' || Array.isArray(network)) {
          return res.status(400).json({ error: `Configuration de réseau invalide pour ${asset.id}` });
        }
        const id = String(network.id || '').trim();
        const name = String(network.name || '').trim();
        const address = String(network.address || '').trim();
        if (!ID_RE.test(id) || ['constructor', 'prototype'].includes(id.toLowerCase()) || ids.has(id)) {
          return res.status(400).json({ error: `Identifiant de réseau invalide ou dupliqué pour ${asset.id}` });
        }
        if (!name || name.length > 80) return res.status(400).json({ error: 'Nom de réseau invalide' });
        if (address.length > 2000) return res.status(400).json({ error: 'Adresse de réception trop longue' });
        ids.add(id);
        receivingAddresses[asset.id][id] = { name, address };
      }
    }

    const contactWhatsApp = String(input.contactWhatsApp || '').replace(/\s/g, '');
    if (contactWhatsApp && !/^\+?\d{8,15}$/.test(contactWhatsApp)) {
      return res.status(400).json({ error: 'Numéro WhatsApp invalide' });
    }
    const contactEmail = String(input.contactEmail || '').trim();
    if (contactEmail.length > 160 || (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))) {
      return res.status(400).json({ error: 'Adresse e-mail invalide' });
    }
    const paymentInstructions = String(input.paymentInstructions || '').trim();
    if (paymentInstructions.length > 500) {
      return res.status(400).json({ error: 'Les instructions de paiement sont trop longues' });
    }

    const config = await SiteConfig.findOneAndUpdate(
      { key: 'main' },
      {
        $set: {
          paymentNumbers,
          paymentInstructions,
          receivingAddresses,
          contactWhatsApp,
          contactEmail,
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.json({ ok: true, updatedAt: config.updatedAt });
  } catch (err) {
    next(err);
  }
});

// Taux commun pour l’USDT et conversion des autres cryptos à partir de leur cours USD.
router.post('/rates', async (req, res, next) => {
  try {
    const {
      buyRate,
      sellRate,
      buyMinXaf,
      buyMaxXaf,
      sellMinXaf,
      sellMaxXaf,
    } = req.body || {};
    const nums = [buyRate, sellRate, buyMinXaf, buyMaxXaf, sellMinXaf, sellMaxXaf].map(Number);
    if (nums[0] !== nums[1]
      || nums.some((n) => !Number.isFinite(n) || n <= 0)
      || nums[2] >= nums[3]
      || nums[4] >= nums[5]) {
      return res.status(400).json({ error: 'Le taux commun et les limites achat/vente sont invalides' });
    }
    const rate = await Rate.create({
      asset: 'USDT',
      buyRate: nums[0],
      sellRate: nums[1],
      minXaf: Math.min(nums[2], nums[4]),
      maxXaf: Math.max(nums[3], nums[5]),
      buyMinXaf: nums[2],
      buyMaxXaf: nums[3],
      sellMinXaf: nums[4],
      sellMaxXaf: nums[5],
    });
    res.status(201).json(rate);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
