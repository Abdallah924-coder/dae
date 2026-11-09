'use strict';
const { logger } = require('../lib/logger');
const router = require('express').Router();
router.get('/history/:asset', async (req, res) => {
  try {
    const { getMarketHistory } = require('../services/marketData');
    const history = await getMarketHistory(req.params.asset);
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(history);
  } catch (err) {
    const status = err.message === 'Actif non pris en charge' ? 404 : 503;
    logger.warn({ err, asset: req.params.asset }, 'Historique de marché indisponible');
    res
      .status(status)
      .json({
        error: status === 404 ? err.message : 'Historique de marché temporairement indisponible.',
      });
  }
});
router.get('/', async (_req, res) => {
  try {
    const { getMarketPrices } = require('../services/marketData');
    res.json(await getMarketPrices());
  } catch (err) {
    logger.warn({ err }, 'Sources de cours indisponibles');
    res.status(503).json({
      error: 'Les cours sont temporairement indisponibles. Réessayez dans quelques instants.',
    });
  }
});
module.exports = router;
