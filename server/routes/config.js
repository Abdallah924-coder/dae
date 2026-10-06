const express = require('express');
const SiteConfig = require('../models/SiteConfig');
const assets = require('../config/cryptoAssets');

const router = express.Router();

function networkEntries(configured = {}, defaults = []) {
  const entries = Object.entries(configured || {});
  if (!entries.length) {
    return defaults.map((network) => ({
      ...network,
      address: '',
      available: false,
    }));
  }
  return entries.map(([id, value]) => {
    const legacyAddress = typeof value === 'string' ? value : '';
    const address = legacyAddress || String(value?.address || '');
    const fallback = defaults.find((network) => network.id === id);
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
      paymentInstructions: config?.paymentInstructions || '',
      contactWhatsApp: config?.contactWhatsApp || '',
      contactEmail: config?.contactEmail || '',
      assets: assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        networks: networkEntries(receivingAddresses[asset.id], asset.networks)
          .filter((network) => network.available),
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
