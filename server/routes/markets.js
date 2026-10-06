const express = require('express');
const { getMarketPrices } = require('../services/marketData');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    res.json(await getMarketPrices());
  } catch (err) {
    console.error('Sources de cours indisponibles:', err.message);
    res.status(503).json({ error: 'Les cours sont temporairement indisponibles. Réessayez dans quelques instants.' });
  }
});

module.exports = router;
