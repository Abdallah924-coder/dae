'use strict';

const DEFAULT_EARN_CONFIG = Object.freeze({
  configVersion: 0,
  subscriptionsEnabled: false,
  allocationsEnabled: false,
  rewardsEnabled: false,
  allocationLimitBps: 1000,
  protocolLimitsBps: {
    venus: 500,
    aaveV3: 500,
  },
  revenueSplitBps: {
    userRewards: 7000,
    platform: 2000,
    safetyReserve: 1000,
  },
  earlyWithdrawal: {
    unaccruedRewardsPenaltyBps: 10000,
    creditedRewardsPenaltyBps: 0,
  },
  products: [
    { productId: 'flexible', name: 'DAE Flexible', apyBps: 200, durationDays: 0, minimumAmountAtomic: '10000000000000000000', flexible: true, published: true },
    { productId: 'bronze', name: 'DAE Bronze', apyBps: 300, durationDays: 30, minimumAmountAtomic: '50000000000000000000', flexible: false, published: true },
    { productId: 'silver', name: 'DAE Silver', apyBps: 400, durationDays: 60, minimumAmountAtomic: '100000000000000000000', flexible: false, published: true },
    { productId: 'gold', name: 'DAE Gold', apyBps: 500, durationDays: 90, minimumAmountAtomic: '250000000000000000000', flexible: false, published: true },
  ],
});

function defaultEarnConfig() {
  return structuredClone(DEFAULT_EARN_CONFIG);
}

module.exports = { DEFAULT_EARN_CONFIG, defaultEarnConfig };
