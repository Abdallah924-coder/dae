const express = require('express');
const { contactMessage } = require('../services/email');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim();
  const message = String(req.body?.message || '').trim();
  if (name.length < 1 || name.length > 100) {
    return res.status(400).json({ error: 'Nom invalide (100 caractères maximum)' });
  }
  if (email.length > 160 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Adresse e-mail invalide' });
  }
  if (message.length < 1 || message.length > 1500) {
    return res.status(400).json({ error: 'Message invalide (1 500 caractères maximum)' });
  }
  if (!process.env.ADMIN_EMAIL?.trim()) {
    console.error('Envoi du formulaire de contact impossible : ADMIN_EMAIL non configuré');
    return res.status(503).json({ error: 'Le formulaire de contact est temporairement indisponible.' });
  }

  try {
    await contactMessage({ name, email, message });
    res.json({ ok: true });
  } catch (error) {
    console.error('Échec de livraison du formulaire de contact via Brevo:', error.message);
    res.status(502).json({ error: 'Votre message n’a pas pu être envoyé. Réessayez plus tard.' });
  }
});

module.exports = router;
