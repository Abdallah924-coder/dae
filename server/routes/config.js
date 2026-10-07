const express = require('express');
const SiteConfig = require('../models/SiteConfig');
const assets = require('../config/cryptoAssets');

const router = express.Router();

function networkEntries(configured = {}, defaults = []) {
  const entries = new Map(Object.entries(configured || {}));
  const defaultsById = new Map(defaults.map((network) => [network.id, network]));
  const ids = new Set([...defaultsById.keys(), ...entries.keys()]);
  return [...ids].map((id) => {
    const value = entries.get(id);
    const legacyAddress = typeof value === 'string' ? value : '';
    const address = legacyAddress || String(value?.address || '');
    const fallback = defaultsById.get(id);
    return {
      id,
      name: String(value?.name || fallback?.name || id),
      address,
      available: Boolean(address.trim()),
    };
  });
}

router.get('/', async (req, res, next) => {
  try {
    const config = await SiteConfig.findOne({ key: 'main' }).lean();
    const receivingAddresses = config?.receivingAddresses || {};
    res.json({
      paymentNumbers: config?.paymentNumbers || { mtn: '', airtel: '' },
      paymentRecipientNames: config?.paymentRecipientNames || { mtn: '', airtel: '' },
      paymentInstructions: config?.paymentInstructions || '',
      contactWhatsApp: config?.contactWhatsApp || 'https://chat.whatsapp.com/I16HQ9O8ygRBeyzUhHn30N',
      contactEmail: config?.contactEmail || '',
      maintenance: config?.maintenance || {
        enabled: false,
        message: 'Le site est temporairement en maintenance. Revenez bientôt.',
      },
      assets: assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        networks: networkEntries(receivingAddresses[asset.id], asset.networks),
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
