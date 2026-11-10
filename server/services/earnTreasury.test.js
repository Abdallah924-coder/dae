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
  verifyTreasuryPayoutReceipt,
} = require('./earnTreasury');

const treasuryAddress = '0x1111111111111111111111111111111111111111';
const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const aaveInterface = new Interface([
  'function withdraw(address asset,uint256 amount,address to) returns (uint256)',
  'function supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)',
]);
const aaveEventsInterface = new Interface([
  'event Supply(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint16 referralCode)',
  'event Withdraw(address indexed reserve,address indexed user,address indexed to,uint256 amount)',
]);
const venusInterface = new Interface([
  'function mint(uint256 mintAmount) returns (uint256)',
  'function redeem(uint256 redeemTokens) returns (uint256)',
]);
const venusEventsInterface = new Interface([
  'event Mint(address minter,uint256 mintAmount,uint256 mintTokens,uint256 totalSupply)',
  'event Redeem(address redeemer,uint256 redeemAmount,uint256 redeemTokens,uint256 totalSupply)',
  'event Mint(address minter,uint256 mintAmount,uint256 mintTokens)',
  'event Redeem(address redeemer,uint256 redeemAmount,uint256 redeemTokens)',
]);
const erc20TransferInterface = new Interface([
  'function transfer(address to,uint256 amount) returns (bool)',
]);
const abiCoder = require('ethers').AbiCoder.defaultAbiCoder();
const oldTreasury = process.env.DAE_EARN_TREASURY_ADDRESS;
process.env.DAE_EARN_TREASURY_ADDRESS = treasuryAddress;
const oldMasterAddress = config.bsc.masterAddress;
const operationalAddress = '0x3333333333333333333333333333333333333333';
config.bsc.masterAddress = operationalAddress;
after(() => {
  if (oldTreasury === undefined) delete process.env.DAE_EARN_TREASURY_ADDRESS;
  else process.env.DAE_EARN_TREASURY_ADDRESS = oldTreasury;
  config.bsc.masterAddress = oldMasterAddress;
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
    async call() { return abiCoder.encode(['uint8'], [18]); },
    async getTransaction() { return { to, from: txFrom, data }; },
    async getTransactionReceipt() {
      return {
        hash: `0x${'a'.repeat(64)}`,
        status,
        blockNumber: receiptBlock,
        logs: [
          {
            address: config.bsc.usdtContract,
            topics: [
              transferTopic,
              addressTopic(source || contracts.aToken),
              addressTopic(recipient),
            ],
            data: `0x${100n.toString(16).padStart(64, '0')}`,
          },
          ...(protocol === 'aaveV3'
            ? [aaveEventsInterface.encodeEventLog(
              aaveEventsInterface.getEvent('Withdraw'),
              [contracts.underlying, treasuryAddress, treasuryAddress, 100n],
            )].map((event) => ({ address: contracts.pool, ...event }))
            : []),
        ],
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

test('rejects a token transfer without the protocol redemption event', async () => {
  const provider = providerFor();
  provider.getTransactionReceipt = async () => ({
    hash: `0x${'a'.repeat(64)}`,
    status: 1,
    blockNumber: 100,
    logs: [{
      address: config.bsc.usdtContract,
      topics: [transferTopic, addressTopic(EARN_PROTOCOLS.aaveV3.aToken), addressTopic(treasuryAddress)],
      data: `0x${100n.toString(16).padStart(64, '0')}`,
    }],
  });
  await assert.rejects(verifyProtocolRedemptionReceipt({
    provider,
    txHash: `0x${'a'.repeat(64)}`,
    protocol: 'aaveV3',
  }), { code: 'ERR_EARN_REDEMPTION_EVENT_MISMATCH' });
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
    logs: [
      {
        address: contracts.underlying,
        topics: [transferTopic, addressTopic(treasuryAddress), addressTopic(contracts.aToken)],
        data: `0x${100n.toString(16).padStart(64, '0')}`,
      },
      {
        address: contracts.pool,
        ...aaveEventsInterface.encodeEventLog(
          aaveEventsInterface.getEvent('Supply'),
          [contracts.underlying, treasuryAddress, treasuryAddress, 100n, 0],
        ),
      },
    ],
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

test('requires Venus mint and redeem events matching the treasury USDT transfers', async () => {
  const contracts = EARN_PROTOCOLS.venus;
  const hash = `0x${'e'.repeat(64)}`;
  const provider = {
    async getNetwork() { return { chainId: 56n }; },
    async getBlockNumber() { return 200 + Math.max(1, config.bsc.confirmations) - 1; },
    async getCode() { return '0x6000'; },
    async call() { return abiCoder.encode(['uint8'], [18]); },
    async getTransaction() {
      return {
        to: contracts.market,
        from: treasuryAddress,
        data: venusInterface.encodeFunctionData('mint', [100n]),
      };
    },
    async getTransactionReceipt() {
      return {
        hash,
        status: 1,
        blockNumber: 200,
        logs: [
          {
            address: contracts.underlying,
            topics: [transferTopic, addressTopic(treasuryAddress), addressTopic(contracts.market)],
            data: `0x${100n.toString(16).padStart(64, '0')}`,
          },
          {
            address: contracts.market,
            ...venusEventsInterface.encodeEventLog(
              venusEventsInterface.getEvent('Mint(address,uint256,uint256,uint256)'),
              [treasuryAddress, 100n, 99n, 99n],
            ),
          },
        ],
      };
    },
  };
  assert.equal((await verifyProtocolAllocationReceipt({
    provider,
    txHash: hash,
    protocol: 'venus',
    expectedAmountAtomic: '100',
  })).amountAtomic, '100');

  provider.getTransaction = async () => ({
    to: contracts.market,
    from: treasuryAddress,
    data: venusInterface.encodeFunctionData('redeem', [99n]),
  });
  provider.getTransactionReceipt = async () => ({
    hash,
    status: 1,
    blockNumber: 200,
    logs: [
      {
        address: contracts.underlying,
        topics: [transferTopic, addressTopic(contracts.market), addressTopic(treasuryAddress)],
        data: `0x${100n.toString(16).padStart(64, '0')}`,
      },
      {
        address: contracts.market,
        ...venusEventsInterface.encodeEventLog(
          venusEventsInterface.getEvent('Redeem(address,uint256,uint256)'),
          [treasuryAddress, 100n, 99n],
        ),
      },
    ],
  });
  assert.equal((await verifyProtocolRedemptionReceipt({
    provider,
    txHash: hash,
    protocol: 'venus',
  })).grossAmountAtomic, '100');
});

test('requires a confirmed exact treasury-to-operational-wallet payout before withdrawal release', async () => {
  const hash = `0x${'f'.repeat(64)}`;
  const provider = providerFor();
  provider.getTransaction = async () => ({
    to: config.bsc.usdtContract,
    from: treasuryAddress,
    value: 0n,
    data: erc20TransferInterface.encodeFunctionData('transfer', [operationalAddress, 100n]),
  });
  provider.getTransactionReceipt = async () => ({
    hash,
    status: 1,
    blockNumber: 100,
    logs: [{
      address: config.bsc.usdtContract,
      topics: [transferTopic, addressTopic(treasuryAddress), addressTopic(operationalAddress)],
      data: `0x${100n.toString(16).padStart(64, '0')}`,
    }],
  });
  const result = await verifyTreasuryPayoutReceipt({
    provider,
    txHash: hash,
    expectedAmountAtomic: '100',
  });
  assert.equal(result.amountAtomic, '100');
  assert.equal(result.settlementAddress, getAddress(operationalAddress));

  provider.getTransaction = async () => ({
    to: config.bsc.usdtContract,
    from: treasuryAddress,
    value: 0n,
    data: erc20TransferInterface.encodeFunctionData('transfer', [treasuryAddress, 100n]),
  });
  await assert.rejects(verifyTreasuryPayoutReceipt({
    provider,
    txHash: hash,
    expectedAmountAtomic: '100',
  }), { code: 'ERR_EARN_PAYOUT_AMOUNT_MISMATCH' });
});
