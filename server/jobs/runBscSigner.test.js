'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { Interface } = require('ethers');
const { canRequeueUnfundedGasTopUp, matchesTokenTransfer } = require('./runBscSigner');

const job = { signedPurpose: 'gas_topup' };
const parsed = {
  nonce: 4,
  value: 3000000000000000n,
  gasLimit: 21000n,
  maxFeePerGas: 50000000n,
};

test('allows an unfunded gas top-up to be re-signed when its nonce is still available', () => {
  assert.equal(canRequeueUnfundedGasTopUp({
    job,
    error: Object.assign(new Error('insufficient funds'), { code: 'INSUFFICIENT_FUNDS' }),
    transactionFound: false,
    balance: 3000000000000000n,
    pendingNonce: 4,
    parsed,
  }), true);
});

test('does not requeue a top-up if it may already be pending or is funded', () => {
  const input = {
    job,
    error: Object.assign(new Error('insufficient funds'), { code: 'INSUFFICIENT_FUNDS' }),
    transactionFound: false,
    balance: 4000000000000000n,
    pendingNonce: 4,
    parsed,
  };

  assert.equal(canRequeueUnfundedGasTopUp({ ...input, pendingNonce: 5 }), false);
  assert.equal(canRequeueUnfundedGasTopUp({ ...input, transactionFound: true }), false);
  assert.equal(canRequeueUnfundedGasTopUp({ ...input, job: { signedPurpose: 'token_transfer' } }), false);
  assert.equal(canRequeueUnfundedGasTopUp({ ...input, balance: 3000000000000000n }), true);
});

test('does not requeue for unrelated broadcast errors', () => {
  assert.equal(canRequeueUnfundedGasTopUp({
    job,
    error: Object.assign(new Error('RPC unavailable'), { code: 'ECONNRESET' }),
    transactionFound: false,
    balance: 0n,
    pendingNonce: 4,
    parsed,
  }), false);
});

test('matches signed BEP-20 transfers using the ABI amount argument', () => {
  const iface = new Interface(['function transfer(address to, uint256 amount) returns (bool)']);
  const destination = '0x0000000000000000000000000000000000000001';
  const data = iface.encodeFunctionData('transfer', [destination, 2500000000000000000n]);
  const decoded = iface.parseTransaction({ data, value: 0n });

  assert.equal(matchesTokenTransfer(decoded, destination, '2500000000000000000'), true);
  assert.equal(matchesTokenTransfer(decoded, destination, '2500000000000000001'), false);
  assert.equal(matchesTokenTransfer(decoded, '0x0000000000000000000000000000000000000002', '2500000000000000000'), false);
});
