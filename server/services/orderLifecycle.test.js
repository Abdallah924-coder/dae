'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { internalBalanceCredit } = require('./orderLifecycle');

test('internalBalanceCredit credits USDT to the customer BEP20 available balance', () => {
  const credit = internalBalanceCredit({
    _id: 'order-id',
    ref: 'CMD-test',
    customerId: '0123456789abcdef01234567',
    mode: 'buy',
    asset: 'USDT',
    network: 'BEP20',
    fulfillment: 'internal_balance',
    amountCrypto: '12.34000001',
  });

  assert.equal(credit.type, 'exchange');
  assert.equal(credit.idempotencyKey, 'buy-order:CMD-test:credit:v1');
  assert.deepEqual(credit.postings, [
    {
      accountRef: 'customer:0123456789abcdef01234567:available',
      asset: 'USDT',
      network: 'BEP20',
      decimals: 18,
      side: 'credit',
      amountAtomic: '12340000010000000000',
    },
    {
      accountRef: 'system:exchange-reserve',
      asset: 'USDT',
      network: 'BEP20',
      decimals: 18,
      side: 'debit',
      amountAtomic: '12340000010000000000',
    },
  ]);
});

test('internalBalanceCredit rejects orders that must not post to the customer ledger', () => {
  const baseOrder = {
    customerId: '0123456789abcdef01234567',
    mode: 'buy',
    asset: 'USDT',
    fulfillment: 'internal_balance',
    amountCrypto: '12',
  };

  assert.equal(internalBalanceCredit({ ...baseOrder, mode: 'sell' }), null);
  assert.equal(internalBalanceCredit({ ...baseOrder, asset: 'BTC' }), null);
  assert.equal(internalBalanceCredit({ ...baseOrder, network: 'TRC20' }), null);
  assert.equal(internalBalanceCredit({ ...baseOrder, fulfillment: 'external_wallet' }), null);
  assert.equal(internalBalanceCredit({ ...baseOrder, customerId: null }), null);
});
