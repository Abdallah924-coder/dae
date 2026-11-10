'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { formatRayPercent } = require('./earnProtocols');

test('formats Aave ray-scaled annual rates as percentages without floating point', () => {
  assert.equal(formatRayPercent(0n), '0.00');
  assert.equal(formatRayPercent(10n ** 27n), '100.00');
  assert.equal(formatRayPercent(25n * 10n ** 24n), '2.50');
  assert.equal(formatRayPercent(19999999999999999999999999n), '1.99');
});
