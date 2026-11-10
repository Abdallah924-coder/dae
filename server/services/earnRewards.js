'use strict';

const BASIS_POINTS = 10_000n;
const DAYS_PER_YEAR = 365n;
const ATOMIC_AMOUNT_RE = /^(0|[1-9][0-9]{0,77})$/;

function parseAtomic(value, label) {
  const amount = String(value ?? '');
  if (!ATOMIC_AMOUNT_RE.test(amount)) throw new TypeError(`${label} invalide.`);
  return BigInt(amount);
}

function calculateDailyApyReward(principalAtomic, apyBps) {
  const principal = parseAtomic(principalAtomic, 'Capital');
  if (!Number.isInteger(apyBps) || apyBps < 0 || apyBps > 10_000) {
    throw new TypeError('APY invalide.');
  }
  return (principal * BigInt(apyBps) / (BASIS_POINTS * DAYS_PER_YEAR)).toString();
}

function splitRealizedYield(amountAtomic, splitBps) {
  const amount = parseAtomic(amountAtomic, 'Rendement réalisé');
  const userRewardsBps = splitBps?.userRewards;
  const platformBps = splitBps?.platform;
  const reserveBps = splitBps?.safetyReserve;
  if (
    ![userRewardsBps, platformBps, reserveBps].every((value) => Number.isInteger(value) && value >= 0 && value <= 10_000) ||
    userRewardsBps + platformBps + reserveBps !== 10_000
  ) {
    throw new TypeError('La répartition des revenus doit être entière et totaliser 100 %.');
  }
  const users = amount * BigInt(userRewardsBps) / BASIS_POINTS;
  const platform = amount * BigInt(platformBps) / BASIS_POINTS;
  const reserve = amount - users - platform;
  return {
    userRewardsAtomic: users.toString(),
    platformAtomic: platform.toString(),
    safetyReserveAtomic: reserve.toString(),
  };
}

function allocateFundedRewards(claims, availableAtomic) {
  const available = parseAtomic(availableAtomic, 'Financement disponible');
  if (!Array.isArray(claims)) throw new TypeError('Réclamations invalides.');
  const normalized = claims.map((claim) => ({
    id: String(claim.id || ''),
    amount: parseAtomic(claim.amountAtomic, 'Récompense'),
  }));
  if (normalized.some((claim) => !claim.id) || new Set(normalized.map((claim) => claim.id)).size !== normalized.length) {
    throw new TypeError('Chaque réclamation doit avoir un identifiant unique.');
  }
  const total = normalized.reduce((sum, claim) => sum + claim.amount, 0n);
  const budget = total < available ? total : available;
  if (budget === 0n || total === 0n) return [];

  const allocations = normalized.map((claim) => {
    const numerator = claim.amount * budget;
    return {
      id: claim.id,
      amount: numerator / total,
      remainder: numerator % total,
    };
  });
  let undistributed = budget - allocations.reduce((sum, allocation) => sum + allocation.amount, 0n);
  allocations.sort((left, right) => (
    left.remainder === right.remainder
      ? left.id.localeCompare(right.id)
      : left.remainder > right.remainder ? -1 : 1
  ));
  for (const allocation of allocations) {
    if (undistributed === 0n) break;
    allocation.amount += 1n;
    undistributed -= 1n;
  }
  return allocations
    .filter((allocation) => allocation.amount > 0n)
    .map(({ id, amount }) => ({ id, amountAtomic: amount.toString() }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

module.exports = {
  allocateFundedRewards,
  calculateDailyApyReward,
  splitRealizedYield,
};
