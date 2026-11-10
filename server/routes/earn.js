'use strict';

const express = require('express');
const { configForClient, getEarnConfig } = require('../services/earnConfig');

const router = express.Router();

router.get('/catalog', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const config = await getEarnConfig();
    const catalog = configForClient(config);
    return res.json({
      ...catalog,
      products: catalog.products.filter((product) => product.published),
      status: 'not_live',
      message: 'Les taux affichés sont indicatifs. Les souscriptions et récompenses ne sont pas ouvertes.',
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
