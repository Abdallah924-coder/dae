'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildTransferPostings, calculateTransferAmounts } = require('./customerTransfer');

test('calculates the 0.05% fee from the entered amount', () => {
  assert.deepEqual(calculateTransferAmounts('1'), {
    amountAtomic: '1000000000000000000',
    feeAtomic: '500000000000000',
    recipientAmountAtomic: '999500000000000000',
  });
});

test('rounds a fractional atomic fee up and preserves balanced postings', () => {
  const amounts = calculateTransferAmounts('1.000000000000000001');
  assert.equal(amounts.feeAtomic, '500000000000001');
  assert.equal(
    BigInt(amounts.feeAtomic) + BigInt(amounts.recipientAmountAtomic),
    BigInt(amounts.amountAtomic),
  );

  const postings = buildTransferPostings({
    senderId: '0123456789abcdef01234567',
    recipientId: '89abcdef0123456701234567',
    feeRecipientId: 'fedcba987654321001234567',
    ...amounts,
  });
  const net = postings.reduce((total, posting) => (
    total + (posting.side === 'credit' ? BigInt(posting.amountAtomic) : -BigInt(posting.amountAtomic))
  ), 0n);
  assert.equal(net, 0n);
  assert.deepEqual(postings.map(({ accountRef, side }) => [accountRef, side]), [
    ['customer:0123456789abcdef01234567:available', 'debit'],
    ['customer:89abcdef0123456701234567:available', 'credit'],
    ['customer:fedcba987654321001234567:available', 'credit'],
  ]);
});

test('rejects invalid precision and amounts below the minimum', () => {
  assert.throws(() => calculateTransferAmounts('0.999999999999999999'), RangeError);
  assert.throws(() => calculateTransferAmounts('1.0000000000000000001'), TypeError);
  assert.throws(() => calculateTransferAmounts('1e2'), TypeError);
});
