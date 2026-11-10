'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const adminAuth = require('./adminAuth');

const ENV_KEYS = [
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
  'ADMIN_SECOND_EMAIL',
  'ADMIN_SECOND_PASSWORD',
  'ADMIN_SESSION_SECRET',
];

function withAdminEnvironment(values, callback) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    callback();
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('supports two independent admin credentials and binds sessions to their identity', () => {
  withAdminEnvironment({
    ADMIN_EMAIL: 'owner@example.test',
    ADMIN_PASSWORD: 'first-secret',
    ADMIN_SECOND_EMAIL: 'reviewer@example.test',
    ADMIN_SECOND_PASSWORD: 'second-secret',
    ADMIN_SESSION_SECRET: 'test-secret-with-more-than-thirty-two-characters',
  }, () => {
    assert.equal(adminAuth.secondAdminConfigured(), true);
    assert.deepEqual(adminAuth.configuredAdmins().map((admin) => admin.email), [
      'owner@example.test',
      'reviewer@example.test',
    ]);
    assert.equal(adminAuth.sessionEmail(adminAuth.createSession('reviewer@example.test')), 'reviewer@example.test');
    let responseBody;
    adminAuth.login({
      body: { email: 'REVIEWER@example.test', password: 'second-secret' },
    }, {
      json(body) {
        responseBody = body;
      },
    }, (error) => {
      throw error;
    });
    assert.equal(responseBody.email, 'reviewer@example.test');
    assert.equal(adminAuth.sessionEmail(responseBody.token), 'reviewer@example.test');
  });
});

test('does not count missing, duplicate or shared credentials as an independent second admin', () => {
  withAdminEnvironment({
    ADMIN_EMAIL: 'owner@example.test',
    ADMIN_PASSWORD: 'same-secret',
    ADMIN_SECOND_EMAIL: 'owner@example.test',
    ADMIN_SECOND_PASSWORD: 'same-secret',
    ADMIN_SESSION_SECRET: 'test-secret-with-more-than-thirty-two-characters',
  }, () => {
    assert.equal(adminAuth.secondAdminConfigured(), false);
    assert.equal(adminAuth.configuredAdmins().length, 1);
  });
});

test('revokes an admin session if that identity is removed from configuration', () => {
  withAdminEnvironment({
    ADMIN_EMAIL: 'owner@example.test',
    ADMIN_PASSWORD: 'first-secret',
    ADMIN_SECOND_EMAIL: 'reviewer@example.test',
    ADMIN_SECOND_PASSWORD: 'second-secret',
    ADMIN_SESSION_SECRET: 'test-secret-with-more-than-thirty-two-characters',
  }, () => {
    const token = adminAuth.createSession('reviewer@example.test');
    process.env.ADMIN_SECOND_EMAIL = '';
    process.env.ADMIN_SECOND_PASSWORD = '';
    assert.equal(adminAuth.sessionEmail(token), null);
  });
});
