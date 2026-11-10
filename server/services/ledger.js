'use strict';

const crypto = require('node:crypto');
const mongoose = require('mongoose');
const LedgerTransaction = require('../models/LedgerTransaction');
const LedgerAccountLock = require('../models/LedgerAccountLock');
const { supportsMultiDocumentTransactions } = require('./mongoCapabilities');

const POSTED_TYPES = new Set([
  'deposit',
  'withdrawal',
  'exchange',
  'p2p_transfer',
  'staking_lock',
  'staking_release',
  'adjustment',
]);
const ATOMIC_AMOUNT_RE = /^[1-9][0-9]{0,77}$/;
const CUSTOMER_ACCOUNT_REF_RE = /^customer:[a-f\d]{24}:(?:available|reserved|staked)$/i;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function normalizePostings(postings) {
  if (!Array.isArray(postings) || postings.length < 2) {
    throw new TypeError('Une écriture comptable doit contenir au moins deux postings');
  }
  const normalized = postings.map((posting) => {
    const amountAtomic = String(posting.amountAtomic || '');
    if (!ATOMIC_AMOUNT_RE.test(amountAtomic)) {
      throw new TypeError('amountAtomic doit être un entier positif sans décimales');
    }
    const decimals = posting.decimals;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      throw new TypeError('decimals doit être un entier compris entre 0 et 36');
    }
    return {
      accountRef: String(posting.accountRef || '').trim(),
      asset: String(posting.asset || '')
        .trim()
        .toUpperCase(),
      network: String(posting.network || '')
        .trim()
        .toUpperCase(),
      decimals,
      side: String(posting.side || '')
        .trim()
        .toLowerCase(),
      amountAtomic,
    };
  });
  if (
    normalized.some(
      (posting) =>
        !posting.accountRef ||
        !posting.asset ||
        !posting.network ||
        !['debit', 'credit'].includes(posting.side),
    )
  ) {
    throw new TypeError('Chaque posting doit définir compte, actif, réseau et sens');
  }
  for (const posting of normalized) {
    if (posting.accountRef.toLowerCase().startsWith('customer:')) {
      posting.accountRef = posting.accountRef.toLowerCase();
      if (!CUSTOMER_ACCOUNT_REF_RE.test(posting.accountRef)) {
        throw new TypeError('Référence de compte client invalide');
      }
    }
  }
  return normalized.sort((left, right) =>
    [left.asset, left.network, left.accountRef, left.side, left.amountAtomic]
      .join(':')
      .localeCompare(
        [right.asset, right.network, right.accountRef, right.side, right.amountAtomic].join(':'),
      ),
  );
}

function payloadHash(payload) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(payload)))
    .digest('hex');
}

async function postLedgerTransaction(input, { session: providedSession } = {}) {
  if (!input || !POSTED_TYPES.has(input.type)) {
    throw new TypeError('Type de transaction comptable invalide');
  }
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 160) {
    throw new TypeError('La clé d’idempotence doit contenir entre 8 et 160 caractères');
  }
  const postings = normalizePostings(input.postings);
  const payload = {
    type: input.type,
    sourceRef: input.sourceRef ? String(input.sourceRef).trim() : null,
    createdBy: String(input.createdBy || '').trim(),
    postings,
    metadata: canonicalize(input.metadata || {}),
  };
  if (!payload.createdBy || payload.createdBy.length > 100) {
    throw new TypeError('L’auteur du posting est requis');
  }
  const requestHash = payloadHash(payload);
  const customerDeltas = new Map();
  for (const posting of postings) {
    if (!CUSTOMER_ACCOUNT_REF_RE.test(posting.accountRef)) continue;
    const key = JSON.stringify([posting.accountRef, posting.asset, posting.network]);
    const current = customerDeltas.get(key) || {
      key,
      accountRef: posting.accountRef,
      asset: posting.asset,
      network: posting.network,
      decimals: posting.decimals,
      delta: 0n,
    };
    if (current.decimals !== posting.decimals) {
      throw new TypeError(`Précision incohérente dans les postings pour ${key}`);
    }
    const amount = BigInt(posting.amountAtomic);
    current.delta += posting.side === 'credit' ? amount : -amount;
    customerDeltas.set(key, current);
  }

  try {
    if (customerDeltas.size === 0) {
      const transaction = new LedgerTransaction({
        reference: `LED-${crypto.randomBytes(12).toString('base64url')}`,
        idempotencyKey,
        requestHash,
        ...payload,
      });
      if (providedSession) await transaction.save({ session: providedSession });
      else await transaction.save();
      return { transaction, duplicate: false };
    }
    if (!supportsMultiDocumentTransactions(mongoose.connection)) {
      const error = new Error('Les écritures sur comptes clients exigent MongoDB avec transactions multi-documents.');
      error.code = 'ERR_LEDGER_TRANSACTIONS_REQUIRED';
      throw error;
    }

    const lockedBalances = [...customerDeltas.values()].sort((left, right) => left.key.localeCompare(right.key));
    for (const balance of lockedBalances) {
      try {
        await LedgerAccountLock.updateOne(
          { key: balance.key },
          { $setOnInsert: { key: balance.key, version: 0 } },
          {
            upsert: true,
            setDefaultsOnInsert: true,
            ...(providedSession ? { session: providedSession } : {}),
          },
        );
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
    }

    const writeTransaction = async (session) => {
      for (const balance of lockedBalances) {
        await LedgerAccountLock.updateOne(
          { key: balance.key },
          { $inc: { version: 1 } },
          { session },
        );
      }

      const existing = await LedgerTransaction.findOne({ idempotencyKey }).session(session);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          const conflict = new Error('La clé d’idempotence a déjà été utilisée pour une autre écriture');
          conflict.code = 'ERR_IDEMPOTENCY_CONFLICT';
          throw conflict;
        }
        return { transaction: existing, duplicate: true };
      }

      for (const balance of lockedBalances) {
        const history = await LedgerTransaction.find({
          status: 'posted',
          postings: { $elemMatch: { accountRef: balance.accountRef, asset: balance.asset, network: balance.network } },
        })
          .select('postings')
          .session(session)
          .lean();
        let currentAtomic = 0n;
        for (const ledgerTransaction of history) {
          for (const posting of ledgerTransaction.postings) {
            if (
              posting.accountRef !== balance.accountRef ||
              posting.asset !== balance.asset ||
              posting.network !== balance.network
            ) continue;
            if (posting.decimals !== balance.decimals) {
              throw new Error(`Précision incohérente dans le ledger pour ${balance.key}`);
            }
            const amount = BigInt(posting.amountAtomic);
            currentAtomic += posting.side === 'credit' ? amount : -amount;
          }
        }
        if (balance.delta < 0n && currentAtomic + balance.delta < 0n) {
          const insufficient = new Error(`Solde insuffisant dans le compartiment ${balance.accountRef}`);
          insufficient.code = 'ERR_LEDGER_INSUFFICIENT_FUNDS';
          throw insufficient;
        }
      }

      const transaction = new LedgerTransaction({
        reference: `LED-${crypto.randomBytes(12).toString('base64url')}`,
        idempotencyKey,
        requestHash,
        ...payload,
      });
      await transaction.save({ session });
      return { transaction, duplicate: false };
    };

    if (providedSession) return await writeTransaction(providedSession);
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await writeTransaction(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  } catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await LedgerTransaction.findOne({ idempotencyKey });
    if (!existing) throw error;
    if (existing.requestHash !== requestHash) {
      const conflict = new Error(
        'La clé d’idempotence a déjà été utilisée pour une autre écriture',
      );
      conflict.code = 'ERR_IDEMPOTENCY_CONFLICT';
      throw conflict;
    }
    return { transaction: existing, duplicate: true };
  }
}

async function getLedgerBalancesAtomic(accountRef) {
  if (!accountRef) throw new TypeError('Compte requis pour lire les soldes');
  const normalizedAccountRef = String(accountRef).trim();
  if (!normalizedAccountRef) throw new TypeError('Compte requis pour lire les soldes');
  const transactions = await LedgerTransaction.find({
    status: 'posted',
    postings: { $elemMatch: { accountRef: normalizedAccountRef } },
  })
    .select('postings')
    .lean();
  const balances = new Map();
  for (const transaction of transactions) {
    for (const posting of transaction.postings) {
      if (posting.accountRef !== normalizedAccountRef) continue;
      if (!Number.isInteger(posting.decimals) || posting.decimals < 0 || posting.decimals > 36) {
        throw new Error('Une écriture du ledger ne contient pas de précision décimale valide');
      }
      const key = `${posting.asset}:${posting.network}`;
      const balance = balances.get(key) || {
        asset: posting.asset,
        network: posting.network,
        decimals: posting.decimals,
        amountAtomic: 0n,
      };
      if (balance.decimals !== posting.decimals) {
        throw new Error(`Précision incohérente dans le ledger pour ${key}`);
      }
      const amount = BigInt(posting.amountAtomic);
      balance.amountAtomic += posting.side === 'credit' ? amount : -amount;
      balances.set(key, balance);
    }
  }
  return [...balances.values()]
    .map((balance) => ({ ...balance, amountAtomic: balance.amountAtomic.toString() }))
    .sort((left, right) => `${left.asset}:${left.network}`.localeCompare(`${right.asset}:${right.network}`));
}

async function getLedgerBalanceAtomic({ accountRef, asset, network }) {
  if (!accountRef || !asset || !network) {
    throw new TypeError('Compte, actif et réseau sont requis pour lire le solde');
  }
  const balances = await getLedgerBalancesAtomic(accountRef);
  return (
    balances.find(
      (balance) =>
        balance.asset === String(asset).toUpperCase() &&
        balance.network === String(network).toUpperCase(),
    )?.amountAtomic || '0'
  );
}

function customerLedgerAccountRef(customerId, bucket) {
  const id = String(customerId || '').trim();
  if (!/^[a-f\d]{24}$/i.test(id)) throw new TypeError('Identifiant client invalide');
  if (!['available', 'reserved', 'staked'].includes(bucket)) {
    throw new TypeError('Compartiment de ledger client invalide');
  }
  return `customer:${id.toLowerCase()}:${bucket}`;
}

async function getCustomerLedgerBalances(customerId) {
  const buckets = ['available', 'reserved', 'staked'];
  const ledgerRows = await Promise.all(
    buckets.map(async (bucket) => ({
      bucket,
      balances: await getLedgerBalancesAtomic(customerLedgerAccountRef(customerId, bucket)),
    })),
  );
  const units = new Map();
  for (const { bucket, balances } of ledgerRows) {
    for (const balance of balances) {
      const key = `${balance.asset}:${balance.network}`;
      const unit = units.get(key) || {
        asset: balance.asset,
        network: balance.network,
        decimals: balance.decimals,
        availableAtomic: 0n,
        reservedAtomic: 0n,
        stakedAtomic: 0n,
      };
      if (unit.decimals !== balance.decimals) {
        throw new Error(`Précision incohérente entre compartiments du ledger pour ${key}`);
      }
      unit[`${bucket}Atomic`] = BigInt(balance.amountAtomic);
      units.set(key, unit);
    }
  }
  return [...units.values()]
    .map((unit) => ({
      asset: unit.asset,
      network: unit.network,
      decimals: unit.decimals,
      available: formatAtomicAmount(unit.availableAtomic.toString(), unit.decimals),
      reserved: formatAtomicAmount(unit.reservedAtomic.toString(), unit.decimals),
      staked: formatAtomicAmount(unit.stakedAtomic.toString(), unit.decimals),
    }))
    .sort((left, right) => `${left.asset}:${left.network}`.localeCompare(`${right.asset}:${right.network}`));
}

function formatAtomicAmount(amountAtomic, decimals) {
  if (!/^-?(?:0|[1-9][0-9]{0,77})$/.test(String(amountAtomic))) {
    throw new TypeError('Montant atomique invalide');
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new TypeError('decimals doit être un entier compris entre 0 et 36');
  }
  const value = BigInt(amountAtomic);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const divisor = 10n ** BigInt(decimals);
  const whole = absolute / divisor;
  const fractional = decimals
    ? (absolute % divisor).toString().padStart(decimals, '0').replace(/0+$/, '')
    : '';
  return `${negative ? '-' : ''}${whole}${fractional ? `.${fractional}` : ''}`;
}

module.exports = {
  postLedgerTransaction,
  getLedgerBalanceAtomic,
  getLedgerBalancesAtomic,
  customerLedgerAccountRef,
  getCustomerLedgerBalances,
  formatAtomicAmount,
};
