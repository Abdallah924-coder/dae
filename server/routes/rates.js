const express = require('express');
const Rate = require('../models/Rate');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const rate = await Rate.findOne({
      $or: [{ asset: 'USDT' }, { asset: { $exists: false } }],
    }).sort({ createdAt: -1 }).lean();
    res.json({
      usdtXafRate: rate?.buyRate ?? 640,
      buyMinXaf: rate?.buyMinXaf ?? rate?.minXaf ?? 10000,
      buyMaxXaf: rate?.buyMaxXaf ?? rate?.maxXaf ?? 500000,
      sellMinXaf: rate?.sellMinXaf ?? rate?.minXaf ?? 10000,
      sellMaxXaf: rate?.sellMaxXaf ?? rate?.maxXaf ?? 500000,
      updatedAt: rate?.createdAt ?? null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
