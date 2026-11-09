'use strict';

const Customer = require('../models/Customer');
const CustomerSession = require('../models/CustomerSession');
const { hashToken, sessionCookie, publicCustomer } = require('../services/customerAuth');

module.exports = async function customerAuth(req, res, next) {
  try {
    const token = sessionCookie(req);
    if (!token) return res.status(401).json({ error: 'Connectez-vous pour continuer' });

    const session = await CustomerSession.findOne({
      tokenHash: hashToken(token),
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!session) return res.status(401).json({ error: 'Session expirée, reconnectez-vous' });

    const customer = await Customer.findById(session.customerId);
    if (
      !customer ||
      customer.status !== 'active' ||
      !customer.emailVerifiedAt ||
      !customer.phoneVerifiedAt
    ) {
      return res.status(403).json({ error: 'Ce compte ne peut pas accéder à la plateforme' });
    }

    req.customer = customer;
    req.customerSession = session;
    req.publicCustomer = publicCustomer(customer);
    next();
  } catch (error) {
    next(error);
  }
};
