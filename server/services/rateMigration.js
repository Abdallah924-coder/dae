'use strict';

const Rate = require('../models/Rate');
const { config } = require('../config');
const { logger } = require('../lib/logger');

const LEGACY_SELL_RATE = 570;
const REQUIRED_SELL_RATE = 580;

async function migrateLegacySellRate() {
  const currentRate = await Rate.findOne({
    $or: [{ asset: 'USDT' }, { asset: { $exists: false } }],
  })
    .sort({ createdAt: -1, _id: -1 })
    .lean();

  if (!currentRate || currentRate.sellRate !== LEGACY_SELL_RATE) return false;

  await Rate.create({
    asset: 'USDT',
    buyRate: currentRate.buyRate,
    sellRate: REQUIRED_SELL_RATE,
    minXaf: currentRate.minXaf ?? config.rates.defaultMinXaf,
    maxXaf: currentRate.maxXaf ?? config.rates.defaultMaxXaf,
    buyMinXaf: currentRate.buyMinXaf,
    buyMaxXaf: currentRate.buyMaxXaf,
    sellMinXaf: currentRate.sellMinXaf,
    sellMaxXaf: currentRate.sellMaxXaf,
  });
  logger.info('Ancien taux de vente 570 FCFA remplacé par 580 FCFA; l’historique est conservé.');
  return true;
}

module.exports = { migrateLegacySellRate };
