'use strict';

const crypto = require('node:crypto');
const mongoose = require('mongoose');
const EarnAction = require('../models/EarnAction');
const EarnAllocation = require('../models/EarnAllocation');
const EarnAuditLog = require('../models/EarnAuditLog');
const EarnConfig = require('../models/EarnConfig');
const StakePosition = require('../models/StakePosition');
const { getProvider } = require('./bsc');
const { supportsMultiDocumentTransactions } = require('./mongoCapabilities');
const {
  customerLedgerAccountRef,
  getLedgerBalanceAtomic,
  postLedgerTransaction,
} = require('./ledger');
const { splitRealizedYield } = require('./earnRewards');
const {
  verifyProtocolAllocationReceipt,
  verifyProtocolRedemptionReceipt,
  getTreasuryUsdtSnapshot,
  verifyTreasuryFundingReceipt,
} = require('./earnTreasury');

const TERMS_VERSION = 'DAE_EARN_V1';

function requireMongoTransactions() {
  if (supportsMultiDocumentTransactions(mongoose.connection)) return;
  const error = new Error('Les opérations DAE Earn exigent MongoDB avec transactions multi-documents.');
  error.code = 'ERR_EARN_TRANSACTIONS_REQUIRED';
  error.status = 503;
  throw error;
}

function actionReason(value) {
  const reason = String(value || '').trim();
  if (reason.length < 8 || reason.length > 300) throw new TypeError('Le motif doit contenir entre 8 et 300 caractères.');
  return reason;
}

function atomicAmount(value, label) {
  const amount = String(value ?? '');
  if (!/^[1-9][0-9]{0,77}$/.test(amount)) throw new TypeError(`${label} invalide.`);
  return amount;
}

async function assertTreasuryCash(expectedAtomic, session) {
  const signedLedgerCash = BigInt(await getLedgerBalanceAtomic({
    accountRef: 'system:earn:treasury-cash',
    asset: 'USDT',
    network: 'BEP20',
  }, { session }));
  const ledgerCash = -signedLedgerCash;
  const snapshot = await getTreasuryUsdtSnapshot(getProvider());
  if (ledgerCash < 0n || snapshot.balanceAtomic !== expectedAtomic) {
    const error = new Error('Le solde on-chain et le cash du ledger Earn ne concordent pas après l’opération.');
    error.code = 'ERR_EARN_TREASURY_RECONCILIATION';
    throw error;
  }
  return snapshot;
}

async function createEarnPosition({ customer, productId, amountAtomic, idempotencyKey, acceptedTermsVersion }) {
  requireMongoTransactions();
  const configRecord = await EarnConfig.findOne({ key: 'main' }).lean();
  if (!configRecord?.subscriptionsEnabled) {
    const error = new Error('Les souscriptions DAE Earn sont temporairement fermées.');
    error.code = 'ERR_EARN_SUBSCRIPTIONS_DISABLED';
    throw error;
  }
  if (
    customer.status !== 'active' ||
    !customer.emailVerifiedAt ||
    customer.kycStatus !== 'approved'
  ) {
    const error = new Error('Un compte actif, vérifié et avec KYC approuvé est requis.');
    error.code = 'ERR_EARN_ACCOUNT_NOT_ELIGIBLE';
    throw error;
  }
  if (acceptedTermsVersion !== TERMS_VERSION) {
    const error = new Error('Les conditions DAE Earn doivent être consultées et acceptées.');
    error.code = 'ERR_EARN_TERMS_REQUIRED';
    throw error;
  }
  if (!/^[0-9a-f-]{36}$/i.test(String(idempotencyKey || ''))) {
    const error = new Error('Clé d’idempotence UUID requise.');
    error.code = 'ERR_EARN_IDEMPOTENCY_REQUIRED';
    throw error;
  }
  const amount = atomicAmount(amountAtomic, 'Montant');
  const product = configRecord.products.find((item) => item.productId === productId && item.published);
  if (!product) {
    const error = new Error('Produit DAE Earn indisponible.');
    error.code = 'ERR_EARN_PRODUCT_UNAVAILABLE';
    throw error;
  }
  if (BigInt(amount) < BigInt(product.minimumAmountAtomic)) {
    const error = new Error('Le montant est inférieur au minimum de ce produit.');
    error.code = 'ERR_EARN_BELOW_MINIMUM';
    throw error;
  }
  const requestHash = crypto.createHash('sha256').update(JSON.stringify({
    customerId: String(customer._id),
    productId,
    amountAtomic: amount,
    configVersion: configRecord.configVersion,
    acceptedTermsVersion,
  })).digest('hex');
  const existing = await StakePosition.findOne({ idempotencyKey }).lean();
  if (existing) {
    if (existing.requestHash !== requestHash || String(existing.customerId) !== String(customer._id)) {
      const error = new Error('Cette clé a déjà servi à créer une souscription différente.');
      error.code = 'ERR_EARN_IDEMPOTENCY_CONFLICT';
      throw error;
    }
    return { position: existing, duplicate: true };
  }

  const session = await mongoose.startSession();
  let position;
  try {
    await session.withTransaction(async () => {
      const [created] = await StakePosition.create([{
        customerId: customer._id,
        productId: product.productId,
        asset: 'USDT',
        network: 'BEP20',
        decimals: 18,
        amountAtomic: amount,
        idempotencyKey,
        requestHash,
        configVersion: configRecord.configVersion,
        termsAcceptedAt: new Date(),
        termsVersion: acceptedTermsVersion,
        rewardRateBps: product.apyBps,
        creditedRewardsPenaltyBps: configRecord.earlyWithdrawal.creditedRewardsPenaltyBps,
        lockDays: product.durationDays,
        status: 'PENDING_ALLOCATION',
      }], { session });
      const ledger = await postLedgerTransaction({
        type: 'staking_lock',
        idempotencyKey: `earn-lock:${idempotencyKey}`,
        sourceRef: String(created._id),
        createdBy: `customer:${customer._id}`,
        metadata: { productId, configVersion: configRecord.configVersion, termsVersion: TERMS_VERSION },
        postings: [
          {
            accountRef: customerLedgerAccountRef(customer._id, 'available'),
            asset: 'USDT', network: 'BEP20', decimals: 18, side: 'debit', amountAtomic: amount,
          },
          {
            accountRef: customerLedgerAccountRef(customer._id, 'staked'),
            asset: 'USDT', network: 'BEP20', decimals: 18, side: 'credit', amountAtomic: amount,
          },
        ],
      }, { session });
      created.ledgerReference = ledger.transaction.reference;
      position = await created.save({ session });
      await EarnAuditLog.create([{
        actor: `customer:${customer._id}`,
        action: 'position_subscribed_and_locked',
        positionId: created._id,
        amountAtomic: amount,
        details: { productId, configVersion: configRecord.configVersion, termsVersion: TERMS_VERSION },
      }], { session });
    });
    return { position, duplicate: false };
  } catch (error) {
    if (error.code === 11000) {
      const duplicate = await StakePosition.findOne({ idempotencyKey }).lean();
      if (duplicate?.requestHash === requestHash && String(duplicate.customerId) === String(customer._id)) {
        return { position: duplicate, duplicate: true };
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

async function requestEarnWithdrawal({ positionId, customerId, acceptEarlyPenalty }) {
  requireMongoTransactions();
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const position = await StakePosition.findOne({
        _id: positionId,
        customerId,
        status: { $in: ['PENDING_ALLOCATION', 'ACTIVE', 'MATURED'] },
      }).session(session);
      if (!position) {
        result = { error: 'Placement introuvable ou retrait déjà demandé.', status: 404 };
        return;
      }
      const now = new Date();
      const early = position.maturesAt && position.maturesAt > now;
      const penaltyAtomic = early
        ? (BigInt(position.totalRewardsPaidAtomic || '0') * BigInt(position.creditedRewardsPenaltyBps || 0) / 10_000n).toString()
        : '0';
      if (early && penaltyAtomic !== '0' && acceptEarlyPenalty !== true) {
        result = {
          error: 'Confirmez explicitement la pénalité affichée avant de demander le retrait.',
          status: 409,
          penaltyAtomic,
          penaltyBps: position.creditedRewardsPenaltyBps,
        };
        return;
      }
      position.status = 'WITHDRAWAL_PENDING';
      position.withdrawalPenaltyAtomic = penaltyAtomic;
      position.withdrawalRequestedAt = now;
      await position.save({ session });
      await EarnAuditLog.create([{
        actor: `customer:${customerId}`,
        action: 'withdrawal_requested',
        positionId: position._id,
        amountAtomic: position.amountAtomic,
        details: { early: Boolean(early), penaltyAtomic, penaltyBps: position.creditedRewardsPenaltyBps },
      }], { session });
      result = { position: position.toObject(), penaltyAtomic, penaltyBps: position.creditedRewardsPenaltyBps };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function proposeEarnAction({ type, actor, reason, positionId, allocationId, protocol, txHash }) {
  requireMongoTransactions();
  const safeReason = actionReason(reason);
  let verified = { blockNumber: 0, grossAmountAtomic: '0', principalAmountAtomic: '0', protocol: null };
  if (type === 'seed_treasury') {
    const snapshot = await getTreasuryUsdtSnapshot(getProvider());
    const currentCash = -BigInt(await getLedgerBalanceAtomic({
      accountRef: 'system:earn:treasury-cash',
      asset: 'USDT',
      network: 'BEP20',
    }));
    const unrecorded = BigInt(snapshot.balanceAtomic) - currentCash;
    if (unrecorded <= 0n) throw Object.assign(new Error('Aucun solde USDT positif non rapproché à initialiser.'), { code: 'ERR_EARN_TREASURY_ALREADY_RECONCILED' });
    verified = {
      ...verified,
      ...snapshot,
      grossAmountAtomic: unrecorded.toString(),
    };
  } else if (type === 'fund_treasury') {
    const receipt = await verifyTreasuryFundingReceipt({ provider: getProvider(), txHash });
    verified = { ...verified, ...receipt, grossAmountAtomic: receipt.amountAtomic };
  } else if (type === 'allocate_position') {
    const position = await StakePosition.findOne({ _id: positionId, status: 'PENDING_ALLOCATION' }).lean();
    if (!position) throw Object.assign(new Error('Placement en attente d’allocation introuvable.'), { code: 'ERR_EARN_POSITION_NOT_PENDING' });
    const configRecord = await EarnConfig.findOne({ key: 'main' }).lean();
    if (!configRecord?.allocationsEnabled) throw Object.assign(new Error('Les allocations DAE Earn sont suspendues.'), { code: 'ERR_EARN_ALLOCATIONS_DISABLED' });
    const receipt = await verifyProtocolAllocationReceipt({
      provider: getProvider(),
      txHash,
      protocol,
      expectedAmountAtomic: position.amountAtomic,
    });
    verified = { ...verified, ...receipt, grossAmountAtomic: receipt.amountAtomic, principalAmountAtomic: receipt.amountAtomic };
  } else if (type === 'redeem_allocation') {
    const allocation = await EarnAllocation.findOne({ _id: allocationId, status: 'active' }).lean();
    if (!allocation) throw Object.assign(new Error('Allocation active introuvable.'), { code: 'ERR_EARN_ALLOCATION_NOT_ACTIVE' });
    const receipt = await verifyProtocolRedemptionReceipt({ provider: getProvider(), txHash, protocol: allocation.protocol });
    const gross = BigInt(receipt.grossAmountAtomic);
    const outstanding = BigInt(allocation.outstandingPrincipalAtomic);
    const principal = gross < outstanding ? gross : outstanding;
    verified = {
      ...verified,
      ...receipt,
      principalAmountAtomic: principal.toString(),
    };
  } else if (type === 'settle_withdrawal') {
    const position = await StakePosition.findOne({ _id: positionId, status: 'WITHDRAWAL_PENDING' }).lean();
    if (!position) throw Object.assign(new Error('Demande de retrait introuvable.'), { code: 'ERR_EARN_WITHDRAWAL_NOT_PENDING' });
    const activeAllocation = await EarnAllocation.exists({ positionId, status: { $ne: 'closed' } });
    if (activeAllocation) throw Object.assign(new Error('Récupérez d’abord le principal du protocole et rapprochez-le avec une preuve confirmée.'), { code: 'ERR_EARN_ALLOCATION_STILL_ACTIVE' });
    verified = { ...verified, grossAmountAtomic: position.amountAtomic, principalAmountAtomic: position.amountAtomic };
  } else {
    throw new TypeError('Action DAE Earn invalide.');
  }

  const session = await mongoose.startSession();
  let action;
  try {
    await session.withTransaction(async () => {
      [action] = await EarnAction.create([{
        type,
        proposerEmail: actor,
        reason: safeReason,
        positionId: positionId || null,
        allocationId: allocationId || null,
        protocol: verified.protocol || protocol || null,
        txHash: verified.txHash || String(txHash || '').toLowerCase() || null,
        blockNumber: verified.blockNumber || 0,
        grossAmountAtomic: verified.grossAmountAtomic || '0',
        principalAmountAtomic: verified.principalAmountAtomic || '0',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }], { session });
      await EarnAuditLog.create([{
        actor,
        action: `${type}_proposed`,
        actionId: action._id,
        positionId: action.positionId,
        allocationId: action.allocationId,
        txHash: action.txHash,
        amountAtomic: action.grossAmountAtomic,
        details: { reason: safeReason, protocol: action.protocol, blockNumber: action.blockNumber },
      }], { session });
    });
    return action;
  } finally {
    await session.endSession();
  }
}

async function applyApprovedEarnAction(action, actor, session) {
  const configRecord = await EarnConfig.findOne({ key: 'main' }).session(session).lean();
  let ledgerReference = null;
  if (action.type === 'seed_treasury') {
    const signedCash = BigInt(await getLedgerBalanceAtomic({
      accountRef: 'system:earn:treasury-cash',
      asset: 'USDT',
      network: 'BEP20',
    }, { session }));
    const currentCash = -signedCash;
    const expected = currentCash + BigInt(action.grossAmountAtomic);
    if (currentCash < 0n) throw new Error('Solde cash ledger négatif.');
    const snapshot = await assertTreasuryCash(expected.toString(), session);
    if (snapshot.blockNumber < action.blockNumber) throw new Error('Le snapshot de trésorerie est antérieur à la proposition.');
    const ledger = await postLedgerTransaction({
      type: 'earn_revenue',
      idempotencyKey: `earn-treasury-seed:${snapshot.blockNumber}:${action._id}`,
      sourceRef: `bsc-treasury-snapshot:${snapshot.blockNumber}`,
      createdBy: actor,
      metadata: { actionId: String(action._id), blockNumber: snapshot.blockNumber, kind: 'opening_treasury_balance' },
      postings: [
        { accountRef: 'system:earn:treasury-cash', asset: 'USDT', network: 'BEP20', decimals: 18, side: 'debit', amountAtomic: action.grossAmountAtomic },
        { accountRef: 'system:earn:capital-contribution', asset: 'USDT', network: 'BEP20', decimals: 18, side: 'credit', amountAtomic: action.grossAmountAtomic },
      ],
    }, { session });
    ledgerReference = ledger.transaction.reference;
  } else if (action.type === 'fund_treasury') {
    const receipt = await verifyTreasuryFundingReceipt({ provider: getProvider(), txHash: action.txHash });
    if (receipt.amountAtomic !== action.grossAmountAtomic) throw new Error('Le reçu de financement a changé depuis la proposition.');
    const currentCash = -BigInt(await getLedgerBalanceAtomic({
      accountRef: 'system:earn:treasury-cash', asset: 'USDT', network: 'BEP20',
    }, { session }));
    await assertTreasuryCash((currentCash + BigInt(receipt.amountAtomic)).toString(), session);
    const ledger = await postLedgerTransaction({
      type: 'earn_revenue',
      idempotencyKey: `earn-treasury-fund:${action.txHash}`,
      sourceRef: action.txHash,
      createdBy: actor,
      metadata: { actionId: String(action._id), blockNumber: receipt.blockNumber, kind: 'treasury_capital' },
      postings: [
        { accountRef: 'system:earn:treasury-cash', asset: 'USDT', network: 'BEP20', decimals: 18, side: 'debit', amountAtomic: receipt.amountAtomic },
        { accountRef: 'system:earn:capital-contribution', asset: 'USDT', network: 'BEP20', decimals: 18, side: 'credit', amountAtomic: receipt.amountAtomic },
      ],
    }, { session });
    ledgerReference = ledger.transaction.reference;
  } else if (action.type === 'allocate_position') {
    if (!configRecord?.allocationsEnabled) throw Object.assign(new Error('Les allocations DAE Earn sont désactivées.'), { code: 'ERR_EARN_ALLOCATIONS_DISABLED' });
    const position = await StakePosition.findOne({
      _id: action.positionId,
      status: 'PENDING_ALLOCATION',
    }).session(session);
    if (!position) throw new Error('Le placement n’est plus en attente d’allocation.');
    const receipt = await verifyProtocolAllocationReceipt({
      provider: getProvider(),
      txHash: action.txHash,
      protocol: action.protocol,
      expectedAmountAtomic: position.amountAtomic,
    });
    if (receipt.amountAtomic !== action.grossAmountAtomic) throw new Error('Le montant alloué diffère de la proposition.');
    const currentCash = -BigInt(await getLedgerBalanceAtomic({
      accountRef: 'system:earn:treasury-cash', asset: 'USDT', network: 'BEP20',
    }, { session }));
    if (currentCash < BigInt(receipt.amountAtomic)) throw new Error('Cash du ledger Earn insuffisant pour l’allocation confirmée.');
    await assertTreasuryCash((currentCash - BigInt(receipt.amountAtomic)).toString(), session);
    const exposures = await EarnAllocation.find({ status: 'active' }).select('protocol outstandingPrincipalAtomic').session(session).lean();
    const totalExposure = exposures.reduce((sum, item) => sum + BigInt(item.outstandingPrincipalAtomic), 0n) + BigInt(receipt.amountAtomic);
    const protocolExposure = exposures
      .filter((item) => item.protocol === action.protocol)
      .reduce((sum, item) => sum + BigInt(item.outstandingPrincipalAtomic), 0n) + BigInt(receipt.amountAtomic);
    const customerPositions = await StakePosition.find({ status: { $in: ['PENDING_ALLOCATION', 'ACTIVE', 'MATURED'] } })
      .select('amountAtomic')
      .session(session)
      .lean();
    const eligible = customerPositions.reduce((sum, item) => sum + BigInt(item.amountAtomic), 0n);
    if (eligible <= 0n) throw new Error('Aucun capital client éligible à l’allocation.');
    if (totalExposure * 10_000n > eligible * BigInt(configRecord?.allocationLimitBps || 0)) {
      throw Object.assign(new Error('La limite globale d’allocation serait dépassée.'), { code: 'ERR_EARN_GLOBAL_ALLOCATION_LIMIT' });
    }
    const limit = BigInt(configRecord?.protocolLimitsBps?.[action.protocol] || 0);
    if (protocolExposure * 10_000n > eligible * limit) {
      throw Object.assign(new Error('La limite du protocole serait dépassée.'), { code: 'ERR_EARN_PROTOCOL_ALLOCATION_LIMIT' });
    }
    const ledger = await postLedgerTransaction({
      type: 'earn_revenue',
      idempotencyKey: `earn-allocation:${action.txHash}`,
      sourceRef: action.txHash,
      createdBy: actor,
      metadata: { actionId: String(action._id), positionId: String(position._id), protocol: action.protocol },
      postings: [
        { accountRef: 'system:earn:deployed-principal', asset: 'USDT', network: 'BEP20', decimals: 18, side: 'debit', amountAtomic: receipt.amountAtomic },
        { accountRef: 'system:earn:treasury-cash', asset: 'USDT', network: 'BEP20', decimals: 18, side: 'credit', amountAtomic: receipt.amountAtomic },
      ],
    }, { session });
    const [allocation] = await EarnAllocation.create([{
      positionId: position._id,
      protocol: action.protocol,
      txHash: action.txHash,
      blockNumber: receipt.blockNumber,
      allocatedAtomic: receipt.amountAtomic,
      outstandingPrincipalAtomic: receipt.amountAtomic,
      activatedBy: actor,
      activationActionId: action._id,
    }], { session });
    const now = new Date();
    const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    position.status = 'ACTIVE';
    position.startsAt = startsAt;
    position.maturesAt = position.lockDays === 0 ? null : new Date(startsAt.getTime() + position.lockDays * 86_400_000);
    position.ledgerReference = ledger.transaction.reference;
    await position.save({ session });
    action.allocationId = allocation._id;
    ledgerReference = ledger.transaction.reference;
  } else if (action.type === 'redeem_allocation') {
    const allocation = await EarnAllocation.findOne({ _id: action.allocationId, status: 'active' }).session(session);
    if (!allocation) throw new Error('L’allocation est déjà clôturée ou suspendue.');
    const receipt = await verifyProtocolRedemptionReceipt({ provider: getProvider(), txHash: action.txHash, protocol: allocation.protocol });
    const gross = BigInt(receipt.grossAmountAtomic);
    const outstanding = BigInt(allocation.outstandingPrincipalAtomic);
    const principal = gross < outstanding ? gross : outstanding;
    if (
      receipt.grossAmountAtomic !== action.grossAmountAtomic ||
      principal.toString() !== action.principalAmountAtomic
    ) {
      throw new Error('La preuve de retrait ou le principal récupéré a changé depuis la proposition.');
    }
    const currentCash = -BigInt(await getLedgerBalanceAtomic({
      accountRef: 'system:earn:treasury-cash', asset: 'USDT', network: 'BEP20',
    }, { session }));
    await assertTreasuryCash((currentCash + gross).toString(), session);
    const realizedYield = gross - principal;
    const revenuePostings = [
      { accountRef: 'system:earn:treasury-cash', asset: 'USDT', network: 'BEP20', decimals: 18, side: 'debit', amountAtomic: gross.toString() },
    ];
    if (principal > 0n) revenuePostings.push({
      accountRef: 'system:earn:deployed-principal', asset: 'USDT', network: 'BEP20', decimals: 18, side: 'credit', amountAtomic: principal.toString(),
    });
    if (realizedYield > 0n) revenuePostings.push({
      accountRef: 'system:earn:realized-income', asset: 'USDT', network: 'BEP20', decimals: 18, side: 'credit', amountAtomic: realizedYield.toString(),
    });
    const receiptLedger = await postLedgerTransaction({
      type: 'earn_revenue',
      idempotencyKey: `earn-redemption:${action.txHash}`,
      sourceRef: action.txHash,
      createdBy: actor,
      metadata: { actionId: String(action._id), allocationId: String(allocation._id), protocol: allocation.protocol, principalReturnedAtomic: principal.toString(), realizedYieldAtomic: realizedYield.toString() },
      postings: revenuePostings,
    }, { session });
    ledgerReference = receiptLedger.transaction.reference;
    if (realizedYield > 0n) {
      const split = splitRealizedYield(realizedYield.toString(), configRecord.revenueSplitBps);
      const splitPostings = [
        { accountRef: 'system:earn:realized-income', asset: 'USDT', network: 'BEP20', decimals: 18, side: 'debit', amountAtomic: realizedYield.toString() },
        { accountRef: 'system:earn:reward-pool', asset: 'USDT', network: 'BEP20', decimals: 18, side: 'credit', amountAtomic: split.userRewardsAtomic },
        { accountRef: 'system:earn:platform-revenue', asset: 'USDT', network: 'BEP20', decimals: 18, side: 'credit', amountAtomic: split.platformAtomic },
        { accountRef: 'system:earn:safety-reserve', asset: 'USDT', network: 'BEP20', decimals: 18, side: 'credit', amountAtomic: split.safetyReserveAtomic },
      ].filter((posting) => posting.amountAtomic !== '0');
      const splitLedger = await postLedgerTransaction({
        type: 'earn_revenue_split',
        idempotencyKey: `earn-revenue-split:${action.txHash}`,
        sourceRef: action.txHash,
        createdBy: actor,
        metadata: { actionId: String(action._id), ...split, realizedYieldAtomic: realizedYield.toString(), splitBps: configRecord.revenueSplitBps },
        postings: splitPostings,
      }, { session });
      ledgerReference = splitLedger.transaction.reference;
    }
    const remaining = BigInt(allocation.outstandingPrincipalAtomic) - principal;
    allocation.outstandingPrincipalAtomic = remaining.toString();
    if (remaining === 0n) allocation.status = 'closed';
    await allocation.save({ session });
  } else if (action.type === 'settle_withdrawal') {
    const position = await StakePosition.findOne({ _id: action.positionId, status: 'WITHDRAWAL_PENDING' }).session(session);
    if (!position) throw new Error('La demande de retrait n’est plus en attente.');
    const activeAllocation = await EarnAllocation.exists({ positionId: position._id, status: { $ne: 'closed' } }).session(session);
    if (activeAllocation) throw new Error('Le principal doit être récupéré et rapproché avant le retrait client.');
    const principal = BigInt(position.amountAtomic);
    const treasuryCash = -BigInt(await getLedgerBalanceAtomic({
      accountRef: 'system:earn:treasury-cash',
      asset: 'USDT',
      network: 'BEP20',
    }, { session }));
    if (treasuryCash < principal) {
      throw Object.assign(new Error('La trésorerie disponible ne couvre pas le capital demandé; le retrait reste en attente.'), {
        code: 'ERR_EARN_WITHDRAWAL_LIQUIDITY',
      });
    }
    await assertTreasuryCash(treasuryCash.toString(), session);
    const penalty = BigInt(position.withdrawalPenaltyAtomic || '0');
    const postings = [
      { accountRef: customerLedgerAccountRef(position.customerId, 'staked'), asset: 'USDT', network: 'BEP20', decimals: 18, side: 'debit', amountAtomic: principal.toString() },
      { accountRef: customerLedgerAccountRef(position.customerId, 'available'), asset: 'USDT', network: 'BEP20', decimals: 18, side: 'credit', amountAtomic: principal.toString() },
    ];
    if (penalty > 0n) {
      const available = BigInt(await getLedgerBalanceAtomic({
        accountRef: customerLedgerAccountRef(position.customerId, 'available'),
        asset: 'USDT',
        network: 'BEP20',
      }, { session }));
      if (available < penalty) {
        throw Object.assign(new Error('Solde disponible insuffisant pour la pénalité acceptée; le capital ne sera pas amputé.'), { code: 'ERR_EARN_PENALTY_FUNDS_REQUIRED' });
      }
      postings.push(
        { accountRef: customerLedgerAccountRef(position.customerId, 'available'), asset: 'USDT', network: 'BEP20', decimals: 18, side: 'debit', amountAtomic: penalty.toString() },
        { accountRef: 'system:earn:penalties', asset: 'USDT', network: 'BEP20', decimals: 18, side: 'credit', amountAtomic: penalty.toString() },
      );
    }
    const ledger = await postLedgerTransaction({
      type: 'staking_release',
      idempotencyKey: `earn-withdrawal:${position._id}`,
      sourceRef: String(position._id),
      createdBy: actor,
      metadata: { actionId: String(action._id), customerId: String(position.customerId), penaltyAtomic: penalty.toString() },
      postings,
    }, { session });
    position.status = 'COMPLETED';
    position.ledgerReference = ledger.transaction.reference;
    await position.save({ session });
    ledgerReference = ledger.transaction.reference;
  }
  return ledgerReference;
}

async function decideEarnAction(actionId, actor, decision, reason = '') {
  requireMongoTransactions();
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = null;
      const action = await EarnAction.findOne({ _id: actionId, status: 'pending', expiresAt: { $gt: new Date() } }).session(session);
      if (!action) return;
      if (action.proposerEmail === actor) {
        result = { error: 'Une action financière doit être approuvée par une autre identité.', status: 403 };
        return;
      }
      if (decision === 'reject') {
        const rejectionReason = actionReason(reason);
        action.status = 'rejected';
        action.approverEmail = actor;
        action.resolutionReason = rejectionReason;
        action.resolvedAt = new Date();
        await action.save({ session });
        await EarnAuditLog.create([{
          actor,
          action: `${action.type}_rejected`,
          actionId: action._id,
          positionId: action.positionId,
          allocationId: action.allocationId,
          txHash: action.txHash,
          amountAtomic: action.grossAmountAtomic,
          details: { reason: rejectionReason },
        }], { session });
        result = { action, ledgerReference: null };
        return;
      }
      const ledgerReference = await applyApprovedEarnAction(action, actor, session);
      action.status = 'approved';
      action.approverEmail = actor;
      action.resolvedAt = new Date();
      action.ledgerReference = ledgerReference;
      await action.save({ session });
      await EarnAuditLog.create([{
        actor,
        action: `${action.type}_approved`,
        actionId: action._id,
        positionId: action.positionId,
        allocationId: action.allocationId,
        txHash: action.txHash,
        amountAtomic: action.grossAmountAtomic,
        details: { ledgerReference },
      }], { session });
      result = { action, ledgerReference };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  TERMS_VERSION,
  createEarnPosition,
  decideEarnAction,
  proposeEarnAction,
  requestEarnWithdrawal,
};
