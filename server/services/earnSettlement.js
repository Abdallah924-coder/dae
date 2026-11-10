'use strict';

const crypto = require('node:crypto');
const mongoose = require('mongoose');
const EarnConfig = require('../models/EarnConfig');
const EarnReward = require('../models/EarnReward');
const EarnRewardDay = require('../models/EarnRewardDay');
const StakePosition = require('../models/StakePosition');
const {
  customerLedgerAccountRef,
  getLedgerBalanceAtomic,
  postLedgerTransaction,
} = require('./ledger');
const { supportsMultiDocumentTransactions } = require('./mongoCapabilities');
const {
  allocateFundedRewards,
  calculateDailyApyReward,
} = require('./earnRewards');

const DAY_MS = 24 * 60 * 60 * 1000;

function requireMongoTransactions() {
  if (supportsMultiDocumentTransactions(mongoose.connection)) return;
  const error = new Error('Les opérations DAE Earn exigent MongoDB avec transactions multi-documents.');
  error.code = 'ERR_EARN_TRANSACTIONS_REQUIRED';
  error.status = 503;
  throw error;
}

function parseRewardDate(value) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError('Date de distribution invalide.');
  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== date) {
    throw new TypeError('Date de distribution invalide.');
  }
  if (start.getTime() >= Date.now() - DAY_MS + 1) {
    throw new RangeError('Seule une journée UTC entièrement terminée peut être distribuée.');
  }
  return { start, end: new Date(start.getTime() + DAY_MS), date };
}

async function distributeDailyEarnRewards(rewardDateUTC = new Date(Date.now() - DAY_MS).toISOString().slice(0, 10)) {
  requireMongoTransactions();
  const earnConfig = await EarnConfig.findOne({ key: 'main' }).select('rewardsEnabled').lean();
  if (!earnConfig?.rewardsEnabled) {
    const error = new Error('La distribution quotidienne DAE Earn est désactivée.');
    error.code = 'ERR_EARN_REWARDS_DISABLED';
    error.status = 503;
    throw error;
  }
  const { start, end, date } = parseRewardDate(rewardDateUTC);
  const session = await mongoose.startSession();
  let summary;
  try {
    await session.withTransaction(async () => {
      summary = null;
      const dailyMarker = await EarnRewardDay.findOne({ rewardDateUTC: date }).session(session);
      let dailyRewards = await EarnReward.find({ rewardDateUTC: date }).session(session);
      if (!dailyMarker && !dailyRewards.length) {
        await StakePosition.updateMany(
          { status: 'ACTIVE', maturesAt: { $ne: null, $lte: start } },
          { $set: { status: 'MATURED' } },
          { session },
        );
        const positions = await StakePosition.find({
          status: { $in: ['ACTIVE', 'MATURED', 'WITHDRAWAL_PENDING', 'COMPLETED'] },
          startsAt: { $lte: start },
          $and: [
            { $or: [{ maturesAt: null }, { maturesAt: { $gte: end } }] },
            { $or: [{ withdrawalRequestedAt: null }, { withdrawalRequestedAt: { $gte: end } }] },
          ],
        })
          .select('_id customerId amountAtomic rewardRateBps')
          .sort({ _id: 1 })
          .session(session)
          .lean();
        if (!positions.length) {
          await EarnRewardDay.create([{
            rewardDateUTC: date,
            positionsCount: 0,
            requestedAtomic: '0',
            paidAtomic: '0',
            completedAt: new Date(),
          }], { session });
          summary = { rewardDateUTC: date, alreadyProcessed: false, paidCount: 0, paidAtomic: '0' };
          return;
        }
        dailyRewards = await EarnReward.insertMany(positions.map((position) => ({
          positionId: position._id,
          customerId: position.customerId,
          rewardDateUTC: date,
          apyBps: position.rewardRateBps,
          principalAtomic: position.amountAtomic,
          requestedAtomic: calculateDailyApyReward(position.amountAtomic, position.rewardRateBps),
          paidAtomic: '0',
          status: 'unfunded',
        })), { session, ordered: true });
      }

      const positionsById = new Map();
      const positionIds = [...new Set(dailyRewards.map((reward) => String(reward.positionId)))];
      const positions = await StakePosition.find({ _id: { $in: positionIds } })
        .select('_id totalRewardsPaidAtomic')
        .session(session)
        .lean();
      for (const position of positions) positionsById.set(String(position._id), position);
      const outstandingClaims = dailyRewards
        .map((reward) => ({
          reward,
          id: String(reward._id),
          positionId: String(reward.positionId),
          amountAtomic: (BigInt(reward.requestedAtomic) - BigInt(reward.paidAtomic)).toString(),
        }))
        .filter((claim) => BigInt(claim.amountAtomic) > 0n);
      if (!outstandingClaims.length) {
        if (!dailyMarker) {
          const requested = dailyRewards.reduce((sum, reward) => sum + BigInt(reward.requestedAtomic), 0n);
          const paid = dailyRewards.reduce((sum, reward) => sum + BigInt(reward.paidAtomic), 0n);
          await EarnRewardDay.create([{
            rewardDateUTC: date,
            positionsCount: dailyRewards.length,
            requestedAtomic: requested.toString(),
            paidAtomic: paid.toString(),
            completedAt: new Date(),
          }], { session });
        }
        summary = { rewardDateUTC: date, alreadyProcessed: true, paidCount: 0, paidAtomic: '0' };
        return;
      }
      const poolBalance = BigInt(await getLedgerBalanceAtomic({
        accountRef: 'system:earn:reward-pool',
        asset: 'USDT',
        network: 'BEP20',
      }, { session }));
      if (poolBalance < 0n) {
        throw new Error('Le solde du pool de récompenses a un sens comptable incohérent.');
      }
      const allocations = new Map(allocateFundedRewards(
        outstandingClaims.map(({ id, amountAtomic }) => ({ id, amountAtomic })),
        poolBalance.toString(),
      ).map(({ id, amountAtomic }) => [id, amountAtomic]));
      const paidTotal = outstandingClaims.reduce((sum, claim) => sum + BigInt(allocations.get(claim.id) || '0'), 0n);
      if (paidTotal > 0n) {
        const postings = [];
        for (const claim of outstandingClaims) {
          const paidAtomic = allocations.get(claim.id) || '0';
          if (paidAtomic === '0') continue;
          postings.push({
            accountRef: customerLedgerAccountRef(claim.reward.customerId, 'available'),
            asset: 'USDT',
            network: 'BEP20',
            decimals: 18,
            side: 'credit',
            amountAtomic: paidAtomic,
          });
          postings.push({
            accountRef: 'system:earn:reward-pool',
            asset: 'USDT',
            network: 'BEP20',
            decimals: 18,
            side: 'debit',
            amountAtomic: paidAtomic,
          });
        }
        const batchKey = crypto.createHash('sha256')
          .update(JSON.stringify([...allocations.entries()].sort(([left], [right]) => left.localeCompare(right))))
          .digest('hex')
          .slice(0, 24);
        const ledger = await postLedgerTransaction({
          type: 'staking_reward',
          idempotencyKey: `earn-rewards:${date}:${batchKey}`,
          sourceRef: `earn-rewards:${date}`,
          createdBy: 'earn-daily-reward-job',
          metadata: {
            rewardDateUTC: date,
            requestedAtomic: outstandingClaims.reduce((sum, claim) => sum + BigInt(claim.amountAtomic), 0n).toString(),
            paidAtomic: paidTotal.toString(),
            batchKey,
          },
          postings,
        }, { session });
        for (const claim of outstandingClaims) {
          const paidAtomic = allocations.get(claim.id) || '0';
          if (paidAtomic === '0') continue;
          const reward = claim.reward;
          const totalPaidForDay = BigInt(reward.paidAtomic) + BigInt(paidAtomic);
          const newStatus = totalPaidForDay === BigInt(reward.requestedAtomic) ? 'paid' : 'scaled';
          await EarnReward.updateOne(
            { _id: reward._id, paidAtomic: reward.paidAtomic },
            {
              $set: { paidAtomic: totalPaidForDay.toString(), status: newStatus, ledgerReference: ledger.transaction.reference },
            },
            { session },
          );
          const position = positionsById.get(claim.positionId);
          if (!position) throw new Error(`Position ${claim.positionId} introuvable pour la récompense.`);
          const totalPaid = BigInt(position.totalRewardsPaidAtomic || '0') + BigInt(paidAtomic);
          const updated = await StakePosition.updateOne(
            { _id: reward.positionId },
            { $set: { totalRewardsPaidAtomic: totalPaid.toString() } },
            { session },
          );
          if (updated.modifiedCount !== 1) throw new Error(`La position ${claim.positionId} a changé pendant la distribution.`);
        }
        summary = {
          rewardDateUTC: date,
          alreadyProcessed: false,
          paidCount: allocations.size,
          paidAtomic: paidTotal.toString(),
          ledgerReference: ledger.transaction.reference,
        };
      } else {
        summary = { rewardDateUTC: date, alreadyProcessed: false, paidCount: 0, paidAtomic: '0', unfundedCount: outstandingClaims.length };
      }
      if (!dailyMarker) {
        const requested = dailyRewards.reduce((sum, reward) => sum + BigInt(reward.requestedAtomic), 0n);
        const paid = dailyRewards.reduce((sum, reward) => sum + BigInt(reward.paidAtomic), 0n) + paidTotal;
        await EarnRewardDay.create([{
          rewardDateUTC: date,
          positionsCount: dailyRewards.length,
          requestedAtomic: requested.toString(),
          paidAtomic: paid.toString(),
          completedAt: new Date(),
        }], { session });
      } else if (paidTotal > 0n) {
        dailyMarker.paidAtomic = (BigInt(dailyMarker.paidAtomic) + paidTotal).toString();
        await dailyMarker.save({ session });
      }
    });
    return summary;
  } catch (error) {
    if (error.code === 11000) {
      const existing = await EarnReward.exists({ rewardDateUTC: date });
      if (existing) return { rewardDateUTC: date, alreadyProcessed: true, paidCount: 0, paidAtomic: '0' };
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = { distributeDailyEarnRewards };
