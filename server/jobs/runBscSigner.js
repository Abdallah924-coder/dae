'use strict';

const mongoose = require('mongoose');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.signer') });
const { Contract, HDNodeWallet, formatUnits, parseEther, getAddress, keccak256, Transaction } = require('ethers');
const connectDB = require('../config/db');
const { config, BSC_PEG_USD_CONTRACT } = require('../config');
const { logger } = require('../lib/logger');
const WalletModel = require('../models/Wallet');
const Customer = require('../models/Customer');
const Withdrawal = require('../models/Withdrawal');
const BscTransferJob = require('../models/BscTransferJob');
const BscCollectionRun = require('../models/BscCollectionRun');
const BscSignerHeartbeat = require('../models/BscSignerHeartbeat');
const { getProvider } = require('../services/bsc');
const { postLedgerTransaction } = require('../services/ledger');
const { reserveBscWithdrawal } = require('../services/bscWithdrawal');
const { encryptSignedTransaction, decryptSignedTransaction } = require('../services/bscSigningJournal');
const { enqueueEmail } = require('../services/emailOutbox');
const { withdrawalEmail } = require('../services/email');

const TOKEN_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];
const DECIMALS = 18;
const TRANSIENT_RPC_ERROR_CODES = new Set([
  'TIMEOUT',
  'ETIMEDOUT',
  'ECONNABORTED',
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'NETWORK_ERROR',
]);

function matchesTokenTransfer(decoded, destination, amountAtomic) {
  return decoded?.name === 'transfer'
    && String(decoded.args.to).toLowerCase() === destination.toLowerCase()
    && decoded.args.amount.toString() === amountAtomic;
}

function isTransientRpcError(error, seen = new Set()) {
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  if (TRANSIENT_RPC_ERROR_CODES.has(error.code)) return true;
  if (
    isTransientRpcError(error.cause, seen) ||
    isTransientRpcError(error.info?.error, seen)
  ) return true;
  return Array.isArray(error.errors)
    && error.errors.some((nestedError) => isTransientRpcError(nestedError, seen));
}

function localSigner() {
  const phrase = process.env.BSC_SIGNER_MNEMONIC || '';
  if (!phrase.trim()) throw new Error('BSC_SIGNER_MNEMONIC doit rester configuré uniquement sur la machine DAE qui exécute ce signataire.');
  const master = HDNodeWallet.fromPhrase(phrase, '', config.bsc.masterDerivationPath);
  const gas = HDNodeWallet.fromPhrase(phrase, '', config.bsc.gasDerivationPath);
  if (!config.bsc.masterAddress || getAddress(master.address) !== getAddress(config.bsc.masterAddress)) {
    throw new Error('Le chemin de dérivation maître ne correspond pas à BSC_MASTER_ADDRESS.');
  }
  if (!config.bsc.gasAddress || getAddress(gas.address) !== getAddress(config.bsc.gasAddress)) {
    throw new Error('Le chemin de dérivation gaz ne correspond pas à BSC_GAS_ADDRESS.');
  }
  return { master, gas };
}

async function finishWithdrawal(job) {
  const withdrawal = await Withdrawal.findById(job.withdrawalId).lean();
  if (!withdrawal || withdrawal.status === 'completed') return;
  await postLedgerTransaction({
    type: 'withdrawal',
    idempotencyKey: `bsc-withdrawal-settle:${withdrawal.idempotencyKey}`,
    sourceRef: String(withdrawal._id),
    createdBy: 'bsc-local-signer',
    postings: [
      { accountRef: `customer:${withdrawal.customerId}:reserved`, asset: 'USDT', network: 'BEP20', decimals: DECIMALS, side: 'debit', amountAtomic: withdrawal.amountAtomic },
      { accountRef: 'system:bsc-custody', asset: 'USDT', network: 'BEP20', decimals: DECIMALS, side: 'credit', amountAtomic: withdrawal.amountAtomic },
    ],
  });
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const updated = await Withdrawal.updateOne(
        { _id: withdrawal._id, status: { $in: ['queued', 'broadcast'] } },
        { $set: { status: 'completed', txHash: job.txHash } },
        { session },
      );
      if (updated.modifiedCount !== 1) return;
      const customer = await Customer.findById(withdrawal.customerId).select('email').session(session).lean();
      if (!customer?.email) throw new Error('E-mail client introuvable pour notifier le retrait terminé.');
      await enqueueEmail({
        dedupeKey: `withdrawal:${withdrawal._id}:completed`,
        ...withdrawalEmail({
          email: customer.email,
          amount: formatUnits(withdrawal.amountAtomic, withdrawal.decimals),
          asset: withdrawal.asset,
          status: 'completed',
          reference: job.txHash,
        }),
      }, { session });
    });
  } finally {
    await session.endSession();
  }
}

async function failWithdrawal(job, message) {
  if (!job.withdrawalId) return;
  const withdrawal = await Withdrawal.findById(job.withdrawalId).lean();
  if (!withdrawal || ['failed', 'rejected', 'cancelled', 'completed'].includes(withdrawal.status)) return;
  await postLedgerTransaction({
    type: 'withdrawal', idempotencyKey: `bsc-withdrawal-release:${withdrawal.idempotencyKey}`,
    sourceRef: String(withdrawal._id), createdBy: 'bsc-local-signer',
    postings: [
      { accountRef: `customer:${withdrawal.customerId}:reserved`, asset: 'USDT', network: 'BEP20', decimals: DECIMALS, side: 'debit', amountAtomic: withdrawal.amountAtomic },
      { accountRef: `customer:${withdrawal.customerId}:available`, asset: 'USDT', network: 'BEP20', decimals: DECIMALS, side: 'credit', amountAtomic: withdrawal.amountAtomic },
    ],
  });
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const updated = await Withdrawal.updateOne(
        { _id: withdrawal._id, status: { $nin: ['completed', 'failed'] } },
        { $set: { status: 'failed', reviewNote: String(message).slice(0, 500) } },
        { session },
      );
      if (updated.modifiedCount !== 1) return;
      const customer = await Customer.findById(withdrawal.customerId).select('email').session(session).lean();
      if (!customer?.email) throw new Error('E-mail client introuvable pour notifier le retrait échoué.');
      await enqueueEmail({
        dedupeKey: `withdrawal:${withdrawal._id}:failed`,
        ...withdrawalEmail({
          email: customer.email,
          amount: formatUnits(withdrawal.amountAtomic, withdrawal.decimals),
          asset: withdrawal.asset,
          status: 'failed',
          reference: String(withdrawal._id),
          explanation: String(message).slice(0, 300),
        }),
      }, { session });
    });
  } finally {
    await session.endSession();
  }
}

async function finalizeFailedJob(job) {
  if (job.kind === 'withdrawal') {
    await failWithdrawal(job, job.errorCode || 'SIGNER_ERROR');
  }
  await BscTransferJob.updateOne({ _id: job._id, status: 'failing' }, {
    $set: { status: 'failed', processedAt: new Date() },
  });
  await updateCollectionStatus(job.collectionRunId);
}

async function updateCollectionStatus(collectionRunId) {
  if (!collectionRunId) return;
  const pending = await BscTransferJob.countDocuments({ collectionRunId, status: { $nin: ['completed', 'failed'] } });
  if (pending) return;
  const failed = await BscTransferJob.countDocuments({ collectionRunId, status: 'failed' });
  await BscCollectionRun.updateOne({ _id: collectionRunId }, { $set: { status: failed ? 'partial' : 'completed' } });
}

async function validateSignedTransaction(job, rawTransaction, signers, token) {
  const parsed = Transaction.from(rawTransaction);
  if (!parsed.from || parsed.chainId !== 56n || parsed.nonce !== job.signingNonce) {
    throw new Error('La transaction signée ne correspond pas au réseau ou au nonce journalisé.');
  }
  if (parsed.from.toLowerCase() !== job.signingAddress || keccak256(rawTransaction).toLowerCase() !== job.txHash.toLowerCase()) {
    throw new Error('La signature ou le hash ne correspond pas au journal local.');
  }
  if (job.signedPurpose === 'gas_topup') {
    const expectedGasAddress = signers.gas.address.toLowerCase();
    let expectedRecipient = config.bsc.masterAddress.toLowerCase();
    if (job.kind === 'sweep') {
      const wallet = await WalletModel.findById(job.walletId).select('address').lean();
      if (!wallet) throw new Error('Adresse du portefeuille de collecte introuvable.');
      expectedRecipient = wallet.address.toLowerCase();
    }
    if (
      parsed.from.toLowerCase() !== expectedGasAddress ||
      parsed.to?.toLowerCase() !== expectedRecipient ||
      parsed.data !== '0x' ||
      parsed.value.toString() !== job.signedValueAtomic
    ) throw new Error('La transaction de financement gaz ne correspond pas au transfert attendu.');
    return parsed;
  }
  if (job.signedPurpose !== 'token_transfer' || parsed.from.toLowerCase() !== job.signingAddress) {
    throw new Error('Type de transaction signée invalide.');
  }
  const expectedSender = job.kind === 'withdrawal'
    ? config.bsc.masterAddress.toLowerCase()
    : (await WalletModel.findById(job.walletId).select('address').lean())?.address?.toLowerCase();
  if (!expectedSender || parsed.from.toLowerCase() !== expectedSender || parsed.to?.toLowerCase() !== config.bsc.usdtContract.toLowerCase()) {
    throw new Error('Expéditeur ou contrat de jeton inattendu dans la transaction signée.');
  }
  const decoded = token.interface.parseTransaction({ data: parsed.data, value: parsed.value });
  if (!matchesTokenTransfer(decoded, job.destination, job.signedTokenAmountAtomic)) {
    throw new Error('Destination ou montant signé différent de l’ordre en file.');
  }
  return parsed;
}

function canRequeueUnfundedGasTopUp({ job, error, transactionFound, balance, pendingNonce, parsed }) {
  const message = String(error?.shortMessage || error?.message || '');
  const isInsufficientFunds = error?.code === 'INSUFFICIENT_FUNDS' || /insufficient funds/i.test(message);
  const feePerGas = parsed.maxFeePerGas ?? parsed.gasPrice;
  if (
    job.signedPurpose !== 'gas_topup' ||
    transactionFound ||
    !isInsufficientFunds ||
    feePerGas == null ||
    pendingNonce > parsed.nonce
  ) return false;
  return balance < parsed.value + parsed.gasLimit * feePerGas;
}

async function requeueUnfundedGasTopUp(job, parsed, error, signers, provider) {
  const [balance, pendingNonce] = await Promise.all([
    provider.getBalance(parsed.from),
    provider.getTransactionCount(parsed.from, 'pending'),
  ]);
  if (!canRequeueUnfundedGasTopUp({ job, error, transactionFound: false, balance, pendingNonce, parsed })) return false;

  const result = await BscTransferJob.updateOne({ _id: job._id, status: 'signed', txHash: job.txHash }, {
    $set: { status: 'queued', errorCode: null },
    $unset: {
      txHash: 1,
      signedPurpose: 1,
      signingAddress: 1,
      signingNonce: 1,
      signedValueAtomic: 1,
      signedTokenAmountAtomic: 1,
      signedRawTransaction: 1,
    },
  });
  if (result.modifiedCount !== 1) return false;
  logger.warn({
    jobId: String(job._id),
    signer: signers.gas.address,
    previousNonce: parsed.nonce,
    balanceWei: balance.toString(),
  }, 'Top-up BNB signé trop élevé pour le solde disponible; nouvelle signature en attente');
  return true;
}

async function broadcastSignedTransaction(job, signers, provider, token) {
  const raw = decryptSignedTransaction(job.signedRawTransaction);
  const parsed = await validateSignedTransaction(job, raw, signers, token);
  const knownReceipt = await provider.getTransactionReceipt(job.txHash);
  const knownTransaction = knownReceipt || await provider.getTransaction(job.txHash);
  if (!knownTransaction) {
    try {
      await provider.broadcastTransaction(raw);
    } catch (error) {
      const transactionAfterError = await provider.getTransaction(job.txHash).catch(() => null);
      if (!transactionAfterError && await requeueUnfundedGasTopUp(job, parsed, error, signers, provider)) return;
      if (!transactionAfterError && !/already known|known transaction/i.test(String(error.message || ''))) throw error;
    }
  }
  await BscTransferJob.updateOne({ _id: job._id, status: 'signed', txHash: job.txHash }, {
    $set: { status: 'broadcast', signingAddress: parsed.from.toLowerCase() },
    $unset: { signedRawTransaction: 1 },
    $inc: { attempts: 1 },
  });
  if (job.kind === 'withdrawal' && job.signedPurpose === 'token_transfer') {
    await Withdrawal.updateOne({ _id: job.withdrawalId, status: { $in: ['queued', 'broadcast'] } }, { $set: { status: 'broadcast', txHash: job.txHash } });
  }
}

async function signAndJournalTransaction(job, signer, signers, provider, token, request, purpose, tokenAmountAtomic = null) {
  const nonce = await provider.getTransactionCount(signer.address, 'pending');
  const populated = await signer.populateTransaction({ ...request, nonce });
  const raw = await signer.signTransaction(populated);
  const signed = Transaction.from(raw);
  const txHash = keccak256(raw);
  const journalEntry = {
    ...job.toObject(),
    txHash,
    signedPurpose: purpose,
    signingAddress: signer.address.toLowerCase(),
    signingNonce: nonce,
    signedValueAtomic: signed.value.toString(),
    signedTokenAmountAtomic: tokenAmountAtomic,
  };
  await validateSignedTransaction(journalEntry, raw, signers, token);
  const encryptedRaw = encryptSignedTransaction(raw);
  const result = await BscTransferJob.updateOne({ _id: job._id, status: 'processing' }, {
    $set: {
      status: 'signed',
      txHash,
      signedPurpose: purpose,
      signingAddress: signer.address.toLowerCase(),
      signingNonce: nonce,
      signedValueAtomic: signed.value.toString(),
      signedTokenAmountAtomic: tokenAmountAtomic,
      signedRawTransaction: encryptedRaw,
    },
  });
  if (result.modifiedCount !== 1) throw new Error('Le job de transfert a changé avant l’enregistrement de la signature.');
  const signedJob = await BscTransferJob.findById(job._id).select('+signedRawTransaction');
  await broadcastSignedTransaction(signedJob, { gas: signers.gas, master: signers.master }, provider, token);
}

async function finalizePreparedWithdrawal(job) {
  const withdrawal = await Withdrawal.findById(job.withdrawalId).lean();
  if (!withdrawal || !['requested', 'queued'].includes(withdrawal.status)) {
    const error = new Error('Demande de retrait absente ou dans un état incompatible.');
    error.code = 'WITHDRAWAL_STATE_INVALID';
    throw error;
  }
  const customer = await Customer.findOne({
    _id: withdrawal.customerId, status: 'active', kycStatus: 'approved',
    emailVerifiedAt: { $ne: null },
  }).select('_id').lean();
  if (!customer) {
    await BscTransferJob.updateOne({ _id: job._id, status: 'preparing' }, { $set: { status: 'failed', errorCode: 'CUSTOMER_NOT_ELIGIBLE' } });
    await Withdrawal.updateOne({ _id: withdrawal._id, status: 'requested' }, { $set: { status: 'failed', reviewNote: 'Le compte n’est plus actif ou approuvé KYC.' } });
    return;
  }
  const ledger = await reserveBscWithdrawal(withdrawal);
  await Promise.all([
    BscTransferJob.updateOne({ _id: job._id, status: { $in: ['preparing', 'prepared'] } }, { $set: { status: 'queued' } }),
    Withdrawal.updateOne({ _id: withdrawal._id, status: { $in: ['requested', 'queued'] } }, { $set: { status: 'queued', ledgerReference: ledger.transaction.reference } }),
  ]);
}

async function processJob(job, signers, provider, token) {
  if (job.status === 'signed' && job.signedRawTransaction) {
    await broadcastSignedTransaction(job, signers, provider, token);
    return;
  }
  if (job.status === 'broadcast' && job.txHash) {
    const receipt = await provider.getTransactionReceipt(job.txHash);
    if (!receipt) return;
    if (receipt.status !== 1) {
      const failing = await BscTransferJob.updateOne({ _id: job._id, status: 'broadcast' }, { $set: { status: 'failing', errorCode: 'CHAIN_REVERTED' } });
      if (failing.modifiedCount) await finalizeFailedJob({ ...job.toObject(), errorCode: 'Transaction BSC échouée on-chain.' });
      return;
    }
    if (await provider.getBlockNumber() < receipt.blockNumber + config.bsc.confirmations - 1) return;
    if (job.signedPurpose === 'gas_topup') {
      await BscTransferJob.updateOne({ _id: job._id, status: 'broadcast' }, {
        $set: { status: 'queued' },
        $unset: { txHash: 1, signedPurpose: 1, signingAddress: 1, signingNonce: 1, signedValueAtomic: 1, signedTokenAmountAtomic: 1 },
      });
      return;
    }
    if (job.kind === 'withdrawal') await finishWithdrawal(job);
    await BscTransferJob.updateOne({ _id: job._id, status: 'broadcast' }, { $set: { status: 'completed', processedAt: new Date() } });
    await updateCollectionStatus(job.collectionRunId);
    return;
  }

  let signer = signers.master;
  let destination = job.destination;
  let amount = job.amountAtomic ? BigInt(job.amountAtomic) : 0n;
  if (job.kind === 'sweep') {
    const wallet = await WalletModel.findById(job.walletId).select('accountIndex address status customerId').lean();
    if (!wallet || wallet.status !== 'active') throw new Error('Portefeuille client introuvable ou suspendu.');
    const customer = await Customer.findOne({ _id: wallet.customerId, status: 'active', kycStatus: 'approved' }).select('_id').lean();
    if (!customer) throw new Error('Le compte client n’est plus actif et approuvé KYC.');
    signer = HDNodeWallet.fromPhrase(process.env.BSC_SIGNER_MNEMONIC, '', `${process.env.BSC_CUSTOMER_DERIVATION_PATH || "m/44'/60'/0'/0"}/${wallet.accountIndex}`).connect(provider);
    if (getAddress(signer.address) !== getAddress(wallet.address)) throw new Error('L’adresse dérivée ne correspond pas au portefeuille enregistré.');
    destination = config.bsc.masterAddress;
    amount = await token.balanceOf(wallet.address);
    if (!amount) {
      await BscTransferJob.updateOne({ _id: job._id }, { $set: { status: 'completed', processedAt: new Date() } });
      await updateCollectionStatus(job.collectionRunId);
      return;
    }
    const minimumGas = parseEther(config.bsc.gasTopUpBnb);
    const gasBalance = await provider.getBalance(wallet.address);
    if (gasBalance < minimumGas) {
      await signAndJournalTransaction(job, signers.gas, signers, provider, token, {
        to: wallet.address,
        value: minimumGas - gasBalance,
      }, 'gas_topup');
      return;
    }
  }
  if (job.kind === 'withdrawal') {
    const withdrawal = await Withdrawal.findById(job.withdrawalId).select('customerId').lean();
    const customer = withdrawal && await Customer.findOne({ _id: withdrawal.customerId, status: 'active', kycStatus: 'approved', emailVerifiedAt: { $ne: null } }).select('_id').lean();
    if (!customer) throw new Error('Le compte n’est plus actif ou approuvé au moment du retrait.');
    const minimumGas = parseEther(config.bsc.gasTopUpBnb);
    const masterGasBalance = await provider.getBalance(signers.master.address);
    if (masterGasBalance < minimumGas) {
      await signAndJournalTransaction(job, signers.gas, signers, provider, token, {
        to: signers.master.address,
        value: minimumGas - masterGasBalance,
      }, 'gas_topup');
      return;
    }
  }
  const data = token.interface.encodeFunctionData('transfer', [destination, amount]);
  await signAndJournalTransaction(job, signer, signers, provider, token, {
    to: config.bsc.usdtContract,
    data,
    value: 0n,
  }, 'token_transfer', amount.toString());
}

async function main() {
  await connectDB();
  if (Number(config.bsc.chainId) !== 56) throw new Error('Le signataire est réservé au réseau BNB Smart Chain mainnet.');
  if (config.bsc.usdtContract.toLowerCase() !== BSC_PEG_USD_CONTRACT) throw new Error('Contrat BSC-USD inattendu; signature refusée.');
  const signers = localSigner();
  const provider = getProvider();
  if (Number((await provider.getNetwork()).chainId) !== 56) throw new Error('Le RPC du signataire ne pointe pas vers BNB Smart Chain.');
  const token = new Contract(config.bsc.usdtContract, TOKEN_ABI, provider);
  if (Number(await token.decimals()) !== DECIMALS) throw new Error('Le contrat configuré n’est pas le jeton BEP-20 attendu à 18 décimales.');
  signers.master = signers.master.connect(provider);
  signers.gas = signers.gas.connect(provider);
  logger.info({ chainId: 56, master: signers.master.address, gasWallet: signers.gas.address }, 'Signataire BSC local démarré');
  const heartbeat = () => BscSignerHeartbeat.updateOne({ name: 'local-bsc-signer' }, { $set: {
    lastSeenAt: new Date(), chainId: 56,
    masterAddress: signers.master.address.toLowerCase(),
    gasAddress: signers.gas.address.toLowerCase(),
  } }, { upsert: true }).catch((error) => logger.error({ err: error }, 'Heartbeat du signataire indisponible'));
  await heartbeat();
  setInterval(heartbeat, 10_000);

  while (true) {
    await BscTransferJob.updateMany(
      { status: 'preparing', updatedAt: { $lt: new Date(Date.now() - 60_000) } },
      { $set: { status: 'prepared' } },
    );
    const preparedJob = await BscTransferJob.findOneAndUpdate(
      { kind: 'withdrawal', status: 'prepared' },
      { $set: { status: 'preparing' } },
      { sort: { createdAt: 1 }, new: true },
    );
    if (preparedJob) {
      try {
        await finalizePreparedWithdrawal(preparedJob);
      } catch (error) {
        logger.error({ jobId: String(preparedJob._id), err: error }, 'Préparation de retrait BSC en attente');
        if (error.code === 'ERR_LEDGER_INSUFFICIENT_FUNDS' || error.code === 'WITHDRAWAL_STATE_INVALID') {
          await BscTransferJob.updateOne({ _id: preparedJob._id, status: 'preparing' }, { $set: { status: 'failed', errorCode: String(error.code).slice(0, 80) } });
          await Withdrawal.updateOne({ _id: preparedJob.withdrawalId, status: 'requested' }, { $set: { status: 'failed', reviewNote: String(error.message).slice(0, 500) } });
        } else {
          await BscTransferJob.updateOne({ _id: preparedJob._id, status: 'preparing' }, { $set: { status: 'prepared' } });
        }
      }
    }
    const broadcasts = await BscTransferJob.find({ status: 'broadcast' }).sort({ updatedAt: 1 }).limit(50);
    for (const job of broadcasts) {
      try { await processJob(job, signers, provider, token); }
      catch (error) { logger.error({ jobId: String(job._id), err: error }, 'Rapprochement de transaction BSC impossible'); }
    }
    const signedJobs = await BscTransferJob.find({ status: 'signed' }).select('+signedRawTransaction').sort({ updatedAt: 1 }).limit(50);
    for (const signedJob of signedJobs) {
      try { await processJob(signedJob, signers, provider, token); }
      catch (error) { logger.error({ jobId: String(signedJob._id), err: error }, 'Reprise de transaction signée BSC en attente'); }
    }
    const failingJobs = await BscTransferJob.find({ status: 'failing' }).sort({ updatedAt: 1 }).limit(50);
    for (const failingJob of failingJobs) {
      try { await finalizeFailedJob(failingJob); }
      catch (error) { logger.error({ jobId: String(failingJob._id), err: error }, 'Libération du retrait échoué en attente'); }
    }
    const job = await BscTransferJob.findOneAndUpdate(
      { status: 'queued' },
      { $set: { status: 'processing' }, $inc: { attempts: 1 } },
      { sort: { createdAt: 1 }, new: true },
    );
    if (job) {
      try { await processJob(job, signers, provider, token); }
      catch (error) {
        logger.error({ jobId: String(job._id), err: error }, 'Transfert BSC échoué');
        if (isTransientRpcError(error)) {
          const requeued = await BscTransferJob.updateOne(
            { _id: job._id, status: 'processing' },
            { $set: { status: 'queued', errorCode: null } },
          );
          if (requeued.modifiedCount === 1) {
            logger.warn({ jobId: String(job._id), code: error.code }, 'Erreur RPC temporaire; job remis en file sans échouer le retrait');
            await new Promise((resolve) => setTimeout(resolve, config.bsc.scanIntervalMs));
            continue;
          }
        }
        const errorMessage = error.message || error.code || 'SIGNER_ERROR';
        const failing = await BscTransferJob.updateOne({ _id: job._id, status: 'processing' }, {
          $set: { status: 'failing', errorCode: String(errorMessage).slice(0, 80) },
        });
        if (failing.modifiedCount) {
          try { await finalizeFailedJob({ ...job.toObject(), errorCode: errorMessage }); }
          catch (settlementError) { logger.error({ jobId: String(job._id), err: settlementError }, 'Finalisation de l’échec BSC en attente'); }
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, job ? 1000 : 5000));
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.fatal({ err: error }, 'Signataire BSC local arrêté');
    process.exitCode = 1;
  }).finally(async () => {
    if (process.exitCode) await mongoose.disconnect();
  });
}

module.exports = {
  canRequeueUnfundedGasTopUp,
  isTransientRpcError,
  localSigner,
  matchesTokenTransfer,
  processJob,
};
