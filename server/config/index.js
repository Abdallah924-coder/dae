'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const ALLOWED_ASSETS = ['USDT', 'BTC', 'POL', 'ETH', 'SOL'];
const ALLOWED_NETWORKS = new Set([
  'TRC20',
  'BEP20',
  'ERC20',
  'BITCOIN',
  'LIGHTNING',
  'POLYGON',
  'ETHEREUM',
  'ARBITRUM',
  'OPTIMISM',
  'SOLANA',
  'BINANCE_PAY',
]);
const BSC_PEG_USD_CONTRACT = '0x55d398326f99059ff775485246999027b3197955';

const config = {
  node: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  publicUrl: (process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL || '').replace(
    /\/+$/,
    '',
  ),
  database: {
    uri: process.env.MONGODB_URI || '',
  },
  auth: {
    email: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
    password: process.env.ADMIN_PASSWORD || '',
    sessionSecret: process.env.ADMIN_SESSION_SECRET || '',
    sessionLifetime: 12 * 60 * 60,
  },
  email: {
    apiKey: process.env.BREVO_API_KEY || '',
    senderEmail: (process.env.BREVO_SENDER_EMAIL || '').trim(),
    senderName: (process.env.BREVO_SENDER_NAME || 'DAE Crypto').trim(),
  },
  sms: {
    apiKey: process.env.INFOBIP_API_KEY || '',
    baseUrl: (process.env.INFOBIP_BASE_URL || 'https://api.infobip.com').replace(/\/+$/, ''),
    sender: (process.env.INFOBIP_SENDER || '').trim(),
  },
  company: process.env.COMPANY_NAME || 'DAE Crypto',
  rates: {
    defaultBuy: Number(process.env.DEFAULT_BUY_RATE) || 635,
    defaultSell: Number(process.env.DEFAULT_SELL_RATE) || 580,
    defaultMinXaf: Number(process.env.DEFAULT_MIN_XAF) || 10000,
    defaultMaxXaf: Number(process.env.DEFAULT_MAX_XAF) || 500000,
  },
  order: {
    holdMinutes: Number(process.env.ORDER_HOLD_MINUTES) || 15,
    maxProofImageBytes: 1_600_000,
  },
  market: {
    cacheMs: Number(process.env.MARKET_CACHE_MS) || 5 * 60_000,
    maxStaleMs: Number(process.env.MARKET_MAX_STALE_MS) || 30 * 60_000,
    retryDelayMs: Number(process.env.MARKET_RETRY_DELAY_MS) || 5 * 60_000,
  },
  bsc: {
    rpcUrl: process.env.BSC_RPC_URL || '',
    logsRpcUrl: process.env.BSC_LOGS_RPC_URL || 'https://bsc-rpc.publicnode.com',
    chainId: Number(process.env.BSC_CHAIN_ID || 56),
    usdtContract: (process.env.BSC_USDT_CONTRACT || BSC_PEG_USD_CONTRACT).trim(),
    hdPublicKey: (process.env.BSC_HD_XPUB || '').trim(),
    masterAddress: (process.env.BSC_MASTER_ADDRESS || '').trim(),
    gasAddress: (process.env.BSC_GAS_ADDRESS || '').trim(),
    confirmations: Number(process.env.BSC_CONFIRMATIONS || 15),
    scanIntervalMs: Number(process.env.BSC_SCAN_INTERVAL_MS || 15000),
    startBlock: process.env.BSC_START_BLOCK?.trim() ? Number(process.env.BSC_START_BLOCK) : null,
    depositsEnabled: process.env.BSC_DEPOSITS_ENABLED === 'true',
    withdrawalsEnabled: process.env.BSC_WITHDRAWALS_ENABLED === 'true',
    sweepsEnabled: process.env.BSC_SWEEPS_ENABLED === 'true',
    masterDerivationPath: process.env.BSC_MASTER_DERIVATION_PATH || "m/44'/60'/1'/0/0",
    gasDerivationPath: process.env.BSC_GAS_DERIVATION_PATH || "m/44'/60'/2'/0/0",
    gasTopUpBnb: process.env.BSC_GAS_TOPUP_BNB || '0.003',
    customerDerivationPath: process.env.BSC_CUSTOMER_DERIVATION_PATH || "m/44'/60'/0'/0",
    withdrawalFreshAuthMinutes: Number(process.env.BSC_WITHDRAWAL_FRESH_AUTH_MINUTES || 10),
  },
  maintenance: {
    checkMs: Number(process.env.MAINTENANCE_CHECK_MS) || 3000,
  },
  allowedAssets: ALLOWED_ASSETS,
  allowedNetworks: ALLOWED_NETWORKS,
};

function validate() {
  const errors = [];
  if (!config.database.uri) errors.push('MONGODB_URI manquant dans .env');
  if (!config.auth.email) errors.push('ADMIN_EMAIL manquant dans .env');
  if (!config.auth.password) errors.push('ADMIN_PASSWORD manquant dans .env');
  if (config.auth.sessionSecret.length < 32) {
    errors.push('ADMIN_SESSION_SECRET doit contenir au moins 32 caractères');
  }
  if (config.email.apiKey && !config.email.senderEmail) {
    errors.push('BREVO_SENDER_EMAIL requis si BREVO_API_KEY est défini');
  }
  if (errors.length) {
    throw new Error('Configuration invalide : ' + errors.join(' ; '));
  }
}

module.exports = { config, validate, BSC_PEG_USD_CONTRACT };
