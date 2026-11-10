'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { getNormalDelta, isProtectedBalanceSufficient } = require('./ledger');

test('protects debit-normal Earn cash and deployed principal accounts', () => {
  assert.equal(getNormalDelta('credit', '30', 'debit'), -30n);
  assert.equal(isProtectedBalanceSufficient('-100', 'debit', -30n), true);
  assert.equal(isProtectedBalanceSufficient('-100', 'debit', -101n), false);
  assert.equal(isProtectedBalanceSufficient('0', 'debit', -1n), false);
});

test('protects credit-normal reward pools, income and reserve balances', () => {
  assert.equal(getNormalDelta('debit', '70', 'credit'), -70n);
  assert.equal(isProtectedBalanceSufficient('100', 'credit', -70n), true);
  assert.equal(isProtectedBalanceSufficient('100', 'credit', -101n), false);
  assert.equal(isProtectedBalanceSufficient('0', 'credit', 50n), true);
});
