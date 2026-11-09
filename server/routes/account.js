'use strict';

const express = require('express');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { isAddress, parseUnits } = require('ethers');
const rateLimit = require('express-rate-limit');
const Customer = require('../models/Customer');
const CustomerLoginChallenge = require('../models/CustomerLoginChallenge');
const CustomerSession = require('../models/CustomerSession');
const Wallet = require('../models/Wallet');
const WalletCounter = require('../models/WalletCounter');
const Order = require('../models/Order');
const Deposit = require('../models/Deposit');
const Withdrawal = require('../models/Withdrawal');
const StakePosition = require('../models/StakePosition');
const customerAuth = require('../middleware/customerAuth');
const cryptoAssets = require('../config/cryptoAssets');
const { customerVerificationCode } = require('../services/email');
const { normalizePhoneNumber, sendSMS } = require('../services/infobip');
const auth = require('../services/customerAuth');
const { getCustomerLedgerBalances } = require('../services/ledger');
const { supportsMultiDocumentTransactions } = require('../services/mongoCapabilities');
const bscWallet = require('../services/bsc');
const BscTransferJob = require('../models/BscTransferJob');
const BscSignerHeartbeat = require('../models/BscSignerHeartbeat');
const BscIndexerHeartbeat = require('../models/BscIndexerHeartbeat');
const { config } = require('../config');
const { postLedgerTransaction } = require('../services/ledger');

const router = express.Router();
const challengeTtlMs = auth.OTP_MINUTES * 60 * 1000;
const challengeMaxAttempts = 5;
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8 });
const resendLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 3 });
const recoveryLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
const withdrawalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
const PHONE_RE = /^\+?[1-9]\d{7,14}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_HD_ACCOUNT_INDEX = 0x7fffffff;
function publicPolicyUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}
const chainByNetwork = {
  BITCOIN: 'bitcoin',
  LIGHTNING: 'lightning',
  TRC20: 'tron',
  SOLANA: 'solana',
  ERC20: 'ethereum',
  ETHEREUM: 'ethereum',
  BEP20: 'bsc',
  POLYGON: 'polygon',
  ARBITRUM: 'arbitrum',
  OPTIMISM: 'optimism',
};
const challengeSelect = [
  '+passwordHash',
  '+passwordSalt',
  '+emailChallenge.hash',
  '+emailChallenge.expiresAt',
  '+emailChallenge.sentAt',
  '+emailChallenge.attempts',
  '+phoneChallenge.hash',
  '+phoneChallenge.expiresAt',
  '+phoneChallenge.sentAt',
  '+phoneChallenge.attempts',
].join(' ');

function authChannelsReady() {
  return Boolean(
    (process.env.CUSTOMER_AUTH_SECRET || '').length >= 32 &&
    auth.publicAppOriginReady() &&
    process.env.BREVO_API_KEY?.trim() &&
    process.env.BREVO_SENDER_EMAIL?.trim() &&
    process.env.INFOBIP_API_KEY?.trim() &&
    process.env.INFOBIP_SENDER?.trim(),
  );
}

function mongoTransactionsReady() {
  return supportsMultiDocumentTransactions(mongoose.connection);
}

function authProvidersReady() {
  return Boolean(
    authChannelsReady() &&
    process.env.CUSTOMER_LEGAL_REVIEWED === 'true' &&
    process.env.CUSTOMER_TERMS_VERSION?.trim() &&
    process.env.CUSTOMER_PRIVACY_VERSION?.trim() &&
    publicPolicyUrl(process.env.CUSTOMER_TERMS_URL) &&
    publicPolicyUrl(process.env.CUSTOMER_PRIVACY_URL),
  );
}

function createChallenges(customer) {
  const emailCode = auth.makeOtp();
  const phoneCode = auth.makeOtp();
  const emailChallenge = {
    hash: auth.otpHash(customer._id, 'email', emailCode),
    expiresAt: new Date(Date.now() + challengeTtlMs),
    sentAt: new Date(),
    attempts: 0,
  };
  const phoneChallenge = {
    hash: auth.otpHash(customer._id, 'phone', phoneCode),
    expiresAt: new Date(Date.now() + challengeTtlMs),
    sentAt: new Date(),
    attempts: 0,
  };
  customer.emailChallenge = emailChallenge;
  customer.phoneChallenge = phoneChallenge;
  return { emailCode, phoneCode };
}

async function deliverChallenges(customer, codes) {
  const [emailResult, smsResult] = await Promise.allSettled([
    customerVerificationCode({ email: customer.email, code: codes.emailCode }),
    sendSMS(
      customer.phone,
      `Code DAE Crypto : ${codes.phoneCode}. Expire dans ${auth.OTP_MINUTES} minutes. Ne le partagez pas.`,
    ),
  ]);
  if (emailResult.status === 'rejected' || smsResult.status === 'rejected') {
    throw new Error(
      'Un canal de vérification est indisponible. Réessayez ou contactez l’assistance.',
    );
  }
}

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizePhone(value) {
  const compact = String(value || '')
    .trim()
    .replace(/[\s().-]/g, '');
  if (!PHONE_RE.test(compact)) return '';
  return `+${normalizePhoneNumber(compact)}`;
}

function checkCode(customer, purpose, code) {
  const challenge = customer[`${purpose}Challenge`];
  if (!challenge?.hash || !challenge.expiresAt || challenge.expiresAt <= new Date()) return false;
  return auth.safeEqualHex(challenge.hash, auth.otpHash(customer._id, purpose, String(code || '')));
}

function issueSessionCookie(res, token) {
  auth.setSessionCookie(res, token);
}

async function allocateWalletAccountIndex() {
  const validateIndex = (value) => {
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_HD_ACCOUNT_INDEX) {
      const error = new Error('La plage d’indices des comptes HD est épuisée ou invalide.');
      error.code = 'ERR_HD_ACCOUNT_INDEX_INVALID';
      throw error;
    }
    return value;
  };
  try {
    const counter = await WalletCounter.findOneAndUpdate(
      { name: 'customer-hd-account' },
      { $inc: { value: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: false },
    );
    return validateIndex(counter.value);
  } catch (error) {
    // Concurrent first registrations can race to create the unique counter document.
    if (error.code !== 11000) throw error;
    const counter = await WalletCounter.findOneAndUpdate(
      { name: 'customer-hd-account' },
      { $inc: { value: 1 } },
      { new: true },
    );
    if (!counter) throw error;
    return validateIndex(counter.value);
  }
}

async function ensureWalletPlaceholders(customer) {
  const networks = new Map();
  for (const asset of cryptoAssets) {
    for (const network of asset.networks) {
      if (!networks.has(network.id)) networks.set(network.id, network);
    }
  }
  await Wallet.bulkWrite(
    [...networks.entries()].map(([networkId]) => ({
      updateOne: {
        filter: { customerId: customer._id, network: networkId },
        update: {
          $setOnInsert: {
            customerId: customer._id,
            chain: chainByNetwork[networkId] || networkId.toLowerCase(),
            network: networkId,
            accountIndex: customer.walletAccountIndex,
            status: 'awaiting_signer',
          },
        },
        upsert: true,
      },
    })),
    { ordered: true },
  );
}

async function createSession(customer, req, res) {
  const token = auth.createSessionToken();
  const userAgent = String(req.get('user-agent') || '').slice(0, 500);
  await CustomerSession.create({
    customerId: customer._id,
    tokenHash: auth.hashToken(token),
    expiresAt: new Date(Date.now() + auth.SESSION_SECONDS * 1000),
    userAgentHash: crypto.createHash('sha256').update(userAgent).digest('hex'),
  });
  customer.lastLoginAt = new Date();
  await customer.save();
  issueSessionCookie(res, token);
}

router.get('/features', async (_req, res, next) => {
  try {
  const providersReady = authProvidersReady();
  const signer = await BscSignerHeartbeat.findOne({ name: 'local-bsc-signer', chainId: 56, masterAddress: config.bsc.masterAddress.toLowerCase(), gasAddress: config.bsc.gasAddress.toLowerCase() }).select('lastSeenAt').lean();
  const signerOnline = Boolean(signer && Date.now() - signer.lastSeenAt.getTime() <= 60_000);
  const indexer = await BscIndexerHeartbeat.findOne({ name: 'bsc-usdt-bep20' }).select('lastSeenAt').lean();
  const indexerOnline = Boolean(indexer && Date.now() - indexer.lastSeenAt.getTime() <= 60_000);
  res.json({
    accounts: {
      registration: providersReady,
      verification: authChannelsReady() ? ['email', 'sms'] : [],
      status: providersReady ? 'ready' : 'configuration_required',
      recovery: authChannelsReady() && mongoTransactionsReady() && auth.publicAppOriginReady(),
      requirements: {
        email: Boolean(process.env.BREVO_API_KEY?.trim() && process.env.BREVO_SENDER_EMAIL?.trim()),
        sms: Boolean(process.env.INFOBIP_API_KEY?.trim() && process.env.INFOBIP_SENDER?.trim()),
        sessionSecret: (process.env.CUSTOMER_AUTH_SECRET || '').length >= 32,
        publicAppOrigin: auth.publicAppOriginReady(),
        mongoTransactions: mongoTransactionsReady(),
        legalReview: process.env.CUSTOMER_LEGAL_REVIEWED === 'true',
        termsVersion: Boolean(process.env.CUSTOMER_TERMS_VERSION?.trim()),
        privacyVersion: Boolean(process.env.CUSTOMER_PRIVACY_VERSION?.trim()),
        termsUrl: Boolean(publicPolicyUrl(process.env.CUSTOMER_TERMS_URL)),
        privacyUrl: Boolean(publicPolicyUrl(process.env.CUSTOMER_PRIVACY_URL)),
      },
      policies: {
        termsUrl: publicPolicyUrl(process.env.CUSTOMER_TERMS_URL),
        privacyUrl: publicPolicyUrl(process.env.CUSTOMER_PRIVACY_URL),
      },
    },
    identity: { status: 'manual_admin_review', enabled: true },
    custody: {
      wallets: { enabled: bscWallet.bscConfigStatus().xpub, status: bscWallet.bscConfigStatus().xpub ? 'bsc_xpub_configured' : 'bsc_xpub_missing' },
      deposits: { enabled: Boolean(config.bsc.depositsEnabled && indexerOnline), status: indexerOnline ? 'indexer_online' : 'indexer_offline' },
      withdrawals: { enabled: Boolean(config.bsc.withdrawalsEnabled && signerOnline && mongoTransactionsReady()), status: signerOnline ? 'configured' : 'self_hosted_signer_offline' },
      staking: { enabled: false, status: 'product_not_configured' },
    },
  });
  } catch (error) {
    next(error);
  }
});

router.post('/register', authLimiter, auth.requireSameOrigin, async (req, res, next) => {
  try {
    if (!authProvidersReady()) {
      return res.status(503).json({
        error:
          'L’inscription reste fermée jusqu’à la configuration des canaux de vérification et des documents juridiques publiés et validés.',
      });
    }
    const firstName = String(req.body.firstName || '').trim();
    const lastName = String(req.body.lastName || '').trim();
    const email = normalizeEmail(req.body.email);
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || '');
    if (
      firstName.length < 2 ||
      firstName.length > 80 ||
      lastName.length < 2 ||
      lastName.length > 80
    ) {
      return res
        .status(400)
        .json({ error: 'Vérifiez votre prénom et votre nom (2 à 80 caractères).' });
    }
    if (email.length > 254 || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Adresse e-mail invalide.' });
    }
    if (!phone) {
      return res
        .status(400)
        .json({ error: 'Indiquez un numéro international valide, avec son indicatif.' });
    }
    if (password.length < 12 || password.length > 128) {
      return res.status(400).json({ error: 'Choisissez un mot de passe de 12 à 128 caractères.' });
    }
    if (req.body.acceptTerms !== true || req.body.acceptPrivacy !== true) {
      return res.status(400).json({
        error: 'Acceptez les conditions et la politique de confidentialité pour continuer.',
      });
    }
    const existingCustomer = await Customer.findOne({ $or: [{ email }, { phone }] }).select(
      challengeSelect,
    );
    if (existingCustomer) {
      if (
        existingCustomer.status !== 'pending_verification' ||
        existingCustomer.email !== email ||
        existingCustomer.phone !== phone
      ) {
        return res.status(409).json({ error: 'Un compte utilise déjà cet e-mail ou ce numéro.' });
      }
      const credentials = await auth.hashPassword(password);
      existingCustomer.passwordHash = credentials.hash;
      existingCustomer.passwordSalt = credentials.salt;
      existingCustomer.termsAcceptedAt = new Date();
      existingCustomer.privacyAcceptedAt = new Date();
      existingCustomer.termsVersion = process.env.CUSTOMER_TERMS_VERSION.trim();
      existingCustomer.privacyVersion = process.env.CUSTOMER_PRIVACY_VERSION.trim();
      const codes = createChallenges(existingCustomer);
      await existingCustomer.save();
      await ensureWalletPlaceholders(existingCustomer);
      try {
        await deliverChallenges(existingCustomer, codes);
      } catch (deliveryError) {
        return res.status(503).json({ error: deliveryError.message, accountCreated: true });
      }
      return res.status(202).json({
        message: 'Compte en attente retrouvé. De nouveaux codes ont été envoyés.',
        accountCreated: true,
        expiresInSeconds: auth.OTP_MINUTES * 60,
      });
    }

    const credentials = await auth.hashPassword(password);
    const accountIndex = await allocateWalletAccountIndex();
    const customer = new Customer({
      firstName,
      lastName,
      email,
      phone,
      passwordHash: credentials.hash,
      passwordSalt: credentials.salt,
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      termsVersion: process.env.CUSTOMER_TERMS_VERSION.trim(),
      privacyVersion: process.env.CUSTOMER_PRIVACY_VERSION.trim(),
      status: 'pending_verification',
      walletAccountIndex: accountIndex,
    });
    const codes = createChallenges(customer);
    await customer.save();
    await ensureWalletPlaceholders(customer);
    try {
      await deliverChallenges(customer, codes);
    } catch (deliveryError) {
      return res.status(503).json({ error: deliveryError.message, accountCreated: true });
    }
    res.status(201).json({
      message: 'Codes envoyés. Vérifiez votre e-mail et votre téléphone pour activer le compte.',
      expiresInSeconds: auth.OTP_MINUTES * 60,
    });
  } catch (error) {
    if (error.code === 11000)
      return res.status(409).json({ error: 'Un compte utilise déjà cet e-mail ou ce numéro.' });
    next(error);
  }
});

router.post('/resend-code', resendLimiter, auth.requireSameOrigin, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const phone = normalizePhone(req.body.phone);
    if (!email || !phone) return res.status(400).json({ error: 'E-mail ou téléphone invalide.' });
    const customer = await Customer.findOne({ email, phone }).select(challengeSelect);
    if (customer && customer.status === 'pending_verification' && authChannelsReady()) {
      const codes = createChallenges(customer);
      await customer.save();
      await deliverChallenges(customer, codes);
    }
    res.status(202).json({
      message: 'Si le compte attend une vérification, de nouveaux codes ont été envoyés.',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/verify', authLimiter, auth.requireSameOrigin, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const phone = normalizePhone(req.body.phone);
    const emailCode = String(req.body.emailCode || '').trim();
    const phoneCode = String(req.body.phoneCode || '').trim();
    const now = new Date();
    const customer = await Customer.findOneAndUpdate(
      {
        email,
        phone,
        status: 'pending_verification',
        'emailChallenge.expiresAt': { $gt: now },
        'phoneChallenge.expiresAt': { $gt: now },
        'emailChallenge.attempts': { $lt: challengeMaxAttempts },
        'phoneChallenge.attempts': { $lt: challengeMaxAttempts },
      },
      { $inc: { 'emailChallenge.attempts': 1, 'phoneChallenge.attempts': 1 } },
      { new: true },
    ).select(challengeSelect);
    if (!customer || customer.status !== 'pending_verification') {
      return res.status(400).json({ error: 'Les codes sont invalides ou expirés.' });
    }
    const emailValid = customer.emailVerifiedAt || checkCode(customer, 'email', emailCode);
    const phoneValid = customer.phoneVerifiedAt || checkCode(customer, 'phone', phoneCode);
    if (!emailValid || !phoneValid) {
      return res.status(400).json({ error: 'Les codes sont invalides, épuisés ou expirés.' });
    }
    const activation = await Customer.updateOne(
      { _id: customer._id, status: 'pending_verification' },
      {
        $set: {
          emailVerifiedAt: now,
          phoneVerifiedAt: now,
          emailChallenge: {},
          phoneChallenge: {},
          status: 'active',
        },
      },
    );
    if (activation.modifiedCount !== 1) {
      return res.status(400).json({ error: 'Ces codes ont déjà été utilisés. Connectez-vous.' });
    }
    const activatedCustomer = await Customer.findById(customer._id);
    await createSession(activatedCustomer, req, res);
    res.json({ customer: auth.publicCustomer(activatedCustomer) });
  } catch (error) {
    next(error);
  }
});

router.post('/login', authLimiter, auth.requireSameOrigin, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    if (email.length > 254 || password.length > 128) {
      return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
    }
    const customer = await Customer.findOne({ email }).select('+passwordHash +passwordSalt');
    const valid = customer
      ? await auth.verifyPassword(password, customer.passwordSalt, customer.passwordHash)
      : await auth.verifyPassword(
          password || 'invalid-customer-login-placeholder',
          '00000000000000000000000000000000',
          '00'.repeat(64),
        );
    if (!customer || !valid)
      return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
    if (customer.status === 'locked' || customer.status === 'closed') {
      return res.status(403).json({ error: 'Ce compte est temporairement indisponible.' });
    }
    if (customer.status !== 'active' || !customer.emailVerifiedAt || !customer.phoneVerifiedAt) {
      return res
        .status(403)
        .json({ error: 'Vérifiez votre e-mail et votre téléphone avant de vous connecter.' });
    }
    if (!authChannelsReady()) {
      return res
        .status(503)
        .json({ error: 'La double vérification e-mail/SMS est momentanément indisponible.' });
    }
    const challengeId = auth.createSessionToken();
    const challengeHash = auth.hashToken(challengeId);
    const emailCode = auth.makeOtp();
    const phoneCode = auth.makeOtp();
    await CustomerLoginChallenge.create({
      customerId: customer._id,
      purpose: 'login',
      challengeHash,
      emailCodeHash: auth.loginOtpHash(customer._id, challengeHash, 'email', emailCode),
      phoneCodeHash: auth.loginOtpHash(customer._id, challengeHash, 'phone', phoneCode),
      expiresAt: new Date(Date.now() + challengeTtlMs),
    });
    try {
      await deliverChallenges(customer, { emailCode, phoneCode });
    } catch (deliveryError) {
      await CustomerLoginChallenge.deleteOne({ challengeHash, usedAt: null });
      return res.status(503).json({ error: deliveryError.message });
    }
    res.json({
      challengeId,
      expiresInSeconds: auth.OTP_MINUTES * 60,
      message: 'Codes de connexion envoyés par e-mail et SMS.',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/login/verify', authLimiter, auth.requireSameOrigin, async (req, res, next) => {
  try {
    const challengeId = String(req.body.challengeId || '');
    const emailCode = String(req.body.emailCode || '').trim();
    const phoneCode = String(req.body.phoneCode || '').trim();
    if (
      challengeId.length < 40 ||
      challengeId.length > 64 ||
      !/^\d{6}$/.test(emailCode) ||
      !/^\d{6}$/.test(phoneCode)
    ) {
      return res.status(400).json({ error: 'Codes ou défi de connexion invalides.' });
    }
    const challengeHash = auth.hashToken(challengeId);
    const challenge = await CustomerLoginChallenge.findOneAndUpdate(
      {
        challengeHash,
        purpose: 'login',
        usedAt: null,
        expiresAt: { $gt: new Date() },
        attempts: { $lt: challengeMaxAttempts },
      },
      { $inc: { attempts: 1 } },
      { new: true },
    ).select('+challengeHash +emailCodeHash +phoneCodeHash');
    if (!challenge)
      return res.status(400).json({ error: 'Défi expiré ou invalide. Recommencez la connexion.' });
    const [emailValid, phoneValid] = await Promise.all([
      Promise.resolve(
        auth.safeEqualHex(
          challenge.emailCodeHash,
          auth.loginOtpHash(challenge.customerId, challengeHash, 'email', emailCode),
        ),
      ),
      Promise.resolve(
        auth.safeEqualHex(
          challenge.phoneCodeHash,
          auth.loginOtpHash(challenge.customerId, challengeHash, 'phone', phoneCode),
        ),
      ),
    ]);
    if (!emailValid || !phoneValid) {
      return res.status(400).json({ error: 'Un ou plusieurs codes sont incorrects.' });
    }
    const claimed = await CustomerLoginChallenge.findOneAndUpdate(
      {
        _id: challenge._id,
        usedAt: null,
        expiresAt: { $gt: new Date() },
      },
      { $set: { usedAt: new Date() } },
      { new: true },
    );
    if (!claimed)
      return res
        .status(400)
        .json({ error: 'Défi déjà utilisé ou expiré. Recommencez la connexion.' });
    const customer = await Customer.findById(challenge.customerId);
    if (
      !customer ||
      customer.status !== 'active' ||
      !customer.emailVerifiedAt ||
      !customer.phoneVerifiedAt
    ) {
      return res.status(403).json({ error: 'Ce compte ne peut pas ouvrir de session.' });
    }
    await createSession(customer, req, res);
    res.json({ customer: auth.publicCustomer(customer) });
  } catch (error) {
    next(error);
  }
});

router.post('/password/forgot', recoveryLimiter, auth.requireSameOrigin, async (req, res, next) => {
  try {
    if (!authChannelsReady() || !mongoTransactionsReady()) {
      return res.status(503).json({
        error: 'La récupération exige les canaux e-mail/SMS et une base MongoDB en replica set.',
      });
    }
    const email = normalizeEmail(req.body.email);
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'Indiquez une adresse e-mail valide.' });
    }
    const customer = await Customer.findOne({
      email,
      status: 'active',
      emailVerifiedAt: { $ne: null },
      phoneVerifiedAt: { $ne: null },
    });
    const challengeCustomerId = customer?._id || new mongoose.Types.ObjectId();
    const challengeId = auth.createSessionToken();
    const challengeHash = auth.hashToken(challengeId);
    const emailCode = auth.makeOtp();
    const phoneCode = auth.makeOtp();
    await CustomerLoginChallenge.create({
      customerId: challengeCustomerId,
      purpose: 'password_reset',
      challengeHash,
      emailCodeHash: auth.otpHash(
        challengeCustomerId,
        `recovery:${challengeHash}:email`,
        emailCode,
      ),
      phoneCodeHash: auth.otpHash(
        challengeCustomerId,
        `recovery:${challengeHash}:phone`,
        phoneCode,
      ),
      expiresAt: new Date(Date.now() + challengeTtlMs),
    });
    if (customer) {
      try {
        await deliverChallenges(customer, { emailCode, phoneCode });
      } catch {
        await CustomerLoginChallenge.deleteOne({ challengeHash, usedAt: null });
      }
    }
    res.status(202).json({
      challengeId,
      expiresInSeconds: auth.OTP_MINUTES * 60,
      message:
        'Si un compte actif correspond à cette adresse, les codes de récupération ont été envoyés.',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/password/reset', recoveryLimiter, auth.requireSameOrigin, async (req, res, next) => {
  try {
    const challengeId = String(req.body.challengeId || '');
    const emailCode = String(req.body.emailCode || '').trim();
    const phoneCode = String(req.body.phoneCode || '').trim();
    const password = String(req.body.password || '');
    if (
      challengeId.length < 40 ||
      challengeId.length > 64 ||
      !/^\d{6}$/.test(emailCode) ||
      !/^\d{6}$/.test(phoneCode)
    ) {
      return res.status(400).json({ error: 'Défi ou codes de récupération invalides.' });
    }
    if (password.length < 12 || password.length > 128) {
      return res.status(400).json({ error: 'Choisissez un mot de passe de 12 à 128 caractères.' });
    }
    const challengeHash = auth.hashToken(challengeId);
    const challenge = await CustomerLoginChallenge.findOneAndUpdate(
      {
        challengeHash,
        purpose: 'password_reset',
        usedAt: null,
        expiresAt: { $gt: new Date() },
        attempts: { $lt: challengeMaxAttempts },
      },
      { $inc: { attempts: 1 } },
      { new: true },
    ).select('+emailCodeHash +phoneCodeHash');
    if (!challenge) {
      return res
        .status(400)
        .json({ error: 'Défi expiré ou invalide. Recommencez la récupération.' });
    }
    const emailValid = auth.safeEqualHex(
      challenge.emailCodeHash,
      auth.otpHash(challenge.customerId, `recovery:${challengeHash}:email`, emailCode),
    );
    const phoneValid = auth.safeEqualHex(
      challenge.phoneCodeHash,
      auth.otpHash(challenge.customerId, `recovery:${challengeHash}:phone`, phoneCode),
    );
    if (!emailValid || !phoneValid) {
      return res.status(400).json({ error: 'Un ou plusieurs codes sont incorrects.' });
    }
    const credentials = await auth.hashPassword(password);
    const session = await mongoose.startSession();
    let resetComplete = false;
    try {
      await session.withTransaction(async () => {
        resetComplete = false;
        const claimed = await CustomerLoginChallenge.findOneAndUpdate(
          {
            _id: challenge._id,
            purpose: 'password_reset',
            usedAt: null,
            expiresAt: { $gt: new Date() },
          },
          { $set: { usedAt: new Date() } },
          { new: true, session },
        );
        if (!claimed) return;
        const changed = await Customer.updateOne(
          {
            _id: challenge.customerId,
            status: 'active',
            emailVerifiedAt: { $ne: null },
            phoneVerifiedAt: { $ne: null },
          },
          { $set: { passwordHash: credentials.hash, passwordSalt: credentials.salt } },
          { session },
        );
        if (changed.modifiedCount !== 1) {
          const failure = new Error('Ce compte ne peut pas réinitialiser son mot de passe.');
          failure.code = 'CUSTOMER_RESET_REJECTED';
          throw failure;
        }
        await CustomerSession.updateMany(
          { customerId: challenge.customerId, revokedAt: null },
          { $set: { revokedAt: new Date() } },
          { session },
        );
        resetComplete = true;
      });
    } catch (error) {
      if (error.code === 'CUSTOMER_RESET_REJECTED') {
        return res.status(400).json({ error: error.message });
      }
      if (/replica set|transaction numbers are only allowed/i.test(error.message || '')) {
        return res.status(503).json({
          error: 'La récupération exige MongoDB en replica set pour révoquer les sessions de façon atomique.',
        });
      }
      return next(error);
    } finally {
      await session.endSession();
    }
    if (!resetComplete) {
      return res.status(400).json({ error: 'Ces codes ont déjà été utilisés ou le compte est indisponible.' });
    }
    res.json({
      message: 'Mot de passe modifié. Reconnectez-vous avec votre nouveau mot de passe.',
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me', customerAuth, (req, res) => {
  const remainingSeconds = Math.floor((req.customerSession.expiresAt.getTime() - Date.now()) / 1000);
  auth.setSessionCookie(res, auth.sessionCookie(req), remainingSeconds);
  res.json({ customer: req.publicCustomer });
});

router.get('/watchlist', customerAuth, (req, res) => {
  res.json({ assets: req.customer.watchlist || [] });
});

router.put('/watchlist', customerAuth, auth.requireSameOrigin, async (req, res, next) => {
  try {
    const assets = req.body?.assets;
    const allowedAssets = new Set(cryptoAssets.map((asset) => asset.id));
    if (
      !Array.isArray(assets) ||
      assets.length > allowedAssets.size ||
      assets.some((asset) => typeof asset !== 'string' || !allowedAssets.has(asset)) ||
      new Set(assets).size !== assets.length
    ) {
      return res.status(400).json({ error: 'Liste de favoris invalide.' });
    }
    const customer = await Customer.findByIdAndUpdate(
      req.customer._id,
      { $set: { watchlist: assets } },
      { new: true, runValidators: true },
    ).select('watchlist');
    return res.json({ assets: customer?.watchlist || [] });
  } catch (error) {
    return next(error);
  }
});

router.get('/sessions', customerAuth, async (req, res, next) => {
  try {
    const now = new Date();
    const currentTokenHash = auth.hashToken(auth.sessionCookie(req));
    const activeFilter = {
      customerId: req.customer._id,
      revokedAt: null,
      expiresAt: { $gt: now },
    };
    const [sessions, activeSessionCount] = await Promise.all([
      CustomerSession.find(activeFilter)
        .select('+tokenHash createdAt expiresAt')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      CustomerSession.countDocuments(activeFilter),
    ]);
    res.json({
      activeSessionCount,
      sessions: sessions.map((session) => ({
        id: String(session._id),
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        current: session.tokenHash === currentTokenHash,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/sessions/revoke-others', customerAuth, auth.requireSameOrigin, async (req, res, next) => {
  try {
    const now = new Date();
    const currentTokenHash = auth.hashToken(auth.sessionCookie(req));
    const result = await CustomerSession.updateMany(
      {
        customerId: req.customer._id,
        tokenHash: { $ne: currentTokenHash },
        revokedAt: null,
        expiresAt: { $gt: now },
      },
      { $set: { revokedAt: now } },
    );
    res.json({ revokedCount: result.modifiedCount });
  } catch (error) {
    next(error);
  }
});

router.get('/wallets', customerAuth, async (req, res, next) => {
  try {
    const derivedAddress = bscWallet.deriveCustomerAddress(req.customer.walletAccountIndex);
    if (derivedAddress) {
      await Wallet.updateOne(
        { customerId: req.customer._id, network: 'BEP20' },
        { $set: { chain: 'bsc', network: 'BEP20', accountIndex: req.customer.walletAccountIndex, address: derivedAddress, derivationPath: `m/44'/60'/0'/0/${req.customer.walletAccountIndex}`, keyVersion: 1, status: 'active' } },
        { upsert: true, setDefaultsOnInsert: true },
      );
    }
    const storedWallets = await Wallet.find({ customerId: req.customer._id })
      .select('chain network address status createdAt')
      .sort({ chain: 1, network: 1 })
      .lean();
    const indexer = await BscIndexerHeartbeat.findOne({ name: 'bsc-usdt-bep20' }).select('lastSeenAt').lean();
    const canReceiveAddresses = Boolean(derivedAddress && config.bsc.depositsEnabled && indexer && Date.now() - indexer.lastSeenAt.getTime() <= 60_000) && req.customer.kycStatus === 'approved';
    const wallets = storedWallets.map((wallet) => ({
      ...wallet,
      address: canReceiveAddresses && wallet.status === 'active' ? wallet.address : null,
    }));
    res.json({ wallets });
  } catch (error) {
    next(error);
  }
});

router.post('/withdrawals', withdrawalLimiter, customerAuth, auth.requireSameOrigin, async (req, res, next) => {
  let withdrawal;
  let transferJob;
  let ledgerPosted = false;
  try {
    const customer = req.customer;
    if (!config.bsc.withdrawalsEnabled) return res.status(503).json({ error: 'Les retraits BSC ne sont pas encore activés.' });
    if (customer.status !== 'active' || !customer.emailVerifiedAt || !customer.phoneVerifiedAt || customer.kycStatus !== 'approved') {
      return res.status(403).json({ error: 'Compte vérifié et KYC approuvé requis pour retirer.' });
    }
    const heartbeat = await BscSignerHeartbeat.findOne({ name: 'local-bsc-signer', chainId: 56, masterAddress: config.bsc.masterAddress.toLowerCase(), gasAddress: config.bsc.gasAddress.toLowerCase() }).lean();
    if (!heartbeat || Date.now() - heartbeat.lastSeenAt.getTime() > 60_000) {
      return res.status(503).json({ error: 'Le signataire local DAE est hors ligne. Réessayez plus tard.' });
    }
    const destination = String(req.body?.destination || '').trim();
    if (!isAddress(destination)) return res.status(400).json({ error: 'Adresse BSC de destination invalide.' });
    const amountText = String(req.body?.amount || '').trim();
    let amountAtomic;
    try { amountAtomic = parseUnits(amountText, 18).toString(); }
    catch { return res.status(400).json({ error: 'Montant invalide : maximum 18 décimales.' }); }
    if (BigInt(amountAtomic) <= 0n) return res.status(400).json({ error: 'Le montant doit être supérieur à zéro.' });
    const idempotencyKey = String(req.get('idempotency-key') || req.body?.idempotencyKey || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return res.status(400).json({ error: 'Clé d’idempotence UUID requise.' });
    const requestHash = crypto.createHash('sha256').update(JSON.stringify({
      customerId: String(customer._id), destination: destination.toLowerCase(), amountAtomic,
    })).digest('hex');
    const existing = await Withdrawal.findOne({ idempotencyKey });
    if (existing) {
      if (existing.requestHash !== requestHash || String(existing.customerId) !== String(customer._id)) {
        return res.status(409).json({ error: 'Clé d’idempotence réutilisée avec d’autres détails.' });
      }
      return res.status(200).json({ withdrawal: { id: String(existing._id), status: existing.status, txHash: existing.txHash } });
    }

    withdrawal = await Withdrawal.create({
      customerId: customer._id, asset: 'USDT', network: 'BEP20', destination,
      amountAtomic, decimals: 18, feeAtomic: '0', idempotencyKey, requestHash, status: 'queued',
    });
    transferJob = await BscTransferJob.create({
      kind: 'withdrawal', status: 'queued', idempotencyKey: `bsc-withdraw:${idempotencyKey}`,
      sourceAddress: config.bsc.masterAddress, destination, amountAtomic, withdrawalId: withdrawal._id,
    });
    const ledger = await postLedgerTransaction({
      type: 'withdrawal', idempotencyKey: `bsc-withdrawal-reserve:${idempotencyKey}`,
      sourceRef: String(withdrawal._id), createdBy: `customer:${customer._id}`,
      postings: [
        { accountRef: `customer:${customer._id}:available`, asset: 'USDT', network: 'BEP20', decimals: 18, side: 'debit', amountAtomic },
        { accountRef: `customer:${customer._id}:reserved`, asset: 'USDT', network: 'BEP20', decimals: 18, side: 'credit', amountAtomic },
      ],
    });
    ledgerPosted = true;
    await Withdrawal.updateOne({ _id: withdrawal._id }, { $set: { ledgerReference: ledger.transaction.reference } });
    return res.status(202).json({ withdrawal: { id: String(withdrawal._id), status: 'queued', amount: amountText, asset: 'USDT', network: 'BEP20' } });
  } catch (error) {
    if (transferJob && !ledgerPosted) await BscTransferJob.deleteOne({ _id: transferJob._id, status: 'queued' }).catch(() => {});
    if (withdrawal && !ledgerPosted && error.code !== 11000) {
      await Withdrawal.deleteOne({ _id: withdrawal._id, status: 'queued' }).catch(() => {});
    }
    return next(error);
  }
});

router.get('/balances', customerAuth, async (req, res, next) => {
  try {
    const balances = await getCustomerLedgerBalances(req.customer._id);
    res.json({ balances, source: 'internal_ledger', assetMovementsEnabled: false });
  } catch (error) {
    next(error);
  }
});

router.get('/funding-activity', customerAuth, async (req, res, next) => {
  try {
    const pageSize = 25;
    const types = ['deposit', 'withdrawal', 'staking'];
    const requestedType = String(req.query.type || 'all');
    if (requestedType !== 'all' && !types.includes(requestedType)) {
      return res.status(400).json({ error: 'Type d’opération invalide.' });
    }
    let cursorFilter = {};
    if (req.query.cursor) {
      if (typeof req.query.cursor !== 'string' || req.query.cursor.length > 256) {
        return res.status(400).json({ error: 'Curseur invalide.' });
      }
      try {
        const decoded = JSON.parse(Buffer.from(req.query.cursor, 'base64url').toString('utf8'));
        const createdAt = new Date(decoded.createdAt);
        if (!mongoose.isValidObjectId(decoded.id) || Number.isNaN(createdAt.getTime())) throw new Error();
        cursorFilter = { $or: [{ createdAt: { $lt: createdAt } }, { createdAt, _id: { $lt: decoded.id } }] };
      } catch {
        return res.status(400).json({ error: 'Curseur invalide.' });
      }
    }
    const models = [
      { type: 'deposit', model: Deposit },
      { type: 'withdrawal', model: Withdrawal },
      { type: 'staking', model: StakePosition },
    ].filter((entry) => requestedType === 'all' || requestedType === entry.type);
    const rows = (await Promise.all(
      models.map(({ type, model }) => model.find({ customerId: req.customer._id, ...cursorFilter })
        .select('asset network amountAtomic feeAtomic decimals status txHash createdAt productId lockDays rewardRateBps startsAt maturesAt')
        .sort({ createdAt: -1, _id: -1 })
        .limit(pageSize + 1)
        .lean()
        .then((items) => items.map((item) => ({ ...item, type }))),
      ),
    )).flat()
      .flat().sort((a, b) => b.createdAt - a.createdAt || String(b._id).localeCompare(String(a._id)));
    const page = rows.slice(0, pageSize);
    const safeAmount = (atomic, decimals) => {
      if (!/^(0|[1-9][0-9]{0,77})$/.test(String(atomic ?? '')) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
      const digits = String(atomic).padStart(decimals + 1, '0');
      return decimals ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : digits;
    };
    const activities = page.map((item) => ({
      id: String(item._id), type: item.type, status: item.status, asset: item.asset,
      network: item.network, amount: safeAmount(item.amountAtomic, item.decimals),
      fee: item.type === 'withdrawal' ? safeAmount(item.feeAtomic, item.decimals) : null,
      reference: item.txHash || null, createdAt: item.createdAt,
      ...(item.type === 'staking' ? { productId: item.productId, lockDays: item.lockDays, rewardRateBps: item.rewardRateBps, startsAt: item.startsAt, maturesAt: item.maturesAt } : {}),
    }));
    const hasMore = rows.length > pageSize;
    const last = page.at(-1);
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: String(last._id) })).toString('base64url')
      : null;
    return res.json({ activities, pagination: { pageSize, hasMore, nextCursor }, assetMovementsEnabled: false });
  } catch (error) {
    return next(error);
  }
});

router.get('/orders', customerAuth, async (req, res, next) => {
  try {
    const filter = { customerId: req.customer._id };
    const pageSize = 20;
    const requestedPage = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const total = await Order.countDocuments(filter);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pages);
    const orders = await Order.find(filter)
      .select('ref mode asset amountCrypto amountUsdt amountXaf rateApplied network status createdAt updatedAt')
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();
    res.json({
      orders: orders.map((order) => ({
        ...order,
        amountCrypto: order.amountCrypto == null ? null : String(order.amountCrypto),
        amountUsdt: order.amountUsdt == null ? null : String(order.amountUsdt),
      })),
      pagination: { page, pageSize, total, pages },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', auth.requireSameOrigin, async (req, res, next) => {
  try {
    const token = auth.sessionCookie(req);
    if (token) {
      await CustomerSession.updateOne(
        { tokenHash: auth.hashToken(token), revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
    }
    auth.clearSessionCookie(res);
    res.json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
