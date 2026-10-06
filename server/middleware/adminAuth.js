const crypto = require('crypto');

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
  return configured.length > 0
    && given.length === configured.length
    && crypto.timingSafeEqual(given, configured);
}

function createSession(email) {
  return sign({ email, exp: Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS });
}

function isValidSession(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return false;
    const [encodedPayload, signature] = parts;
    if (!encodedPayload || !signature) return false;
    const expected = crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET)
      .update(encodedPayload)
      .digest();
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());
    return payload.email === process.env.ADMIN_EMAIL?.trim().toLowerCase()
      && Number.isInteger(payload.exp)
      && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function login(req, res, next) {
  const configuredEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const configuredPassword = process.env.ADMIN_PASSWORD;
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;
  if (!configuredEmail || !configuredPassword || !sessionSecret || sessionSecret.length < 32) {
    return res.status(503).json({ error: 'Les identifiants admin ne sont pas configurés correctement sur le serveur' });
  }

  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  if (email.length > 254 || password.length > 1024) {
    return res.status(401).json({ error: 'Adresse e-mail ou mot de passe incorrect' });
  }
  if (!safeEqual(email, configuredEmail) || !safeEqual(password, configuredPassword)) {
    return res.status(401).json({ error: 'Adresse e-mail ou mot de passe incorrect' });
  }
  try {
    res.json({ token: createSession(email), expiresIn: SESSION_LIFETIME_SECONDS });
  } catch (err) {
    next(err);
  }
}

module.exports = (req, res, next) => {
  const authorization = req.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!isValidSession(token)) return res.status(401).json({ error: 'Session expirée ou non autorisée' });
  next();
};

module.exports.login = login;
module.exports.createSession = createSession;
