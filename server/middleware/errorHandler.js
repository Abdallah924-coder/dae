'use strict';

const { logger } = require('../lib/logger');

module.exports = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  logger.error({
    err,
    req: { id: req.id, method: req.method, url: req.originalUrl },
  }, `Serveur error ${status}`);
  res.status(status).json({
    error: status >= 500 ? 'Erreur serveur' : (err.message || 'Une erreur est survenue'),
  });
};