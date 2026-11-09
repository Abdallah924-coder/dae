'use strict';

const { logger } = require('../lib/logger');
const { safeRequestPath } = require('../lib/requestLog');

module.exports = (err, req, res, _next) => {
  if (err.code === 'ERR_ORDER_TRANSACTIONS_REQUIRED') {
    return res.status(503).json({
      error: 'Les commandes sont indisponibles : configurez MongoDB en replica set ou cluster compatible.',
    });
  }
  const status = err.status || err.statusCode || 500;
  if (err.code === 'ERR_ORDER_IDEMPOTENCY_CONFLICT') {
    return res.status(409).json({ error: err.message, code: err.code, orderRef: err.orderRef });
  }
  logger.error(
    {
      err,
      req: { id: req.id, method: req.method, path: safeRequestPath(req) },
    },
    `Serveur error ${status}`,
  );
  res.status(status).json({
    error: status >= 500 ? 'Erreur serveur' : err.message || 'Une erreur est survenue',
  });
};
