'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

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

module.exports = { config, validate };
