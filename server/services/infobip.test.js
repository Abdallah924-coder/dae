const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhoneNumber, sendSMS, buildSMSRequest } = require('./infobip');

test('normalizePhoneNumber strips formatting and keeps the phone number valid', () => {
  assert.equal(normalizePhoneNumber('+242 06 472 93 91'), '242064729391');
  assert.equal(normalizePhoneNumber('242064729391'), '242064729391');
  assert.throws(() => normalizePhoneNumber('abc'), /Numéro de téléphone invalide/);
});

test('buildSMSRequest uses the Infobip payload structure', () => {
  const payload = buildSMSRequest('242064729391', 'Votre transaction a bien été reçue et est actuellement en attente de traitement. Nous vous informerons dès sa validation.', '447491163443');
  assert.deepEqual(payload.messages[0].destinations, [{ to: '242064729391' }]);
  assert.equal(payload.messages[0].sender, '447491163443');
  assert.match(payload.messages[0].content.text, /actuellement en attente de traitement/);
});

test('sendSMS uses the Infobip API and returns a message id', async () => {
  process.env.INFOBIP_API_KEY = 'test-key';
  process.env.INFOBIP_BASE_URL = 'https://example.test';
  process.env.INFOBIP_SENDER = '447491163443';

  let request;
  global.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return { ok: true, text: async () => JSON.stringify({ messages: [{ messageId: 'abc123' }] }) };
  };

  const result = await sendSMS('+242 06 472 93 91', 'Bonjour');
  assert.equal(request.url, 'https://example.test/sms/3/messages');
  assert.equal(request.body.messages[0].destinations[0].to, '242064729391');
  assert.equal(result.messages[0].messageId, 'abc123');
});
