const INFOBIP_URL = 'https://api.infobip.com';

function normalizePhoneNumber(phoneNumber) {
  const raw = String(phoneNumber || '').trim();
  if (!raw) throw new Error('Numéro de téléphone manquant');
  const digits = raw.replace(/\D/g, '');
  if (!digits || digits.length < 8 || digits.length > 15) {
    throw new Error('Numéro de téléphone invalide');
  }
  return digits;
}

function buildSMSRequest(to, text, sender) {
  return {
    messages: [{
      destinations: [{ to }],
      sender,
      content: { text },
    }],
  };
}

async function sendSMS(phoneNumber, message) {
  const apiKey = process.env.INFOBIP_API_KEY?.trim();
  const baseUrl = (process.env.INFOBIP_BASE_URL || INFOBIP_URL).replace(/\/+$/, '');
  const sender = process.env.INFOBIP_SENDER?.trim();
  if (!apiKey) throw new Error('INFOBIP_API_KEY non configuré');
  if (!baseUrl) throw new Error('INFOBIP_BASE_URL non configuré');
  if (!sender) throw new Error('INFOBIP_SENDER non configuré');

  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  const safeMessage = String(message || '').trim();
  if (!safeMessage) throw new Error('Message SMS vide');

  const response = await fetch(`${baseUrl}/sms/3/messages`, {
    method: 'POST',
    headers: {
      Authorization: `App ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'DAE-Crypto/1.0',
    },
    body: JSON.stringify(buildSMSRequest(normalizedPhone, safeMessage, sender)),
    signal: AbortSignal.timeout(15000),
  });

  const responseText = await response.text();
  if (!response.ok) {
    const detail = responseText.slice(0, 500) || `Infobip a répondu avec le statut ${response.status}`;
    throw new Error(`Infobip a refusé l’envoi SMS: ${detail}`);
  }

  try {
    return JSON.parse(responseText || '{}');
  } catch {
    return { raw: responseText };
  }
}

module.exports = { normalizePhoneNumber, sendSMS, buildSMSRequest };
