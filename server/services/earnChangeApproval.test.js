'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canResolveEarnChange } = require('./earnChangeApproval');

const now = new Date('2026-11-10T12:00:00.000Z');
const proposal = {
  status: 'pending',
  proposerEmail: 'first@example.test',
  expiresAt: new Date('2026-11-11T12:00:00.000Z'),
};

test('only a distinct admin can resolve a pending, unexpired Earn proposal', () => {
  assert.equal(canResolveEarnChange(proposal, 'second@example.test', now), true);
  assert.equal(canResolveEarnChange(proposal, 'FIRST@example.test', now), false);
  assert.equal(canResolveEarnChange({ ...proposal, status: 'approved' }, 'second@example.test', now), false);
  assert.equal(canResolveEarnChange({
    ...proposal,
    expiresAt: new Date('2026-11-10T11:59:59.999Z'),
  }, 'second@example.test', now), false);
});
