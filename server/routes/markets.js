'use strict';
const { logger } = require('../lib/logger');
const router = require('express').Router();
router.get('/', async (req, res, next) => {
  try {
    const { getMarketPrices } = require('../services/marketData');
    res.json(await getMarketPrices());
  } catch (err) {
    logger.warn({ err }, 'Sources de cours indisponibles');
    res.status(503).json({ error: 'Les cours sont temporairement indisponibles. Réessayez dans quelques instants.' });
  }
});
module.exports = router;