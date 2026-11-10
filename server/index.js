'use strict';

const path = require('path');
const fs = require('node:fs/promises');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { config, validate } = require('./config/index');
const { logger } = require('./lib/logger');
const { safeRequestPath } = require('./lib/requestLog');
const connectDB = require('./config/db');
const { migrateLegacySellRate } = require('./services/rateMigration');
const { migrateWalletAddressIndex } = require('./services/walletIndexMigration');
const { drainEmailOutbox } = require('./services/emailOutbox');
const errorHandler = require('./middleware/errorHandler');
const SiteConfig = require('./models/SiteConfig');

validate();

const app = express();
app.set('trust proxy', 1);

// Request ID middleware (doit être le premier)
app.use((req, res, next) => {
  const suppliedRequestId = String(req.get('x-request-id') || '');
  req.id = /^[A-Za-z0-9_-]{8,64}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID();
  res.set('x-request-id', req.id);
  next();
});

// Logging middleware
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info(
      {
        req: { id: req.id, method: req.method, path: safeRequestPath(req) },
        res: { status: res.statusCode },
        durationMs: Math.round(durationMs),
      },
      `${req.method} ${safeRequestPath(req)} ${res.statusCode} ${Math.round(durationMs)}ms`,
    );
  });
  next();
});

// Security headers (CSP activée en production)
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.tailwindcss.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        imgSrc: ["'self'", 'data:', 'https://cdn.simpleicons.org', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ['https://fonts.gstatic.com'],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        upgradeInsecureRequests: config.node === 'production' ? [] : null,
      },
    },
    hsts: config.node === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  }),
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/healthz', async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ status: 'unavailable', database: 'disconnected' });
    }
    res.json({ status: 'ok' });
  } catch (_err) {
    res.status(503).json({ status: 'unavailable' });
  }
});

const publicDirectory = path.join(__dirname, '..', 'public');
let maintenanceCache = { checkedAt: 0, enabled: false, message: '' };
const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character];
  });
app.use(async (req, res, next) => {
  if (
    req.path === '/healthz' ||
    req.path === '/admin' ||
    req.path.startsWith('/api/admin') ||
    path.extname(req.path)
  )
    return next();

  try {
    if (Date.now() - maintenanceCache.checkedAt > config.maintenance.checkMs) {
      const cfg = await SiteConfig.findOne({ key: 'main' }).select('maintenance').lean();
      maintenanceCache = {
        checkedAt: Date.now(),
        enabled: Boolean(cfg?.maintenance?.enabled),
        message:
          cfg?.maintenance?.message ||
          'Le site est temporairement en maintenance. Revenez bientôt.',
      };
    }
    if (!maintenanceCache.enabled) return next();
    if (req.path.startsWith('/api/')) {
      return res.status(503).json({
        error: maintenanceCache.message,
        maintenance: true,
      });
    }
    const maintenanceHtml = await fs.readFile(
      path.join(publicDirectory, 'maintenance.html'),
      'utf8',
    );
    res
      .status(503)
      .type('html')
      .send(
        maintenanceHtml.replace(
          '<!-- MAINTENANCE_MESSAGE -->',
          escapeHtml(maintenanceCache.message),
        ),
      );
  } catch (error) {
    next(error);
  }
});

const cleanPages = {
  '/': 'index.html',
  '/admin': 'index.html',
  '/acheter': 'index.html',
  '/vendre': 'index.html',
  '/envoyer': 'index.html',
  '/attente': 'index.html',
  '/contact': 'index.html',
  '/suivi': 'index.html',
  '/inscription': 'index.html',
  '/connexion': 'index.html',
  '/mot-de-passe-oublie': 'index.html',
  '/compte': 'index.html',
  '/profil': 'index.html',
  '/portefeuille': 'index.html',
  '/transactions': 'index.html',
  '/depot': 'index.html',
  '/retrait': 'index.html',
  '/staking': 'index.html',
  '/verification': 'index.html',
  '/securite': 'index.html',
};
const legacyPages = {
  '/admin.html': '/admin',
  '/achat.html': '/acheter',
  '/vente.html': '/vendre',
  '/attente.html': '/attente',
  '/contact.html': '/contact',
  '/suivi.html': '/suivi',
  '/index.html': '/',
};

for (const [route, filename] of Object.entries(cleanPages)) {
  app.get(route, (_req, res, next) => {
    res.sendFile(path.join(publicDirectory, 'app', filename), (error) => {
      if (error) next(error);
    });
  });
}
for (const [legacyPath, cleanPath] of Object.entries(legacyPages)) {
  app.get(legacyPath, (req, res) => {
    const query = req.originalUrl.includes('?')
      ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
      : '';
    res.redirect(301, `${cleanPath}${query}`);
  });
}
app.use(express.static(publicDirectory));

const orderLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });
const contactLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
const marketLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120 });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
const adminLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

app.use('/api/rates', require('./routes/rates'));
app.use('/api/markets', marketLimiter, require('./routes/markets'));
app.use('/api/config', require('./routes/config'));
app.use('/api/earn', require('./routes/earn'));
app.use('/api/account', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api/account', require('./routes/account'));
app.use('/api/contact', contactLimiter, require('./routes/contact'));
app.use(
  '/api/orders',
  (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  },
  orderLimiter,
  require('./routes/orders'),
);
app.use(
  '/api/admin',
  adminLimiter,
  (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  },
  (req, res, next) => {
    if (req.path === '/auth/login' && req.method === 'POST')
      return adminLoginLimiter(req, res, next);
    next();
  },
  require('./routes/admin'),
);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Route introuvable' }));

app.use(errorHandler);

const PORT = config.port;
connectDB()
  .then(async () => {
    await migrateWalletAddressIndex();
    await migrateLegacySellRate();
    const emailOutboxTimer = setInterval(() => {
      drainEmailOutbox().catch((error) => logger.error({ err: error }, 'Traitement de la file e-mail indisponible'));
    }, 5000);
    emailOutboxTimer.unref();
    const earnRewardsTimer = setInterval(() => {
      require('./jobs/distributeEarnRewards').runEarnRewardJob()
        .catch((error) => logger.error({ err: error }, 'Traitement des récompenses DAE Earn indisponible'));
    }, 15 * 60 * 1000);
    earnRewardsTimer.unref();
    require('./jobs/distributeEarnRewards').runEarnRewardJob()
      .catch((error) => logger.error({ err: error }, 'Traitement initial des récompenses DAE Earn indisponible'));
    drainEmailOutbox().catch((error) => logger.error({ err: error }, 'Traitement initial de la file e-mail indisponible'));
    app.listen(PORT, () => {
      logger.info({ port: PORT, env: config.node }, `Serveur sur http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    logger.fatal({ err }, 'Démarrage impossible');
    process.exit(1);
  });

module.exports = app;
