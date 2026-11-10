'use strict';

const crypto = require('crypto');
const { logger } = require('../lib/logger');

const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;

function sign(payload) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('ADMIN_SESSION_SECRET doit contenir au moins 32 caractères');
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function safeEqual(input, expected) {
  const given = Buffer.from(String(input || ''));
  const configured = Buffer.from(String(expected || ''));
  return (
    configured.length > 0 &&
    given.length === configured.length &&
    crypto.timingSafeEqual(given, configured)
  );
}

function configuredAdmins() {
  const admins = [
    { email: process.env.ADMIN_EMAIL?.trim().toLowerCase(), password: process.env.ADMIN_PASSWORD },
    { email: process.env.ADMIN_SECOND_EMAIL?.trim().toLowerCase(), password: process.env.ADMIN_SECOND_PASSWORD },
  ].filter((admin) => admin.email && admin.password);
  return admins.filter((admin, index) => (
    admin.email.length <= 254 &&
    admin.password.length <= 1024 &&
    admins.findIndex((candidate) => candidate.email === admin.email) === index
  ));
}

function secondAdminConfigured() {
  const admins = configuredAdmins();
  return admins.length === 2 &&
    admins[0].email !== admins[1].email &&
    admins[0].password !== admins[1].password;
}

function createSession(email) {
  return sign({ email, exp: Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS });
}

function sessionEmail(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return null;
    const [encodedPayload, signature] = parts;
    if (!encodedPayload || !signature) return null;
    const expected = crypto
      .createHmac('sha256', process.env.ADMIN_SESSION_SECRET)
      .update(encodedPayload)
      .digest();
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());
    const admin = configuredAdmins().find((candidate) => candidate.email === payload.email);
    return (
      admin &&
      Number.isInteger(payload.exp) &&
      payload.exp > Math.floor(Date.now() / 1000)
    ) ? admin.email : null;
  } catch {
    return null;
  }
}

function login(req, res, next) {
  const admins = configuredAdmins();
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;
  if (!admins.length || !sessionSecret || sessionSecret.length < 32) {
    return res
      .status(503)
      .json({ error: 'Les identifiants admin ne sont pas configurés correctement sur le serveur' });
  }

  const email = String((req.body || {}).email || '')
    .trim()
    .toLowerCase();
  const password = String((req.body || {}).password || '');
  if (email.length > 254 || password.length > 1024) {
    return res.status(401).json({ error: 'Adresse e-mail ou mot de passe incorrect' });
  }
  const admin = admins.find((candidate) => safeEqual(email, candidate.email) && safeEqual(password, candidate.password));
  if (!admin) {
    logger.warn('Tentative de connexion admin échouée');
    return res.status(401).json({ error: 'Adresse e-mail ou mot de passe incorrect' });
  }
  try {
    res.json({ token: createSession(admin.email), email: admin.email, expiresIn: SESSION_LIFETIME_SECONDS });
  } catch (err) {
    next(err);
  }
}

module.exports = (req, res, next) => {
  const authorization = req.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const email = sessionEmail(token);
  if (!email)
    return res.status(401).json({ error: 'Session expirée ou non autorisée' });
  req.adminEmail = email;
  next();
};

module.exports.login = login;
module.exports.createSession = createSession;
module.exports.configuredAdmins = configuredAdmins;
module.exports.secondAdminConfigured = secondAdminConfigured;
module.exports.sessionEmail = sessionEmail;
