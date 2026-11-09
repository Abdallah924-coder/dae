'use strict';

const mongoose = require('mongoose');
const Order = require('../models/Order');
const connectDB = require('../config/db');
const { logger } = require('../lib/logger');
const { supportsMultiDocumentTransactions } = require('../services/mongoCapabilities');
const { transitionOrder } = require('../services/orderLifecycle');

async function runExpiryJob() {
  await connectDB();
  if (!supportsMultiDocumentTransactions(mongoose.connection)) {
    const error = new Error('Le job d’expiration exige MongoDB en replica set ou cluster compatible.');
    error.code = 'ERR_ORDER_TRANSACTIONS_REQUIRED';
    throw error;
  }

  const now = new Date();
  let expiredCount = 0;
  while (true) {
    const candidates = await Order.find({ status: 'created', expiresAt: { $lte: now } })
      .select('_id')
      .sort({ expiresAt: 1, _id: 1 })
      .limit(200)
      .lean();
    if (!candidates.length) break;
    for (const candidate of candidates) {
      const expired = await transitionOrder({
        orderId: candidate._id,
        expectedStatus: 'created',
        nextStatus: 'expired',
        actorType: 'system',
        expiresAfter: now,
      });
      if (expired) expiredCount += 1;
    }
  }
  logger.info({ expiredCount }, 'Expiration des commandes terminée');
  return expiredCount;
}

if (require.main === module) {
  runExpiryJob()
    .catch((error) => {
      logger.error({ err: error }, 'Échec du job d’expiration des commandes');
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    });
}

module.exports = { runExpiryJob };
