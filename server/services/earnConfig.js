'use strict';

const { formatUnits } = require('ethers');
const EarnConfig = require('../models/EarnConfig');
const { defaultEarnConfig } = require('../config/earnProducts');

const PRODUCT_IDS = ['flexible', 'bronze', 'silver', 'gold'];
const ATOMIC_AMOUNT_RE = /^[1-9][0-9]{0,77}$/;

function configForClient(config) {
  const source = config || defaultEarnConfig();
  return {
    configVersion: source.configVersion || 0,
    subscriptionsEnabled: Boolean(source.subscriptionsEnabled),
    allocationsEnabled: Boolean(source.allocationsEnabled),
    rewardsEnabled: Boolean(source.rewardsEnabled),
    allocationLimitBps: source.allocationLimitBps,
    protocolLimitsBps: source.protocolLimitsBps,
    revenueSplitBps: source.revenueSplitBps,
    earlyWithdrawal: source.earlyWithdrawal,
    products: source.products.map((product) => ({
      ...product,
      minimumAmount: formatUnits(product.minimumAmountAtomic, 18),
    })),
    productionEnabled: false,
  };
}

async function getEarnConfig() {
  return EarnConfig.findOne({ key: 'main' }).lean();
}

function validateEarnConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Configuration DAE Earn invalide.');
  }
  const integer = (value, label, maximum) => {
    if (!Number.isInteger(value) || value < 0 || value > maximum) {
      throw new TypeError(`${label} doit être un entier entre 0 et ${maximum}.`);
    }
    return value;
  };
  const allocationLimitBps = integer(input.allocationLimitBps, 'La limite globale', 1000);
  for (const key of ['subscriptionsEnabled', 'allocationsEnabled', 'rewardsEnabled']) {
    if (typeof input[key] !== 'boolean') throw new TypeError(`Le paramètre ${key} doit être booléen.`);
  }
  const protocolLimitsBps = {
    venus: integer(input.protocolLimitsBps?.venus, 'La limite Venus', allocationLimitBps),
    aaveV3: integer(input.protocolLimitsBps?.aaveV3, 'La limite Aave V3', allocationLimitBps),
  };
  if (protocolLimitsBps.venus + protocolLimitsBps.aaveV3 > allocationLimitBps) {
    throw new RangeError('La somme des limites protocolaires ne peut dépasser la limite globale.');
  }

  const revenueSplitBps = {
    userRewards: integer(input.revenueSplitBps?.userRewards, 'La part des récompenses', 10000),
    platform: integer(input.revenueSplitBps?.platform, 'La part DAE', 10000),
    safetyReserve: integer(input.revenueSplitBps?.safetyReserve, 'La part de réserve', 10000),
  };
  if (Object.values(revenueSplitBps).reduce((sum, value) => sum + value, 0) !== 10000) {
    throw new RangeError('La répartition des revenus doit totaliser 100 %.');
  }

  const earlyWithdrawal = {
    unaccruedRewardsPenaltyBps: integer(input.earlyWithdrawal?.unaccruedRewardsPenaltyBps, 'La pénalité sur récompenses non acquises', 10000),
    creditedRewardsPenaltyBps: integer(input.earlyWithdrawal?.creditedRewardsPenaltyBps, 'La pénalité sur récompenses déjà créditées', 10000),
  };
  if (!Array.isArray(input.products) || input.products.length !== PRODUCT_IDS.length) {
    throw new TypeError('Les quatre produits DAE Earn doivent être configurés.');
  }
  const productsById = new Map(input.products.map((product) => [product?.productId, product]));
  if (productsById.size !== PRODUCT_IDS.length || PRODUCT_IDS.some((id) => !productsById.has(id))) {
    throw new TypeError('Chaque produit DAE Earn doit apparaître une seule fois.');
  }
  const products = PRODUCT_IDS.map((productId) => {
    const product = productsById.get(productId);
    const name = String(product.name || '').trim();
    const durationDays = integer(product.durationDays, `La durée ${productId}`, 3650);
    const apyBps = integer(product.apyBps, `L’APY ${productId}`, 10000);
    const minimumAmountAtomic = String(product.minimumAmountAtomic || '');
    if (name.length < 2 || name.length > 60) throw new TypeError(`Nom de produit invalide : ${productId}.`);
    if (!ATOMIC_AMOUNT_RE.test(minimumAmountAtomic)) throw new TypeError(`Dépôt minimum invalide : ${productId}.`);
    if (typeof product.flexible !== 'boolean' || typeof product.published !== 'boolean') {
      throw new TypeError(`Options du produit invalides : ${productId}.`);
    }
    if ((productId === 'flexible') !== product.flexible || (product.flexible && durationDays !== 0) || (!product.flexible && durationDays === 0)) {
      throw new TypeError(`Durée incohérente pour le produit ${productId}.`);
    }
    return {
      productId,
      name,
      apyBps,
      durationDays,
      minimumAmountAtomic,
      flexible: product.flexible,
      published: product.published,
    };
  });

  return {
    subscriptionsEnabled: input.subscriptionsEnabled,
    allocationsEnabled: input.allocationsEnabled,
    rewardsEnabled: input.rewardsEnabled,
    allocationLimitBps,
    protocolLimitsBps,
    revenueSplitBps,
    earlyWithdrawal,
    products,
  };
}

module.exports = { configForClient, getEarnConfig, validateEarnConfig };
