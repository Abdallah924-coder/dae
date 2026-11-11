'use strict';

const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { configForClient, getEarnConfig } = require('../services/earnConfig');
const { config } = require('../config');
const customerAuth = require('../middleware/customerAuth');
const customerAuthService = require('../services/customerAuth');
const EarnReward = require('../models/EarnReward');
const StakePosition = require('../models/StakePosition');
const { formatAtomicAmount } = require('../services/ledger');
const { supportsMultiDocumentTransactions } = require('../services/mongoCapabilities');
const { createEarnPosition, requestEarnWithdrawal } = require('../services/earnOperations');
const { parseUnits } = require('ethers');

const router = express.Router();
const subscriptionLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
const withdrawalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });

function requireFreshCustomerAuth(req, res) {
  const ageMs = Date.now() - req.customerSession.createdAt.getTime();
  const maxAgeMs = config.bsc.withdrawalFreshAuthMinutes * 60_000;
  if (!Number.isFinite(ageMs) || ageMs < 0 || !Number.isFinite(maxAgeMs) || ageMs > maxAgeMs) {
    res.status(401).json({ error: 'Reconnectez-vous avec votre code e-mail avant cette opération.' });
    return false;
  }
  return true;
}

function handleEarnError(error, res, next) {
  const statusByCode = {
    ERR_EARN_SUBSCRIPTIONS_DISABLED: 503,
    ERR_EARN_ACCOUNT_NOT_ELIGIBLE: 403,
    ERR_EARN_TERMS_REQUIRED: 400,
    ERR_EARN_IDEMPOTENCY_REQUIRED: 400,
    ERR_EARN_IDEMPOTENCY_CONFLICT: 409,
    ERR_EARN_PRODUCT_UNAVAILABLE: 409,
    ERR_EARN_BELOW_MINIMUM: 400,
    ERR_EARN_TRANSACTIONS_REQUIRED: 503,
  };
  if (statusByCode[error.code]) return res.status(statusByCode[error.code]).json({ error: error.message, code: error.code });
  return next(error);
}

router.get('/catalog', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const config = await getEarnConfig();
    const catalog = configForClient(config);
    return res.json({
      ...catalog,
      products: catalog.products.filter((product) => product.published),
      status: catalog.subscriptionsEnabled ? 'accepting_subscriptions' : 'not_live',
      message: catalog.subscriptionsEnabled
        ? 'Les APY sont indicatifs. Le capital est verrouillé au ledger; toute récompense dépend des revenus effectivement réalisés et financés.'
        : 'Les taux affichés sont indicatifs. Les souscriptions ne sont pas ouvertes.',
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/positions', customerAuth, async (req, res, next) => {
  try {
    const positions = await StakePosition.find({ customerId: req.customer._id })
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)
      .lean();
    const rewards = await EarnReward.find({ customerId: req.customer._id })
      .sort({ rewardDateUTC: -1 })
      .limit(1000)
      .lean();
    const rewardsByPosition = new Map();
    for (const reward of rewards) {
      const id = String(reward.positionId);
      const entries = rewardsByPosition.get(id) || [];
      entries.push({
        date: reward.rewardDateUTC,
        requested: formatAtomicAmount(reward.requestedAtomic, 18),
        paid: formatAtomicAmount(reward.paidAtomic, 18),
        status: reward.status,
      });
      rewardsByPosition.set(id, entries);
    }
    return res.json({
      positions: positions.map((position) => ({
        id: String(position._id),
        productId: position.productId,
        amount: formatAtomicAmount(position.amountAtomic, position.decimals),
        rewardRateBps: position.rewardRateBps,
        lockDays: position.lockDays,
        status: position.status === 'ACTIVE' && position.maturesAt && position.maturesAt <= new Date()
          ? 'MATURED'
          : position.status,
        startsAt: position.startsAt,
        maturesAt: position.maturesAt,
        totalRewardsPaid: formatAtomicAmount(position.totalRewardsPaidAtomic || '0', position.decimals),
        totalRewardsPaidAtomic: position.totalRewardsPaidAtomic || '0',
        creditedRewardsPenaltyBps: position.creditedRewardsPenaltyBps || 0,
        withdrawalPenalty: formatAtomicAmount(position.withdrawalPenaltyAtomic || '0', position.decimals),
        rewards: rewardsByPosition.get(String(position._id)) || [],
      })),
      source: 'internal_ledger',
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/positions', subscriptionLimiter, customerAuth, customerAuthService.requireSameOrigin, async (req, res, next) => {
  if (!supportsMultiDocumentTransactions(mongoose.connection)) {
    return res.status(503).json({ error: 'MongoDB en replica set est requis pour verrouiller les fonds.' });
  }
  if (!requireFreshCustomerAuth(req, res)) return;
  const idempotencyKey = String(req.get('idempotency-key') || req.body?.idempotencyKey || '');
  let amountAtomic;
  try {
    amountAtomic = parseUnits(String(req.body?.amount || ''), 18).toString();
    if (BigInt(amountAtomic) <= 0n) throw new Error();
  } catch {
    return res.status(400).json({ error: 'Montant USDT invalide.' });
  }
  try {
    const result = await createEarnPosition({
      customer: req.customer,
      productId: String(req.body?.productId || ''),
      amountAtomic,
      idempotencyKey,
      acceptedTermsVersion: String(req.body?.acceptedTermsVersion || ''),
    });
    return res.status(result.duplicate ? 200 : 201).json({
      position: {
        id: String(result.position._id),
        productId: result.position.productId,
        amount: formatAtomicAmount(result.position.amountAtomic, 18),
        status: result.position.status,
        ledgerReference: result.position.ledgerReference,
      },
    });
  } catch (error) {
    return handleEarnError(error, res, next);
  }
});

router.post('/positions/:id/withdrawal', withdrawalLimiter, customerAuth, customerAuthService.requireSameOrigin, async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Placement invalide.' });
  if (!supportsMultiDocumentTransactions(mongoose.connection)) {
    return res.status(503).json({ error: 'MongoDB en replica set est requis pour demander un retrait.' });
  }
  if (!requireFreshCustomerAuth(req, res)) return;
  try {
    const result = await requestEarnWithdrawal({
      positionId: req.params.id,
      customerId: req.customer._id,
      acceptEarlyPenalty: req.body?.acceptEarlyPenalty === true,
    });
    if (result.error) {
      return res.status(result.status).json({
        error: result.error,
        ...(result.penaltyAtomic ? {
          penalty: formatAtomicAmount(result.penaltyAtomic, 18),
          penaltyBps: result.penaltyBps,
        } : {}),
      });
    }
    return res.status(202).json({
      position: { id: String(result.position._id), status: result.position.status },
      penalty: formatAtomicAmount(result.penaltyAtomic, 18),
      penaltyBps: result.penaltyBps,
      message: 'Demande envoyée. Le retrait sera traité après vérification de la liquidité par DAE.',
    });
  } catch (error) {
    return handleEarnError(error, res, next);
  }
});

module.exports = router;
