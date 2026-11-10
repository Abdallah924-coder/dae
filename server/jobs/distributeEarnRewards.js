'use strict';

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { logger } = require('../lib/logger');
const { distributeDailyEarnRewards } = require('../services/earnSettlement');
const EarnReward = require('../models/EarnReward');
const EarnConfig = require('../models/EarnConfig');
const EarnRewardDay = require('../models/EarnRewardDay');
const StakePosition = require('../models/StakePosition');

function nextDate(date) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

async function runEarnRewardJob(rewardDateUTC) {
  const config = await EarnConfig.findOne({ key: 'main' }).select('rewardsEnabled').lean();
  if (!config?.rewardsEnabled) return [{ disabled: true, reason: 'rewards_disabled' }];
  const pending = await EarnReward.find({ status: { $in: ['unfunded', 'scaled'] } })
    .select('rewardDateUTC requestedAtomic paidAtomic')
    .sort({ rewardDateUTC: 1 })
    .limit(1000)
    .lean();
  const dates = new Set(rewardDateUTC
    ? [rewardDateUTC]
    : [new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)]);
  for (const reward of pending) {
    if (BigInt(reward.requestedAtomic) > BigInt(reward.paidAtomic)) dates.add(reward.rewardDateUTC);
  }
  if (!rewardDateUTC) {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const lastProcessed = await EarnRewardDay.findOne().sort({ rewardDateUTC: -1 }).select('rewardDateUTC').lean();
    let firstMissingDate = lastProcessed
      ? nextDate(lastProcessed.rewardDateUTC)
      : null;
    if (!firstMissingDate) {
      const earliestPosition = await StakePosition.findOne({
        termsVersion: 'DAE_EARN_V1',
        startsAt: { $ne: null, $lte: new Date(`${yesterday}T23:59:59.999Z`) },
      }).sort({ startsAt: 1 }).select('startsAt').lean();
      firstMissingDate = earliestPosition
        ? earliestPosition.startsAt.toISOString().slice(0, 10)
        : yesterday;
    }
    let catchupDate = firstMissingDate;
    for (let count = 0; catchupDate <= yesterday && count < 30; count += 1) {
      dates.add(catchupDate);
      catchupDate = nextDate(catchupDate);
    }
  }
  const results = [];
  for (const date of [...dates].sort().slice(0, 30)) {
    const result = await distributeDailyEarnRewards(date);
    results.push(result);
    logger.info(result, 'Traitement quotidien des récompenses DAE Earn terminé');
  }
  return results;
}

if (require.main === module) {
  connectDB()
    .then(() => runEarnRewardJob(process.argv[2]))
    .catch((error) => {
      logger.error({ err: error }, 'Échec de la distribution quotidienne DAE Earn');
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    });
}

module.exports = { runEarnRewardJob };
