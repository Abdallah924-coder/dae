const express = require('express');
const { getMarketPrices } = require('../services/marketData');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    res.json(await getMarketPrices());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
