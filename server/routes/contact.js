'use strict';

const express = require('express');
const { contactMessage } = require('../services/email');
const { validate, contactSchema } = require('../lib/validate');
const { logger } = require('../lib/logger');

const router = express.Router();

router.post('/', validate(contactSchema), async (req, res) => {
  if (!process.env.ADMIN_EMAIL?.trim()) {
    logger.error('Envoi du formulaire de contact impossible : ADMIN_EMAIL non configuré');
    return res
      .status(503)
      .json({ error: 'Le formulaire de contact est temporairement indisponible.' });
  }

  try {
    await contactMessage(req.body);
    res.json({ ok: true });
  } catch (error) {
    logger.error({ err: error }, 'Échec de livraison du formulaire de contact via Brevo');
    res.status(502).json({ error: 'Votre message n’a pas pu être envoyé. Réessayez plus tard.' });
  }
});

module.exports = router;
