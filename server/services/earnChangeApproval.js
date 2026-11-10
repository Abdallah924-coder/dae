'use strict';

function canResolveEarnChange(proposal, adminEmail, now = new Date()) {
  return Boolean(
    proposal &&
    proposal.status === 'pending' &&
    String(proposal.proposerEmail).toLowerCase() !== String(adminEmail).toLowerCase() &&
    proposal.expiresAt instanceof Date &&
    proposal.expiresAt > now,
  );
}

module.exports = { canResolveEarnChange };
