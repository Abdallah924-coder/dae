'use strict';

const mongoose = require('mongoose');
const { formatUnits, zeroPadValue, getAddress } = require('ethers');
const connectDB = require('../config/db');
const { config, BSC_PEG_USD_CONTRACT } = require('../config');
const { logger } = require('../lib/logger');
const Wallet = require('../models/Wallet');
const Customer = require('../models/Customer');
const Deposit = require('../models/Deposit');
const BscIndexCursor = require('../models/BscIndexCursor');
const BscIndexerHeartbeat = require('../models/BscIndexerHeartbeat');
const {
  bscConfigStatus,
  getLogsProvider,
  parseTransferLog,
  TRANSFER_TOPIC,
} = require('../services/bsc');
const { postLedgerTransaction } = require('../services/ledger');
const { enqueueEmail } = require('../services/emailOutbox');
const { depositCreditedEmail } = require('../services/email');

const NETWORK = 'BEP20';
const ASSET = 'USDT'; // Product label; chain contract is Binance-Peg BSC-USD.
const DECIMALS = 18;
const RANGE_SIZE = 1000;
const ADDRESS_BATCH = 100;
const RPC_RETRY_DELAYS_MS = [500, 1000, 2000];
const TRANSIENT_RPC_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'NETWORK_ERROR',
]);

async function initialize() {
  const status = bscConfigStatus();
  if (
    !status.rpc ||
    !status.xpub ||
    !status.token ||
    !status.startBlock ||
    !status.depositsEnabled
  ) {
    throw new Error(
      'Configurez RPC, contrat vérifié, xpub, BSC_START_BLOCK et BSC_DEPOSITS_ENABLED=true avant l’indexation.',
    );
  }
  if (config.bsc.usdtContract.toLowerCase() !== BSC_PEG_USD_CONTRACT)
    throw new Error('Contrat BEP-20 BSC-USD non vérifié.');
  const provider = getLogsProvider();
  const chain = await withTransientRpcRetry(() => provider.getNetwork());
  if (Number(chain.chainId) !== 56)
    throw new Error('Le RPC des journaux ne pointe pas vers BNB Smart Chain mainnet (chainId 56).');
  const decimals = await withTransientRpcRetry(() =>
    provider.call({ to: config.bsc.usdtContract, data: '0x313ce567' }),
  );
  if (Number(BigInt(decimals)) !== DECIMALS)
    throw new Error('Le contrat configuré ne présente pas 18 décimales; indexation refusée.');
  const logsContract = await withTransientRpcRetry(() => provider.getCode(config.bsc.usdtContract));
  if (logsContract === '0x')
    throw new Error('Le contrat USDT est introuvable sur le RPC des journaux.');
  return provider;
}

function isTransientRpcError(error, seen = new Set()) {
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  if (TRANSIENT_RPC_ERROR_CODES.has(error.code)) return true;
  if (isTransientRpcError(error.cause, seen) || isTransientRpcError(error.info?.error, seen))
    return true;
  return (
    Array.isArray(error.errors) &&
    error.errors.some((nestedError) => isTransientRpcError(nestedError, seen))
  );
}

async function withTransientRpcRetry(operation) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const delay = RPC_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isTransientRpcError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function isLogLimitError(error) {
  return (
    error?.info?.error?.code === -32005 ||
    error?.error?.code === -32005 ||
    /limit exceeded|too many results/i.test(String(error?.message || ''))
  );
}

async function getDepositLogs(provider, filter) {
  try {
    return await withTransientRpcRetry(() => provider.getLogs(filter));
  } catch (error) {
    if (!isLogLimitError(error)) throw error;

    const fromBlock = Number(filter.fromBlock);
    const toBlock = Number(filter.toBlock);
    if (fromBlock < toBlock) {
      const midpoint = Math.floor((fromBlock + toBlock) / 2);
      const firstHalf = await getDepositLogs(provider, { ...filter, toBlock: midpoint });
      const secondHalf = await getDepositLogs(provider, { ...filter, fromBlock: midpoint + 1 });
      return [...firstHalf, ...secondHalf];
    }

    const recipientTopics = filter.topics?.[2];
    if (Array.isArray(recipientTopics) && recipientTopics.length > 1) {
      const midpoint = Math.ceil(recipientTopics.length / 2);
      const firstHalf = await getDepositLogs(provider, {
        ...filter,
        topics: [filter.topics[0], filter.topics[1], recipientTopics.slice(0, midpoint)],
      });
      const secondHalf = await getDepositLogs(provider, {
        ...filter,
        topics: [filter.topics[0], filter.topics[1], recipientTopics.slice(midpoint)],
      });
      return [...firstHalf, ...secondHalf];
    }

    throw error;
  }
}

async function creditTransfer(log) {
  const transfer = parseTransferLog(log);
  const wallet = await Wallet.findOne({ network: NETWORK, address: transfer.to })
    .select('_id customerId')
    .lean();
  if (!wallet || BigInt(transfer.amountAtomic) <= 0n) return;
  const customer = await Customer.findOne({
    _id: wallet.customerId,
    status: 'active',
    kycStatus: 'approved',
  })
    .select('_id')
    .lean();

  let deposit = await Deposit.findOne({
    network: NETWORK,
    txHash: transfer.txHash,
    eventIndex: transfer.eventIndex,
  });
  if (!deposit) {
    try {
      [deposit] = await Deposit.create([
        {
          customerId: wallet.customerId,
          walletId: wallet._id,
          asset: ASSET,
          network: NETWORK,
          txHash: transfer.txHash,
          eventIndex: transfer.eventIndex,
          blockNumber: transfer.blockNumber,
          amountAtomic: transfer.amountAtomic,
          decimals: DECIMALS,
          // Logs are only queried through the safe head, so they already satisfy this threshold.
          confirmations: config.bsc.confirmations,
          status: customer ? 'confirming' : 'compliance_review',
        },
      ]);
    } catch (error) {
      if (error.code !== 11000) throw error;
      deposit = await Deposit.findOne({
        network: NETWORK,
        txHash: transfer.txHash,
        eventIndex: transfer.eventIndex,
      });
    }
  }
  if (deposit.status === 'credited' || deposit.status === 'rejected') return;
  if (!customer) {
    await Deposit.updateOne(
      { _id: deposit._id, status: { $in: ['detected', 'confirming'] } },
      { $set: { status: 'compliance_review' } },
    );
    return;
  }

  await creditDeposit(deposit, wallet.customerId);
}

async function creditDeposit(deposit, customerId) {
  const key = `bsc-deposit:${deposit.txHash}:${deposit.eventIndex}`;

  await postLedgerTransaction({
    type: 'deposit',
    idempotencyKey: key,
    sourceRef: `${deposit.txHash}:${deposit.eventIndex}`,
    createdBy: 'bsc-deposit-indexer',
    metadata: {
      chainId: 56,
      tokenContract: config.bsc.usdtContract,
      blockNumber: deposit.blockNumber,
    },
    postings: [
      {
        accountRef: `customer:${customerId}:available`,
        asset: ASSET,
        network: NETWORK,
        decimals: DECIMALS,
        side: 'credit',
        amountAtomic: deposit.amountAtomic,
      },
      {
        accountRef: 'system:bsc-custody',
        asset: ASSET,
        network: NETWORK,
        decimals: DECIMALS,
        side: 'debit',
        amountAtomic: deposit.amountAtomic,
      },
    ],
  });
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const updated = await Deposit.updateOne(
        { _id: deposit._id, status: { $in: ['detected', 'confirming', 'compliance_review'] } },
        { $set: { status: 'credited' } },
        { session },
      );
      if (updated.modifiedCount !== 1) return;
      const customer = await Customer.findById(customerId).select('email').session(session).lean();
      if (!customer?.email) throw new Error('E-mail client introuvable pour notifier le dépôt crédité.');
      await enqueueEmail({
        dedupeKey: `deposit:${deposit._id}:credited`,
        ...depositCreditedEmail({
          email: customer.email,
          amount: formatUnits(deposit.amountAtomic, deposit.decimals),
          asset: deposit.asset,
          network: deposit.network,
          reference: deposit.txHash,
        }),
      }, { session });
    });
  } finally {
    await session.endSession();
  }
}

async function reconcilePendingDeposits(provider) {
  const latest = await withTransientRpcRetry(() => provider.getBlockNumber());
  const pending = await Deposit.find({
    network: NETWORK,
    status: { $in: ['detected', 'confirming', 'compliance_review'] },
  })
    .sort({ blockNumber: 1 })
    .limit(500)
    .lean();
  for (const deposit of pending) {
    const confirmations = Math.max(0, latest - deposit.blockNumber + 1);
    await Deposit.updateOne(
      { _id: deposit._id, status: { $in: ['detected', 'confirming', 'compliance_review'] } },
      {
        $set: { confirmations },
      },
    );
    if (confirmations < config.bsc.confirmations) continue;
    const customer = await Customer.findOne({
      _id: deposit.customerId,
      status: 'active',
      kycStatus: 'approved',
    })
      .select('_id')
      .lean();
    if (!customer) {
      if (deposit.status !== 'compliance_review')
        await Deposit.updateOne({ _id: deposit._id }, { $set: { status: 'compliance_review' } });
      continue;
    }
    await creditDeposit(deposit, customer._id);
  }
}

async function runOnce(provider) {
  const activeProvider = provider || (await initialize());
  const latest = await withTransientRpcRetry(() => activeProvider.getBlockNumber());
  const safeHead = latest - config.bsc.confirmations + 1;
  if (safeHead < 0) return { indexedThrough: null, deposits: 0 };

  let cursor = await BscIndexCursor.findOne({ name: 'bsc-usdt-bep20' });
  if (!cursor) {
    cursor = await BscIndexCursor.create({
      name: 'bsc-usdt-bep20',
      blockNumber: config.bsc.startBlock - 1,
      version: 2,
    });
  } else if (cursor.version < 2) {
    cursor =
      (await BscIndexCursor.findOneAndUpdate(
        { _id: cursor._id, version: { $lt: 2 } },
        { $set: { blockNumber: config.bsc.startBlock - 1, version: 2 } },
        { new: true },
      )) || (await BscIndexCursor.findOne({ name: 'bsc-usdt-bep20' }));
  }
  let fromBlock = cursor.blockNumber + 1;
  let depositCount = 0;
  const contract = getAddress(config.bsc.usdtContract);

  while (fromBlock <= safeHead) {
    const toBlock = Math.min(fromBlock + RANGE_SIZE - 1, safeHead);
    const addresses = await Wallet.distinct('address', {
      network: NETWORK,
      address: { $type: 'string' },
    });
    for (let offset = 0; offset < addresses.length; offset += ADDRESS_BATCH) {
      const topics = addresses
        .slice(offset, offset + ADDRESS_BATCH)
        .map((address) => zeroPadValue(address, 32));
      const logs = await getDepositLogs(activeProvider, {
        address: contract,
        fromBlock,
        toBlock,
        topics: [TRANSFER_TOPIC, null, topics],
      });
      for (const log of logs) {
        await creditTransfer(log);
        depositCount += 1;
      }
    }
    await BscIndexCursor.updateOne({ name: 'bsc-usdt-bep20' }, { $set: { blockNumber: toBlock } });
    fromBlock = toBlock + 1;
  }
  return { indexedThrough: safeHead, deposits: depositCount };
}

async function main() {
  await connectDB();
  logger.info({ ...bscConfigStatus() }, 'Démarrage de l’indexeur des dépôts BSC');
  let provider;
  while (true) {
    try {
      provider = provider || (await initialize());
      const result = await runOnce(provider);
      await reconcilePendingDeposits(provider);
      if (result.indexedThrough !== null)
        await BscIndexerHeartbeat.updateOne(
          { name: 'bsc-usdt-bep20' },
          { $set: { lastSeenAt: new Date(), indexedThrough: result.indexedThrough } },
          { upsert: true },
        );
      logger.info(result, 'Indexation des dépôts BSC terminée');
    } catch (error) {
      provider = null;
      logger.error({ err: error }, 'Échec de l’indexation BSC');
    }
    await new Promise((resolve) => setTimeout(resolve, config.bsc.scanIntervalMs));
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      logger.fatal({ err: error }, 'Impossible de démarrer l’indexeur BSC');
      process.exitCode = 1;
    })
    .finally(async () => {
      if (process.exitCode) await mongoose.disconnect();
    });
}

module.exports = {
  runOnce,
  creditTransfer,
  reconcilePendingDeposits,
  getDepositLogs,
  isTransientRpcError,
  withTransientRpcRetry,
};
