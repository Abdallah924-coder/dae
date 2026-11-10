'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const PASSWORD_KEY_BYTES = 64;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_SECONDS = 12 * 60 * 60;
const OTP_MINUTES = 10;

function authSecret() {
  const secret = process.env.CUSTOMER_AUTH_SECRET || '';
  if (secret.length < 32)
    throw new Error('CUSTOMER_AUTH_SECRET doit contenir 32 caractères minimum');
  return secret;
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = await scrypt(password, salt, PASSWORD_KEY_BYTES, SCRYPT_OPTIONS);
  return { salt, hash: derived.toString('hex') };
}

async function verifyPassword(password, salt, expectedHex) {
  const actual = await scrypt(password, salt, PASSWORD_KEY_BYTES, SCRYPT_OPTIONS);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function makeOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function otpHash(customerId, purpose, code) {
  return crypto
    .createHmac('sha256', authSecret())
    .update(`${customerId}:${purpose}:${code}`)
    .digest('hex');
}

function loginOtpHash(customerId, challengeHash, channel, code) {
  return otpHash(customerId, `login:${challengeHash}:${channel}`, code);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function safeEqualHex(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function publicAppOriginReady() {
  if (process.env.NODE_ENV !== 'production') return true;
  const configuredUrl = process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL;
  if (!configuredUrl) return false;
  try {
    return new URL(configuredUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

function setSessionCookie(res, token, maxAge = SESSION_SECONDS) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const remainingSeconds = Math.max(0, Math.min(SESSION_SECONDS, Math.floor(maxAge)));
  res.setHeader('Set-Cookie', [
    `dae_customer_session=; HttpOnly; SameSite=Strict; Path=/api/account; Max-Age=0${secure}`,
    `dae_customer_session=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${remainingSeconds}${secure}`,
  ]);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', [
    `dae_customer_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure}`,
    `dae_customer_session=; HttpOnly; SameSite=Strict; Path=/api/account; Max-Age=0${secure}`,
  ]);
}

function sessionCookie(req) {
  const entry = String(req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('dae_customer_session='));
  const token = entry ? entry.slice('dae_customer_session='.length) : '';
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
}

function requireSameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return res.status(403).json({ error: 'Origine de requête non autorisée' });
  try {
    const originUrl = new URL(origin);
    const configuredUrl = process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL;
    if (process.env.NODE_ENV === 'production' && !configuredUrl) {
      return res.status(403).json({ error: 'Origine publique canonique non configurée' });
    }
    const configuredOrigin = configuredUrl ? new URL(configuredUrl) : null;
    if (process.env.NODE_ENV === 'production' && configuredOrigin?.protocol !== 'https:') {
      return res.status(403).json({ error: 'L’origine publique doit utiliser HTTPS' });
    }
    const allowed = configuredOrigin
      ? configuredOrigin.origin
      : `${req.protocol}://${req.get('host')}`;
    const localDev =
      process.env.NODE_ENV !== 'production' &&
      ['http://localhost:5173', 'http://127.0.0.1:5173'].includes(originUrl.origin);
    if (originUrl.origin !== allowed && !localDev) {
      return res.status(403).json({ error: 'Origine de requête non autorisée' });
    }
    next();
  } catch {
    res.status(403).json({ error: 'Origine de requête non autorisée' });
  }
}

function publicCustomer(customer) {
  return {
    id: String(customer._id),
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone,
    emailVerified: Boolean(customer.emailVerifiedAt),
    kycStatus: customer.kycStatus,
    status: customer.status,
    createdAt: customer.createdAt,
  };
}

module.exports = {
  SESSION_SECONDS,
  OTP_MINUTES,
  authSecret,
  hashPassword,
  verifyPassword,
  makeOtp,
  otpHash,
  loginOtpHash,
  hashToken,
  safeEqualHex,
  createSessionToken,
  publicAppOriginReady,
  setSessionCookie,
  clearSessionCookie,
  sessionCookie,
  requireSameOrigin,
  publicCustomer,
};
