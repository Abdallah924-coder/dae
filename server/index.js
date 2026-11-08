'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { config, validate } = require('./config/index');
const { logger } = require('./lib/logger');
const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');
const SiteConfig = require('./models/SiteConfig');

validate();

const app = express();
app.set('trust proxy', 1);

// Request ID middleware (doit être le premier)
app.use((req, res, next) => {
  req.id = req.get('x-request-id') || crypto.randomUUID();
  res.set('x-request-id', req.id);
  next();
});

// Logging middleware
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info({
      req: { method: req.method, url: req.originalUrl, ip: req.ip },
      res: { status: res.statusCode },
      durationMs: Math.round(durationMs),
    }, `${req.method} ${req.originalUrl} ${res.statusCode} ${Math.round(durationMs)}ms`);
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
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/healthz', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ status: 'unavailable', database: 'disconnected' });
    }
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'unavailable' });
  }
});

const publicDirectory = path.join(__dirname, '..', 'public');
let maintenanceCache = { checkedAt: 0, enabled: false, message: '' };
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
    res.status(503).sendFile(path.join(publicDirectory, 'maintenance.html'), (error) => {
      if (error) next(error);
    });
  } catch (error) {
    next(error);
  }
});

const cleanPages = {
  '/': 'index.html',
  '/admin': 'index.html',
  '/acheter': 'index.html',
  '/vendre': 'index.html',
  '/attente': 'index.html',
  '/contact': 'index.html',
  '/suivi': 'index.html',
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
  app.get(route, (req, res, next) => {
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
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
const adminLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

app.use('/api/rates', require('./routes/rates'));
app.use('/api/markets', require('./routes/markets'));
app.use('/api/config', require('./routes/config'));
app.use('/api/contact', contactLimiter, require('./routes/contact'));
app.use('/api/orders', orderLimiter, require('./routes/orders'));
app.use(
  '/api/admin',
  adminLimiter,
  (req, res, next) => {
    if (req.path === '/auth/login' && req.method === 'POST')
      return adminLoginLimiter(req, res, next);
    next();
  },
  require('./routes/admin'),
);
app.use('/api', (req, res) => res.status(404).json({ error: 'Route introuvable' }));

app.use(errorHandler);

const PORT = config.port;
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      logger.info({ port: PORT, env: config.node }, `Serveur sur http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    logger.fatal({ err }, 'Démarrage impossible');
    process.exit(1);
  });

module.exports = app;