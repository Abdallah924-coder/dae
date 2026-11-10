'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  allocateFundedRewards,
  calculateDailyApyReward,
  splitRealizedYield,
} = require('./earnRewards');

test('calculates daily simple APY accrual using 365 days and integer atomic units', () => {
  assert.equal(calculateDailyApyReward('100000000000000000000', 500), '13698630136986301');
  assert.equal(calculateDailyApyReward('1', 500), '0');
  assert.throws(() => calculateDailyApyReward('-1', 500), /Capital invalide/);
});

test('splits only realized yield, keeping revenue allocation separate from product APY', () => {
  assert.deepEqual(splitRealizedYield('101', {
    userRewards: 7000,
    platform: 2000,
    safetyReserve: 1000,
  }), {
    userRewardsAtomic: '70',
    platformAtomic: '20',
    safetyReserveAtomic: '11',
  });
  assert.throws(() => splitRealizedYield('100', {
    userRewards: 7000,
    platform: 2000,
    safetyReserve: 900,
  }), /totaliser 100 %/);
});

test('scales APY-based claims to actual funding without creating or losing atomic units', () => {
  const result = allocateFundedRewards([
    { id: 'a', amountAtomic: '7' },
    { id: 'b', amountAtomic: '3' },
  ], '6');
  assert.deepEqual(result, [
    { id: 'a', amountAtomic: '4' },
    { id: 'b', amountAtomic: '2' },
  ]);
  assert.equal(result.reduce((sum, entry) => sum + BigInt(entry.amountAtomic), 0n), 6n);
});

test('caps distribution at claims and uses deterministic largest-remainder rounding', () => {
  assert.deepEqual(allocateFundedRewards([
    { id: 'c', amountAtomic: '1' },
    { id: 'a', amountAtomic: '1' },
    { id: 'b', amountAtomic: '1' },
  ], '2'), [
    { id: 'a', amountAtomic: '1' },
    { id: 'b', amountAtomic: '1' },
  ]);
  assert.deepEqual(allocateFundedRewards([{ id: 'a', amountAtomic: '3' }], '10'), [
    { id: 'a', amountAtomic: '3' },
  ]);
});
