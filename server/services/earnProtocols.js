'use strict';

const { Contract, formatUnits, getAddress } = require('ethers');
const { config } = require('../config');
const { EARN_PROTOCOLS } = require('../config/earnProtocols');
const { logger } = require('../lib/logger');
const { getProvider } = require('./bsc');

const VENUS_MARKET_ABI = [
  'function underlying() view returns (address)',
  'function comptroller() view returns (address)',
  'function getCash() view returns (uint256)',
  'function supplyRatePerBlock() view returns (uint256)',
];
const VENUS_COMPTROLLER_ABI = [
  'function markets(address) view returns (bool,uint256,bool,uint256,uint256,uint96,bool)',
  'function protocolPaused() view returns (bool)',
  'function actionPaused(address,uint8) view returns (bool)',
  'function supplyCaps(address) view returns (uint256)',
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];
const AAVE_POOL_ABI = [
  'function getConfiguration(address) view returns (uint256 data)',
  'function getReserveData(address) view returns (tuple(uint256 configuration,uint128 liquidityIndex,uint128 currentLiquidityRate,uint128 variableBorrowIndex,uint128 currentVariableBorrowRate,uint128 currentStableBorrowRate,uint40 lastUpdateTimestamp,uint16 id,address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress,address interestRateStrategyAddress,uint128 accruedToTreasury,uint128 unbacked,uint128 isolationModeTotalDebt))',
];
function isAddressCode(code) {
  return typeof code === 'string' && code !== '0x' && code.length > 2;
}

function safeFailure(error) {
  return error?.code || error?.name || 'PROTOCOL_READ_FAILED';
}

async function getVenusStatus(provider, blockTag) {
  const { underlying, market } = EARN_PROTOCOLS.venus;
  const marketContract = new Contract(market, VENUS_MARKET_ABI, provider);
  const underlyingToken = new Contract(underlying, ERC20_ABI, provider);
  const marketCode = await provider.getCode(market, blockTag);
  if (!isAddressCode(marketCode)) throw Object.assign(new Error(), { code: 'VENUS_MARKET_CODE_MISSING' });
  const [configuredUnderlying, comptrollerAddress, cash, supplyRatePerBlock, tokenDecimals] = await Promise.all([
    marketContract.underlying({ blockTag }),
    marketContract.comptroller({ blockTag }),
    marketContract.getCash({ blockTag }),
    marketContract.supplyRatePerBlock({ blockTag }),
    underlyingToken.decimals({ blockTag }),
  ]);
  if (getAddress(configuredUnderlying) !== getAddress(underlying)) {
    throw Object.assign(new Error(), { code: 'VENUS_UNDERLYING_MISMATCH' });
  }
  if (Number(tokenDecimals) !== 18) throw Object.assign(new Error(), { code: 'VENUS_UNDERLYING_DECIMALS_MISMATCH' });
  const comptroller = new Contract(comptrollerAddress, VENUS_COMPTROLLER_ABI, provider);
  const [comptrollerCode, marketListing, protocolPaused, mintPaused, redeemPaused, supplyCap] = await Promise.all([
    provider.getCode(comptrollerAddress, blockTag),
    comptroller.markets(market, { blockTag }),
    comptroller.protocolPaused({ blockTag }),
    comptroller.actionPaused(market, 0, { blockTag }),
    comptroller.actionPaused(market, 1, { blockTag }),
    comptroller.supplyCaps(market, { blockTag }),
  ]);
  if (!isAddressCode(comptrollerCode)) throw Object.assign(new Error(), { code: 'VENUS_COMPTROLLER_CODE_MISSING' });
  return {
    protocol: 'venus',
    chainId: 56,
    blockNumber: blockTag,
    market,
    underlying,
    listed: marketListing[0],
    supplyPaused: protocolPaused || mintPaused,
    withdrawalPaused: protocolPaused || redeemPaused,
    supplyRatePerBlock: supplyRatePerBlock.toString(),
    supplyRateAnnualized: null,
    liquidityAtomic: cash.toString(),
    liquidity: formatUnits(cash, 18),
    supplyCapAtomic: supplyCap.toString(),
    supplyCap: supplyCap === 0n ? null : formatUnits(supplyCap, 18),
    allocationEnabled: false,
    withdrawalEnabled: false,
  };
}

async function getAaveV3Status(provider, blockTag) {
  const { underlying, pool, aToken } = EARN_PROTOCOLS.aaveV3;
  const poolContract = new Contract(pool, AAVE_POOL_ABI, provider);
  const token = new Contract(underlying, ERC20_ABI, provider);
  const [poolCode, tokenDecimals, reserveConfig, reserveData, liquidity] = await Promise.all([
    provider.getCode(pool, blockTag),
    token.decimals({ blockTag }),
    poolContract.getConfiguration(underlying, { blockTag }),
    poolContract.getReserveData(underlying, { blockTag }),
    token.balanceOf(aToken, { blockTag }),
  ]);
  if (!isAddressCode(poolCode)) throw Object.assign(new Error(), { code: 'AAVE_POOL_CODE_MISSING' });
  if (Number(tokenDecimals) !== 18) throw Object.assign(new Error(), { code: 'AAVE_UNDERLYING_DECIMALS_MISMATCH' });
  if (getAddress(reserveData[8]) !== getAddress(aToken)) {
    throw Object.assign(new Error(), { code: 'AAVE_ATOKEN_MISMATCH' });
  }
  const configBits = reserveConfig;
  const active = ((configBits >> 56n) & 1n) === 1n;
  const frozen = ((configBits >> 57n) & 1n) === 1n;
  const paused = ((configBits >> 60n) & 1n) === 1n;
  const supplyCapWholeTokens = (configBits >> 116n) & ((1n << 36n) - 1n);
  const rateRay = BigInt(reserveData[2]);
  return {
    protocol: 'aaveV3',
    chainId: 56,
    blockNumber: blockTag,
    pool,
    aToken,
    underlying,
    active,
    frozen,
    paused,
    currentLiquidityRateRay: rateRay.toString(),
    supplyRateAnnualPercent: formatRayPercent(rateRay),
    liquidityAtomic: liquidity.toString(),
    liquidity: formatUnits(liquidity, 18),
    supplyCapAtomic: (supplyCapWholeTokens * 10n ** 18n).toString(),
    supplyCap: supplyCapWholeTokens === 0n ? null : supplyCapWholeTokens.toString(),
    allocationEnabled: false,
    withdrawalEnabled: false,
  };
}

function formatRayPercent(rateRay) {
  const hundredthsOfPercent = rateRay * 10000n / 10n ** 27n;
  const whole = hundredthsOfPercent / 100n;
  const fraction = (hundredthsOfPercent % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}

async function readProtocol(provider, protocol, blockTag) {
  try {
    return await (protocol === 'venus'
      ? getVenusStatus(provider, blockTag)
      : getAaveV3Status(provider, blockTag));
  } catch (error) {
    logger.warn({ protocol, errorCode: safeFailure(error) }, 'Lecture du protocole DAE Earn indisponible');
    return {
      protocol,
      chainId: 56,
      blockNumber: blockTag,
      status: 'unavailable',
      errorCode: safeFailure(error),
      allocationEnabled: false,
      withdrawalEnabled: false,
    };
  }
}

async function getEarnProtocolStatus(provider = getProvider()) {
  const chain = await provider.getNetwork();
  if (Number(chain.chainId) !== 56 || config.bsc.chainId !== 56) {
    throw Object.assign(new Error('Le RPC Earn doit pointer vers BNB Smart Chain mainnet.'), {
      code: 'ERR_EARN_WRONG_CHAIN',
    });
  }
  if (getAddress(config.bsc.usdtContract) !== getAddress(EARN_PROTOCOLS.venus.underlying)) {
    throw Object.assign(new Error('Le jeton USDT configuré ne correspond pas au marché vérifié.'), {
      code: 'ERR_EARN_UNDERLYING_MISMATCH',
    });
  }
  const blockTag = await provider.getBlockNumber();
  const [venus, aaveV3] = await Promise.all([
    readProtocol(provider, 'venus', blockTag),
    readProtocol(provider, 'aaveV3', blockTag),
  ]);
  return {
    chainId: 56,
    blockNumber: blockTag,
    observedAt: new Date().toISOString(),
    source: 'bsc_rpc_read_only',
    allocationEnabled: false,
    protocols: { venus, aaveV3 },
  };
}

module.exports = { formatRayPercent, getEarnProtocolStatus };
