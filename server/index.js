require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');

const app = express();
app.set('trust proxy', 1);

// CSP désactivée en dev (Tailwind CDN). À configurer avant la mise en ligne.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.get('/healthz', (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ status: 'unavailable', database: 'disconnected' });
  }
  res.json({ status: 'ok' });
});
const publicDirectory = path.join(__dirname, '..', 'public');
const cleanPages = {
  '/admin': 'admin.html',
  '/acheter': 'achat.html',
  '/vendre': 'vente.html',
  '/attente': 'attente.html',
  '/contact': 'contact.html',
  '/suivi': 'suivi.html',
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
    res.sendFile(path.join(publicDirectory, filename), (error) => {
      if (error) next(error);
    });
  });
}
for (const [legacyPath, cleanPath] of Object.entries(legacyPages)) {
  app.get(legacyPath, (req, res) => {
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
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
app.use('/api/admin', adminLimiter, (req, res, next) => {
  if (req.path === '/auth/login' && req.method === 'POST') return adminLoginLimiter(req, res, next);
  next();
}, require('./routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Route introuvable' }));

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
connectDB()
  .then(() => app.listen(PORT, () => console.log('Serveur sur http://localhost:' + PORT)))
  .catch((err) => {
    console.error('Démarrage impossible :', err.message);
    process.exit(1);
  });
