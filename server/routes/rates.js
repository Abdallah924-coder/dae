'use strict';

const express = require('express');
const { logger } = require('../lib/logger');
const { config } = require('../config/index');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const Rate = require('../models/Rate');
    const rate = await Rate.findOne({
      $or: [{ asset: 'USDT' }, { asset: { $exists: false } }],
    })
      .sort({ createdAt: -1 })
      .lean();
    res.json({
      buyRate: rate?.buyRate ?? config.rates.defaultBuy,
      sellRate: rate?.sellRate ?? config.rates.defaultSell,
      usdtXafRate: rate?.buyRate ?? config.rates.defaultBuy,
      buyMinXaf: rate?.buyMinXaf ?? rate?.minXaf ?? config.rates.defaultMinXaf,
      buyMaxXaf: rate?.buyMaxXaf ?? rate?.maxXaf ?? config.rates.defaultMaxXaf,
      sellMinXaf: rate?.sellMinXaf ?? rate?.minXaf ?? config.rates.defaultMinXaf,
      sellMaxXaf: rate?.sellMaxXaf ?? rate?.maxXaf ?? config.rates.defaultMaxXaf,
      updatedAt: rate?.createdAt ?? null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
