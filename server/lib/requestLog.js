'use strict';

const crypto = require('node:crypto');

function safeRequestPath(req) {
  const pathname = req.path || '/';
  return pathname
    .replace(/^\/api\/admin\/orders\/[^/]+(?=\/|$)/, '/api/admin/orders/:ref')
    .replace(/^\/api\/orders\/[^/]+(?=\/|$)/, '/api/orders/:ref');
}

function hashOrderReference(reference) {
  return crypto.createHash('sha256').update(String(reference || '')).digest('hex').slice(0, 16);
}

module.exports = { safeRequestPath, hashOrderReference };
