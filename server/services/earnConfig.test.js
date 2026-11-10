'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { defaultEarnConfig } = require('../config/earnProducts');
const { configForClient, validateEarnConfig } = require('./earnConfig');

test('default catalog uses the four requested indicative products and keeps all movements disabled', () => {
  const config = configForClient(null);
  assert.deepEqual(config.products.map(({ productId, apyBps, durationDays, minimumAmount }) => ({
    productId,
    apyBps,
    durationDays,
    minimumAmount,
  })), [
    { productId: 'flexible', apyBps: 200, durationDays: 0, minimumAmount: '10.0' },
    { productId: 'bronze', apyBps: 300, durationDays: 30, minimumAmount: '50.0' },
    { productId: 'silver', apyBps: 400, durationDays: 60, minimumAmount: '100.0' },
    { productId: 'gold', apyBps: 500, durationDays: 90, minimumAmount: '250.0' },
  ]);
  assert.equal(config.productionEnabled, false);
  assert.equal(config.subscriptionsEnabled, false);
  assert.equal(config.allocationsEnabled, false);
  assert.equal(config.rewardsEnabled, false);
});

test('reports production active only when subscriptions, allocations and rewards are all enabled', () => {
  const defaults = defaultEarnConfig();
  assert.equal(configForClient({
    ...defaults,
    subscriptionsEnabled: true,
    allocationsEnabled: true,
  }).productionEnabled, false);
  assert.equal(configForClient({
    ...defaults,
    subscriptionsEnabled: true,
    allocationsEnabled: true,
    rewardsEnabled: true,
  }).productionEnabled, true);
});

test('validates revenue split, global and per-protocol allocation limits', () => {
  const defaults = defaultEarnConfig();
  assert.deepEqual(validateEarnConfig(defaults).revenueSplitBps, {
    userRewards: 7000,
    platform: 2000,
    safetyReserve: 1000,
  });
  assert.throws(() => validateEarnConfig({
    ...defaults,
    allocationLimitBps: 1001,
  }), /limite globale/);
  assert.throws(() => validateEarnConfig({
    ...defaults,
    protocolLimitsBps: { venus: 600, aaveV3: 500 },
  }), /limites protocolaires/);
  assert.throws(() => validateEarnConfig({
    ...defaults,
    revenueSplitBps: { userRewards: 7000, platform: 2000, safetyReserve: 999 },
  }), /totaliser 100 %/);
});

test('validates product identity, duration and atomic minimums', () => {
  const defaults = defaultEarnConfig();
  assert.throws(() => validateEarnConfig({
    ...defaults,
    products: defaults.products.map((product) => (
      product.productId === 'gold' ? { ...product, productId: 'silver' } : product
    )),
  }), /une seule fois/);
  assert.throws(() => validateEarnConfig({
    ...defaults,
    products: defaults.products.map((product) => (
      product.productId === 'bronze' ? { ...product, durationDays: 0 } : product
    )),
  }), /Durée incohérente/);
  assert.throws(() => validateEarnConfig({
    ...defaults,
    products: defaults.products.map((product) => (
      product.productId === 'gold' ? { ...product, minimumAmountAtomic: '0' } : product
    )),
  }), /Dépôt minimum invalide/);
});
