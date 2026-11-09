'use strict';

const mongoose = require('mongoose');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.signer') });
const { Contract, HDNodeWallet, parseEther, getAddress } = require('ethers');
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

const TOKEN_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];
const DECIMALS = 18;

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
  await Withdrawal.updateOne({ _id: withdrawal._id }, { $set: { status: 'completed', txHash: job.txHash } });
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
  await Withdrawal.updateOne({ _id: withdrawal._id, status: { $nin: ['completed', 'failed'] } }, { $set: { status: 'failed', reviewNote: String(message).slice(0, 500) } });
}

async function updateCollectionStatus(collectionRunId) {
  if (!collectionRunId) return;
  const pending = await BscTransferJob.countDocuments({ collectionRunId, status: { $nin: ['completed', 'failed'] } });
  if (pending) return;
  const failed = await BscTransferJob.countDocuments({ collectionRunId, status: 'failed' });
  await BscCollectionRun.updateOne({ _id: collectionRunId }, { $set: { status: failed ? 'partial' : 'completed' } });
}

async function processJob(job, signers, provider, token) {
  if (job.status === 'broadcast' && job.txHash) {
    const receipt = await provider.getTransactionReceipt(job.txHash);
    if (!receipt) return;
    if (receipt.status !== 1) {
      await BscTransferJob.updateOne({ _id: job._id }, { $set: { status: 'failed', errorCode: 'CHAIN_REVERTED', processedAt: new Date() } });
      await failWithdrawal(job, 'Transaction BSC échouée on-chain.');
      await updateCollectionStatus(job.collectionRunId);
      return;
    }
    if (await provider.getBlockNumber() < receipt.blockNumber + config.bsc.confirmations - 1) return;
    await BscTransferJob.updateOne({ _id: job._id }, { $set: { status: 'completed', processedAt: new Date() } });
    if (job.kind === 'withdrawal') await finishWithdrawal(job);
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
      const topUp = signers.gas.sendTransaction({ to: wallet.address, value: minimumGas - gasBalance });
      await (await topUp).wait(config.bsc.confirmations);
    }
  }
  if (job.kind === 'withdrawal') {
    const withdrawal = await Withdrawal.findById(job.withdrawalId).select('customerId').lean();
    const customer = withdrawal && await Customer.findOne({ _id: withdrawal.customerId, status: 'active', kycStatus: 'approved', emailVerifiedAt: { $ne: null }, phoneVerifiedAt: { $ne: null } }).select('_id').lean();
    if (!customer) throw new Error('Le compte n’est plus actif ou approuvé au moment du retrait.');
    const minimumGas = parseEther(config.bsc.gasTopUpBnb);
    const masterGasBalance = await provider.getBalance(signers.master.address);
    if (masterGasBalance < minimumGas) {
      const topUp = await signers.gas.sendTransaction({ to: signers.master.address, value: minimumGas - masterGasBalance });
      await topUp.wait(config.bsc.confirmations);
    }
  }
  const tx = await token.connect(signer).transfer(destination, amount);
  await BscTransferJob.updateOne({ _id: job._id }, { $set: { status: 'broadcast', txHash: tx.hash }, $inc: { attempts: 1 } });
  if (job.kind === 'withdrawal') await Withdrawal.updateOne({ _id: job.withdrawalId }, { $set: { status: 'broadcast', txHash: tx.hash } });
  const receipt = await tx.wait(config.bsc.confirmations);
  if (receipt.status !== 1) throw new Error('Transaction BSC échouée on-chain.');
  await BscTransferJob.updateOne({ _id: job._id }, { $set: { status: 'completed', processedAt: new Date() } });
  if (job.kind === 'withdrawal') await finishWithdrawal({ ...job.toObject(), txHash: tx.hash });
  await updateCollectionStatus(job.collectionRunId);
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
    const broadcasts = await BscTransferJob.find({ status: 'broadcast' }).sort({ updatedAt: 1 }).limit(50);
    for (const job of broadcasts) {
      try { await processJob(job, signers, provider, token); }
      catch (error) { logger.error({ jobId: String(job._id), err: error }, 'Rapprochement de transaction BSC impossible'); }
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
        const failed = await BscTransferJob.updateOne({ _id: job._id, status: 'processing' }, { $set: { status: 'failed', errorCode: String(error.code || 'SIGNER_ERROR').slice(0, 80) } });
        if (failed.modifiedCount) await failWithdrawal(job, error.message || error.code || 'SIGNER_ERROR');
        await updateCollectionStatus(job.collectionRunId);
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

module.exports = { localSigner, processJob };
