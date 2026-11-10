'use strict';

const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const { Interface, getAddress } = require('ethers');
const { EARN_PROTOCOLS } = require('../config/earnProtocols');
const { config } = require('../config');
const {
  verifyProtocolAllocationReceipt,
  verifyProtocolRedemptionReceipt,
  verifyTreasuryFundingReceipt,
} = require('./earnTreasury');

const treasuryAddress = '0x1111111111111111111111111111111111111111';
const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const aaveInterface = new Interface([
  'function withdraw(address asset,uint256 amount,address to) returns (uint256)',
  'function supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)',
]);
const oldTreasury = process.env.DAE_EARN_TREASURY_ADDRESS;
process.env.DAE_EARN_TREASURY_ADDRESS = treasuryAddress;
after(() => {
  if (oldTreasury === undefined) delete process.env.DAE_EARN_TREASURY_ADDRESS;
  else process.env.DAE_EARN_TREASURY_ADDRESS = oldTreasury;
});

function addressTopic(address) {
  return `0x${address.toLowerCase().slice(2).padStart(64, '0')}`;
}

function providerFor({ protocol = 'aaveV3', txTo, txData, txFrom = treasuryAddress, source, recipient = treasuryAddress, status = 1, blockOffset = 0 } = {}) {
  const contracts = EARN_PROTOCOLS[protocol];
  const to = txTo || (protocol === 'venus' ? contracts.market : contracts.pool);
  const data = txData || aaveInterface.encodeFunctionData('withdraw', [
    contracts.underlying,
    100n,
    treasuryAddress,
  ]);
  const receiptBlock = 100;
  return {
    async getNetwork() { return { chainId: 56n }; },
    async getCode() { return '0x6000'; },
    async getTransaction() { return { to, from: txFrom, data }; },
    async getTransactionReceipt() {
      return {
        hash: `0x${'a'.repeat(64)}`,
        status,
        blockNumber: receiptBlock,
        logs: [{
          address: config.bsc.usdtContract,
          topics: [
            transferTopic,
            addressTopic(source || contracts.aToken),
            addressTopic(recipient),
          ],
          data: `0x${100n.toString(16).padStart(64, '0')}`,
        }],
      };
    },
    async getBlockNumber() { return receiptBlock + Math.max(1, config.bsc.confirmations) - 1 + blockOffset; },
  };
}

test('accepts a confirmed Aave USDT withdrawal to the configured DAE Earn treasury', async () => {
  const result = await verifyProtocolRedemptionReceipt({
    provider: providerFor(),
    txHash: `0x${'a'.repeat(64)}`,
    protocol: 'aaveV3',
  });
  assert.equal(result.grossAmountAtomic, '100');
  assert.equal(result.treasuryAddress, getAddress(treasuryAddress));
});

test('rejects failed, unconfirmed, wrong-source and wrong-destination receipts', async () => {
  await assert.rejects(verifyProtocolRedemptionReceipt({
    provider: providerFor({ status: 0 }),
    txHash: `0x${'a'.repeat(64)}`,
    protocol: 'aaveV3',
  }), { code: 'ERR_EARN_RECEIPT_FAILED' });
  await assert.rejects(verifyProtocolRedemptionReceipt({
    provider: providerFor({ blockOffset: -1 }),
    txHash: `0x${'a'.repeat(64)}`,
    protocol: 'aaveV3',
  }), { code: 'ERR_EARN_RECEIPT_UNCONFIRMED' });
  await assert.rejects(verifyProtocolRedemptionReceipt({
    provider: providerFor({ source: treasuryAddress }),
    txHash: `0x${'a'.repeat(64)}`,
    protocol: 'aaveV3',
  }), { code: 'ERR_EARN_RECEIPT_NO_USDT' });
  await assert.rejects(verifyProtocolRedemptionReceipt({
    provider: providerFor({ recipient: '0x2222222222222222222222222222222222222222' }),
    txHash: `0x${'a'.repeat(64)}`,
    protocol: 'aaveV3',
  }), { code: 'ERR_EARN_RECEIPT_NO_USDT' });
});

test('rejects a receipt returned for a different transaction hash', async () => {
  const provider = providerFor();
  provider.getTransactionReceipt = async () => ({
    hash: `0x${'d'.repeat(64)}`,
    status: 1,
    blockNumber: 100,
    logs: [],
  });
  await assert.rejects(verifyProtocolRedemptionReceipt({
    provider,
    txHash: `0x${'a'.repeat(64)}`,
    protocol: 'aaveV3',
  }), { code: 'ERR_EARN_RECEIPT_HASH_MISMATCH' });
});

test('verifies Aave allocation call, treasury origin, exact amount and aToken transfer', async () => {
  const contracts = EARN_PROTOCOLS.aaveV3;
  const provider = providerFor();
  provider.getTransaction = async () => ({
    to: contracts.pool,
    from: treasuryAddress,
    data: aaveInterface.encodeFunctionData('supply', [
      contracts.underlying,
      100n,
      treasuryAddress,
      0,
    ]),
  });
  provider.getTransactionReceipt = async () => ({
    hash: `0x${'b'.repeat(64)}`,
    status: 1,
    blockNumber: 100,
    logs: [{
      address: contracts.underlying,
      topics: [transferTopic, addressTopic(treasuryAddress), addressTopic(contracts.aToken)],
      data: `0x${100n.toString(16).padStart(64, '0')}`,
    }],
  });
  const result = await verifyProtocolAllocationReceipt({
    provider,
    txHash: `0x${'b'.repeat(64)}`,
    protocol: 'aaveV3',
    expectedAmountAtomic: '100',
  });
  assert.equal(result.amountAtomic, '100');
});

test('recognizes external USDT capital received by the DAE treasury, not treasury self-transfers', async () => {
  const provider = providerFor();
  provider.getTransactionReceipt = async () => ({
    hash: `0x${'c'.repeat(64)}`,
    status: 1,
    blockNumber: 100,
    logs: [{
      address: config.bsc.usdtContract,
      topics: [transferTopic, addressTopic('0x2222222222222222222222222222222222222222'), addressTopic(treasuryAddress)],
      data: `0x${250n.toString(16).padStart(64, '0')}`,
    }],
  });
  const result = await verifyTreasuryFundingReceipt({
    provider,
    txHash: `0x${'c'.repeat(64)}`,
  });
  assert.equal(result.amountAtomic, '250');
});
