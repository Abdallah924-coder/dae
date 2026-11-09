'use strict';

const pino = require('pino');

function safeErrorSerializer(error) {
  if (!error || typeof error !== 'object') return { type: 'Error' };
  const summary = {
    type: typeof error.name === 'string' ? error.name.slice(0, 80) : 'Error',
  };
  if (['string', 'number'].includes(typeof error.code)) {
    summary.code = String(error.code).slice(0, 80);
  }
  const status = Number(error.status || error.statusCode);
  if (Number.isInteger(status) && status >= 100 && status <= 599) summary.status = status;
  return summary;
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  serializers: { err: safeErrorSerializer },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'body.password',
      'req.body.password',
      'BREVO_API_KEY',
      'INFOBIP_API_KEY',
      'ADMIN_SESSION_SECRET',
      'MONGODB_URI',
    ],
    censor: '[REDACTED]',
  },
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});

module.exports = { logger };
